# Desktop shell boundary（刻意未实现）

`apps/desktop/` 是未来用户可见工作台的宿主边界，不是核心业务包。当前**没有** Electron / Tauri / Wails shell、窗口进程、自动同步器或“假 desktop adapter”；在没有真实桌面事件协议、权限模型和用户交互验收前，实现这些只会把猜测固化为产品行为。

已经确定的集成方向：

```text
desktop renderer / main process
          ↓ explicit product application / MCP / SDK
Trace runtime（project-local .trace/state/trace.sqlite）
          ↓
core protocol / data / storage
```

桌面端与 Codex 必须共享同一项目本地 `.trace/`，不会另建隐蔽状态库。可复用的用户动作是：状态、来源安全摘要、候选 review、proposal、adopt、receipt；renderer 不得直接读写 SQLite/JSONL，也不得将输入框 prompt 自动入库。

准入条件：先以 Change Set 固化 desktop event schema、版本与 replay fixture；将文件/网络/认知源权限转成可见且可撤销的确认；通过多次使用、恢复、backup/restore、不同 profile 的端到端验证后，才可标记 desktop 已实现。
