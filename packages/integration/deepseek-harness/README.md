# DeepSeek Harness integration boundary（刻意未实现）

`packages/integration/deepseek-harness/` 是未来 DeepSeek Harness 宿主适配器的位置，不是 Trace core，也不是虚构的 SDK 集成。当前它**不加载、不注册、不订阅、不修改**任何 DeepSeek Harness；在没有已验证的真实 lifecycle / event API 前，不使用猜测的事件名伪造“已接入”。

未来 adapter 必须先满足：

1. 固化真实 host version、事件 schema、权限、事件顺序、重放 fixture 与 failure semantics；
2. 仅实现 `@trace/plugin-contract` 的 host adapter，宿主私有包名不得泄漏进 core；
3. 将事件映射为 bounded activation / continuity / observability；prompt、完整 transcript、工具参数与凭证不自动写入；
4. 所有来源、候选前例、案例与能力产物经过 runtime 的 data / lineage / proposal gate；
5. 验证兼容、deactivate、rollback 和多次使用回放后，才可进入 profile/bundle 并标记完成。

未来 DeepSeek 与 desktop 都应使用项目级 `.trace/` 作为可见状态边界，不能另起私有数据库。
