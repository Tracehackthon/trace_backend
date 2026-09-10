# `@trace/integration-zhihu-transport`

知乎 HTTP transport 是外部 API 通信边界。它封装认证、分页、响应 envelope、错误分类和受限请求参数，并将结果交给 `@trace/integration-zhihu-precedent` 进行摘要/候选转换。

它不直接写 Trace SQLite、不改变 candidate/adoption 状态，也不把 API 原始正文自动作为认知源。调用方必须在配置层提供 endpoint、凭证、用户授权和限额策略；源码与公共 README 不包含个人 token、固定账户或环境路径。

产品中用户看到的是一个待审阅前例及其来源/风险，不是 transport 的原始 API 响应。
