# Codex app-server 动态兼容性资格

## 目的

Native Codex 不能把 `0.x.y` 当成能力契约。Codex app-server 是实验性 JSON-RPC 协议，版本字符串、`initialize.userAgent` 与实际 Schema 之间可能不一致；因此 Trace 只接受一份由**同一可执行文件**产生的本地资格记录。

## 资格记录包含什么

`trace.codex-app-server-qualification` 记录：

- `executable.sha256`：当前 Codex 可执行文件的 SHA-256、路径、版本输出；
- `schema.fingerprint`：`generate-json-schema --experimental` 生成的 `ClientRequest`、`ServerRequest`、`ServerNotification` 内容指纹；
- `schema.required_surface`：从生成 Schema 实际抽取并核验的 Trace 所需方法；
- `initialize`：真实握手的 `userAgent`、`codexHome`、平台与客户端声明；
- `probe.evidence`：经过脱敏的真实 JSON-RPC 调用序列。默认 probe 只做 `initialize → account/read → thread/start(ephemeral)`，**不启动 turn**；
- `cache_key`：版本、userAgent、二进制 hash、Schema 指纹、probe 指纹的组合哈希。

记录本身不是信任根：启动时仍要重新读取可执行文件、重新生成/读取对应 Schema 并执行 live `initialize`。任一身份、Schema 或 probe 证据变化都会 fail-closed。

## 初次资格验证与 Codex 更新

```powershell
pnpm qualify:codex-app-server
```

命令会：

1. 调用当前 `codex --version`；
2. 用同一个可执行文件生成 JSON Schema；
3. 启动同一个可执行文件的 `app-server --stdio`；
4. 真实发送 `initialize`、`account/read`、隔离 `thread/start(ephemeral)`；
5. 通过方法表面、Schema 指纹、初始化身份、项目 cwd/ephemeral 结果的组合验证后，写用户本地记录。

默认不会调用 `turn/start`，因此不会以“自动检查”为名隐式发起模型工作。`TRACE_CODEX_LIVE_TURN_PROBE=1` 仅供人工明确开启的实验性资格测试，可能产生 provider 工作，不应放在启动路径。

Codex 自动更新后，启动时如果发现以下任一项变化，会拒绝继续使用旧记录：

- 可执行文件 SHA-256 或路径变化；
- `--version` 与握手 `userAgent` 不一致；
- Schema 文件 hash/fingerprint 变化；
- 生成 Schema 缺少 required method；
- 本地资格记录、probe evidence 或 cache key 被修改；
- live initialize 的 `codexHome`/平台字段无效。

此时重新运行资格命令即可生成新的本地记录。旧记录不被覆盖为“兼容”；写入采用临时文件加原子替换，失败时保留旧记录并拒绝切换。

## 现有 adapter 接入约束

`apps/agent/codex.mjs` 的 native `open()` 应在正式创建 thread 前调用 `validateCodexAppServerInstallation({ initializeResult, initializeParams, executable, env, qualificationRecordPath })`。资格记录验证的是 Codex 安装与协议，不绑定生成记录时的项目 cwd；当前项目目录由 adapter 在本次连接的 realpath 与后续 `thread/start` 单独约束。不要把 `validateCodexAppServerVersion(userAgent)` 单独作为 native 放行条件；它只保留给旧测试/插件协议的历史检查。没有记录或记录无法重新核验时，应返回可行动的“请运行资格验证”，而不是放宽 semver 或启动模型。

公开 profile 能力只声明 `codex-app-server/dynamic-qualified` 与 `qualificationRequiredAtConnect`，不预报某个静态 runtime 版本；实际 `check` 成功后再返回此次 live qualification 得到的版本。
