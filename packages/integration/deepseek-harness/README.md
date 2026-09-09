# DeepSeek Harness integration boundary（预留）

这里是未来接入 `<DEEPSEEK_HARNESS_PROJECT>` 的位置，不是 Trace core 的实现目录。

边界约定：

1. 只实现 `@trace/plugin-contract` 的 DeepSeek Harness host adapter；
2. 插件发现、生命周期、事件订阅和宿主能力映射在这里完成；
3. 外部来源、结果、候选前例和能力产物必须通过 `@trace/data` 与 `core/runtime`；
4. 不直接写 JSONL、不复制 Change Set 状态机、不把 Harness 的内部包名当作 Trace 协议字段；
5. 接入前先生成 Change Set，验证 host compatibility、schema、replay 和行为，再进入 profile/bundle。

当前只保留位置和契约，不加载、不注册、不修改 DeepSeek Harness。桌面端未来使用同一 project-local `.trace/`，不另起一套状态库。
