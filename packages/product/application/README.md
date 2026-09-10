# `@trace/product-application`

`@trace/product-application` 是 Trace 的应用服务层。它将项目实例、协作 profile、runtime、Codex hook 安装器和版本检查组合为面向产品入口的安全操作，供 `apps/mcp`、CLI 与未来桌面端调用。

## 关键约束

- `inspect*` 只返回用户可见的安全摘要；来源 root、正文、prompt、凭证和工具参数不进入通用响应；
- `propose*` 不写状态，只生成含状态指纹的可解释提案；
- `apply*` 只接受与当前状态匹配的显式 adoption token；状态改变后提案自动失效；
- legacy 项目只会把当前兼容 profile 固化为 lock，不会重写 SQLite、来源、能力、模板或 hooks；
- 安装/更新 Plugin 与迁移用户项目是两条独立生命周期。

不要从 UI 或宿主直接访问 core storage；新的产品动作应先在此层定义提案、影响、回滚和 receipt。
