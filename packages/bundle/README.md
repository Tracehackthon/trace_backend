# Bundle 组合层

Bundle 是一份可复现的产品组合清单：它选择 core、adapter、冷启动模板与默认 patch，但不成为新的领域层。它可以被 Codex、CLI 或 SDK 选择；用户不需要直接编辑 bundle 才能使用 Trace。

Bundle 不复制用户的认知源、聊天记录或项目 `.trace/`。任何 bundle 变化都必须有 Change Set、明确 runtime / protocol 身份和发布决策；拉取新仓库或安装新 Plugin 不会自动把新 bundle 覆盖到已有项目。

当前 Codex 组合边界见 [Codex bundle](codex/README.md)，用户项目的升级规则见[版本、协议与发布](../../docs/versioning.md)。
