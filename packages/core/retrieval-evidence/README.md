# `@trace/retrieval-evidence`

此包定义“宿主原生检索已经发生了什么”的安全 evidence 协议。它支持 `source_access_offered`、`source_search`、`source_read` 与 `source_access_unclassified`，只保存相对 locator、当时 revision/hash、受控 hash 与策略身份。

它不是检索器：不会根据 prompt 预选页面、注入正文或声称 Agent 已理解。Codex 仍决定是否搜索、怎样读；Trace 只提供来源 lease、预算与访问分类。absolute root、prompt、来源正文、工具参数和工具输出不进入 evidence。详见[宿主原生检索架构](../../../docs/host-native-retrieval.md)。
