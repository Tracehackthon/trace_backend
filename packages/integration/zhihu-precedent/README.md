# `@trace/integration-zhihu-precedent`

知乎外部来源的独立 adapter。它不进入 `@trace/data` 或 `@trace/precedent` 内部，也不承担 Trace adoption/publish 决策。

输入可以来自未来知乎 API，也可以来自离线回放 fixture；adapter 只接受**有界摘要**，不把 HTML/全文直接变成认知源。它输出两个可进入 TS ledger 的草稿：

1. `captureZhihuAnswer`：`source_snapshot`；
2. `buildZhihuCandidatePrecedent`：带 source revision 和 Change Set ID 的 `candidate_precedent`。

当前包不负责 HTTP 鉴权、限流和 API 请求；这些属于未来 transport adapter。这样 API 变化不会污染候选前例协议。
