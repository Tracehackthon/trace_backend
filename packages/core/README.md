# packages/core/

`core` 是 Trace 的行为核心组，类似 DeepSeek Harness 的 `packages/core`：协议、数据底座、连续性和状态机在这里，宿主/SDK 不反向定义它。每个子包均可独立测试，跨域变化用 Change Set 连接；宿主只通过 SDK/RPC 访问 continuity 和 activation pack。
