# DeepSeek Harness integration boundary（刻意未实现）

`packages/integration/deepseek-harness/` 是未来 DeepSeek Harness 宿主适配器的位置，不是 Trace core，也不是一个虚构的 SDK 集成。当前**不加载、不注册、不订阅、不修改**任何 DeepSeek Harness；没有已验证的真实宿主 lifecycle/event API 时，不能用猜测的事件名伪造“已接入”。

未来 adapter 的固定边界：

1. 只实现 `@trace/plugin-contract` 的 host adapter；任何 host 私有包名都留在 adapter 内，不能泄漏到 core protocol；
2. 先以 Change Set 固化真实 host version、事件 schema、权限、事件顺序、重放 fixture 与 failure semantics；
3. 将 host event 映射为 Trace 的 bounded activation/continuity/observability contract，原 prompt、完整 transcript、工具参数与凭证不自动写入；
4. 外部来源、结果、候选前例、prompt case 和能力产物只能经 runtime 的 data/lineage/proposal gates；不直接写 JSONL/SQLite，不复制 Change Set 状态机；
5. 必须验证 host compatibility、schema、replay、行为和 deactivate/rollback，才可加入 profile/bundle 并标为完成。

DeepSeek 与未来 desktop 都应使用项目级 `.trace/` 作为用户可见状态边界，而不是另起一套私有数据库。
