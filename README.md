# Trace Runtime

**Trace 的本机后端与 Codex 接入仓库。** 产品围绕“一件仍在变化的事”，连接原表达、材料、自己的理解与实践结果；这里负责保存、版本校验、Agent 执行和工作回流。

[产品介绍与第一次使用](docs/product-guide.md) · [底层架构](docs/architecture.md) · [生产化计划](docs/production-plan.md) · [全部文档](docs/README.md)

本页命令适用于**源码工作区**。已经拿到 native 发行包的用户请读[安装与维护](native/README.md)；Windows 可用包内 `Connect-Trace-to-Codex.cmd` 连接插件，不要在旧发行包中执行新服务命令。

## 先分清三件事

| 你要做什么 | 使用哪个入口 | 是否需要 Trace Plugin |
| --- | --- | --- |
| 保存事项、理解和工作结果 | 本机产品 API，`apps/desktop` | 不需要 |
| **让 Trace 调用 Codex**，得到回答或修订候选 | Agent API，`apps/agent` | 不需要；需要本机 Codex CLI 与登录 |
| **在 Codex 中使用 Trace** 的上下文、领取工作并回流 | `trace-codex` Plugin → `apps/mcp` | 需要 |

Codex 负责推理与执行；Trace 负责内容范围、版本、运行状态及用户确认。**装插件不等于开启生成 API，生成成功也不等于修改了“我的理解”。**

## 本机运行

在本仓库根目录使用 **Node >=22.13**（本机验证版本 22.23.1）。这条源码服务路径不需要先安装依赖或构建 TypeScript。

```sh
npm start
```

打开终端打印的本机地址，默认 `http://127.0.0.1:4173`；`Ctrl+C` 停止自己启动的服务。数据位置会明确打印，沿用旧服务路径，不迁移已有库。高级配置与旧库选择见[启动与维护](docs/local-runtime.md)。

如需同时开放 **Codex 生成 API**，改用：

```sh
npm start -- --agent
```

该命令不自动调用模型，也不改变页面。实际生成会使用本机 Codex 账号及模型额度。当前适配器只接受已验证的 CLI **0.153.4**；其他版本需重新验证。已有服务占用端口时会停止启动，不抢端口、不替你关闭进程。

不确定配置时，先运行 `npm start -- --check`。它只检查配置与端口，不检查数据库、登录或模型。

## 连接 Codex

- **Web 开发者**：从 [Agent 后端](apps/agent/README.md) 的 HTTP 契约接入；无需先初始化 Trace 项目或安装插件。
- **Codex 使用者**：按[插件安装与使用](docs/codex-plugin.md)连接，在新任务中使用 `$trace` / `$trace-work`。插件安装和 hooks 启用是独立操作。

## 当前可用范围

截至 2026-09-15，以下为工作区源码能力，不是发布或线上验收声明：

- **已有本机实现**：SQLite 产品命令、版本冲突与重试；Codex 工作领取/回流；独立 Agent 生成、SSE、取消、fresh 和过期保护。
- **页面尚未接入**：真实 Agent 回答展示，以及真实候选的确认采纳闭环。后端接口存在不等于网页按钮已经调用。
- **尚未生产化**：Web/Agent 发行包、完整备份恢复入口、运行归档、升级兼容验收、安全远程连接。
- **部署边界**：独立 `trace-portal` 浏览器版、这里的本机 SQLite、Codex 项目账本不自动同步。静态云页面不能直接调用本机 Codex。

## 开发和交付从哪里看

| 问题 | 唯一入口 |
| --- | --- |
| 哪层负责什么、数据在哪里 | [底层架构与目录地图](docs/architecture.md) |
| 如何启动、检查和安全停用 | [本机运行手册](docs/local-runtime.md) |
| 如何从 Web 发起生成、订阅和取消 | [Agent 协议](apps/agent/docs/protocol.md) |
| 下一步先实现什么、何时可以交付 | [生产阶段计划](docs/production-plan.md) |
| 产品用途与知乎内容方向 | [产品指南](docs/product-guide.md) |
| 原生协作对话与决策记录 | [对话引擎与决策路径](docs/dialogue-engine.md) |

`pnpm build` 编译 CLI/MCP runtime；Web/Agent 的 build 是语法检查。**现有 `pnpm package` 不包含 Web/Agent 服务，不能用它宣称已交付新后端。** 开发与验收命令按[生产计划的检查表](docs/production-plan.md#验证入口)选择，不要求新用户先运行整套工程命令。
