# Agent 后端：Trace Agent Runtime

**只负责生成，不负责采用。** 接收当前事项上的讨论、解释、比较或局部修订请求，通过一个服务端授权的 Agent profile 执行，返回回答或候选；不修改产品正文。

## 开始使用

在 runtime 仓库根目录运行：

```sh
npm start -- --agent
```

默认兼容路径使用本机 Codex CLI 0.153.4 且需已登录。也可以配置独立模型或完整外部 Agent，此时不要求机器安装 Codex。启动不消耗模型额度；真正提交生成才会执行。**不需要安装 Trace Plugin，不需要先开启 hooks。** 默认同源本机地址端口 4173。

## Web 如何调用

```text
读取产品 revision / matter / contextMode / epoch
  → POST /api/agent/runs
  → SSE /api/agent/runs/:runId/events
  → 查询最终 run，核验 usableAsCurrent
  → 展示回答或候选（不能直接改正文）
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
| `codex.mjs` | 可选 Codex JSON-RPC、版本约束与子进程隔离 |
| `model.mjs` / `external-agent.mjs` | 受限模型工具循环与完整外部 Agent 协议 |
| `remote-http.mjs` | 固定 HTTPS endpoint、服务端凭据、响应上限和错误净化 |
| `store.mjs` | 独立 agent.sqlite 的运行、候选与事件持久化 |
| `server.mjs` | 可选独立 API 宿主，不是默认推荐的第二个服务 |

当前 HTTP 边界仍是单用户、本机同源、默认单并发；远程执行器不等于该 HTTP 服务已经具备公网多租户身份。默认关闭外部检索；可[显式开启知乎／全网来源](../../docs/zhihu-native.md)，不提供任意文件执行或自动采纳。网页展示与真实候选采纳尚未接入，发行包尚未覆盖此服务。后续顺序见[生产计划](../../docs/production-plan.md)。
