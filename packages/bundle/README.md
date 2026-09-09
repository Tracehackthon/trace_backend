# packages/bundle/

Bundle 是可复现的组合，不是新的领域层。它把 core 包、adapter、工具清单和默认 patch 按顺序组装成一个 profile；同一份 bundle 可由 CLI、Codex 或 SDK 选择。任何 bundle 变化都必须通过 Change Set 记录并绑定 runtime/protocol 版本。
