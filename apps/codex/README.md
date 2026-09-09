# Codex adapter（第一版契约）

只处理 Codex hook/MCP 事件、Activation Pack 输入和宿主能力发现/审批/执行状态映射。`src/index.ts` 只编译有预算、来源引用、读取指针和禁止范围的 Activation Pack，并生成用户可见 activation receipt；它不能修改 core 状态机，也不能把宿主授权推断成 Trace 采用。

## 当前可切换触发入口

`trace-runtime codex trigger` 是 TS runtime 的显式 trigger seam。Codex hook/bridge 只需要把一个 `codex.turn.started` JSON event 写入绝对路径，然后调用：

```powershell
node dist/apps/cli/src/main.js codex trigger `
  --sqlite-state-file D:\abs\trace.sqlite `
  --event-file D:\abs\codex-turn-started.json
```

触发器只会产生 Activation Pack 和 activation receipt，不会发布能力，也不会把全文来源注入宿主。profile 中的 `trigger.mode` 可以在宿主接入时从 `manual` 切换为 `ts-runtime`；本轮不改用户级 Codex hook 文件。
