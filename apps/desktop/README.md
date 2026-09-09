# Desktop shell（预留）

桌面端属于宿主/展示边界，不属于 `core`，也不属于 native 领域逻辑。未来无论采用 Electron、Tauri、Wails 或其他 shell，都应遵循：

```text
desktop renderer / main process
          ↓  SDK / JSONL RPC
Trace runtime（产品模式显式 sqlite-state-file；开发模式显式分离 change/data/continuity state file）
          ↓
core protocol / data / storage
```

- renderer 不直接读取或修改 JSONL；
- main process 只负责窗口、进程生命周期、权限和显式 runtime command；
- native 只负责平台启动器和 sidecar，不能复制数据状态机；
- 所有桌面操作仍返回 `record_id`、`revision`、`change_id` 和 lineage report，便于审计和回放。
- 工作视图默认只显示主题摘要、证据数量、状态、影响和下一步；审核视图再展开来源摘录、Diff、revision 和 lineage；诊断视图才显示 runtime/tool 细节。
- Continuity 面板必须显示沉淀回执、激活回执、未决问题和“如何继续对话”；模板安装先 preview，生成 instance/lockfile 后才允许激活。

当前没有选择桌面技术栈，也没有构建桌面二进制。
