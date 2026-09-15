# Trace Runtime

**Trace 的产品后端与 Agent Runtime 仓库。** 产品围绕“一件仍在变化的事”，连接原表达、材料、自己的理解与实践结果；这里负责保存、版本校验、Agent 执行和工作回流。Codex 是一个可选执行器，不是远程路径的必需依赖。

[产品介绍与第一次使用](docs/product-guide.md) · [底层架构](docs/architecture.md) · [知乎与全网接入](docs/zhihu-native.md) · [生产化计划](docs/production-plan.md) · [全部文档](docs/README.md)

本页命令适用于**源码工作区**。已经拿到 native 发行包的用户请读[安装与维护](native/README.md)，不要在旧发行包中执行新服务命令。

## 先分清三件事

| 你要做什么 | 使用哪个入口 | 是否需要 Trace Plugin |
| --- | --- | --- |
| 保存事项、理解和工作结果 | 本机产品 API，`apps/desktop` | 不需要 |
| **让 Trace 调用 Agent**，得到回答或修订候选 | Agent API，`apps/agent` | 不需要；可选 Codex、模型网关或外部 Agent |
| **在 Codex 中使用 Trace** 的上下文、领取工作并回流 | `trace-codex` Plugin → `apps/mcp` | 需要 |

所选执行器负责推理；Trace 负责内容范围、工具授权、版本、运行状态及用户确认。**装插件不等于开启生成 API，生成成功也不等于修改了“我的理解”。**

## 本机运行

在本仓库根目录使用 **Node >=22.13**（本机验证版本 22.23.1）。这条源码服务路径不需要先安装依赖或构建 TypeScript。

```sh
npm start
```

打开终端打印的本机地址，默认 `http://127.0.0.1:4173`；`Ctrl+C` 停止自己启动的服务。数据位置会明确打印，沿用旧服务路径，不迁移已有库。高级配置与旧库选择见[启动与维护](docs/local-runtime.md)。

如需同时开放 **Agent 生成 API**，改用：

```sh
npm start -- --agent
```

该命令不自动调用模型，也不改变页面。未配置 profile 文件时使用本机 Codex 账号及模型额度；当前 Codex adapter 只接受已验证的 CLI **0.153.4**。也可由服务端配置固定模型或完整外部 Agent，机器不必安装 Codex；见 [Agent profile](apps/agent/docs/profiles.md)。已有服务占用端口时会停止启动，不抢端口、不替你关闭进程。

不确定配置时，先运行 `npm start -- --check`。它只检查配置与端口，不检查数据库、登录或模型。

## 连接 Codex

- **Windows 首次连接 Plugin**：运行仓库根目录的 `Connect-Trace-to-Codex.cmd`；这是面向使用者的简单入口，不是开启 Agent API 的步骤。
- **Web 开发者**：从 [Agent 后端](apps/agent/README.md) 的 HTTP 契约接入；无需先初始化 Trace 项目或安装插件。
- **Codex 使用者**：按[插件安装与使用](docs/codex-plugin.md)连接，在新任务中使用 `$trace` / `$trace-work`。插件安装和 hooks 启用是独立操作。

## 当前可用范围

截至 2026-09-15，以下为工作区源码能力，不是发布或线上验收声明：

- **已有底层实现**：SQLite 产品命令、版本冲突与重试；Codex 工作领取/回流；provider-neutral Agent Runtime、服务端 profile、Codex/模型/外部 Agent 三类适配器、SSE、取消、fresh 和过期保护。
- **知乎与全网（可选）**：本机 Web 已有真实接口面板；原生 Codex 可通过 MCP 搜索／发起用户授权；Agent 请求可显式开启来源检索。接口、授权和来源校验已做受控测试；真实知乎搜索与本机页面展示已验收，全网接口已连通（非知乎来源尚未验收），真实 OAuth、线上回调部署和片段确认关联尚未完成。启用方式见[专题指南](docs/zhihu-native.md)。
- **页面尚未接入**：真实 Agent 回答展示，以及真实候选的确认采纳闭环。后端接口存在不等于网页按钮已经调用。
- **尚未生产化**：Web/Agent 发行包、完整备份恢复入口、运行归档、升级兼容验收、安全远程连接。
- **部署边界**：独立 `trace-portal` 浏览器版、这里的本机 SQLite、Codex 项目账本不自动同步。静态云页面不能直接调用本机 Codex。
- **远程执行接缝已实现、生产边界未完成**：独立 Runtime 可接固定模型或外部 Agent，不依赖原生 Codex；公网租户身份、队列/worker、出站策略、两库恢复、真实供应方与发行验收仍按[生产计划](docs/production-plan.md)推进。

## 开发和交付从哪里看

| 问题 | 唯一入口 |
| --- | --- |
| 哪层负责什么、数据在哪里 | [底层架构与目录地图](docs/architecture.md) |
| 如何启动、检查和安全停用 | [本机运行手册](docs/local-runtime.md) |
| 如何从 Web 发起生成、订阅和取消 | [Agent 协议](apps/agent/docs/protocol.md) |
| 如何配置自己的模型或完整 Agent | [Agent profile 与执行器协议](apps/agent/docs/profiles.md) |
| 下一步先实现什么、何时可以交付 | [生产阶段计划](docs/production-plan.md) |
| 产品用途与知乎内容方向 | [产品指南](docs/product-guide.md) |

`pnpm build` 编译 CLI/MCP runtime；Web/Agent 的 build 是语法检查。**现有 `pnpm package` 不包含 Web/Agent 服务，不能用它宣称已交付新后端。** 开发与验收命令按[生产计划的检查表](docs/production-plan.md#验证入口)选择，不要求新用户先运行整套工程命令。
