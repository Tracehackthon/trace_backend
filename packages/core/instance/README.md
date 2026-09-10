# `@trace/instance`

项目 instance 定义每个项目自己的 `.trace/` 边界：实例锁、模板身份、项目本地 profile、SQLite 状态、候选、receipt / backup 以及可选项目认知源目录。它让不同项目、团队和来源不会共享隐式状态。

初始化是 create-only，不覆盖非空 `.trace/`。`local` / `empty` 模式在项目内建立来源边界；`external` / `team` 仅将用户明确授权的 profile 保存为本地配置。可提交的 `project.json` 和 lock 只保存来源身份、hash 与 scope，不保存外部 root 或凭证。

新 runtime 或 Plugin 不会重建 instance。早于 collaboration lock 的项目会被识别为 `legacy_unlocked`：用户先审阅 proposal，明确采用后才固化当前兼容模型/来源地图；SQLite、来源、能力、模板与 hooks 都不被改写。完整版本规则见[版本、协议与发布](../../../docs/versioning.md)。
