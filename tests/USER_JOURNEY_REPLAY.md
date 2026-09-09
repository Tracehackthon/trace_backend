# Codex 用户旅程回放说明

对应自动化测试：`user_journey.test.mjs`。测试每次使用临时 SQLite 和临时候选/能力目录，不接触用户真实数据库、Wiki 或已安装 Skill。

## 输入

1. `fixtures/zhihu-agent-collaboration.json`：已知知乎公开问题/回答 URL 的**有界摘要**，保留 `provider`、`source_id`、`external_id`、`url`、`captured_at`、`content_hash` 和 `content_mode`；不抓取或注入网页全文。
2. `fixtures/local-cognition-agent-collaboration.json`：本地 Trace 协作治理摘要，分类为 `private`，没有伪造外部 URL。
3. 用户主题：`Agent 协作问题：上下文与能力版本漂移`。

## 数据变化链

```text
source_snapshot(知乎@1) ─┐
                         ├─> codex.turn.started
source_snapshot(本地@1) ─┘       └─> activation_receipt
                                      └─> 2 discussion_turns
                                           └─> Change Set proposed@1
                                           └─> candidate_precedent@1
                                                ├─> validated@2
                                                ├─> adopted@3
                                                └─> published@4
                                                     └─> capability_candidate@1
                                                          ├─> adopted@2
                                                          └─> published@3
                                                               └─> Skill provenance ref
Change Set analyzed@2 → validated@3 → adopted@4 → promoted@5
                                      └─> capability receipt
                                      └─> persistence receipt
                                      └─> SQLite backup → restore → doctor
                                      └─> capability rollback（不回滚数据底座）
```

每一条后继记录都保存父记录的 `record_id + revision + schema identity`；候选和 Change Set 还保存 `causation_id/correlation_id`。测试最后递归验证候选链包含两类来源，且 SQLite 中仍有两条独立的 `source_snapshot`。

## 用户必须看见的内容

- 当前主题、两条来源的名称/类型/修订、读取指针、预算和禁止范围；激活回执明确“不会因此自动写入”。
- 每轮讨论的输入摘要、输出摘要、变化类型和开放问题，而不是无法解释的“Agent 已记住”。
- 候选前例的 claim、证据引用、当前状态（candidate/validated/adopted/published）。
- capability_candidate 的 semantic delta、判断变化、机制、适用范围、反例、验收和 adoption 状态；Skill 必须显示其精确候选 revision。
- Change Set 的 base/proposed、影响范围、验证结果、采用者、发布目标和当前 revision。
- 能力 preview 的 additions/updates/unchanged/removals，发布 approval、候选 manifest 哈希、文件哈希和 rollback 条件。
- persistence receipt：已保存的引用/版本、明确 `not_persisted` 清单和下一次可以继续问 Agent 的提示。

## 不应该注入或持久化的内容

- 完整原始聊天转录；测试只持久化讨论摘要和精确引用。
- 未采纳的候选；只有候选链达到用户采用后才允许发布。
- 未授权的私人来源；fixture 中的第三方私人范围被列入 `forbidden_scopes` 和 `not_persisted`。
- 未被 `source_refs` 选中的来源全文、知乎页面全文、宿主私有上下文和能力参数秘密。
- 从用户输入直接猜出的长期规则；必须通过 Change Set、验证、采用和 receipt 才能成为可再次激活的状态。

## 通过条件

测试必须同时满足：

1. provider/source ID 不合并；
2. Activation Pack 只含两个显式 source ref 和 read pointer；
3. lineage 完整、revision 连续、schema/hash 验证通过，且 candidate_precedent 不能绕过 capability_candidate 直接发布；
4. doctor 无 error，backup/restore 后记录数量和 receipt 不变；
5. 能力 rollback 只移除本次发布文件，不删除 SQLite、来源、候选或 Change Set。
