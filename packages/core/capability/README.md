# `@trace/core-capability`

Capability Publisher 是 Trace 的“候选能力 → 可审查产物 → 明确发布”边界。它不会把一次讨论或一个目录直接当成 Skill，也不会自动删除目标目录中的未声明文件。

## 发布协议

协议标识为 `trace.capability-publish@0.2.0`。历史 `0.1.0` manifest/spec 会在内存中显式 upcast；无迁移路径的版本拒绝读取。一份 `CapabilitySpec` 必须声明：

- 能力身份、版本、显示名、说明和产物类型；
- 绝对的 source/target root；
- 明确的相对文件清单（禁止遍历、反斜杠和 symlink）；
- host/runtime 兼容性和可选协议注册表引用。

## 生命周期

```text
preview → stage → validate → publish(用户明确 approval) → rollback(发布回执)
```

- `preview` 只读取并比较文件，明确 additions/updates/unchanged/removals，始终要求确认。
- `stage` 在隔离 candidate 目录生成 `candidate.json`、源哈希和安装前哈希。
- `validate` 重新检查源文件、候选文件集和每个文件哈希，防止候选目录被静默替换。
- `publish` 要求非空用户 approval；写出独立 receipt，并在写入后逐文件校验哈希。目标目录存在未声明文件或 staged 后被外部修改时拒绝发布。
- `rollback` 只依据 receipt 恢复发布前内容，并且仅在目标当前仍等于本次发布结果时执行；不会修改 Trace SQLite/JSONL 数据。

当前实现位于 `src/contract.ts` 与 `src/publisher.ts`。它是 TS runtime 的唯一能力发布实现；旧 Python 发布入口只作为兼容对照，不与该发布器并发写同一个目标。
