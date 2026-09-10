# Trace Runtime 迁移完整性状态

更新时间：2026-09-10

这份清单用来区分“已迁移并验证”“已实现但未接宿主”“有意保留的兼容边界”和“尚未迁移”。不能因为目录已经是 TypeScript 就把未验证的宿主或连接器说成完成。

## 迁移矩阵

| 领域 | TS 位置 | 状态 | 证据/边界 |
|---|---|---|---|
| 协议、错误、状态门槛与 upcaster registry | `packages/core/protocol` | 已迁移并验证 | 所有 public contract、adapter 与 host installer 复用 `requireText` / `requireObject` / `requireStringList` / `rejectUnknown`；Change Set、Data、Context、Continuity、runtime event、template/plugin/capability/candidate contract 都有显式 `0.1.0 → 0.2.0` directed in-memory path；无完整路径仍 fail-closed |
| 数据 envelope、lineage、hash、revision | `packages/core/data` | 已迁移并验证 | `0.1.0 → 0.2.0` 先校验历史 hash 后再生成内存视图；合成全链、缺父、篡改、revision gap 回归；新增不含正文的 prompt capture proposal kind |
| JSONL/SQLite 存储 | `packages/core/storage` | 已迁移并验证 | SQLite 分表；JSONL 兼容；identity-targeted 热写入、per-identity revision gap 守卫、WAL + 5 秒 busy timeout、CAS 和只读 doctor；Node 22–24.1 使用发行包内纯 JavaScript `sql.js`（asm build）fallback（受控本地文件锁与原子提交），Node >=24.2 使用稳定 `node:sqlite` |
| Change Set | `packages/core/change-set` | 已迁移并验证 | `0.1.0 → 0.2.0` in-memory upcast；proposed → analyzed → validated → adopted → promoted/rollback |
| Continuity / 沉淀与激活回执 | `packages/core/continuity` | 已迁移并验证 | `0.2.0` 顶层 correlation/causation；主题、讨论回合、用户可见 receipt；旧 `0.1.0` 只读 upcast、不改历史 revision；不保存完整转录 |
| Runtime observability | `packages/core/observability` | 已迁移并验证（Codex activation） | 同库 `trace_events`；correlation/causation、receipt refs、耗时、错误码；没有通用 payload，禁止 prompt/source body/secret/tool args 入库；`doctor --correlation-id` 查询 |
| 显式 prompt 案例沉淀 | `packages/core/case-capture` + `apps/cli` | 已迁移并验证 | `transient → hash-only proposal → user selected content + approval → source_snapshot → outcome + Change Set → candidate_precedent`；hook 不自动落库，summary/redacted/full_private 是用户选择 |
| Activation Pack / 上下文边界 | `packages/core/context` | 已迁移并验证 | 来源引用、读取指针、预算、禁止范围；不拼宿主 prompt |
| JSONL → SQLite migration | `packages/core/migration` | 已迁移并验证 | staging、源文件不改写、报告可回放 |
| Capability Publisher | `packages/core/capability` + `packages/core/capability-candidate` | 已迁移并验证 | `candidate_precedent → capability_candidate → adopted → preview → stage → validate → publish(approval) → rollback`；逐文件哈希、目标形状、Skill 内容契约、候选 revision 和认知源 provenance 门禁 |
| Codex adapter | `apps/codex` | 已迁移并验证（真实 hook 路由） | 用户级 `hooks.json` 调用 `hook-stdio --route-from-event-cwd`；按事件 cwd 发现当前 `.trace/` 并自动加载该项目 source profile；宿主收到按需绝对读取指针，SQLite receipt 只保存相对 pointer identity；无 Trace 项目成功 no-op |
| doctor / backup / restore | `packages/core/operations`、`apps/cli` | 已迁移并验证 | integrity/schema/revision；VACUUM backup 清单；restore staging + previous target |
| TypeScript SDK / JSONL RPC | `packages/sdk` | 已迁移并验证 | 与 runtime 相同方法和结果语义 |
| Python SDK | `python/sdk` | 仅保留薄适配并验证 | 只启动/调用 TS runtime RPC；`uv.lock` 已固定；不包含旧 Python runtime |
| canonical JSON Schema | `schemas/` | 已迁移并验证 | JSON Schema 2020-12 结构契约；语义仍由 runtime validator 守护 |
| native 分发边界 | `native/` | 首条可用实现已验证 | manifest-hash installer、Node launcher、Windows `.cmd`、发行内纯 JavaScript `sql.js`（asm build）fallback；还不是 SEA/签名二进制 |
| 候选前例协议 | `packages/core/precedent` + `packages/core/capability-candidate` | 已迁移并验证 | 宿主无关 payload、证据 refs、Change Set lineage；前例不能绕过语义候选直接发布 |
| 知乎候选前例 adapter | `packages/integration/zhihu-precedent` | 独立拆包并验证 | 有界知乎 API-like/fixture 输入 → source_snapshot/candidate_precedent；不负责 HTTP transport 或 adoption |
| 知乎实时 API transport | `packages/integration/zhihu-transport` | 已迁移并验证 | Node 22 fetch；官方 Access Secret + `X-Request-Timestamp`；平台搜索/全局搜索/热榜/用户接口及黑客松内容接口；无默认重试；响应码/密钥泄漏门禁 |
| MyWiKi 正式认知源 | `packages/integration/mywiki-source` | 已迁移并验证 | 用户选择 root/profile；formal `wiki/` 读；`activation_excluded_paths` 可阻止敏感正式页进入自动 activation；检索按完整短语或精度优先 token relevance；revision 由 content hash 派生，避免 coarse mtime 漏变更；source_snapshot provenance；proposal → explicit approval → hash/revision CAS → backup → atomic write |
| 确定性效果评估 | `tests/evals` + `scripts/run-evals*.mjs` | 已实现并验证（Layer 1） | 12 条 synthetic golden case；MyWiKi precision/recall、无关/禁止激活率、真实 Codex `hook-stdio --route-from-event-cwd` replay、项目隔离与 durable pointer-only 边界；`eval:pair` 生成不含 raw prompt/source body/path 的 baseline/Trace manifests；不等同于模型效果验收 |
| 用户级 Skill 替换 | `packages/host/codex-skill` + `apps/cli` | 已迁移并验证 | preview、显式 approval、staging 原子替换、备份、rollback；不把旧 Skill 放进 discovery 目录 |
| Codex hooks 切换 | `packages/host/codex-hooks` + `apps/cli` | 已迁移并验证 | 读写真实 `hooks.json` 形状，移除旧 Python / 固定项目 Trace command、保留无关 hooks、备份、CAS preview、rollback；新命令按 event cwd 路由，避免多项目串线；默认不静默修改用户配置 |
| 可选择认知源模板 | `packages/template/catalog` + `templates/*` | 已迁移并验证 | `trace.codex-starter`/`empty`/`team`；模板只提供结构/权限/source-pack，语义源由用户选择并写入 instance lock |
| 项目实例初始化与本地认知源边界 | `packages/core/instance` + `apps/cli` | 已迁移并验证 | 默认产品命令 `trace init` create-only `.trace/`；local/empty 使用项目源，external/team 使用 profile；高级兼容入口仍为 `trace internal project init`；lock 只记录 source id、hash 和 scope，不把外部绝对路径写入 project descriptor |
| 产品 CLI 与文档导航 | `apps/cli` + README.md + docs/ | 已迁移并验证 | 默认帮助只暴露 init/status/inbox/review/sources/abilities/codex/doctor/backup；协议参数收进 `trace internal` / --help --advanced；用户文档不依赖个人路径，所有项目状态从当前项目 .trace/ 发现 |
| Desktop shell | `apps/desktop` | 明确保留，未实现 | 无真实 desktop event/permission/replay contract；目录只记录准入条件，不能标记完成 |
| DeepSeek Harness adapter | `packages/integration/deepseek-harness` | 明确保留，未实现 | 无真实 host lifecycle/event contract；目录只记录插件边界和验收条件，不能伪造集成 |
| 旧 Python `tools/trace_core` | `tmp/trace-python-runtime-legacy-20260909/` | 已移出 active tree | 不参与 build、package、CLI、RPC 或测试；归档仅用于显式恢复，不作为产品 runtime |

## 结论

本轮要求的底层迁移（TS 分包、数据底座、Codex runtime adapter、能力发布、能力内容契约、doctor/backup/restore、可安装发行包）以及独立候选前例 adapter、真实知乎 transport、MyWiKi 正式页 connector、用户级 Skill/hooks installer 已形成一条可回放垂直链。旧 Python runtime 已从 active tree 去除；保留的 `python/sdk` 只是跨语言薄客户端。

“完整迁移”在这里的精确定义是：已实现领域从同一 TS 协议进入 runtime，经 CLI、Codex adapter、SDK 和发行包得到一致状态/错误语义，旧数据可读且失败可恢复；用户级 Skill/hooks 仍以 preview + 显式 approval 为产品安全边界，Desktop shell 或 SEA 二进制仍延期，不把延期项冒充完成。本轮已完成旧 Python runtime 的 active-tree 去除、真实 transport、正式源 CAS 写和宿主切换器。

## 发布前检查

```powershell
Set-Location <RUNTIME_DIR>
corepack pnpm install --frozen-lockfile
corepack pnpm check:all
corepack pnpm package -- --out <PACKAGE_DIR>
node <PACKAGE_DIR>\native\install.mjs --target <INSTALL_DIR>
```

模板资源和源码导出：

```powershell
corepack pnpm audit:templates
corepack pnpm export:source -- --out <SOURCE_EXPORT_DIR>
```

`AUDIT_20260909.md` 是当前底层后端、模板、预设上下文和能力的审查结论；它明确区分已验证的 Codex 基线、prompt capture、SQLite driver fallback，与 DeepSeek Harness/Desktop 仍未验收的真实宿主接入。

Changeset 位于 `.changeset/`；其发布基线为 `main`。`governance/version-policy.json` 与 `docs/versioning.md` 明确区分产品发行版、独立 workspace 包和协议版本；在用户明确授权前不要执行 `corepack pnpm version-packages`。发布前运行 `corepack pnpm audit:versions` 和 `corepack pnpm changeset status`。宿主切换必须通过 installer 的显式 approval 和可回滚回执，不由构建过程静默改写当前 Codex/Skill。

当前还应运行 `corepack pnpm audit:release-plan`：它会验证根 private 产品 runtime、Codex profile、Codex bundle、协议数组和 cwd 路由命令是一致的，并明确提示 workspace Changesets 不能替产品发行身份作决定。完成 effects 基线可用 `corepack pnpm eval:pair`，但它仍只是 Layer 1 retrieval/hook 证据；真实 Agent read/tool trace 与用户效果属于下一层验收。
