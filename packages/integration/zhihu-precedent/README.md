# `@trace/integration-zhihu-precedent`

知乎外部来源到 Trace 候选前例的独立 adapter。它不进入 `@trace/data` 或 `@trace/precedent` 内部，也不承担用户 adoption、能力发布或 HTTP 鉴权决策。

输入可来自真实 transport 或离线回放 fixture；adapter 只接受有界、可追溯的摘要与来源身份，不把 HTML/全文直接变成认知源。它产出两类草稿：

1. `captureZhihuAnswer`：可审阅的 `source_snapshot`；
2. `buildZhihuCandidatePrecedent`：带 source revision、相似/差异/风险与 Change Set ID 的 `candidate_precedent`。

候选仍需用户审阅、结果证据和 adoption；“知乎上有类似案例”不自动变成 Trace 的能力或判断。
