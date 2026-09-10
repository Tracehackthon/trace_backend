# 产品边界与架构

Trace 的架构不是从“数据库、RAG 或 hook”倒推出来的，而是服务于同一条产品生命周期：**候选认知变化 → 用户采用 → 能力 / 激活 → 后续验证、限制或撤回**。

```text
用户层：看见工作线、来源实际使用、候选、采用状态、能力、健康与恢复
    ↓
宿主层：Codex hooks、SDK JSONL RPC、未来 desktop adapter
    ↓
核心层：协作模型、来源地图、context、continuity、data、precedent、capability、change set、storage
```

## 用户层

用户看到的是项目、认知源、当前协作模型、来源地图、候选、能力、健康与恢复；更重要的是能知道：本轮发生了什么变化、什么只是候选、什么尚未保存、下一步怎样继续。默认 CLI 从最近的 `.trace/` 自动发现项目，避免重复填写 SQLite 路径、lineage 或 producer。`trace profile` 显示协作契约和地图；`trace sources` 显示宿主实际使用来源的 evidence。两者分别回答“应如何协作”和“实际做了什么”。

## 宿主层

Codex hook、SDK 与未来桌面端使用 `trace internal ...` 或 RPC。Codex 的用户级 hook 不携带某个固定项目路径，而是按每个事件的 `cwd` 找到最近 `.trace/`，再加载该项目 profile 与状态库；非 Trace 项目成功 no-op。它们可以传递 event、引用、correlation 与 causation，但不能绕过 runtime 直接写 SQLite / JSONL。

对于认知源检索，职责不是“Trace 检索、Codex 读取预选页”，而是：`UserPromptSubmit` 先编译版本化的协作模型与来源地图（不含来源正文），再给当前宿主 source lease（正式根、prefix、预算）；Codex 使用自己的 native search/read/tool 能力决定实际访问；`PreToolUse` 对可识别 read 检查预算；`PostToolUse` 把实际访问写成无正文的 `host_retrieval_evidence`。个人/项目地图存于 ignored `profiles/`，`instance/activation.lock.json` 只保存身份/hash；配置变更通过显式更新与备份，避免隐式 drift。因此用户可区分来源已提供、已搜索、已读取与未分类访问，不会把一个 pointer 当成 Agent 已读。完整协议见 [Codex 原生检索与 Trace 证据架构](host-native-retrieval.md) 与[适配使用者](personalization.md)。

Desktop 与 DeepSeek Harness 仍是明确未实现的宿主边界：目录存在不等于产品已接入。真实 lifecycle、权限、事件顺序、replay、deactivate 与 rollback 必须先有可验证契约。

## 核心层

- Context 只提供受控引用、预算和禁止范围，不注入整库正文；host-native source lease 的绝对根仅存在于当前宿主响应，持久化 evidence 只保存安全相对 locator、revision/hash 与输入/输出 hash；
- Continuity 记录跨会话工作线、重要变化、激活 / 沉淀回执，而不把完整聊天伪装为认知源；
- Data Ledger 维护 hash、revision、lineage 和 fail-closed 验证；
- Change Set 管理候选、验证、采纳、发布与回滚；
- Prompt case 必须经过 transient → proposal → user-approved capture；
- 协议 upcaster 只生成内存视图，不重写历史 revision；
- Observability 不提供自由 payload 字段，避免 prompt、来源正文、凭证和工具参数误入运行日志。

`native_observed` 不是文件系统沙箱：Codex hook 可以观察 Bash、MCP 和多数本地函数工具，但不能成为所有专用工具路径的强制 ACL。对需要硬隔离的来源，profile 不能开启 native lease，必须等待真实权限 adapter。

开发者接口仍可通过 `trace --help --advanced` 发现。它们稳定、可测试，但不应成为新用户 README 或 Codex 日常提示中的默认操作。
