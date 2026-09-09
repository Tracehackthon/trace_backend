# native/

Native 是运行时分发边界，不是领域逻辑。发行包仍由 TypeScript runtime 生成；native 只负责启动、校验、安装和平台相关 sidecar，不能复制 Change Set、上下文或数据规则。

桌面端 shell 位于 `apps/desktop/`，不放在 `native/`。native 可以为桌面端提供 launcher/sidecar，但不能承载窗口状态、插件发现或 Trace 数据规则。

当前可用入口：

- `launcher/trace-runtime.mjs`：用当前 Node 启动发行包内的 `dist/apps/cli/src/main.js`，设置 `TRACE_RUNTIME_ROOT`，透传参数和退出码；
- `launcher/trace-runtime.cmd`：Windows 的薄包装；
- `install.mjs`：校验 `release-manifest.json` 中每个文件的 SHA-256/字节数，再写入 staging 目录并原子替换目标。替换前保留 `.previous-*`，安装回执写在目标目录内；默认拒绝覆盖，必须显式 `--replace`。
- 发行包同时 materialize 纯 JavaScript `sql.js`（asm build）及其运行资产。Node 22–24.1 的 runtime 默认先使用它，避免加载实验性的 `node:sqlite`，不依赖 node-gyp、预编译二进制或本机编译器；Node `>=24.2.0` 默认使用稳定内置 driver。`release-manifest.json.sqlite_driver_bundle` 记录该 fallback 身份。

```text
corepack pnpm package -- --out C:\abs\trace-release
node C:\abs\trace-release\native\install.mjs --target C:\abs\trace-installed
C:\abs\trace-installed\native\launcher\trace-runtime.cmd doctor run --sqlite-state-file C:\abs\trace-state\trace.sqlite
```

发布/安装约定：

- `launcher/`：启动同版本 TS runtime，负责参数和退出码，不实现 Change Set 或上下文规则；
- `sidecars/`：平台相关的沙箱、文件观察或进程辅助程序；
- `releases/`：生成物清单、平台/架构矩阵和哈希，不把二进制提交为源码；
- native 发行物必须携带 `runtime_version`、`protocol_versions` 和源码/构建哈希，不能被 Python SDK 静默替换；`install.mjs` 不接受未经清单校验的目录。

当前 installer 是跨平台 Node 安装器，不等同于免 Node 的单文件二进制。Node SEA 仍需单独的目标平台构建、签名和回放门禁；在行为和协议稳定前不把它伪装成已完成的 native binary。

