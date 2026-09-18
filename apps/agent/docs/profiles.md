# Agent profile 与执行器协议

本文是服务端执行配置的操作契约。Web 只选择公开的 `profileId`；不能提交 endpoint、model、token、cwd 或权限。产品请求与 SSE 仍使用[统一 Web 协议](protocol.md)。

## 三类执行器

| `kind` | 谁负责推理循环 | Trace 保留的边界 | 适用场景 |
| --- | --- | --- | --- |
| `codex` + `mode=bounded-analysis` | 本机 Codex App Server | 空临时目录、临时线程、隔离配置、run-scoped tools、结构与引用校验 | 默认安全分析；不读项目文件 |
| `codex` + `mode=native` | 本机 Codex App Server | 服务端选定真实项目 cwd、持久 thread、项目 AGENTS/skills/config、run-scoped Trace tools；审批/输入由同源 API 显式继续，断线/重启 fail-closed | 明确允许 Codex 使用项目能力；不是任意桌面/云端能力 |
| `model` | Trace 的 `openai-chat-completions-v1` adapter | Trace 驱动最多 12 次工具循环；固定 endpoint/model；不静默换模型 | 自有或托管的 OpenAI-compatible 模型网关 |
| `agent` | 独立外部 Agent 服务 | Trace 仍控制上下文工具、预算、版本、最终结果校验与取消 | 已有自己的规划/推理/模型编排的 Agent 服务 |

它们实现同一 executor 契约：`check({signal})` 与 `execute({request, context, signal, isCurrent, onEvent, retrieval})`。适配器只能通过 run-scoped tool bridge 取得正文，不能拿到 SQLite、文件路径或凭据。

## 服务端配置

复制 [`profiles.example.json`](../profiles.example.json) 到仓库外的运维目录，修改后设置绝对路径：

```powershell
$env:TRACE_AGENT_PROFILES_FILE = 'D:\trace-config\agent-profiles.json'
$env:TRACE_TEAM_MODEL_TOKEN = '<secret-from-secret-manager>'
$env:TRACE_TEAM_AGENT_TOKEN = '<secret-from-secret-manager>'
$env:TRACE_AGENT_ENABLED = '1'
npm start -- --agent
```

未设置 `TRACE_AGENT_PROFILES_FILE` 时自动生成兼容 profile `local-codex`，继续读取原有 `TRACE_CODEX_BIN / TRACE_CODEX_MODEL / TRACE_AGENT_RUNTIME_ROOT`，模式固定为 `bounded-analysis`。不会自动选择另一个 profile 作为失败回退。

配置文件规则：

- `protocolVersion` 当前为 1；`configVersion`、每个 `profile.version` 都是正整数；改配置时显式递增。
- `ownerId` 与 profile 的版本/hash 固定到每个 run。执行中删除、停用、改版本、改 endpoint/model 或撤去凭据，旧 run 会停止且迟到结果无效。
- 文件最多 64 KiB、16 个 profile；profile id 唯一，默认 profile 必须启用。
- **文件不接受内联 secret 或任意 headers。** 只记录 `credentialEnv` 的环境变量名；运行记录、capabilities、SSE 与错误不返回变量名、值或 endpoint。
- 远程 endpoint 必须为 HTTPS。只有 `localhost / 127.0.0.1 / ::1` 测试服务可使用 HTTP；URL 不能含账号、密码、query 或 fragment；不跟随 redirect。
- `authScheme` 为 `bearer`（默认）或 `x-api-key`。没有凭据的内部服务可省略 `credentialEnv`，其网络身份仍由部署层负责。
- Codex 子进程会额外移除所有 model/agent profile 声明的 credential env，避免不同执行器共享密钥。
- Codex profile 的 `mode` 省略即 `bounded-analysis`；可选 `native`。native 必须提供服务端配置的绝对 `projectCwd`，该目录在每次启动时 `realpath` 核验，HTTP 请求不能覆盖它。
- `threadId` 只在 native 模式的 run request 中可选，用于 `thread/resume`。服务端不会复制或解析 `auth.json`；Codex 自己负责登录，Trace 只调用 `account/read`。

### Codex 配置示例

```json
{
  "id": "native-codex",
  "label": "Native Codex (selected project)",
  "kind": "codex",
  "enabled": false,
  "version": 1,
  "mode": "native",
  "projectCwd": "D:\\Projects\\my-project"
}
```

Native profile 的 `projectCwd` 是部署者选择的工作区，不是用户输入的路径。第一次 run 建立持久 thread；后续通过原请求协议的 `threadId` 明确恢复。Codex 的命令、文件变更、权限和 MCP elicitation 请求不会被 Trace 自动回答：当前实现持久化 `state:waiting,recoverable:true` 事件并保持原 turn，客户端须调用审批或 input API 显式继续；同一请求重复提交必须使用同一幂等键和完整 body，断线、超时或重启后不会自动恢复。

`GET /api/agent/capabilities` 返回可选 profile 的安全描述、能力和默认 id。`POST /api/agent/check` 可传 `{"profileId":"team-agent"}`。模型 profile 的 check 只核验配置和凭据，不发送计费模型请求；外部 Agent check 会执行下方协议握手；Codex check 执行 App Server 与账号握手。

## `model`：受限模型循环

该 adapter 向固定 endpoint 发送 OpenAI-compatible chat-completions JSON：`model/messages/tools/tool_choice/stream:false`。初始 messages 只有系统边界、用户输入和不含正文的 context manifest。模型请求 `trace_context_read / trace_context_search`（以及明确启用的检索工具）后，Trace 才把该次工具结果加入下一轮 messages。

限制：最多 12 次 host tool 调用、单个远程 JSON 响应 512 KiB、最终结构化文本 128 KiB；未知工具、无效 arguments、redirect、非 JSON、超限、profile 漂移都失败关闭。当前不消费 provider 原生流式增量，因此 profile capabilities 标记 `streaming:false`；统一 SSE 仍提供运行、工具与最终结果事件。

不同供应方若不兼容该请求形状，应在自有网关归一化，或实现下方完整 Agent 协议；不要向浏览器开放供应方 token 或动态 endpoint。

## `agent`：`trace-external-agent-v1`

外部服务的固定 endpoint 接收 JSON POST，不使用回调 URL，不直接访问 Trace 数据库。

检查：

```json
{"protocolVersion":1,"operation":"check"}
```

```json
{"protocolVersion":1,"type":"ready","runtimeVersion":"my-agent/1.2","capabilities":{"tools":true}}
```

开始：

```json
{
  "protocolVersion": 1,
  "operation": "start",
  "executorContractVersion": 1,
  "request": {"requestId":"...","purpose":"discuss","input":"..."},
  "context": {"protocolVersion":1,"fragments":[{"id":"matter:original","characters":20}]},
  "tools": [{"type":"function","name":"trace_context_read","inputSchema":{"type":"object"}}]
}
```

外部 Agent 可返回一个工具调用；`sessionId` 在本次执行内不可改变：

```json
{
  "protocolVersion": 1,
  "type": "tool_call",
  "sessionId": "remote-session-id",
  "runtimeVersion": "my-agent/1.2",
  "call": {"id":"call-1","name":"trace_context_read","arguments":{"id":"matter:original"}}
}
```

Trace 调用自己的工具后向同一 endpoint 发送：

```json
{
  "protocolVersion": 1,
  "operation": "tool_result",
  "sessionId": "remote-session-id",
  "call": {"id":"call-1","success":true,"result":{"id":"matter:original","text":"..."}}
}
```

可重复 `tool_call → tool_result`，总预算仍为 12。完成时返回：

```json
{
  "protocolVersion": 1,
  "type": "completed",
  "sessionId": "remote-session-id",
  "runtimeVersion": "my-agent/1.2",
  "output": {"answer":"...","replacement":null,"citations":[],"uncertainties":[]}
}
```

取消、超时、配置变化或本地失败后，Trace 终止当前 HTTP 请求，并以独立 2 秒预算 best-effort 发送 `{"protocolVersion":1,"operation":"cancel","sessionId":"..."}`。外部服务必须把 `(credential identity, requestId)` 作为幂等执行身份，并把 cancel 设计为幂等；Trace 不会因未知远程执行状态自动重试可能计费的工作。

外部 Agent 的最终 `output` 仍由 Trace 校验用途、结构、精确引用和目标版本。远程返回 `completed` 不等于正文已采用。
