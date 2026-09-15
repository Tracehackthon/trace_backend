# Trace for Codex

> **把 Codex 的一次次工作，变成能被用户看见、采用和带回下一次的协作积累。**

`trace-codex` 是 Trace 在 Codex 中的产品入口。它不要求用户学习一组复杂 CLI 命令，也不替换 Codex 的搜索、阅读、推理和编码能力。

你只需在 Codex 中说：

```text
$trace 帮我开始这个项目。
$trace 我现在有哪些协作积累？
$trace-adapt 我希望你更适配我处理问题的方式。
$trace-review 哪些内容正在等待我的决定？
$trace-context 把我当前的上下文 Skill 包带进这个任务。
$trace-work 接收我在 Trace 里准备给这次 Codex 任务的内容。
```

## 它给用户什么

- **项目状态可见**：当前 profile、来源边界、版本差异、待审阅候选与 receipt；
- **协作方式可适配**：通用 starter 先工作，个人 / 项目 / 团队偏好通过明确 proposal 形成版本化 profile；
- **沉淀过程可控**：prompt、讨论和外部前例先是 candidate，不会被 Agent 静默写进长期上下文；
- **升级过程可控**：Plugin 更新不覆盖项目；旧 profile 先展示，再由用户明确迁移；
- **原生能力不被取代**：Codex 仍决定怎样检索、阅读、推理和执行，Trace 只记录受控来源 evidence。

## 个人上下文 Skill 包

`$trace-context` 从当前项目已经锁定的 collaboration model 与 source activation map 动态生成一份虚拟 `SKILL.md`，由 MCP 绑定当前 `CODEX_THREAD_ID / CODEX_SESSION_ID` 并写入 activation receipt。它让 Codex 获得“怎样与我协作、哪些认知源入口在什么条件下可导航”的底层上下文，但不复制来源正文、绝对 root、raw prompt、凭证或工具参数。

这份包只在当前 task/project 生效，不会写进 Codex 全局 Skill 目录，也不会因为领取而修改 profile、发布能力或证明来源页面已经被读过。具体工作内容的“带去用 / 结果回来”仍走下面独立的 `$trace-work` 流程。

## 它如何工作

Skill 负责理解自然语言、解释选择、等待用户决定；本地 MCP 负责读取安全摘要、生成稳定 proposal，并只在用户明确 adopt 后执行初始化、profile 更新/迁移或 hooks 变更。

```text
讨论 / 检查 → proposal（不写入）→ 用户 adopt → apply → receipt
```

MCP 不会通用保存或返回 raw prompt、来源正文、认知源绝对 root、凭证、工具参数或隐藏推理。

## 与 Trace 产品工作区往返

`$trace-work` 通过 MCP 从本机 Trace 产品服务接收用户明确确认的本次上下文。MCP 进程从 `CODEX_THREAD_ID` / `CODEX_SESSION_ID` 取得真实任务身份，模型不能传入或覆盖该身份；服务端回执同时绑定 `workId`、Codex session、绝对项目目录与上下文 hash。

Codex 完成真实工作和验证后，通过 `trace_product_result_return` 把事实、解释、未确认项和产物路径分开带回。`returned_for_review` 只表示结果抵达 Trace 的复核边界，不表示用户已经采用新的理解。默认本机服务地址是 `http://127.0.0.1:4173`，并且只允许 HTTP loopback origin。

## 安装一次，日常不再配置

在 Trace 安装目录双击：

```text
Connect-Trace-to-Codex.cmd
```

它会先展示计划、询问确认，再连接 Plugin 与本地 MCP；不会初始化 `.trace/`、读取认知源、迁移 profile 或启用 hooks。日常只需回到 Codex 使用 `$trace`。

完整安装、可见性与旧用户版本行为见[Trace Codex Plugin 文档](../../docs/codex-plugin.md)。
