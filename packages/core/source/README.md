# Source

来源领域包描述用户选择的来源快照、revision、状态与 provenance。它保持宿主无关：知乎、个人知识库、团队 Wiki 或未来 provider 都是 integration adapter，而不是 core 的专用字段。

来源内容不是自动上下文。Trace 只让用户配置/授权的来源在受控 scope 下可被宿主访问，并保存安全的 locator、revision 和 evidence；完整正文、root、凭证和“Agent 已理解”的断言都不进入通用状态。
