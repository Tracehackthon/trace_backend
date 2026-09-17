# Agent 高级配置、接口索引与验证

供 Web 后端维护者使用。实现 **Trace → Agent Runtime** 的执行通道；默认可用 Codex，也可使用服务端配置的模型或完整外部 Agent。不替代已有 **Codex → Trace** MCP 工作快照领取/回流。当前本机 Web 已通过这一协议展示回答并处理修订候选。

## 现在能做什么

- `discuss / explain / compare / revise`：讨论、解释、比较用户明确选择的材料、生成精确选区的修订候选。
- 通用 executor 契约、服务端 profile、按需上下文工具、结构化结果、SSE 事件、取消/超时、请求去重与重启恢复。
- 三个明确适配器：本机 `codex app-server`、Trace 驱动的 OpenAI-compatible 模型循环、`trace-external-agent-v1` 完整 Agent 服务。
- 从当前产品 SQLite 固定上下文；独立 `agent.sqlite` 保存请求、候选和事件。生成本身不写产品状态；用户明确接受修订候选时，由 Product Workspace 事务只改准确草稿选区。
- 本轮支持单用户、loopback、同源调用。**默认不联网；可[显式开启知乎／全网来源](../../../docs/zhihu-native.md)，不提供任意文件执行、公网多租户认证或自动采纳。**

日常只需在 runtime 根目录运行 `npm start -- --agent`，见[本机运行](../../../docs/local-runtime.md)。以下为高级维护路径，不是新用户必读命令清单。完整[调用契约](protocol.md)在本仓库内，独立 checkout 也可读取。

## 启动

需要 Node >=22.13。只有选择 `codex` profile 时才需要已登录的 Codex CLI；当前经过运行时隔离验证的 CLI 为 **0.153.4**。其他版本失败关闭，需要重新验证而非直接放宽版本检查。非 Codex 配置见[Agent profile 与执行器协议](profiles.md)。

默认不开启 Agent。保持现有 Web 页面不变，在**确认原服务归属、停止自己管理的旧实例之后**，从 `trace-runtime` 启动后端：

```powershell
codex --version
codex login status
$env:TRACE_AGENT_ENABLED = '1'
pnpm --filter @trace/app-desktop start
```

这会让同一个本机 Web origin 提供 `/api/agent/*`。不会自动安装 Codex plugin；默认 profile 复用 Codex 自己的登录机制，不读取、复制或通过 HTTP 接收 `auth.json` / API key。模型默认沿用本机配置，可由服务运维者通过 `TRACE_CODEX_MODEL` 指定。配置了 profiles 文件后，请求只能选择公开 `profileId`，仍不能指定 model、endpoint 或 token。

独立 API 进程（默认 4174；不能与同一 `agent.sqlite` 的另一个实例同时运行）：

```powershell
$env:TRACE_WEB_STATE_FILE = 'D:\your-workspace\.trace\state\web.sqlite' # 必须换成已有产品库
$env:TRACE_AGENT_ENABLED = '1'
pnpm --filter @trace/app-agent start
```

独立 API 和页面端口不同，浏览器不会自动成为同源。实际页面应使用集成在 Web 后端的 middleware 或受控的本机同源路由；不要设置 `Access-Control-Allow-Origin: *`。静态 Vercel / IndexedDB 页面不会因此自动获得访问本机 Codex 或本机 SQLite 的能力。

| 服务端环境变量 | 默认 / 边界 |
| --- | --- |
| `TRACE_AGENT_ENABLED` | 只有 `1` 开启；否则 Agent capabilities 可查，执行接口 503 |
| `TRACE_AGENT_PROFILES_FILE` | 可选、绝对路径；省略时生成兼容的 `local-codex` profile；格式见 [profiles](profiles.md) |
| `TRACE_WEB_STATE_FILE` | 集成 Web 沿用原配置；独立 Agent 服务必须是绝对路径 |
| `TRACE_AGENT_STATE_FILE` | 产品库同目录的 `agent.sqlite`，必须与产品库分开 |
| `TRACE_CODEX_BIN` | `codex`；可配置绝对可执行文件路径；不经 shell 拼接 |
| `TRACE_CODEX_MODEL` | 省略则继承 CLI 默认模型；不静默回退到另一模型 |
| `TRACE_AGENT_TIMEOUT_MS` | 180000；范围 1000—600000，涵盖启动、握手、工具和生成 |
| `TRACE_AGENT_RUNTIME_ROOT` | OS 临时目录下 `trace-agent-runtime`；仅保存每次执行的空临时工作目录 |
| `TRACE_AGENT_PORT` | 独立 API 4174，冲突直接失败，不自动换端口 |

## 调用入口

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/agent/capabilities` | 开关、协议和边界；不等于登录或模型可用 |
| `POST /api/agent/check`，body `{}` 或 `{"profileId":"..."}` | 检查默认或指定 profile；模型 profile 不发计费请求，Agent/Codex 按各自协议握手 |
| `POST /api/agent/runs` | 提交版本化生成请求；首次 202，精确重放 200 |
| `GET /api/agent/requests/:requestId` | 丢失提交响应时按原请求 ID 找回运行；ID 须 URL encode |
| `GET /api/agent/runs/:runId` | 状态、候选、上下文目录、`usableAsCurrent` |
| `GET /api/agent/runs/:runId/events` | SSE；支持 `Last-Event-ID` 或 `?after=N` |
| `POST /api/agent/runs/:runId/cancel`，body `{}` | 幂等取消；不影响其他服务、会话或 canonical 数据 |
| `POST /api/agent/runs/:runId/adoption` | `accept`／`dismiss`／`undo`；接受和撤销需 `commandId`、`expectedRevision`，并由 Product Workspace 做 CAS、目标和选区校验 |

## Host Session sensemaking worker

Host Session 的 hook 只写入 Product Workspace 的 `web.sqlite`，不会同步等待 Agent。`Stop` 在事务内创建唯一的 `sensemaking_jobs` outbox；resident worker 再以 DB lease/owner/expiry 领取，进程崩溃后只接管过期 lease。worker 支持 `disabled`、离线 `fixture-dev`、服务端 ExecutorRegistry 的 `profile` 与不进入路由的 `shadow`：

```powershell
$env:TRACE_SENSEMAKING_MODE = 'fixture-dev' # 本机离线契约；生产不要把它当真实质量验收
npm start -- --agent
```

真实 `profile` 或 `shadow` 必须同时设置 `TRACE_SENSEMAKING_PROFILE_ID`；profile 的 model/service identity、工具集（默认无工具）、超时、步数、输入/输出预算和 attempt 上限均从服务端配置读取，普通 prompt 不能覆盖。没有真实凭据时保持 `disabled` 或明确的 `fixture-dev`，不静默回退到另一模型。

维护者入口：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/agent/sensemaking/health` | 读取 worker mode、profile identity、queue depth、failed count、lease/limits、shadow 和最近错误 |
| `POST /api/agent/sensemaking/drain` | 有界处理已入队任务；`{"protocolVersion":1,"limit":16}`，不修改路由或采用 |

输入先经过 `trace.host-privacy@1` allowlist、项数/长度预算、secret/credential/path/PII 替换和 echo/overlap 检查；结果严格符合 `trace.sensemaking-result@1`，schema、identity、大小或重合校验失败只留下失败 job、hash 和 rejected privacy receipt。`agent.sqlite` 只保存运行/配置/结果哈希；HostTurn 原文与 WorkflowFinding 的产品状态仍只由 `web.sqlite` 持有。`shadow` 的候选不生成 RoutingProposal。

POST 需要与目标 URL 一致的 `Origin` 和 `Content-Type: application/json`。本机脚本也需要传 Origin；Origin 校验不等于防御同用户下恶意进程的认证。

## 验证

在 runtime 根目录：

```powershell
pnpm --filter @trace/app-agent build
node --test --test-concurrency=1 tests/agent-backend.test.mjs tests/agent-profiles.test.mjs tests/agent-service.test.mjs tests/agent-transport.test.mjs

# 本机真实 CLI + 合成模型 provider，不消费真实模型额度
$env:TRACE_AGENT_WIRE = '1'
node --test tests/agent-codex-wire.test.mjs
Remove-Item Env:TRACE_AGENT_WIRE

# 显式启用：会使用本机 Codex 登录及模型额度，只发送临时库的合成内容
$env:TRACE_AGENT_LIVE = '1'
node --test tests/agent-codex-live.test.mjs
Remove-Item Env:TRACE_AGENT_LIVE
```

普通测试默认跳过两类 opt-in 检查。`WIRE` 验证真实协议与输入/工具边界，不能证明模型理解；`LIVE` 验证真实模型读取随机片段、返回引用、fresh 拒绝旧读取、两个 threadId 不同、产品库字节级投影未变。测试中预期的 `skill package is not available` 是负例断言，不是生产代码忽略失败。

当前 run 上限 1000、并发 1、上下文 64 KiB、正文输入 16000 字符、12 次 Trace 工具调用、输出 128 KiB、4096 个普通事件、16 条 SSE 连接。超限报错，不自动删用户记录。详见设计中的容量与维护边界。

本轮交付形态是源码工作区与 native runtime 包中可选的本机服务。`pnpm package` 会携带受管的 `apps/desktop` server、`apps/agent` 和 Product Workspace host 模块，但这不等于已经在某台机器完成安装、数据库迁移、备份恢复或生产运行验收；没有把它伪装成桌面/云发行包。
