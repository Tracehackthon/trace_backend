# `@trace/core-capability`

Capability Publisher 是 Trace 的“候选能力 → 可审查产物 → 明确发布”边界。它不会把一次讨论、一个目录或一条前例直接当成 Skill，也不会自动删除目标目录中未声明的文件。

## 生命周期

```text
candidate + evidence + Change Set
  → preview
  → stage
  → validate
  → publish（用户明确 approval）
  → rollback（receipt）
```

- `preview` 只读取并比较 additions / updates / unchanged / removals；
- `stage` 在隔离目录生成 `candidate.json`、源 hash 与安装前 hash；
- `validate` 复核源文件、候选文件集与每个文件 hash；
- `publish` 要求明确 approval，写独立 receipt，逐文件校验；目标有未声明文件或 staged 后变更时拒绝；
- `rollback` 仅在目标仍等于本次发布结果时依据 receipt 恢复，不回写 Trace ledger。

`trace.capability-publish@0.2.0` 对历史 `0.1.0` 使用显式 in-memory upcast，未知版本拒绝读取。当前实现是 TypeScript runtime 的唯一能力发布路径；旧 Python 入口仅作兼容对照，不并发写同一目标。

用户应该先在 `$trace-review` 看能力候选的来源、范围、验收与风险。采用候选不等于发布；发布仍须经过上述 preview / validation / explicit approval 流程。
