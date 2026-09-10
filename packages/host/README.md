# Host adapters

`packages/host/` 放置特定宿主的安装与事件桥接实现。它们只能把真实宿主事件映射到 Trace 的 application/runtime 契约，不能把宿主私有行为倒灌到 core，也不能直接写 SQLite。

当前已实现的是 Codex 的 hook 与 Skill/Plugin 安装边界；未来 DeepSeek Harness、桌面端或其他宿主必须先有真实 lifecycle、权限、事件顺序、回放 fixture 与 failure semantics，才能新增 adapter。目录预留不等于宿主已接入。
