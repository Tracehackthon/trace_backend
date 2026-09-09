# Desktop shell boundary（刻意未实现）

`apps/desktop/` 是未来用户可见工作台的宿主边界，不是核心业务包。当前**没有** Electron/Tauri/Wails shell、窗口进程、自动同步器或“假 desktop adapter”；在没有真实桌面事件协议、权限模型和用户交互验收前，实现这些会把猜测固化为产品行为。

已经确定、但尚未由本目录实现的契约：

```text
desktop renderer / main process
          ↓ explicit SDK / JSONL RPC
Trace runtime (project-local .trace/state/trace.sqlite)
          ↓
core protocol / data / storage
```

未来实现的准入条件：

1. 先以 Change Set 固化 desktop event schema、版本和 replay fixture；
2. renderer 只能通过 SDK/RPC 请求摘要、引用和显式命令，不能直接读写 SQLite/JSONL；
3. main process 必须把文件/网络/认知源权限转成可见、可撤销的用户确认；
4. 默认工作视图显示主题摘要、证据数量、状态、影响和下一步；审核视图才展示 revision/lineage，诊断视图才展示运行时细节；
5. prompt 案例必须调用 `prompt-case propose → capture`，不可将输入框内容自动入库；
6. 必须通过多次使用、恢复、backup/restore、不同用户 source profile 的端到端测试后，才可标记 desktop 已实现。

桌面端届时与 Codex 共享**同一项目本地** `.trace/`，不会另建隐蔽状态库。
