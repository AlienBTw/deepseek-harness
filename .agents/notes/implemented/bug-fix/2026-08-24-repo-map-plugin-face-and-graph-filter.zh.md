# Agent Note: repo-map 插件形态、无标签文件过滤与伴生门禁合规

Status: implemented

English | [2026-08-24-repo-map-plugin-face-and-graph-filter.md](2026-08-24-repo-map-plugin-face-and-graph-filter.md)

## Problem

repo-map 上下文提供者发布时带着本应被自身门禁拦住的缺陷。该插件混用了具名导出和 `export default`,Loader 的 `unwrapExports` 只保留了默认导出对象并丢弃了命名空间——包括 `inject: ['agents']`——复现了已记录的 ACP 默认导出失败类别。无标签文件过滤器用 `` definitions.has(`${file}\u0000`) `` 判定成员关系,而映射从不存储这种键形(其键是 `` `${rel_fname}\u0000${name}` ``),因此过滤器退化为空操作,拥有定义但未获得排名的文件可能渲染为重复的裸哨兵。该包还没有不变量伴生文件、清单导出或项目引用,违反了每个包必须持有 `./invariant` 的规则,且其测试从未通过真实 Loader 组合来驱动插件。

## Decision

repo-map 现在遵循所有同级上下文提供者使用的函数插件形态:仅具名导出(`name`、`inject`、`Config`、`apply`)且没有默认导出,Loader 因此保留包含注入服务的完整命名空间。

`buildRankedTags` 通过取每个定义键中 NUL 分隔符之前的前缀来推导定义所属文件的集合。只有当文件不拥有任何定义条目且未通过排名标签出现时才视为无标签;不含分隔符的畸形键不归属任何文件。行为与其镜像的 Aider repomap 排名阶段一致。

该包以自身包名注册,发布了手工持有的 `src/invariant.ts` 伴生文件。它验证每一条持久的 repo-map 读取:恰好一个文本块、包所有的标题行、section 文本等于消息体且不多不少的快照 source,以及落在开放回合内的追加。验证运行于分发时、会话创建时的种子历史,以及伴生安装时已存储的全部会话。清单发布 `./invariant`,将 `@maple/invariants` 声明为 peer 与 dev 依赖,包 tsconfig 引用 invariants 运行时。

组合覆盖通过真实 Loader + Include 从测试专用的 cordis.yml 启动插件,作用于由真实 Tree-Sitter 语法解析的夹具工作区,断言持久的首步注入、每回合重注入、安静的后继步骤以及释放。

## Alternatives considered

**保留默认导出并将 `inject` 加到它上面。** 否决:只要存在默认导出,Loader 就会丢弃命名空间,任何具名导出元数据在那里都不可靠;packages/AGENTS.md 背后的复盘已经排除了混合形态。

**在循环内对每个文件探测 `definitions.get()` 来修复过滤器。** 否决:它会对每个键重扫全部文件;推导一个前缀集合是线性的,并保持哨兵路径零分配。

**把 graph.ts 低于覆盖门禁留作既有债务。** 就本次修复相邻的分支而言不可接受:个性化上限、仅有定义的自环、分隔符前缀推导正是过滤器依赖的行为,所以直接钉住;其余未触及的辅助分支仍作为已记录债务保留。

## Verification

单元测试钉住修正后的过滤器:有排名的定义文件不再重复渲染为哨兵、未排名的定义属主留在哨兵集合之外、聊天文件的哨兵保持抑制、排序遵循节点排名、无分隔符的键不认领文件。不变量测试覆盖每条拒绝臂以及外来 source 旁路与安装期校验。组合套件覆盖 Loader 形态、首步注入、每回合重注入与 fiber 释放。`verify-package-invariants` 接受全部伴生文件。

## Consequences

在格式良好的工作区上模型看到的 repository-map 文本与之前相同;可见变化局限于此前会把未排名定义属主渲染成重复哨兵的工作区。未来重新引入默认导出或破坏快照契约的改动会在测试中失败,而不是静默丢失注入。该包在 `tree-context.ts`、`parser.ts` 和 `queries.ts` 中仍低于逐文件 100% 分支门禁——这些是与此修复无关的既有缺口,在被单独处理前 CI 覆盖率通道仍会标记。
