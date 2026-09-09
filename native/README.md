# native/

`native/` 是 Trace 的**发行与安装边界**，不是领域逻辑。Change Set、上下文、候选、能力和数据规则仍全部由 TypeScript runtime 实现；native 只负责启动、校验、安装及平台相关 sidecar。

桌面端 shell 位于 `apps/desktop/`，不放在 `native/`。native 可以为它提供 launcher/sidecar，但不能承载窗口状态、插件发现或 Trace 数据规则。

## 用户入口

安装完成后，在项目目录执行：

```powershell
trace init
trace codex enable
trace status
```

Windows 安装目录同时提供 `trace.cmd` 与兼容别名 `trace-runtime.cmd`。两者都会启动同一份发行包 runtime；日常使用优先 `trace`。

从源码制作和安装发行包：

```powershell
corepack pnpm package -- --out C:\abs\trace-release
node C:\abs\trace-release\native\install.mjs --target C:\abs\trace-installed
C:\abs\trace-installed\native\launcher\trace.cmd --help
```

`install.mjs` 会先验证 `release-manifest.json` 中每个文件的 SHA-256 与字节数，然后写入 staging 目录并原子替换目标。默认拒绝覆盖；需要升级时显式传 `--replace`。旧安装会保留为 `.previous-*`，安装回执写在目标目录内。

## 当前分发能力

- `launcher/trace.mjs` / `trace.cmd`：默认产品 CLI；
- `launcher/trace-runtime.mjs` / `trace-runtime.cmd`：兼容命名的同一 launcher；
- `install.mjs`：清单校验、staging 安装、原子替换与安装回执；
- 发行包 materialize 纯 JavaScript `sql.js`（asm build）及运行资产。Node 22–24.1 默认使用它，以避免加载实验性的 `node:sqlite`；Node `>=24.2.0` 默认使用稳定内置 driver。`release-manifest.json.sqlite_driver_bundle` 记录 fallback 身份。

## 维护者边界

- `launcher/` 只负责参数、环境和退出码，不能实现 Change Set 或上下文规则；
- `sidecars/` 只可放平台相关的沙箱、文件观察或进程辅助程序；
- `releases/` 记录生成物清单、平台/架构矩阵和哈希，不把二进制提交为源码；
- native 发行物必须携带 `runtime_version`、`protocol_versions` 和源码/构建哈希；`install.mjs` 不接受未经清单校验的目录。

当前 installer 是跨平台 Node 安装器，不等同于免 Node 的单文件二进制。Node SEA 仍需要单独的目标平台构建、签名和回放门禁；在行为和协议稳定前不把它伪装成已完成的 native binary。
