# Trace 本地 MCP

这是 `trace-codex` Plugin 的标准 stdio MCP server，也是未来桌面端可复用的产品控制面。它直接调用 `@trace/product-application`，而不通过 shell 拼接 CLI，因此 proposal、状态指纹、备份和 receipt 与 CLI 使用同一套核心语义。

## 提供什么

- 只读状态：项目、来源摘要、候选 inbox、能力候选、版本差异、Codex hooks；
- 上下文 Skill：把已锁定 collaboration model/source map 编译为当前 Codex task/project 的虚拟 `SKILL.md`，并写 privacy-safe activation receipt；
- 产品工作往返：领取用户确认的有限工作快照，真实完成后把结果送入 Trace 复核区；
- 显式变更：项目初始化、legacy profile lock 迁移、profile 更新、hook 启用；
- 每一项变更固定为 `inspect / discuss → propose（无写入）→ 用户 adopt → apply → receipt`；
- proposal 带状态指纹，发生并发变化时返回 `STALE_PROPOSAL`，不会按旧提案覆盖新状态。

## 不提供什么

MCP 不保存或通用返回 raw prompt、来源正文、认知源绝对 root、凭证、工具参数或隐藏推理；动态上下文包不会被安装到全局 Skill 目录。它不是检索层，Codex 仍用自己的搜索、读取、推理和编码能力。

普通用户不直接运行本 server。一次性安装由 `native/install-codex-plugin.mjs` 完成，日常通过 `$trace` 使用。完整 UX 与版本行为见[Trace Codex Plugin](../../docs/codex-plugin.md)。

## 知乎与全网（可选本机 provider）

新增 `trace_zhihu_status`、`trace_zhihu_search`、`trace_global_search`、`trace_zhihu_login`、`trace_zhihu_login_check`、`trace_zhihu_disconnect`、`trace_zhihu_user_read`。它们通过 `TRACE_PRODUCT_URL` 访问本机后端，不在 MCP 配置或输入中接收知乎密钥；登录由用户在浏览器授权，个人内容仅按明确请求读取。

构建与配置见[知乎接入指南](../../docs/zhihu-native.md)。工具存在不代表当前本机服务已开启或线上回调已部署；不自动读取收藏、翻页或采纳来源。
