# `@trace/integration-zhihu-transport`

知乎 HTTP transport 是外部 API 通信边界。它封装认证、分页、响应 envelope、错误分类和受限请求参数，并将结果交给 `@trace/integration-zhihu-precedent` 进行摘要/候选转换。

它不直接写 Trace SQLite、不改变 candidate/adoption 状态，也不把 API 原始正文自动作为认知源。调用方必须在配置层提供 endpoint、凭证、用户授权和限额策略；源码与公共 README 不包含个人 token、固定账户或环境路径。

产品中用户看到的是一个待审阅前例及其来源/风险，不是 transport 的原始 API 响应。

## 当前组成

- `src/index.ts`：官方 API transport；认证、超时、响应大小、错误分类和无损 Int64 分页。
- `src/normalize.ts`：知乎／全网摘要来源，保留真实 URL，不从内容 ID 拼造地址。
- `src/provider.ts`：共享来源服务、串行请求／限流、授权用户读取；无自动采纳。
- `src/oauth.ts`：本机授权会话、严格 state／浏览器绑定、后端交换 Token，内存保存。
- `src/http.ts`：同源 loopback Web／MCP 接口。
- `src/relay.ts`：HTTPS 回调代码中转，无 App Key／用户 Token；单进程、短时、一次性领取。

完整配置、原生 Codex 工具、Web 入口、HTTPS 回调与验收边界以[知乎与全网接入指南](../../../docs/zhihu-native.md)为准。知乎是内容来源 provider，不与 Codex／其他模型 provider 混为一层。
