# `@trace/product-application`

`@trace/product-application` 当前实现的是 **Project Collaboration Runtime**，不是 Web 的 Product Workspace。它将项目实例、协作 profile、runtime、Codex hook 安装器和版本检查组合为项目协作入口，供 `apps/mcp` 与 CLI 调用。事项、理解、对照和工作状态由相邻的 [`@trace/product-workspace`](../workspace/README.md) 维护。

## 关键约束

- `inspect*` 只返回用户可见的安全摘要；来源 root、正文、prompt、凭证和工具参数不进入通用响应；
- `propose*` 不写状态，只生成含状态指纹的可解释提案；
- `apply*` 只接受与当前状态匹配的显式 adoption token；状态改变后提案自动失效；
- legacy 项目只会把当前兼容 profile 固化为 lock，不会重写 SQLite、来源、能力、模板或 hooks；
- 安装/更新 Plugin 与迁移用户项目是两条独立生命周期。

不要从 UI 或宿主直接访问 core storage；新的产品动作应先在此层定义提案、影响、回滚和 receipt。
