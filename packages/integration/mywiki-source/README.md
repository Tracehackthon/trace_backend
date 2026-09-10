# `@trace/integration-mywiki-source`

这是一个本地 Markdown 认知来源 adapter；包名保留历史兼容性，但产品语义是通用的“用户授权的正式认知来源”，不依赖任何开发者个人 Wiki 或固定目录。

它负责读取用户明确配置的 source profile、计算页面 revision、生成安全 locator，并为正式页面写入提供 proposal / receipt。它不把全文写入 Trace ledger，不把来源 root 打包到公共模板，也不自行决定哪些页面应进入 Codex 上下文。

Codex 原生检索模式下，Trace 只提供受控 source lease 与访问 evidence；Codex 自己决定是否搜索/读取。正式来源写回必须经过用户明确的 proposal → adopt → revision/hash CAS → backup → atomic write。
