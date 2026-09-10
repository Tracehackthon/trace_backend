# `@trace/precedent`

候选前例的宿主无关协议包。它只定义 candidate precedent 的 payload、证据引用和 Change Set lineage，不了解 Codex、知乎 HTTP、桌面端或具体知识库实现。

外部来源 adapter 位于 `packages/integration/*`，不得把供应商字段塞进 core。用户 prompt 也只能在显式案例 capture 后作为一个 `source_snapshot` evidence ref；一次好结果、网页或讨论不能绕过候选、Change Set、验证与 adoption 门槛。

用户会在 `$trace-review` 中看到“这是什么前例、和当前项目哪里相似/不同、证据是什么、为什么仍未采用”，而不是被自动写进能力或上下文。
