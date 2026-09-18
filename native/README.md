# Native 发行与安装边界

`native/` 是用户获得 Trace 产品的交付边界：负责把已构建 runtime 安全安装到本机，并一次性连接 Codex Plugin。它让产品可以安装、检查、替换和恢复；认知变化、候选、能力与存储规则仍由 TypeScript runtime 统一实现。

普通用户不需要日常打开此目录。日常协作入口始终是 Codex 中的 `$trace`；CLI 只在 Plugin 不可用、需要备份/恢复或进行自动化时使用。

## 两个独立的安装动作

### 1. 安装或更新 Trace runtime

发行包安装器校验 `release-manifest.json` 的 SHA-256 与字节数，写入 staging 后才原子替换目标。默认拒绝覆盖；显式 `--replace` 时保留旧安装为 `.previous-*` 并写入 receipt。

```powershell
corepack pnpm package -- --out <release-directory>
node <release-directory>\native\install.mjs --target <installed-runtime-directory>
```

### 2. 一次性连接 Codex Plugin

runtime 已安装后，普通用户直接双击安装根目录的 `Connect-Trace-to-Codex.cmd`。它会先运行安全预览并在写入 Codex 前询问确认，不需要用户填写 Node 路径。

无图形/批处理启动器的维护场景，才使用下面两条**单行**命令：

```powershell
node <installed-runtime-directory>\native\install-codex-plugin.mjs --dry-run
node <installed-runtime-directory>\native\install-codex-plugin.mjs --confirm true
```

它会复制受管理的 Plugin marketplace、在 `.agents/plugins/marketplace.json` 写入 Codex 可发现的 marketplace manifest、注册 `trace-codex` 并为其 MCP 写入 runtime 位置；**不会**创建或升级项目 `.trace/`、读取认知源、迁移 profile，或启用 hooks。更新 Plugin 才显式追加 `--replace`，且只刷新 `trace-codex@trace-runtime-local`。安装先在 staging 完成 Plugin 校验，旧 marketplace 只有在 staging 成功后才会移动；因此 staging 失败不会触碰已有 marketplace。交换之后若失败，安装器会尝试恢复旧 marketplace；若无法完整恢复，会留下失败 journal，必须先审阅它再重试。

Plugin 安装器在 staging 前校验指定 runtime root 的 `runtime.json`/`package.json`、必需服务入口和发行包 `release-manifest.json` 哈希，并校验 Plugin/Skill 清单是否仍受该 manifest 覆盖；MCP launcher 启动前还会复核 `TRACE_RUNTIME_ROOT`。因此 dry-run 或 `--replace` 不会把只含 MCP 文件的旧 checkout、半拷贝目录或其他 lookalike root 当成当前 Trace runtime。

Plugin 版本更新也不会自动接收宿主会话。完成 Plugin 连接后，仍要单独通过 hooks proposal/approval 安装七个受管事件（`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`Interrupt`、`SessionEnd`），并在当前 Codex task 中明确 attach；未 attach 仍不保存 prompt/final。没有 `.trace/` 的 cwd 只有在 Codex hook 环境与 Product Service 共享同一个绝对 `TRACE_WEB_STATE_FILE` 时才能进入用户级 `web.sqlite`；缺少该配置时保持安全 no-op。

完整的项目状态和版本行为见[Codex Plugin 文档](../docs/codex-plugin.md)与[版本、协议与发布](../docs/versioning.md)。

## 当前分发能力

- `launcher/trace.mjs` / `trace.cmd`：CLI 回退与自动化入口；
- `launcher/trace-runtime.mjs` / `trace-runtime.cmd`：兼容名称；
- `install.mjs`：runtime 清单校验、staging 安装、原子替换与 receipt；
- `install-codex-plugin.mjs`：Plugin 的显式、可预览、可替换安装；
- SQLite driver materialization：Node `>=24.2.0` 可用稳定内置 driver；较早受支持 Node 使用发行包内的 `sql.js`，避免实验性 warning。

Node SEA 单文件、签名和真正桌面安装器仍是未来发行物，不因本目录存在而宣称已经完成。

## Codex app-server 动态资格验证

Native Codex 不把任意新的 semver 当作兼容版本。`native/codex-compatibility.mjs` 将以下证据组合成一条可重放的本地资格记录：

1. 当前可执行文件的 `--version` 与二进制 SHA-256；
2. 同一可执行文件生成的 `app-server` JSON Schema 及内容指纹；
3. Schema 中实际存在的 `initialize`、账户、thread、turn 和审批/事件方法；
4. 当前进程的 `initialize`、`account/read`、隔离 `thread/start(ephemeral)` wire probe。

服务器 `userAgent` 只用于和可执行文件版本互相校验，不作为能力清单；服务器返回的任意声明也不会直接放行。二进制哈希、Schema 指纹、版本或 initialize 身份变化时，旧记录失效。资格记录放在用户本地路径，不写入源码 fixture，原子更新并可回放核验。记录属于安装/协议能力，不绑定资格命令当时所在的项目目录；当前项目仍由 native adapter 在连接时重新约束。

首次安装或 Codex 自动更新后执行：

```powershell
pnpm qualify:codex-app-server
```

可通过以下环境变量改变本地记录和 Schema 缓存位置：

```powershell
$env:TRACE_CODEX_QUALIFICATION_RECORD = '<absolute-path>\\codex-app-server-qualification.json'
$env:TRACE_CODEX_SCHEMA_CACHE = '<absolute-directory>'
$env:TRACE_CODEX_QUALIFY_PROJECT = '<absolute-project-directory>'
```

该命令默认**不会启动模型 turn**，只进行握手、账户读取和隔离 thread 创建。`TRACE_CODEX_LIVE_TURN_PROBE=1` 是明确的人工资格实验开关，可能触发 provider 工作，不应作为自动启动检查。未知版本只有在生成新 Schema 并通过该 wire probe 后，才会形成本地资格记录；缺少方法、Schema 被篡改、二进制被替换、身份不一致时保持 fail-closed。
