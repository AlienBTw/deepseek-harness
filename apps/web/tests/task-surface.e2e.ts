// Web e2e scenario: a seeded session whose final tool/result carries Task Surface
// presentation metadata renders the Task Surface dock without a model call.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/task-surface/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/task-surface', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/task-surface/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'task-surface-web-e2e'
const PROMPT = 'Use the show_task_surface tool with title "Choose Environment", description "Pick staging or production.", one markdown section saying "Pick staging or production.", a required choice field "env" labeled "Environment" with Staging and Production options, and submit label "Continue". After the tool returns, stop.'

describe.skipIf(MODE === 'record')('web e2e: Task Surface dock over seeded session', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.locator('[data-task-surface-dock]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows sections, fields, dismiss, and submit on the active Task Surface dock', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-task-surface'))
    const dock = page.locator('[data-task-surface-dock]')
    await expect.poll(() => dock.getByText('Choose Environment', { exact: true }).count()).toBe(1)
    await expect.poll(() => dock.getByText('Pick staging or production.').count()).toBeGreaterThan(0)
    await expect.poll(() => dock.getByRole('radio', { name: 'Staging' }).count()).toBe(1)
    await expect.poll(() => dock.getByRole('button', { name: 'Dismiss' }).count()).toBe(1)
    await expect.poll(() => dock.getByRole('button', { name: 'Continue' }).count()).toBe(1)

    const snapshot = (await captureStableAria(page, '[data-task-surface-dock]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
