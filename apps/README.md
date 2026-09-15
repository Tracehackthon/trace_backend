# Apps：当前宿主与入口

此目录既有已运行的服务，也有宿主适配器；不能把目录存在当成全部完成，或把“desktop”误读成已经发行桌面应用。

| 目录 | 当前职责 | 入口 |
| --- | --- | --- |
| desktop | 本机 HTTP 宿主、产品页面、SQLite 产品状态及领域命令 | [本机 Web](desktop/README.md) |
| agent | Trace 主动调用服务端授权的 Codex、模型或外部 Agent，管理运行、上下文、流式事件与候选 | [Agent Runtime](agent/README.md) |
| mcp | Codex 通过 Plugin 领取项目上下文/工作并回流 | [MCP](mcp/README.md) |
| codex | 原生 Codex hooks 与项目认知接续适配 | [来源与 evidence](../docs/host-native-retrieval.md) |
| cli | 自动化、诊断、安装后备与认知账本维护 | [项目使用](../docs/getting-started.md) |

默认本机只需一个服务：仓库根目录 `npm start`；同时开启生成用 `npm start -- --agent`。不是每个 apps 目录都要启动一个进程。

**当前产品领域规则仍在 desktop/src/product 中**，并未全部收进 packages。Agent 只读产品版本并写独立运行库；MCP 工作回流经产品 API，而不是直接改数据库。完整分工见[架构](../docs/architecture.md)，后续抽包和交付条件见[生产计划](../docs/production-plan.md)。

原生 Codex 用户从 Plugin 的 `$trace` / `$trace-work` 开始；Web 调用生成 API 不需要安装 Plugin。CLI 不是两类用户的日常必经流程。
