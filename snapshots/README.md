# Snapshots

这里保存测试与回放快照：输入身份、协议版本、输出、hash 与比较结果。快照是可复现测试证据，不是用户生产状态，也不能被 runtime 自动当作当前事实或认知源。

快照默认不得包含 raw prompt、来源正文、绝对路径、凭证、工具参数或隐藏推理；需要内容型 fixture 时应明确标为 synthetic test data。真实用户状态始终位于项目自己的 `.trace/`，并通过 backup / restore 管理。
