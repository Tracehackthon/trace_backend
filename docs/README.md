# Trace 文档导航

先选你要做的事，不需要按目录全部读完。源码能力、运行状态和正式发布是三个不同状态。

## 使用产品

- [产品介绍、六项功能与知乎材料用途](product-guide.md)：为什么用、第一次怎么用、浏览器数据边界。
- [本机运行](local-runtime.md)：一个服务、三个命令、数据位置与故障处理。
- [在 Codex 中使用 Trace](codex-plugin.md)：Plugin 安装、工作领取与回流；不是生成后端的必装依赖。

## 开发底层

| 任务 | 读这一份 |
| --- | --- |
| 分清产品状态、Agent 执行与原生协作 | [底层架构](architecture.md) |
| 从 Web 调用 Codex | [Agent 后端](../apps/agent/README.md) → [HTTP 契约](../apps/agent/docs/protocol.md) |
| 保存事项、理解、工作和结果 | [产品命令与回流协议](../apps/desktop/README.md) |
| 维护原生认知运行时 | [Packages](../packages/README.md) · [MCP](../apps/mcp/README.md) |
| 查知乎 transport / provider 代码 | [HTTP transport](../packages/integration/zhihu-transport/README.md) · [前例 adapter](../packages/integration/zhihu-precedent/README.md) |

## 准备交付

- [生产阶段计划](production-plan.md)：先做什么、哪些还没实现、每一阶段怎样验收。
- [本机服务维护](local-runtime.md)：Web / Agent 的两库边界。
- [认知账本备份恢复](operations.md)：仅 trace.sqlite，不覆盖上述两库。
- [版本和兼容](versioning.md) · [Native 发行](../native/README.md)：现有 native 包不是新的 Web/Agent 包。

## 按需深入原生协作

[对话引擎与决策路径](dialogue-engine.md)：原生协作的 scripted onboard/adapt/review、决策记录与回放；与 Web 自由生成 API 分开。

[项目初始化](getting-started.md) · [日常候选与沉淀](daily-workflow.md) · [个性化](personalization.md) · [来源授权与实际访问](host-native-retrieval.md) · [评估 fixtures](../tests/evals/README.md)

它们是 Codex 协作能力的专题，不是启动 Web 或生成 API 的前置步骤。旧界面探索见[历史原型](../apps/desktop/docs/prototype-history.md)，不再与当前使用指南混排。

## 维护分工

- README 只保留定位、入口与必要边界；不堆阶段日志和全部 CLI flags。
- 当前职责在 architecture；当前接口在对应 apps 文档；拟实施内容在 production-plan。
- 产品定义与探索设计在工作区 manunl；实现仓库应能独立读取当前调用协议。
- 失败与重跑留在任务/测试记录中，不把旧通过次数复制成新版本已验收。
