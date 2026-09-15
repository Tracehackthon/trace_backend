# Agent 后端：让 Trace 调用 Codex

**只负责生成，不负责采用。** 接收当前事项上的讨论、解释、比较或局部修订请求，通过 Codex 执行，返回回答或候选；不修改产品正文。

## 开始使用

在 runtime 仓库根目录运行：

```sh
npm start -- --agent
```

前提：Node >=22.13，本机 Codex CLI 0.153.4 且已登录。启动不消耗模型额度；真正提交生成才会执行。**不需要安装 Trace Plugin，不需要先开启 hooks。** 默认同源本机地址端口 4173。

## Web 如何调用

```text
读取产品 revision / matter / contextMode / epoch
  → POST /api/agent/runs
  → SSE /api/agent/runs/:runId/events
  → 查询最终 run，核验 usableAsCurrent
  → 展示回答或候选（不能直接改正文）
```

- [请求、上下文、SSE 和错误边界](docs/protocol.md)：Web 接入时读这一份。
- [接口索引、高级配置与测试](docs/operations.md)：排查、独立 API 进程和协议验证时再读。
- [本机启动与维护](../../docs/local-runtime.md)：数据位置、停用与恢复边界。

## 源码职责

| 模块 | 责任 |
| --- | --- |
| `backend.mjs` / `http.mjs` | 开关、组装、loopback 同源 HTTP、SSE |
| `service.mjs` | 请求去重、运行状态、取消、超时、过期保护 |
| `context.mjs` / `protocol.mjs` | 有界上下文、fresh、请求与候选校验 |
| `codex.mjs` | Codex JSON-RPC、版本约束、工具权限与子进程 |
| `store.mjs` | 独立 agent.sqlite 的运行、候选与事件持久化 |
| `server.mjs` | 可选独立 API 宿主，不是默认推荐的第二个服务 |

当前单用户、本机、默认单并发；不提供联网检索、任意文件执行、远程身份、自动采纳。网页展示与真实候选采纳尚未接入，发行包尚未覆盖此服务。后续顺序见[生产计划](../../docs/production-plan.md)。
