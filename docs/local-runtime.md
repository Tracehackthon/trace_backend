# 本机后端：启动与维护

面向运行源码服务的人。默认只运行**一个本机 HTTP 进程**，同时提供产品接口、Host Session 接收边界与可选的 Agent 接口；不要为了开启 Agent 或 Host Session 再启动第二套服务。

## 三个常用命令

在 runtime 仓库根目录，Node >=22.13；无需先装开发依赖。

| 命令 | 行为 |
| --- | --- |
| `npm start` | 启动 Web 与产品 API；未配置环境开关时 Agent 关闭 |
| `npm start -- --agent` | 同时开启 Agent 生成 API；不自动生成或安装插件 |
| `npm start -- --check` | 仅检查配置与端口；不打开数据库，不启动执行器 |

现有 `node apps/desktop/server.mjs` / package 内 `dev` 命令继续兼容；新入口增加参数校验、明确的配置输出和占用端口预检。预检与正式监听之间仍可能有竞争，不代表数据库或服务健康检查。

**看到 `Trace Web:` 才表示已监听成功。** 地址默认 `http://127.0.0.1:4173`。新入口沿用原数据位置：runtime 仓库的上一级目录下 `.trace/state/web.sqlite`。Host Session、WorkflowFinding、RoutingProposal、activation receipt、Guard journal、PublicationPolicy 和 CapabilityTrial 都由该 `web.sqlite` 负责；Agent 的 run/profile/event/result hash 另存相邻的 `agent.sqlite`。不要把换启动命令误当作迁移数据库。

## 只有选旧库或改端口时才配环境变量

PowerShell 示例，路径必须替换为自己的真实产品库：

```powershell
$env:TRACE_WEB_STATE_FILE = 'D:\TraceData\web.sqlite'
npm start -- --check
npm start -- --agent
```

新路径会在正式启动时建库；请先核对启动输出，出现空数据不要重置原库。入口不读取 `.env`，也不自动寻找或复制别的数据库。Agent 库默认在产品库旁的 `agent.sqlite`，两者不能合用一个文件。

- `TRACE_DESKTOP_PORT`：默认为 4173；占用即失败，不自动改成其他端口。与 Codex Plugin 工作往返时，插件端 `TRACE_PRODUCT_URL` 必须匹配。
- `TRACE_AGENT_ENABLED=1`：与 `--agent` 一样启用。**已在 shell 设置时，裸 `npm start` 仍会开启 Agent**；关闭须设为 `0` 且不传 `--agent`。
- profile、模型、外部 Agent、Codex 可执行文件、超时与独立 API 服务：见[高级配置](../apps/agent/docs/operations.md)和 [profile 协议](../apps/agent/docs/profiles.md)，不要把 endpoint 或凭据放到浏览器请求中。

### Host Session 与常驻 worker

Codex hooks 是用户级入口，但不会因为安装或启动服务就自动捕获对话。用户在当前任务中调用 attach 后，事件才进入 Product Workspace；未附着、暂停或结束的会话只返回安全 no-op/可恢复错误。即使当前 cwd 没有 `.trace/`，已附着会话仍可写入用户级 `web.sqlite`，不绑定一个不存在的项目；这要求运行 hook 的 Codex 环境与 Product Service 使用同一个已配置的绝对 `TRACE_WEB_STATE_FILE`。未配置该变量时，即使调用过 attach，hook 在无 `.trace/` cwd 也会返回 `{}` no-op，不会自行创建 web 数据库。

`SessionStart` / `UserPromptSubmit` 可提供有预算的 activation offer；`Stop` 只快速写入 HostTurn 并排队 sensemaking job。worker 在同一 Product/Agent 生命周期内有界轮询，使用 DB lease、owner 与 expiry 防止重复消费；`TRACE_SENSEMAKING_MODE` 必须显式为 `disabled`、`fixture-dev`、`profile` 或 `shadow`，真实 `profile`/`shadow` 还必须设置服务端 `TRACE_SENSEMAKING_PROFILE_ID`。默认是 `disabled`，不会静默切换到付费模型。健康检查：

```text
GET  /api/agent/sensemaking/health
POST /api/agent/sensemaking/drain   {"protocolVersion":1,"limit":16}
```

健康结果区分 mode、profile/service identity、队列深度、失败数、lease/预算、shadow 标记和最近错误；`drain` 只处理已入队的有限 job，不改变路由或采用状态。Host Session 页面为 `/?view=host`，原始 prompt/final 默认折叠；页面只显示 Product Workspace 投影和回执，不另存浏览器副本。

## 开启 Agent 后怎样判断真的可用

1. 访问 `GET /api/agent/capabilities`：`enabled=true` 只证明开关。
2. 同源 `POST /api/agent/check`，JSON body `{}` 或 `{"profileId":"..."}`：核验默认或指定执行器；model profile 不发计费请求。
3. 真正的执行验收应检查终态、实际工具事件、引用与产品未被自动改写；见[协议](../apps/agent/docs/protocol.md)。生成会使用所选 profile 对应的账号与额度。

POST 必须有匹配 URL 的 `Origin` 和 `Content-Type: application/json`，脚本也一样。401/403 等错误不能通过放开 CORS 解决。线上静态页面连接本机属于待实现的安全连接方案，不是启动参数。

## 故障时先做什么

| 现象 | 检查与处理 |
| --- | --- |
| 端口已占用 | 核对现有实例、数据路径和 owner；只停止自己管理的服务，不删锁或杀未知进程 |
| Agent 503 / disabled | 核对启动开关；更新源码后需正常重启 Node 服务，刷新页面不足以生效 |
| profile 不可用 / 被撤权 | 核对 capabilities、服务端 profile 文件及对应 credential env；不要从浏览器临时改 endpoint |
| Codex 不可用 / 版本不支持 | 仅对 codex profile 核对 CLI、登录和配置；不要删除版本校验或静默换模型 |
| Host Session 无记录 | 先确认当前任务已 attach、服务的 `TRACE_WEB_STATE_FILE` 正确且 hooks 指向本轮 runtime；未 attach 时无记录是预期边界 |
| worker disabled / queue 不下降 | 读取 `/api/agent/sensemaking/health`；确认 mode/profile 是服务端配置，先用 fixture-dev 离线验证，不把 disabled 当成真实模型成功 |
| Guard recovery_required | 只读查看 recovery preview，核对 branch/HEAD/worktree/state hash；不要自动切回、reset、clean、删除或远程操作 |
| run stale / `usableAsCurrent=false` | 重读产品状态，让用户决定是否新建请求；不要把旧候选套到新正文 |
| 响应丢失或 SSE 断开 | 先按原 requestId 找回，再按游标接续；不要直接重新发一个可能计费的请求 |
| 磁盘满 / 运行记录达到上限 | 停止新增生成，保留库和错误码；当前无归档命令，不直接清表 |

## 停用、备份与回退

- 正常停止自己启动的终端服务使用 `Ctrl+C`，确认进程退出和端口释放。只需停用生成时，在服务停止后设 `TRACE_AGENT_ENABLED=0`，再不带 `--agent` 启动。该操作不删除已有候选。
- **CLI 的 `trace backup` 仅覆盖项目认知账本，不覆盖 Web / Agent 库。** 目前两库没有统一的在线备份恢复命令；不要对运行中的 SQLite 只复制主文件就声称备份完成。
- 临时离线备份：确认相关 writer 全部停止后，保留整个实际状态目录（包括存在的 `-wal` / `-shm`）、配置与源码版本。恢复先在隔离副本验证完整性和业务读取，再确认是否替换。备份包含私人正文与结果，不公开上传。
- 源码回退不等于数据回退。不要自动执行降级迁移，不删除 `.owner` 绕过可能还活着的进程。Host Session 表迁移必须 additive 且不改变 workspace snapshot revision；Agent 库与产品库分别备份，不能把一份复制品宣称为两库一致恢复。可恢复备份、升级/回退演练仍是[生产阶段](production-plan.md)的必需交付。
