# 产品边界与架构

Trace 的架构不是从“数据库、RAG 或 hook”倒推出来的，而是服务于同一条产品生命周期：**候选认知变化 → 用户采用 → 能力 / 激活 → 后续验证、限制或撤回**。

```text
用户层：看见工作线、来源、候选、采用状态、能力、健康与恢复
    ↓
宿主层：Codex hooks、SDK JSONL RPC、未来 desktop adapter
    ↓
核心层：context、continuity、data、precedent、capability、change set、storage
```

## 用户层

用户看到的是项目、认知源、候选、能力、健康与恢复；更重要的是能知道：本轮发生了什么变化、什么只是候选、什么尚未保存、下一步怎样继续。默认 CLI 从最近的 `.trace/` 自动发现项目，避免重复填写 SQLite 路径、lineage 或 producer。

## 宿主层

Codex hook、SDK 与未来桌面端使用 `trace internal ...` 或 RPC。它们可以传递 event、引用、correlation 与 causation，但不能绕过 runtime 直接写 SQLite / JSONL。

Desktop 与 DeepSeek Harness 仍是明确未实现的宿主边界：目录存在不等于产品已接入。真实 lifecycle、权限、事件顺序、replay、deactivate 与 rollback 必须先有可验证契约。

## 核心层

- Context 只提供受控引用和读取指针，不注入整库正文；
- Continuity 记录跨会话工作线、重要变化、激活 / 沉淀回执，而不把完整聊天伪装为认知源；
- Data Ledger 维护 hash、revision、lineage 和 fail-closed 验证；
- Change Set 管理候选、验证、采纳、发布与回滚；
- Prompt case 必须经过 transient → proposal → user-approved capture；
- 协议 upcaster 只生成内存视图，不重写历史 revision；
- Observability 不提供自由 payload 字段，避免 prompt、来源正文、凭证和工具参数误入运行日志。

开发者接口仍可通过 `trace --help --advanced` 发现。它们稳定、可测试，但不应成为新用户 README 或 Codex 日常提示中的默认操作。