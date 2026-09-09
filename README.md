# Trace Runtime（TypeScript）

Trace Runtime 是一个可安装的 TypeScript 基座：它负责把「上下文、来源、数据记录、候选能力、模板和宿主触发」放进可验证、可回放、可升级的协议链路。它不把任何用户的 Wiki、凭证或聊天记录打包进发行版。

## 先给用户的结论

- **运行时代码不依赖某个用户目录。** 所有项目路径、认知源路径、状态库路径都由命令参数或项目实例配置提供。
- **每个项目都有自己的 `.trace/`。** 其中保存该项目的 SQLite 状态、候选内容、回执、备份和项目级认知源目录；启动项目不会把另一个用户的 Wiki 复制进来。
- **认知源分两种。** `local/empty` 把项目认知源放在项目内；`external/team` 只保存一个用户选择的 profile，正式页面仍留在外部个人或团队源中。
- **模板不是认知源。** 模板只提供协议、能力入口、上下文治理和冷启动结构；真正的语义内容必须由用户选择或在项目中逐步沉淀。
- **所有写入可见且需要确认。** 候选、能力发布、正式 Wiki 写入和 Codex hooks/Skill 替换都有 proposal、版本、备份和回滚边界。
- **高频 hook 不重扫整库。** SQLite 热写入只核验当前 identity 的 revision 历史；全库 integrity/schema/revision 检查保留在 `doctor`，不会让每轮 Codex 激活随着历史记录线性退化。
- **每轮运行都有安全的关联追踪。** Codex hook 仅临时用原始 prompt 检索已授权读取指针；它不会把 prompt 写进 thread、receipt、event 或 hook 输出。事件表只写 `correlation_id`、receipt reference、耗时和错误码，不含页面正文、密钥或工具参数。
- **值得沉淀的 prompt 走显式案例链，不走 hook 自动落库。** 原始 prompt 先是 transient；用户可创建不含正文的 capture proposal，再选择 `summary`、`redacted_excerpt` 或 `full_private`，明确确认后才写入 `source_snapshot`，有结果证据后才可形成 `candidate_precedent`。

## 安装与检查

在 `<RUNTIME_DIR>` 执行：

```powershell
Set-Location <RUNTIME_DIR>
corepack pnpm install --frozen-lockfile
corepack pnpm check:all
```

需要 Node.js `>=22.13.0` 和 pnpm `>=10.34.5`。SQLite driver 默认是可审计的 `auto`：Node `>=24.2.0` 使用稳定的 `node:sqlite`；Node 22–24.1 优先使用随发行包提供的纯 JavaScript `sql.js`（asm build），因此不会加载 `node:sqlite` 或产生它的 experimental warning。可用 `TRACE_SQLITE_DRIVER=auto|node|sql.js` 显式选择；强制 `node` 在 Node 24.2 前会在 doctor 输出 driver warning。`check:all` 包含 TypeScript 类型检查、模板资源审计、TS/SQLite 集成测试以及薄 Python SDK 测试。

## 为一个项目建立本地边界

这是推荐的第一次启动流程。`--confirm true` 是明确的创建确认；命令不会覆盖已有的非空 `.trace/`。

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js project init `
  --project-dir <PROJECT_DIR> `
  --user-id <USER_ID> `
  --template trace.codex-starter `
  --source-mode local `
  --confirm true
```

会创建：

```text
<PROJECT_DIR>/.trace/
├─ project.json                         # 项目实例和来源模式（不含外部绝对路径）
├─ instance/trace.lock.json             # 模板/协议/来源 profile hash 锁
├─ instance/template.manifest.json      # 本项目采用的模板清单
├─ profiles/source.profile.json         # 本地或外部来源配置（本地运行时配置）
├─ source/wiki/                        # local/empty 模式的项目认知源
├─ state/trace.sqlite                  # 运行时状态（首次写入时创建）
├─ candidates/                          # 候选前例、候选能力及其版本
├─ receipts/                            # 激活、发布、迁移等可见回执
├─ backups/                             # 状态与来源写入备份
└─ .gitignore                           # 默认忽略运行时状态和个人配置
```

连接用户已有认知源时显式选择，不会自动读取：

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js project init `
  --project-dir <PROJECT_DIR> `
  --user-id <USER_ID> `
  --template trace.codex-starter `
  --source-mode external `
  --source-profile <SOURCE_PROFILE_JSON> `
  --confirm true
```

`external` profile 至少包含 `source_id`、`root`、`user_id`；`team` 模式额外表达团队作用域。项目 lock 只记录 `source_id/profile_hash/scope_type`，不会把来源绝对路径写进可提交的 `project.json`。

## 数据链路和常用入口

产品模式统一使用一个 SQLite 文件；开发兼容模式才分别传 JSONL 文件。路径必须由调用方提供，运行时不会猜测用户目录：

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js continuity list --sqlite-state-file <STATE_FILE>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js codex activate --sqlite-state-file <STATE_FILE> --purpose "继续 Agent 协作问题" --summary "只使用受控来源指针" --source-ref '{"record_id":"source-1","revision":1,"label":"local"}'
node <RUNTIME_DIR>/dist/apps/cli/src/main.js doctor run --sqlite-state-file <STATE_FILE>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js doctor run --sqlite-state-file <STATE_FILE> --correlation-id <CORRELATION_ID>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js backup create --sqlite-state-file <STATE_FILE> --backup-file <BACKUP_FILE>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js restore run --backup-file <BACKUP_FILE> --sqlite-state-file <RESTORED_STATE_FILE>
```

### 显式 prompt 案例沉淀

Codex hook 不替用户决定“这条 prompt 值得保存”。需要沉淀时，先以文件把原始内容交给一次性 propose 命令；该命令只计算 hash 并持久化用户写的意图摘要/理由，CLI 输出不会回显正文：

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js prompt-case propose --sqlite-state-file <STATE_FILE> --prompt-file <ABS_PROMPT_FILE> --mode summary --intent-summary "协作问题的可复用描述" --rationale "确认是否可变成前例" --scope-type personal --scope-id <USER_ID> --producer @<ABS_PRODUCER_JSON> --correlation-id <ID> --causation-id <ID>
```

返回的 proposal 包含 `proposal_ref` 和下一步 approval token。用户选择的内容另存为文件后，才执行 `prompt-case capture --proposal-ref <JSON> --approval approve:<RECORD_ID> --content-file <ABS_SELECTED_CONTENT_FILE> ...`。`full_private` 强制 `private` classification；`summary`/`redacted_excerpt` 也默认 private，但可按产品作用域选择更严格的分类。capture 产生 `source_snapshot`；只有加上一个或多个 outcome ref 与 Change Set 后，`prompt-case precedent` 才能形成候选前例。proposal、snapshot 和 Continuity receipt 都是可见的，raw prompt 除非用户在 capture 步骤选择 `full_private`，否则不会进入状态库。

来源、候选和能力的职责不能混淆：知乎或其他外部源先成为带 provenance 的 `source_snapshot`，讨论后才形成 `candidate_precedent`，再经 `capability_candidate` 的验证和用户采纳，最后才允许 Skill/能力发布。激活上下文只引用已授权的来源和版本，不把整库全文塞进 prompt。

`doctor --correlation-id` 返回按时间排序的、可用户查看的运行事件：组件、操作、成功/失败、关联 ID、receipt/data 引用、耗时及错误码。它**不会**返回原始 prompt、完整来源正文、凭证、未采纳候选正文或工具参数。事件与运行状态保存在同一 SQLite 文件，因此 `backup` / `restore` 会一并处理。

CLI 的成功/失败业务结果默认都是一行 JSON，便于 Codex、Python SDK、桌面端后续直接消费；`--help` 是正常的零退出码发现入口。需要传递较大的 JSON 对象时，所有 `JSON` 参数均可使用 `@<JSON_FILE>`，例如 `--source-ref @<ABS_SOURCE_REF_JSON>`，无需把对象正文塞进 shell 引号。

### 协议升级

`trace.change-set`、`trace.data-envelope`、`trace.context-record`、`trace.continuity`、`trace.runtime-event`、template/plugin/capability/capability-candidate/project-instance contract 现在均使用显式、定向的 `0.1.0 → 0.2.0` in-memory upcaster。它们不改写历史 revision；后续业务更新才会追加当前版本。任何没有注册完整路径的版本都以 `PROTOCOL_MIGRATION_REQUIRED` 拒绝读取，而不是静默猜测。Data envelope 的旧哈希会先按旧 envelope 校验，再生成仅内存的 `0.2.0` 视图。

## 模板、Skill 与 hooks

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js template list
node <RUNTIME_DIR>/dist/apps/cli/src/main.js template preview --manifest <TEMPLATE_MANIFEST>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js skill preview --skill-root <CODEX_SKILL_ROOT> --source-dir <PUBLISHED_SKILL_DIR>
node <RUNTIME_DIR>/dist/apps/cli/src/main.js hooks preview --hooks-file <CODEX_HOOKS_FILE> --command "<TS_RUNTIME_HOOK_COMMAND>"
```

preview 不会改变宿主。只有带明确 approval 的 install 才会原子替换，并保留 rollback receipt。`templates/` 是只读冷启动输入；用户 overlay 和模板升级需要三方 diff 与 Change Set。

## 目录边界

- `packages/core/protocol`：协议身份、共享 validator primitive、状态门槛与显式 upcaster registry；领域包只维护自身语义，不复制基础 `object/text/list/unknown-field` 校验。
- `packages/core/observability`：同库、无自由 payload 的运行事件；只记录 provenance，不保存敏感正文。
- `packages/core/case-capture`：prompt 的 transient → proposal → user-approved source snapshot → precedent 边界；proposal 永远不接收/保存 raw prompt bytes。
- 其他 `packages/core/*`：状态、数据链和运行时；不读用户 Wiki。
- `packages/integration/*`：知乎、MyWiKi 等真实来源 adapter；每个来源独立版本化。
- `packages/host/*`、`apps/codex`：宿主安装与 Codex 触发边界。
- `packages/sdk/*`、`python/sdk`：跨进程和薄 SDK，不复制核心状态机。
- `templates/`、`profiles/`、`packages/bundle/`：组合与冷启动描述，不是用户数据。
- `native/`：清单校验、安装器和 launcher，不实现业务规则；发行包包含 Node 22 fallback SQLite driver。
- `apps/desktop`、`packages/integration/deepseek-harness`：明确保留的宿主边界，当前没有伪造 shell 或事件 adapter；见各自 README 的准入条件。

旧 Python runtime 已从 active tree 移除；`python/sdk` 只保留面向 RPC 的薄客户端。需要源码导出到独立 Git 目录时执行：

```powershell
corepack pnpm export:source -- --out <SOURCE_EXPORT_DIR> --replace --keep-backups 3
```

导出会排除 `node_modules/`、`dist/`、缓存、SQLite、凭证和用户数据。导出时会保留目标目录的 `.git/` 与本地 `.workbuddy-ai/` 状态，但不会把依赖树放进 `trace-runtime.previous-*` 备份；默认最多保留 3 个由当前 entry-level exporter 创建的 source-only 备份，可用 `--keep-backups` 或 `TRACE_SOURCE_EXPORT_KEEP_BACKUPS` 调整。旧版 root-move 备份不会被自动删除。需要依赖时在导出后执行 `corepack pnpm install --frozen-lockfile`。发行包也不会包含用户认知源。
