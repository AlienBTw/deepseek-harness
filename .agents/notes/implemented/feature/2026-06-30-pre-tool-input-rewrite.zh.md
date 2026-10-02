# Agent Note: 工具执行前输入重写——一致性设计

Status: implemented

[English](2026-06-30-pre-tool-input-rewrite.md) | 中文

## 问题

[拦截扩展点 Agent Note](../feature/2026-06-30-interception-extension-points.zh.md) 将 `tools/pre-execute` 定义为一道针对执行的允许/拒绝/询问门禁，此时执行的身份标识已受保护、参数已被深度冻结。Claude Code 的 `PreToolUse` 钩子还提供了 `updatedInput`，因此忠实的桥接需要一个显式的重写机制。重写不能是对现有执行对象的可变逃逸口：它必须保持持久化历史、审计记录、展示层与实际执行值之间的一致性。

## 决策

重写是由 agent loop（智能体循环）拥有、在 `dsh-tools` 上声明为 `tools/pre-rewrite` waterfall（瀑布式事件）的「身份标识创建前一致性事务」。loop 在每个模型工具调用的持久化 `tool/call` 提交之前、以及注册表铸造不可变 `ToolExecution` 之前解析该决策。生效参数提交之后，普通的允许/拒绝/询问流水线在已密封的身份标识上照常运行。

### 已定设计选择

1. **派生历史：** 就地 surface-replace（表面替换）该步的 `assistant/message` 工具调用块，使 `deriveMessages()` 与下一次提供方请求携带生效参数（Claude Code 的模型：模型看到重写已生效）。被遮蔽的 append-origin 事件保留模型原始输出，供人类转写使用。单独的修正事件被否决，因为那会为同一事实引入第二套模型可见词汇。
2. **审计伴随字段：** `tool/call.arguments` 存储生效的原始 JSON 字符串；发生重写时，可选的 `tool/call.originalArguments` 保留模型未解析的原始输出。未发生重写时该字段缺席。
3. **专门的更早扩展点：** `tools/pre-rewrite` 返回 `keep` | `rewrite`。允许/拒绝/询问仍留在 `tools/pre-execute`。钩子桥接在重写阶段只运行一次 `PreToolUse`，缓存合并结果，并在 `tools/pre-execute` 映射缓存的权限决策，从而避免钩子运行两次。直接的 `ctx.tools.execute()`（无 loop）仍只在 `tools/pre-execute` 运行 PreToolUse——该路径没有 assistant/message 或 `tool/call` 一致性问题。
4. **与 ask 的交互：** 重写先完成；`ask` 与单调守卫观察的是已重写的 `ToolExecution`。用户批准的是将要运行的内容；原始输出仅保留在审计伴随字段中。

### 顺序（已固定）

```text
assistant/message (model emission)
  -> tools/pre-rewrite (+ hook/invoked|hook/result when a bridge runs PreToolUse)
  -> [assistant/message surface replace when rewritten]
  -> tool/call (effective arguments; optional originalArguments)
  -> ToolExecution mint (frozen effective arguments)
  -> tools/pre-execute → guards → tools/execute → …
```

### 桥接映射

- Claude Code：`updatedInput` 整体替换待定参数（`tool_input` 即完整参数对象）。
- Codex：`updatedInput` 遵循 Codex 的 `{ command }` 暴露——字符串 `command` 拼入对象参数；否则钩子对象整体替换待定值。`mergeHookOutputs` 中匹配钩子的最后一个非 `undefined` 的 `updatedInput` 生效。

## 曾考虑的替代方案

### 为什么不直接修改执行对象？

允许 pre-execute 监听器赋值 `exec.arguments` 只能提供执行层面的重写，模型历史、审计和展示层不会随之改变。保持身份标识受保护使得这种局部行为不可表达。

### 为什么不把重写并入 `PreToolDecision`？

当 `tools/pre-execute` 触发时，`tool/call` 已经记入日志，`ToolExecution` 身份已密封。扩展该决策无法原子地更新三个读取方。

### 为什么不为派生历史使用单独的修正消息？

第二个模型可见事件会重复工具调用事实，并迫使每个消费方学习叠加规则。Surface replace 复用现有的压缩/替换机制，并与 Claude Code「重写已生效」的转写一致。

## 后果

- 原生插件在 `tools/pre-rewrite` 上订阅参数变换，并继续在 `tools/pre-execute` 上做允许/拒绝/询问。
- CC/Codex 桥接兑现 `updatedInput`，不再发出先前的忽略警告。
- 展示层（`presentCall`/`presentResult`）继续读取 `tool/call.arguments`，该字段现在始终命名实际运行的内容。
- 证据：`packages/core/agent-loop/tests/interception.spec.ts`（`tools/pre-rewrite`）；Claude Code / Codex 的 `updatedInput` coverage cases；`packages/hooks/hook-protocol/tests/merge.spec.ts` 的 last-wins 折叠。
