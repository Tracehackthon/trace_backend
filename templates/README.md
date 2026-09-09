# Trace Templates

模板是冷启动输入，不是用户认知源本身。一个 Bundle 分开声明三类内容：

- `capabilities/`：预设行动能力；
- `sources/`：预设认知源路由、作用域和权限；
- `contexts/`：Trace 的激活、可见性、回执和治理上下文。

先执行 `trace-runtime template preview`，确认 additions、权限和兼容性，再使用带 `--confirm true` 的 `trace-runtime template install` 生成 instance lockfile。模板更新必须保留用户 overlay，并通过三方 Diff、Change Set 和验收后才激活。

可选冷启动模板：

- `trace.codex-starter`：用户选择自己的 MyWiKi profile；携带共同思考的结构/source-pack，但不复制另一用户的语义内容。
- `trace.codex-empty`：只安装协议和空上下文，适合不授权认知源的用户。
- `trace.codex-team`：要求显式选择团队认知源，作用域只允许 team/project。

需要认知源的模板必须在 install 时提供 `--source-profile ABS`；lockfile 只保存 source id、profile hash 和 scope type，不把 root 或凭证写入模板。
