# `@trace/data`

`@trace/data` 是 Trace 的可回放数据底座：统一 envelope、来源与父子引用、schema 身份、payload / envelope hash，以及 append-only revision。宿主必须通过 runtime / application service / SDK 写入，不能绕过它直接写 SQLite。

## 不可省略的链路字段

- `record_id`、`revision`：稳定身份与可回放修订；
- `kind`、`schema_id`、`schema_version`：记录类型与兼容性身份；
- `origin`、`producer`：来源与产生组件；
- `lineage.parent_refs`、`lineage.source_refs`：精确引用上游记录 revision；
- `payload`：由各 kind 的闭合 validator 校验；
- `integrity.payload_hash`、`integrity.envelope_hash`：读回时重新计算，篡改失败。

`prompt_capture_proposal` 只保存 transient prompt 的 hash、用户摘要和选择，不保存 raw prompt。只有用户明确 capture 后的 `source_snapshot` 才可承载选定内容；案例、候选前例与能力发布仍分别经过 outcome evidence、Change Set 和 adoption。

当前 `trace.data-envelope@0.3.0` 用显式 in-memory upcaster 读取已注册历史版本；未知或断链版本 fail-closed。`DataLedger.verifyChain()` 会核验引用、revision、kind/schema、一致性 hash 与 lineage 环。
