# Agent 后端：Trace Agent Runtime

**生成与产品采用分层。** Runtime 接收当前事项上的讨论、解释、比较或局部修订请求，通过一个服务端授权的 Agent profile 执行，返回回答或候选；只有用户随后明确点击接受，专用产品事务才会改动准确选区的草稿，并可撤销。它不会自动修改正式理解。

## 开始使用

在 runtime 仓库根目录运行：

```sh
npm start -- --agent
```

默认兼容路径使用本机 Codex CLI 0.155.0-alpha.2.6 且需已登录；它是明确命名的 `bounded-analysis` 模式：每次运行使用空临时目录、短线程和 Trace 受限工具，不读取项目文件。也可以由服务端配置独立的 `native` Codex profile，让 Codex 在管理员选定的真实项目目录中读取该项目的 AGENTS/skills/config，并以持久 thread 执行；native 连接不依赖静态 semver 白名单，而是在同一可执行文件生成 Schema 并完成 no-model wire qualification 后才放行，二进制或 Schema 更新后需重新资格验证。该模式不是浏览器可提交的任意 cwd，也不会自动批准工具或文件写入。还可以配置独立模型或完整外部 Agent，此时不要求机器安装 Codex。启动不消耗模型额度；真正提交生成才会执行。**不需要安装 Trace Plugin，不需要先开启 hooks。** 默认同源本机地址端口 4173。

## Web 如何调用

```text
读取产品 revision / matter / contextMode / epoch
  → POST /api/agent/runs
  → SSE /api/agent/runs/:runId/events
  → 查询最终 run，核验 usableAsCurrent
  → 展示回答或候选 → 用户明确接受／放弃；接受只改准确草稿选区，可撤销
```

- [请求、上下文、SSE 和错误边界](docs/protocol.md)：Web 接入时读这一份。
- [Agent profile、模型循环与外部 Agent 协议](docs/profiles.md)：接自有模型或 Agent 服务时读这一份。
- [接口索引、高级配置与测试](docs/operations.md)：排查、独立 API 进程和协议验证时再读。
- [本机启动与维护](../../docs/local-runtime.md)：数据位置、停用与恢复边界。

## 源码职责

| 模块 | 责任 |
| --- | --- |
| `backend.mjs` / `http.mjs` | 开关、组装、loopback 同源 HTTP、SSE |
| `service.mjs` / `runtime.mjs` | 通用 executor 契约、受限工具桥、请求去重、运行状态、取消、超时、过期保护 |
| `context.mjs` / `protocol.mjs` | 有界上下文、fresh、请求与候选校验 |
| `profiles.mjs` | 服务端 profile 读取、选择、版本绑定和安全公开描述 |
| `codex.mjs` | Codex JSON-RPC、协议/fixture 版本约束、bounded-analysis 隔离与 native 项目线程 |
| `model.mjs` / `external-agent.mjs` | 受限模型工具循环与完整外部 Agent 协议 |
| `remote-http.mjs` | 固定 HTTPS endpoint、服务端凭据、响应上限和错误净化 |
| `store.mjs` | 独立 agent.sqlite 的运行、候选与事件持久化；附加 sensemaking run/event/result 表不保存 HostTurn 正文 |
| `sensemaking-worker.mjs` | 消费 Product Workspace Stop outbox；按服务端配置选择 fixture 或 ExecutorRegistry profile，以 lease/attempt/hash 可恢复地写回严格候选结果/finding/proposal |
| `sensemaking-cli.mjs` | `once` / `drain` 本机 worker 入口；不联网、不执行 git 或发布 Skill |
| `server.mjs` | 可选独立 API 宿主，不是默认推荐的第二个服务 |

当前 HTTP 边界仍是单用户、本机同源、默认单并发；远程执行器不等于该 HTTP 服务已经具备公网多租户身份。默认关闭外部检索；可[显式开启知乎／全网来源](../../docs/zhihu-native.md)，不提供任意文件执行或自动采纳。网页已接入回答、来源、候选接受／放弃／撤销和 Host Session 视图；runtime package 已携带 Agent/Host 服务源码，但发行包的安装、升级、备份恢复仍需按实际目标单独验收。后续顺序见[生产计划](../../docs/production-plan.md)。

Native profile 只接受服务端 profile 文件中的绝对 `projectCwd`。运行请求可带 `threadId` 以恢复该 profile 已建立的持久 Codex thread；省略则 `thread/start`，不会设置 `ephemeral:true`、`history:none` 或 `project_doc_max_bytes:0`。Codex 发出审批或交互式输入请求时，当前纵切会先持久化带安全摘要的 `runtime.approval.required` / `runtime.input.required` 事件并保持 turn 等待；同源客户端必须通过 `POST /api/agent/runs/:runId/approval` 或 `/input` 明确响应，不能隐式批准。断线、超时、重启会 fail-closed，不会自动恢复或复活迟到响应；Trace 不从 Codex 读取或复制 `auth.json`，账号状态仍通过 Codex `account/read` 核验。

## Host Session sensemaking worker（第三阶段）

Stop 只在 Product Workspace 的 `web.sqlite` 入队 `sensemaking_jobs`，hook 不等待模型。启动 `apps/agent` 时通过服务端配置选择明确的 `TRACE_SENSEMAKING_MODE=disabled|fixture-dev|profile|shadow`；`profile`/`shadow` 还必须配置 `TRACE_SENSEMAKING_PROFILE_ID`，prompt 不能覆盖 profile，也不会在真实 profile 不可用时静默切换模型。resident worker 启动时核验并接管过期 lease，后台单并发有界轮询；可用 `GET /api/agent/sensemaking/health` 查看 profile identity、队列、失败数、预算和最近错误，或用 `POST /api/agent/sensemaking/drain` 显式排空有限任务。

profile 的版本、service identity、超时、步数、输入/输出上限、attempt 和工具集由服务端 `ExecutorRegistry` 绑定。executor 只收到已经过 privacy policy allowlist、预算和脱敏后的 HostTurn、安全 evidence、bounded finding 摘要；结果必须符合 `trace.sensemaking-result@1`。schema、provider identity、大小、secret/PII/path 脱敏或 echo/fragment overlap 任一失败，都会保留失败 job 与 rejected privacy receipt，不生成 finding。`shadow` 可保存可验证候选和 run 结果，但不会创建 routing proposal。`agent.sqlite` 只保存 run/profile/event/result hash，不拥有 HostTurn 原文；用户内容和工作流状态仍由 Product `web.sqlite` 负责。`fixture-dev` 仅用于离线契约测试，不能作为真实供应方质量验收；未配置真实 profile 时必须明确显示 disabled/fixture-dev，而不是静默替换执行器。
