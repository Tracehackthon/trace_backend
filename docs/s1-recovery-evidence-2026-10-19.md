# S1 本机服务与成对恢复验证（2026-10-19）

## 边界与基线

- 基线：`91b86b17327fa3bb87e14cefb366d31c497b43c4`，隔离分支 `codex/runtime-s1-recovery`，独立 worktree；原 Runtime 工作树未提交状态不纳入本轮结果。
- 对象：此分支的**源码本机 Runtime**，使用系统临时目录中的隔离数据库、fixture 模型与来源，不使用真实用户库、真实模型、线上服务或桌面安装包。`traceweb` 0.2.11 的固定 Runtime 来源不同，不能由此判定安装版通过。
- 数据 owner：`web.sqlite` 为产品命令、事项、理解、revision 与回执；`agent.sqlite` 为 run、event、result；后者可原本不存在。服务启动顺序先取得端口，再开库；退出释放 owner。离线维护用同一 owner 拒绝本轮 Runtime 占用。
- `VACUUM INTO` 为每库制作独立 SQLite 快照；只有**所有写入者停止**，两库才构成同一离线时间点。工具不新增 HTTP API 或数据库 schema。

## 可重放命令与结果

在此分支根目录：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node --test tests/local-entry.test.mjs tests/product-commands.test.mjs tests/agent-backend.test.mjs tests/agent-service.test.mjs tests/backend-api-flow.test.mjs tests/product-recovery.test.mjs
```

本轮 `typecheck` 通过；上述测试 **56/56 通过**。`tests/backend-api-flow.test.mjs` 用 HTTP/SSE 跑通产品命令、来源 fixture、Agent run/结果、候选采纳；停服务后成对备份、验证，再写出 revision 3 和额外 Agent run，恢复到原路径后重启读取：revision 回到 2，原理解和 revision 1 命令回执可读，原 run 为 `succeeded`，备份后新增 run 不存在。`tests/product-recovery.test.mjs` 覆盖空库起步、Agent 原本缺席、备份后新增数据再原路径恢复；以及端口占用、Agent 初始化失败、损坏 Web/Agent 库、强制中断后重启、缺件、篡改、错目标和占用 owner 等失败路径。

首次运行 `backend-api-flow` 失败于独立 worktree 尚未构建 Zhihu fixture 的 `dist`，完成 `pnpm install --frozen-lockfile` 与 `pnpm build` 后进入真实测试。新增断言又两次发现测试输入错误：复用已有事项 ID，以及传入不允许的空 retrieval 列表；分别更正为新事项 ID、使用默认 retrieval 后测试通过。首次 `product-recovery` 运行的清理 hook 在 Windows 先于子进程停止触发 `EBUSY`，另一次发现 Windows 子进程 `SIGTERM` 并非可依赖的 JS 正常收尾；改用测试专用 stdin 正常停止通道后 7/7 新测试通过。上述失败没有触碰用户数据，也未静默当作成功。

另运行 `pnpm test` 全套：首次 238 项中 227 通过、3 失败、8 跳过；不重新构建再跑为 228 通过、2 失败、8 跳过。剩余失败均在未修改的 `tests/dialogue_engine.test.mjs` 第 2、3 项，错误为 `sql.js` 的 `Aborted(OOM)`；单独重跑该文件仍是 1 通过、2 失败。因此**不能把全套测试写成通过**。本轮 S1 相关的 56 项与类型检查通过；全套失败留作独立排查，不为扩大范围而改动认知对话引擎或测试数据。

## 尚未验证

- 未在 `traceweb` 0.2.11 安装实例、实际用户路径或真实长时间运行负载上做恢复验收；不宣称“本机产品可持续试用”。
- 离线 owner 只覆盖本分支桌面/独立 Agent 服务及既有 Agent owner；不遵守约定的外部写入者仍需维护者人工确认已停止。两库快照不是跨库事务。
- 备份摘要只检测文件变化，不提供来源真实性签名；备份及 `.pre-restore-*` 含私人内容，需本机保护。异常中断发生在多文件恢复中途时，需先人工核查暂存原件，不自动再试或删除。
- heartbeat 是进程活性；产品读取和 Agent run/worker health 才是相应功能的验收。前端体验不在本轮。

## 相关实现

- 离线命令和防覆盖逻辑：[maintain-product-state.mjs](../scripts/maintain-product-state.mjs)
- 生命周期与 owner：[桌面服务](../apps/desktop/server.mjs)、[独立 Agent 服务](../apps/agent/server.mjs)、[owner 锁](../apps/desktop/state-owner.mjs)
- 操作说明：[本机运行与恢复](local-runtime.md)
