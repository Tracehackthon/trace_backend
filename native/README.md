# Native 发行与安装边界

`native/` 负责把已构建的 Trace runtime 安全地交给用户运行：打包、完整性校验、staging 安装、launcher 与一次性的 Codex Plugin 连接。它不承载认知变化、候选、能力或存储领域逻辑。

普通用户不需要日常打开此目录。日常协作入口始终是 Codex 中的 `$trace`；CLI 只在 Plugin 不可用、需要备份/恢复或进行自动化时使用。

## 两个独立的安装动作

### 1. 安装或更新 Trace runtime

发行包安装器校验 `release-manifest.json` 的 SHA-256 与字节数，写入 staging 后才原子替换目标。默认拒绝覆盖；显式 `--replace` 时保留旧安装为 `.previous-*` 并写入 receipt。

```powershell
corepack pnpm package -- --out <release-directory>
node <release-directory>
ative\install.mjs --target <installed-runtime-directory>
```

### 2. 一次性连接 Codex Plugin

runtime 已安装后，先预览再确认：

```powershell
node <installed-runtime-directory>
ative\install-codex-plugin.mjs --dry-run
node <installed-runtime-directory>
ative\install-codex-plugin.mjs --confirm true
```

它会复制受管理的 Plugin marketplace、注册 `trace-codex` 并为其 MCP 写入 runtime 位置；**不会**创建或升级项目 `.trace/`、读取认知源、迁移 profile，或启用 hooks。更新 Plugin 才显式追加 `--replace`，且只刷新 `trace-codex@trace-runtime-local`。

完整的项目状态和版本行为见[Codex Plugin 文档](../docs/codex-plugin.md)与[版本、协议与发布](../docs/versioning.md)。

## 当前分发能力

- `launcher/trace.mjs` / `trace.cmd`：CLI 回退与自动化入口；
- `launcher/trace-runtime.mjs` / `trace-runtime.cmd`：兼容名称；
- `install.mjs`：runtime 清单校验、staging 安装、原子替换与 receipt；
- `install-codex-plugin.mjs`：Plugin 的显式、可预览、可替换安装；
- SQLite driver materialization：Node `>=24.2.0` 可用稳定内置 driver；较早受支持 Node 使用发行包内的 `sql.js`，避免实验性 warning。

Node SEA 单文件、签名和真正桌面安装器仍是未来发行物，不因本目录存在而宣称已经完成。
