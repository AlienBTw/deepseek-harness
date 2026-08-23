//! Maple desktop shell: one native window over the harness's own local server.
//!
//! The shell owns no UI of its own beyond a static splash page. It boots the
//! existing web profile (`dsh web --no-open --port 0`) as a child process,
//! watches the child's stdout for the readiness line the web bundle prints
//! (`dsh web: http://127.0.0.1:<port>`), then navigates this window to that
//! URL. Every capability the browser surface has — RPC gateway, plugin
//! roster, native directory picker — stays owned by the harness composition;
//! the shell adds only windowing and lifetime.
//!
//! Debug builds launch the CLI from source through tsx (the same launch the
//! repo's root `pnpm dsh` script uses); release builds run the built
//! `apps/cli/lib/bin.js`, so packaging requires `pnpm run build` first.
//! `MAPLE_DESKTOP_LAUNCH=built|source` overrides either default. The host
//! child runs inside a kill-on-close job object, so it cannot outlive this
//! process even when cleanup never runs, and fatal startup errors surface in
//! a dialog because a GUI-subsystem binary has no stderr to print them on.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, Url};

/// How long the shell waits for the host's readiness line before giving up.
/// First boots transform every plugin module through tsx, so the budget is
/// generous rather than tuned.
const READY_TIMEOUT: Duration = Duration::from_secs(180);

/// Silence budget on the source-launch plane before the shell suggests the
/// built-binary fallback: long enough for a cold tsx transform pass, short
/// enough that the hint arrives while someone is still watching.
const SOURCE_STALL_HINT: Duration = Duration::from_secs(45);

/// How often the supervisor wakes to check readiness, silence, and deadline.
const SUPERVISE_INTERVAL: Duration = Duration::from_secs(2);

/// Marker written by the stdout pump once the readiness line was seen.
static HOST_READY: AtomicBool = AtomicBool::new(false);

/// Marker set while the shell itself terminates the child (window close or
/// fallback relaunch), so the pump stays quiet about the intended death.
static KILLING_HOST: AtomicBool = AtomicBool::new(false);

/// Wall-clock milliseconds since {@link START} of the last child output line;
/// the stall hint reads the gap between now and this.
static LAST_OUTPUT_MS: AtomicU64 = AtomicU64::new(0);

/// Boot timestamp anchoring every elapsed computation.
fn start() -> Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    *START.get_or_init(Instant::now)
}

/// Milliseconds since {@link start}.
fn elapsed_ms() -> u64 {
    start().elapsed().as_millis() as u64
}

/// The spawned harness host, kept for termination when the window closes.
struct HostProcess(Mutex<Option<Child>>);

/// Report a fatal startup condition and exit: stderr first for terminals,
/// then a native dialog because a GUI-subsystem release binary has no other
/// surface a double-clicking user would ever see.
fn fatal(message: String) -> ! {
    eprintln!("[maple] {message}");
    #[cfg(all(windows, not(debug_assertions)))]
    {
        rfd::MessageDialog::new()
            .set_title("Maple")
            .set_description(&message)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
    std::process::exit(1);
}

/// Whether `candidate` holds the repository markers the shell needs.
fn looks_like_repo(candidate: &Path) -> bool {
    candidate.join("pnpm-workspace.yaml").is_file()
        && candidate.join("apps").join("cli").join("src").is_dir()
}

/// Walk up from `start` looking for the repository root: the nearest ancestor
/// holding both the workspace manifest and the CLI app.
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start.to_path_buf());
    while let Some(candidate) = dir {
        if looks_like_repo(&candidate) {
            return Some(candidate);
        }
        dir = candidate.parent().map(Path::to_path_buf);
    }
    None
}

/// Hint files naming the checkout for installs that live outside one: a
/// `maple-desktop.repo` file dropped beside the executable, or the per-user
/// `%APPDATA%\Maple\repo-root.txt`. Each names an absolute checkout path.
fn hint_files(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut hints = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            hints.push(dir.join("maple-desktop.repo"));
        }
    }
    if let Some(dir) = app.path().app_data_dir().ok() {
        hints.push(dir.join("repo-root.txt"));
    }
    hints
}

/// Resolve the repository root: the `MAPLE_DESKTOP_REPO_ROOT` override wins,
/// then ancestors of the current directory and the executable, then hint
/// files naming a checkout for installs that live outside one.
fn repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("MAPLE_DESKTOP_REPO_ROOT") {
        if !root.is_empty() {
            return Ok(PathBuf::from(root));
        }
    }
    let mut starts = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    for start in starts {
        if let Some(root) = find_repo_root(&start) {
            return Ok(root);
        }
    }
    for hint in hint_files(app) {
        if let Ok(text) = std::fs::read_to_string(&hint) {
            let candidate = PathBuf::from(text.trim());
            if !candidate.as_os_str().is_empty()
                && looks_like_repo(&candidate)
                && candidate.is_dir()
            {
                return Ok(candidate);
            }
        }
    }
    Err("could not locate the Maple repository root (looked upward from the \
         working directory and the executable, then checked MAPLE_DESKTOP_REPO_ROOT \
         and its hint file); set MAPLE_DESKTOP_REPO_ROOT or write the checkout path \
         to the repo-root.txt file under this app's data directory"
        .into())
}

/// Which artifact of the CLI a launch uses.
#[derive(Clone, Copy, PartialEq)]
enum LaunchPlane {
    /// The checked-in source entry through the tsx ESM hook.
    Source,
    /// The bundled `apps/cli/lib/bin.js`.
    Built,
}

impl LaunchPlane {
    fn from_env_or_default() -> Result<Self, String> {
        match std::env::var("MAPLE_DESKTOP_LAUNCH").as_deref() {
            Ok("built") => Ok(Self::Built),
            Ok("source") => Ok(Self::Source),
            Ok(other) => Err(format!(
                "MAPLE_DESKTOP_LAUNCH must be \"source\" or \"built\", got {other:?}"
            )),
            Err(_) if cfg!(debug_assertions) => Ok(Self::Source),
            Err(_) => Ok(Self::Built),
        }
    }
}

/// Spawn the harness host serving the web profile. `--port 0` lets the OS
/// pick a free port and `--no-open` suppresses the default-browser handoff;
/// the actual port arrives in the readiness line rather than being assumed.
fn spawn_host(root: &Path, plane: LaunchPlane) -> Result<Child, String> {
    let mut command = Command::new("node");
    match plane {
        LaunchPlane::Source => {
            // Debug builds mirror the root package.json's `dsh` script exactly:
            command.arg("--import").arg("tsx/esm");
            command.arg(root.join("apps/cli/src/bin.ts"));
        }
        LaunchPlane::Built => {
            // Release builds run the bin `pnpm run build` produced next to the
            // source tree.
            command.arg(root.join("apps/cli/lib/bin.js"));
        }
    }
    command.args(["web", "--no-open", "--port", "0"]);
    // Bare `tsx/esm` resolves through the checkout's own node_modules, so the
    // child must start there regardless of where the shell was launched from.
    command.current_dir(root);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // A GUI-subsystem parent gives a console child a visible console
        // window; the host's stderr still reaches this process through the
        // inherited handle and flows to whatever terminal launched dev mode.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().map_err(|error| format!("failed to spawn the dsh web host: {error}"))
}

/// Place the host inside a kill-on-close job object so it can never outlive
/// this shell: if the shell dies any death — crash, TerminateProcess, power
/// loss — the kernel closes the handle and reaps the whole child tree with
/// it, freeing the port and watchers no cleanup code would run for.
#[cfg(windows)]
fn confine_to_job(child: &Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    let job = win32job::Job::create_with_limit_info(&info)
        .map_err(|error| format!("job object creation failed: {error}"))?;
    job.assign_process(child.as_raw_handle() as isize)
        .map_err(|error| format!("job assignment failed: {error}"))?;
    // Intentional leak: the handle must outlive this call for the whole shell
    // lifetime — its closure is precisely the orphan guard. One Job struct is
    // the entire cost.
    std::mem::forget(job);
    Ok(())
}

/// Extract the loopback URL from one stdout line. The web bundle prints
/// `dsh web: http://127.0.0.1:<port>[ (LAN: …)]` once the server is bound;
/// anything else on stdout is forwarded untouched.
fn parse_ready_url(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("dsh web: ")?;
    let token = rest.split_whitespace().next()?;
    token.starts_with("http://127.0.0.1:").then(|| token.to_string())
}

/// Forward every child-stdout line to this process's stderr and act on the
/// readiness line and on the stream ending. A stream end while the shell is
/// killing the child is teardown noise; any other end means the host died and
/// the shell follows it down.
fn pump_stdout(app: tauri::AppHandle, reader: BufReader<Box<dyn std::io::Read + Send>>) {
    // A dedicated OS thread: read_line blocks, which must not occupy one of
    // the async runtime's worker threads.
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            LAST_OUTPUT_MS.store(elapsed_ms(), Ordering::SeqCst);
            if let Some(url) = parse_ready_url(&line) {
                HOST_READY.store(true, Ordering::SeqCst);
                eprintln!("[maple] host ready at {url}");
                navigate_main_window(&app, &url);
            } else {
                eprint!("[host] {line}");
            }
        }
        if KILLING_HOST.load(Ordering::SeqCst) {
            // Teardown we initiated; the death is expected and already logged.
            return;
        }
        if !HOST_READY.load(Ordering::SeqCst) {
            eprintln!("[maple] harness host exited before becoming ready");
            app.exit(1);
            return;
        }
        eprintln!("[maple] harness host exited");
        app.exit(1);
    });
}

/// Point the composed window at the live server: retitle away from the splash
/// marker and navigate off the bundled page. Runs on the pump thread; a
/// missing window means startup already tore the app down.
fn navigate_main_window(app: &tauri::AppHandle, url: &str) {
    let parsed = match Url::parse(url) {
        Ok(parsed) => parsed,
        Err(error) => {
            eprintln!("[maple] host reported an unusable URL {url}: {error}");
            app.exit(1);
            return;
        }
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.set_title("Maple") {
        eprintln!("[maple] could not retitle the window: {error}");
    }
    if let Err(error) = window.navigate(parsed) {
        eprintln!("[maple] could not navigate to the harness UI: {error}");
        app.exit(1);
    }
}

/// Terminate the host child, if any, marking the death as intentional so the
/// pump stays silent about it, and wait so the port frees before returning.
fn kill_host(host: &HostProcess) {
    KILLING_HOST.store(true, Ordering::SeqCst);
    if let Some(mut child) = host.0.lock().expect("host mutex poisoned").take() {
        let _unused = child.kill();
        let _unused = child.wait();
    }
}

/// Watch one launch attempt: raise the built-fallback hint once when a source
/// boot goes silent, and enforce the overall readiness deadline. Runs on a
/// dedicated thread because the waits are plain sleeps.
fn supervise(app: tauri::AppHandle, plane: LaunchPlane, hinted: &'static AtomicBool) {
    loop {
        std::thread::sleep(SUPERVISE_INTERVAL);
        if HOST_READY.load(Ordering::SeqCst) {
            return;
        }
        let elapsed = Duration::from_millis(elapsed_ms());
        let silent_for = elapsed - Duration::from_millis(LAST_OUTPUT_MS.load(Ordering::SeqCst));
        if plane == LaunchPlane::Source && !hinted.swap(true, Ordering::SeqCst) && silent_for >= SOURCE_STALL_HINT {
            eprintln!(
                "[maple] the tsx-launched host has produced no output for {}s while booting; \
                 if it never becomes ready, run `pnpm run build` and restart with \
                 MAPLE_DESKTOP_LAUNCH=built to launch the bundle instead",
                SOURCE_STALL_HINT.as_secs(),
            );
        }
        if elapsed >= READY_TIMEOUT {
            // Kill through shared state so the pump sees an intentional death
            // and every platform gets its cleanup, dialogs last because they
            // block.
            if let Some(host) = app.try_state::<HostProcess>() {
                kill_host(&host);
            }
            fatal(format!(
                "the harness host did not become ready within {:?}; check its output above",
                READY_TIMEOUT
            ));
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _unused = window.set_focus();
            }
        }))
        .setup(|app| {
            let root = match repo_root(app.handle()) {
                Ok(root) => root,
                Err(message) => fatal(message),
            };
            let plane = match LaunchPlane::from_env_or_default() {
                Ok(plane) => plane,
                Err(message) => fatal(message),
            };
            let mut host = match spawn_host(&root, plane) {
                Ok(host) => host,
                Err(message) => fatal(message),
            };
            #[cfg(windows)]
            if let Err(message) = confine_to_job(&host) {
                // Orphan protection is defense in depth; losing it degrades to
                // the cleanup-only path rather than blocking the launch.
                eprintln!("[maple] {message} (continuing without an orphan guard)");
            }
            // The pump takes ownership of the piped stdout before the child
            // lands in shared state, so termination never races the reader.
            let stdout = host
                .stdout
                .take()
                .expect("dsh web host was spawned with piped stdout");
            let reader = BufReader::new(Box::new(stdout) as Box<dyn std::io::Read + Send>);
            LAST_OUTPUT_MS.store(0, Ordering::SeqCst);
            start();
            app.manage(HostProcess(Mutex::new(Some(host))));

            let handle = app.handle().clone();
            pump_stdout(handle, reader);
            static HINTED: AtomicBool = AtomicBool::new(false);
            supervise(app.handle().clone(), plane, &HINTED);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("maple desktop shell failed to initialize")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(host) = app.try_state::<HostProcess>() {
                    kill_host(&host);
                }
            }
        });
}
