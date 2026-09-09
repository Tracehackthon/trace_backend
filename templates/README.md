# Trace Templates

模板是冷启动输入，不是用户认知源本身。一个 Bundle 分开声明三类内容：

- `capabilities/`：预设行动能力；
- `sources/`：预设认知源路由、作用域和权限；
- `contexts/`：Trace 的激活、可见性、回执和治理上下文。

## 用户如何选择

`trace-runtime project init` 会在项目下创建 `.trace/`。默认的 `local` 模式建立空的项目认知源目录，适合冷启动；`external` 模式通过用户自己提供的 source profile 连接已有个人认知源；`team` 模式连接明确授权的团队认知源；`empty` 模式完全不读取认知源。

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js template list
node <RUNTIME_DIR>/dist/apps/cli/src/main.js template preview --manifest <TEMPLATE_MANIFEST>
```

确认 additions、权限和兼容性后，再使用带 `--confirm true` 的 `project init` 或 `template install`。模板更新必须保留用户 overlay，并通过三方 diff、Change Set 和验收后才激活。

可选冷启动模板：

- `trace.codex-starter`：Codex + 共同思考治理结构；可使用项目本地认知源，也可显式连接用户选择的外部 profile。
- `trace.codex-empty`：只安装协议和空上下文，适合不授权认知源的用户。
- `trace.codex-team`：默认 team 作用域，要求显式选择团队认知源或使用项目内团队副本。

认知源 profile 至少包含 `source_id`、`root`、`user_id`。项目 lockfile 只保存 `source_id`、`profile_hash` 和 `scope_type`，不把 root 或凭证写入模板锁；profile 本身作为本地配置管理。
