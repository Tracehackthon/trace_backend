# `@trace/precedent`

候选前例的宿主无关协议包。它只定义 candidate precedent 的 payload、证据引用和 Change Set lineage，不知道知乎、Codex、HTTP 或桌面端。

具体来源 adapter 放在 `packages/integration/*`，不能把外部来源字段塞进 core。当前独立的知乎 adapter 是 `@trace/integration-zhihu-precedent`。
