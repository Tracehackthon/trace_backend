# Codex app-server live smoke

日期：2026-09-17。使用本机 `codex-cli 0.155.0-alpha.2.6` 的实际可执行文件，以临时 `CODEX_HOME` 启动：

```powershell
codex app-server --stdio
```

工作目录是本 runtime 项目；没有读取或复制用户的 `auth.json`。握手返回：

- `initialize.userAgent`: `Codex Desktop/0.155.0-alpha.2.6 (...) dumb (...)`
- `account/read {"refreshToken":false}`: `account:null`、`requiresOpenaiAuth:true`（隔离 home 未登录，符合预期）
- `thread/start` 使用真实项目 `cwd`、`approvalPolicy:"on-request"`、`dynamicTools:[]`，返回 `thread.ephemeral:false`、`historyMode:"paginated"` 和项目 `cwd`
- 发送一条合成文本 `turn/start` 后发送 `turn/interrupt`，服务端返回中断结果；不调用模型、不执行工具
- 同一进程内 `thread/resume {threadId,cwd,approvalPolicy}` 成功，返回同一 thread、`preview` 和 `turns[].status:"interrupted"`

补充：只做 `thread/start` 而没有第一条 turn 时，立即 `thread/resume` 返回 `no rollout found for thread id`；这是 Codex 对尚未 materialize 的持久 thread 的预期行为，不是兼容性放宽理由。Trace native 路径总是在 `thread/start` 后提交 `turn/start`，并将该 thread id 作为后续显式 resume 身份。

stderr 仅有临时 `CODEX_HOME` 的 PATH alias 警告与 Windows PowerShell shell snapshot warning；没有写入本项目内容。
