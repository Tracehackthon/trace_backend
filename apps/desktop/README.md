# Trace Web — 本机可接续版本（2026-09-15）

本目录承担本机 HTTP 宿主、Web 页面和产品领域规则，目录名不表示已有桌面安装包。旧原型已移到[历史记录](docs/prototype-history.md)。

## 当前使用

在 runtime 根目录运行 `npm start`，打开终端打印的本机地址。需要生成 API 时改用 `npm start -- --agent`，不必再启动第二个服务；详见[本机运行](../../docs/local-runtime.md)。旧目录内 `npm run dev` 保留兼容。

**2026-09-15 P0：默认保存已切换为服务端产品命令。** 升级后需要重启原服务进程；只刷新页面不会更新 Node 服务。不要让新旧服务同时写同一个数据库。尚未重启的旧服务会被新页面明确提示，不会降级回整份 host 写入。

- 首页留下一点 → 同一件事 → 原表达或理解找对照 → 手工粘贴材料 → 确认关联 / 返回原处。
- 自己写并保存理解 → 带去用 → 填写工具 / 项目 / 任务 → 确认本地带入快照 → 记录实际结果 → 只留结果或查看差异后确认修订。
- 搜索和全部痕迹统一检索真实原表达、当前理解、手工材料、结果、修订与工作；点击按 ID 返回来处，保留查询 / 筛选。
- 左下个人设置支持本机称呼、减少动效、查看保存位置和 JSON 导出；没有虚构账号或云同步。
- 草稿自动保存在本机；理解须明确保存，关联材料不自动修改理解。工作上下文可由 Codex MCP 领取；手工复制仍不冒充 Agent 接收回执。

## 存储与运行边界

- 默认数据库：工作区根目录的 `.trace/state/web.sqlite`，与认知账本 `trace.sqlite` 分开。
- 可用环境变量 `TRACE_WEB_STATE_FILE` 指定独立绝对路径；端口用 `TRACE_DESKTOP_PORT`。
- 同源 GET `/api/product/workspace` 读取；POST `/api/product/commands` 提交明确动作；GET `/api/product/commands/{commandId}` 查询持久化回执。领域校验、workspace revision CAS、动作执行和命令回执同一事务完成。
- 可选内容来源也按 Web 域分开：`POST /api/search/zhihu` 是知乎搜索，`POST /api/search/global` 是全网搜索，`GET /api/search/capabilities` 只报告这两项是否启用；`/api/zhihu/*` 只处理连接状态、OAuth 和经用户授权后的本人数据；`/api/agent/*` 只处理生成运行。请求体不能通过 `source`、URL、Token 或模型参数改变这些边界。
- 默认拒绝旧 PUT `/api/web/workspace` 和 POST `/api/web/reset`，返回 `410 LEGACY_WRITE_DISABLED`；GET `/api/web/workspace` 与 GET `/api/web/export` 保留读取兼容。没有任何请求参数能重新启用旧写入。
- 不接受客户端整份 host 或伪造的提交回执。普通草稿与显式保存分开；对照确认、工作结果修订由服务端执行，再返回权威状态。
- 同一 commandId 同一请求返回原回执，不执行第二次；同 ID 换内容、旧 workspace revision 均冲突。返回 `headRevision` 区分旧回执与当前状态。页面保留失败后继续编辑的草稿，重试原命令后依次保存后续动作。
- GET `/api/web/export` 导出真实已保存内容。手工保存链路不外发；显式使用 Agent 时，允许的上下文会交给 Codex。
- Node 的 `node:sqlite` 有 ExperimentalWarning；它不代表测试失败。数据库历史快照目前未自动压缩。
- 默认入口 `src/web-main.js`。事项、理解、对照、工作与产品命令由 [`@trace/product-workspace`](../../packages/product/workspace/README.md) 统一维护；desktop 下只保留页面 Adapter。原 `src/main.js` 与旧讨论保留在 `legacy.html`，不作为当前产品状态源。
- 背景 / 两姿态鸟 / 完整字体 / 现用 vendor 的固定字节在 `approved-assets.lock.json` 中，测试校验，不得通过重新生成资源或刷新 lock 掩盖漂移。
- 原图、原组件和字体许可仍在原 artifacts；runtime 是隔离派生副本。

### P0 命令协议

入口实现见 Product Workspace 的 [浏览器 Interface](../../packages/product/workspace/src/index.mjs) 与 [Node 持久化 Interface](../../packages/product/workspace/src/workspace.mjs)。下面是**空库**创建事项的请求示例；真实调用先读取当前 revision，并为一次逻辑提交使用唯一 commandId：

```json
{
  "protocolVersion": 1,
  "commandId": "example-capture-1",
  "expectedRevision": 0,
  "operations": [
    { "type": "capture.create", "matterId": "example-matter-1", "text": "还没有想清楚，先留下这一点。" }
  ]
}
```

- 动作白名单：`capture.draft/create`、`chain.action`、`comparison.open/action/return`、`handoff.create`、`worksite.action`、`preferences.update`、`workspace.recover/reset`。嵌套 action 与 patch 也逐字段校验，不是任意 reducer/JSON patch 通道。
- 一次批处理最多 256 个动作，全部成功或全部回滚；浏览器长草稿队列分批顺序提交。对照的内部 `COMMIT_RESULT` 不是客户端可调用动作。
- 成功响应含 `host / revision / headRevision / storage / receipt`。`receipt.status=committed` 仅表示本机已持久化，`hostDelivery=not_requested` 不代表已发送原生 Agent。
- 重置只能独立提交 `workspace.reset`，指定 `mode=empty|demo` 和 `confirm=replace-current-workspace`，同样受 expectedRevision 保护。示例由服务端固定 fixture 生成并标记；客户端不能以重置提交任意对象。
- 继续使用既有 schema v1 四表和历史快照，不做用户库迁移。command 指纹在原账本中以 `product-v1:` 命名空间区分；查询回执不把旧快照导入记录伪装成产品命令。
- `createProductWorkspace({allowSnapshotWrites:true})` 仅用于显式的旧格式测试/受控导入。默认服务器从不启用；不要对真实用户库同时运行这样的导入宿主。
- 这是本机单用户、同源访问协议，不是公网鉴权系统。块级文稿/完整来源修复、宿主失效通知尚未实现；当前仍使用字符串理解和局部选区模型。真实生成由 [Agent 后端](../agent/README.md)另行提供；使用 `--agent` 启动时，页面会连接它并以显式确认方式处理修订候选。

## Codex 上下文带入与结果回流

本机产品服务为 `trace-codex` MCP 提供两条 loopback-only 接口：

- `POST /api/product/codex/receive`：把一项用户确认的工作原子绑定到 Codex task/session、绝对项目目录、不可变上下文快照及 SHA-256 摘要，并返回服务端回执；
- `POST /api/product/codex/return`：只接受同一 delivery / session / project / context hash 的实际结果，保留不可变外部回传，并把结果放进待用户复核的草稿区。

Codex plugin 暴露对应的 `trace_product_context_receive` 和 `trace_product_result_return`。session 身份由 MCP 子进程读取 `CODEX_THREAD_ID / CODEX_SESSION_ID`，不由模型 tool 参数提供。被标为 `exclude` 的带入不会进入 Codex；`reference / trial / contrast` 各自带有使用限制；上下文包上限 256 KiB。

两条接口复用现有 SQLite 命令账本、幂等回放和工作区修订链。回传前重新核验项目、delivery、session、hash 与 matter 归属；成功状态 `returned_for_review` 不会自动修改「我的理解」。Plugin 默认通过 `TRACE_PRODUCT_URL=http://127.0.0.1:4173` 连接，MCP client 只允许无凭证、无路径的 HTTP loopback origin。

`received` 证明该本机 Codex adapter 领取并持久化绑定了快照，不证明内容已经正确影响 Agent 的推理或产物；后者仍看实际 diff、测试和产物证据。Host Session 的 Stop outbox/fixture worker 已覆盖本机异步 sensemaking，但运行中快照失效通知、远程宿主凭据或来源/模型 adapter 仍未实现。

## Codex Host Session Ingest

Product Workspace 还提供一条独立的用户级宿主会话接收边界：

- `POST /api/product/host/session/attach`、`/pause`、`/detach`：显式附着、暂停或结束当前 Codex session；请求必须带 `commandId`、`host`、`sessionId`，附着可带空的 `projectRef`；
- `POST /api/product/host/event`：接收 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`Interrupt`、`SessionEnd`；只有已 attach 的 session 才会保存 prompt / `last_assistant_message`，工具事件仅保存安全 identity；
- `GET /api/product/host/sessions`、`/turns`、`/findings`：读取安全的 session、HostTurn 和 Workflow Finding 投影；
- `POST /api/product/host/finding`：保存用户明确捕获、并指向已接收 HostTurn 的 finding，初始为 `scope=unknown`、`target_kind=unresolved`、`status=captured`。

这些记录位于 `web.sqlite` 的独立 append-only 表，不推进产品 snapshot revision，也不写入项目 `trace.sqlite` 或 Agent 库；不依赖 `transcript_path`。全局 hook 在未附着或暂停时成功 no-op，非 `.trace/` cwd 也只有在 session 已附着时才可进入该用户级接收空间。幂等键由 host/session/turn/event/tool identity 组成，同键不同内容会冲突；不会由此自动生成 Skill、修改理解或发布规则。

实现与验证见工作区[历史任务记录](../../../docs/tasks/trace-codex-product-bridge.md)（独立 checkout 不含此记录）。源码更新后须按 owner 安全重启对应服务；Codex 安装/更新 plugin 后须新开任务，已有会话不会热加载 MCP 工具。不要按历史端口描述判断当前进程版本。

## 检查

`npm run build` 检查所有新旧入口和 runtime 模块语法；`npm test` 覆盖状态、桥接、真实 SQLite HTTP、检索投影和资产锁。
本批新增 `tests/product-commands.test.mjs`（仓库根目录下）覆盖命令边界、事务回滚、重放、并发、旧格式兼容与现有对照/回流服务端化。完整回执见[任务记录](../../../docs/tasks/trace-product-domain-p0.md)。

更新后的浏览器脚本在工作区 `artifacts/trace-product-domain-p0-20260915/integration/product-e2e.cjs`，创建独立数据库与 4182 服务，不写用户 4173 数据。用 `TRACE_PLAYWRIGHT_MODULE`、`TRACE_BROWSER_EXECUTABLE` 配置本机浏览器运行依赖；测试 TEMP/TMP 应指向有空间的独立目录。旧 Web v1 脚本拦截的是旧 PUT，不再作为新命令协议的唯一验收。

当前完成本机 Web 链路及 Codex MCP 的隔离 receive/return 往返；知乎／全网面板可显示真实 provider 摘要，用户选择后可把来源及原始链接放入对照，并明确确认关联。启用 Agent 后，页面可发起运行、订阅 SSE、取消，并对局部修订候选执行确认、放弃或撤销；候选只改变理解草稿，不会自动保存为正式理解。其他任意外部 Agent、云账号 / 同步、移动端及桌面打包不在该 Web 已验证范围。不要把旧原型的 mock 讨论当作已连接模型。

---

### Host Session 第三阶段状态

宿主会话页继续通过 Product Workspace API 投影状态，不在浏览器另存副本。它同时展示 resident sensemaking worker 的 queue/profile/shadow/privacy 状态、Repository Guard recovery journal，以及 capability candidate/trial/publication policy。原始 turn 正文默认折叠；API 列表省略 prompt/final，仅返回 input fields、hash 和 redaction receipt。worker 未配置或 Product/Agent 服务未运行时显示“不可用”，不会伪称已执行模型或发布。