# Trace TypeScript Harness Runtime

这是 Trace 从 Python 脚本迁移到 TypeScript Harness 的新边界。它参照 `D:/AGeneral Workspace/AI-powered/harness/deepseek-harness` 的包组、应用、SDK、profile、patch 和 native 分发分工，但只迁移 Trace 已经有协议证据的行为。

## 当前可运行链

```text
@trace/protocol ← @trace/storage ← @trace/{data,change-set,continuity,context,precedent,capability-candidate,capability,operations} ← @trace/runtime
                                      ↑
                         integration/zhihu-precedent + integration/zhihu-transport
                         integration/mywiki-source + host/codex-skill + host/codex-hooks
                                                                                ↓
                                      apps/cli ← sdk/server ← sdk/typescript
                                                    ↑                 ↑
                                              python/sdk       apps/codex/desktop

@trace/sdk-protocol 只定义跨进程 wire types，引用 core 类型但不持有领域状态。
```

```powershell
Set-Location D:\文档\MyWiKi\tools\trace_runtime
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:python
```

本项目已迁移到 pnpm 10 workspace：根 `package.json` 固定 `packageManager` 和 Node/pnpm engine，`pnpm-workspace.yaml` 集中维护 catalogs、依赖构建白名单和内部 `workspace:*` 关系，`pnpm-lock.yaml` 是可复现安装的唯一 Node 依赖锁文件。TypeScript 构建不再引用外部 `../capability_runtime/node_modules`。Python SDK 使用 `pyproject.toml` + `uv.lock`；Ruff 只负责 Python lint/format，不能替代 TS 类型检查。

CLI 和 RPC 支持两种明确的状态布局：开发兼容模式分别传入 `--change-state-file <绝对路径>` 与 `--data-state-file <绝对路径>`；产品模式传入一个 `--sqlite-state-file <绝对路径>`，由 SQLite 分表保存 change、data 和 continuity。不会猜测仓库或用户目录，也不会把变化日志和数据日志混成同一逻辑表：

```powershell
node dist/apps/cli/src/main.js change list --change-state-file D:\tmp\trace-change-sets.jsonl --data-state-file D:\tmp\trace-data.jsonl
node dist/packages/sdk/server/src/main.js --change-state-file D:\tmp\trace-change-sets.jsonl --data-state-file D:\tmp\trace-data.jsonl
node dist/apps/cli/src/main.js continuity list --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js codex activate --sqlite-state-file D:\tmp\trace.db --thread-id thread-1 --purpose "继续 Agent 协作问题" --summary "只使用受控来源指针" --source-ref '{"record_id":"source-1","revision":1,"label":"local"}'
node dist/apps/cli/src/main.js doctor run --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js backup create --sqlite-state-file D:\tmp\trace.db --backup-file D:\tmp\trace.backup.sqlite
node dist/apps/cli/src/main.js restore run --backup-file D:\tmp\trace.backup.sqlite --sqlite-state-file D:\tmp\trace-restored.db
node dist/apps/cli/src/main.js capability preview --spec D:\tmp\capability-spec.json --candidate-dir D:\tmp\candidate --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js capability stage --spec D:\tmp\capability-spec.json --candidate-dir D:\tmp\candidate --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js capability validate --candidate-dir D:\tmp\candidate --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js capability publish --candidate-dir D:\tmp\candidate --sqlite-state-file D:\tmp\trace.db --approval "用户已审阅并采纳" --receipt D:\tmp\capability-receipt.json
node dist/apps/cli/src/main.js capability rollback --receipt D:\tmp\capability-receipt.json
node dist/apps/cli/src/main.js template preview --manifest templates/codex-starter/manifest.json
node dist/apps/cli/src/main.js template list
node dist/apps/cli/src/main.js zhihu search --profile D:\abs\zhihu-profile.json --query "agent collaboration" --count 10
node dist/apps/cli/src/main.js zhihu search --profile D:\abs\zhihu-profile.json --query "agent collaboration" --count 10 --capture-run-id run-1 --sqlite-state-file D:\tmp\trace.db
node dist/apps/cli/src/main.js mywiki search --profile D:\abs\mywiki-profile.json --query "Agent 协作" --limit 8
node dist/apps/cli/src/main.js mywiki read --profile D:\abs\mywiki-profile.json --page wiki/capabilities/collaboration/共同思考协作能力.md
node dist/apps/cli/src/main.js skill preview --skill-root C:\abs\codex\skills --source-dir D:\abs\published-skill
node dist/apps/cli/src/main.js skill install --skill-root C:\abs\codex\skills --source-dir D:\abs\published-skill --backup-root D:\abs\trace-backups --approval "approve:trace-agent-collaboration"
node dist/apps/cli/src/main.js skill rollback --receipt D:\abs\trace-skill-install-receipt.json
node dist/apps/cli/src/main.js hooks preview --hooks-file C:\abs\codex\hooks.json --command "node D:\abs\trace\dist\apps\cli\src\main.js codex hook-stdio --sqlite-state-file D:\abs\trace.db"
node dist/apps/cli/src/main.js hooks install --hooks-file C:\abs\codex\hooks.json --command "node D:\abs\trace\dist\apps\cli\src\main.js codex hook-stdio --sqlite-state-file D:\abs\trace.db" --backup-root D:\abs\trace-backups --approval "approve:codex-hooks"
node dist/apps/cli/src/main.js migrate sqlite --change-state-file D:\tmp\trace-change-sets.jsonl --data-state-file D:\tmp\trace-data.jsonl --sqlite-state-file D:\tmp\trace.db
$env:TRACE_PACKAGE_DIR = 'D:\tmp\trace-runtime-package'; corepack pnpm package
node D:\tmp\trace-runtime-package\native\install.mjs --target D:\tmp\trace-installed
D:\tmp\trace-installed\native\launcher\trace-runtime.cmd doctor run --sqlite-state-file D:\tmp\trace.db
```

当前第一条垂直切片是 Change Set + Data Ledger；本轮增加 SQLite Ledger、Continuity（主题/讨论回合/沉淀回执/激活回执）、Activation Pack、模板契约、锁定文件和 JSONL→SQLite staging migration。数据记录必须携带 schema、origin、producer、lineage 和 hash，并支持递归链路检查。`schemas/` 保存 JSON Schema 2020-12 结构契约，运行时 validator 继续负责语义、状态门槛和哈希链。能力链额外分离 `candidate_precedent` 与 `capability_candidate`：前者是证据，后者保存 semantic delta、判断变化、范围、反例、验收和采用状态。

当前为 root aggregate build：源码按 workspace package 分界，统一编译到 `dist/`；package.json 已声明真实的 `workspace:*` 依赖，独立 `lib/` 产物和发布门禁在各领域 parity 完成后再开启。SQLite 使用 Node 22 `node:sqlite`，产品运行时需固定 Node 版本并在启动时执行 `doctor` 检查。

Capability Publisher 已形成 `preview → stage → validate → publish → rollback` 门禁；Skill 还必须通过 `trace.capability-content@0.1.0` 的入口、触发、工作流、验收、安全和 MyWiKi provenance 校验，并指向一个已采用的 `trace.capability-candidate@0.1.0` 精确 revision。Codex Adapter 已能把 `codex.turn.started` 转换为受预算 Activation Pack，并写入 activation receipt；`@trace/integration-zhihu-transport` 负责官方 Access Secret/时间戳鉴权的真实 HTTP 请求，`@trace/integration-zhihu-precedent` 负责有界结果到 source/candidate draft 的转换；`@trace/integration-mywiki-source` 只读取用户选择的正式页，写入必须走 proposal + revision/hash CAS + 明确 approval + backup。Skill 和 hooks installer 都是原子替换、保留回滚、拒绝 symlink/traversal 的宿主边界。

逐步的可见/不可见边界和预期 revision 链见 `tests/USER_JOURNEY_REPLAY.md`；能力内容契约与官方知乎 Skill 的格式对照见 `products/trace/docs/protocols/Trace 能力内容契约 v0.1.md`。

`corepack pnpm package` 要求调用方通过 `TRACE_PACKAGE_DIR` 或 `--out ABS` 提供绝对输出目录；它打包 `dist/`、schemas、profiles、bundle、templates、薄 Python SDK、native installer/launcher 和 `release-manifest.json`，不打包用户 SQLite、私有 Wiki、凭证或运行时日志。`.changeset/` 已准备本轮版本图，但不会在没有发布授权时自动执行 `pnpm version-packages`。

模板资源可单独审计：`corepack pnpm audit:templates`。如果需要把源码放到独立目录做 Git 远程管理，不要把发行包反向当作源码；使用 `corepack pnpm export:source -- --out ABS`。源码导出会排除 `node_modules/`、`dist/`、`tmp/`、SQLite、缓存和用户数据。

## 迁移边界

- 旧 Python runtime 已移出 active tree，归档副本位于 `D:\文档\MyWiKi\tmp\trace-python-runtime-legacy-20260909\`，不参与 build、package、CLI、RPC 或测试；如需恢复只能显式从该归档恢复。
- `python/sdk/` 是薄 RPC 客户端，不复制 TypeScript 状态机；`packages/integration/zhihu-precedent` 是可独立版本化的来源 adapter；`native/` 已提供清单校验 installer 和 launcher，只承载已验证的 runtime，不实现业务规则。
- `profiles/` 与 `packages/bundle/` 只描述组合；改变组合要先创建 Change Set，不直接覆盖源码或 Codex 配置。
- `templates/` 是只读冷启动输入；安装后生成用户 instance/lockfile，用户 overlay 与模板升级通过三方 diff，不静默覆盖本地沉淀。
- `core/continuity` 只保存用户可理解的连续性摘要和回执，不把完整聊天记录冒充认知源；`core/context` 生成渐进式 Activation Pack，不直接拼宿主 prompt。
- 用户级 Skill 与 Codex hooks 的实际切换由 `skill install` / `hooks install` 执行，默认 preview；必须显式 `approve:<id>`，自动备份且可 rollback。实现不把每个用户的 MyWiKi 语义内容写进模板：模板只提供结构、权限和冷启动 source-pack，用户在安装时选择自己的认知源 profile。

完整的物理边界、四层映射和迁移顺序见 [[Trace TypeScript Harness 分包架构]]。

迁移是否真的完成按 `MIGRATION_STATUS.md` 判定：它逐领域列出已验证、已实现但未接宿主、有意保留的薄 SDK 和明确延期的宿主/分发工作，避免用目录重命名掩盖缺失链路。
