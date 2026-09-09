# `@trace/data`

Trace 的数据底座：统一记录封装、来源、父子引用、schema 身份、payload/integrity hash 和 append-only revision。它不负责 prompt、Codex 或 DeepSeek Harness 的组合；宿主只能通过 runtime/SDK 写入。

## 不可省略的数据链字段

- `record_id`、`revision`：稳定身份和可回放修订；不能只依赖最新值；
- `kind`、`schema_id`、`schema_version`：区分来源快照、规范化结果、候选前例、能力候选、提示词包、运行事件和产物；
- `origin`、`producer`：谁从哪里、由哪个组件生成；
- `lineage.parent_refs`、`lineage.source_refs`：具体指向某个记录的某个 revision；
- `payload`：领域数据；按 `kind` 检查必填字段；
- `integrity.payload_hash`、`integrity.envelope_hash`：读回时重新计算，篡改直接失败。

`prompt_capture_proposal` 是唯一允许在尚无 Change Set/上游 refs 时保存的候选数据 kind：它只保存 transient prompt 的 hash、用户写的摘要和选择，不能保存 raw prompt。真正内容只能作为用户确认后的 `source_snapshot` 写入。`trace.data-envelope@0.1.0` 会先验证历史哈希再只读 upcast 为 `0.2.0`；未注册版本 fail-closed。

`DataLedger.verifyChain()` 会递归检查父记录和来源记录是否存在、revision 是否精确匹配、kind/schema 是否一致，并检测循环引用。来源变化只能产生新 revision，不会覆盖旧证据。
