# Context

上下文包生成有作用域的 Activation Pack：来源引用、读取指针、预算和禁止范围。它不直接拼接宿主 prompt，也不把完整来源正文或隐藏推理自动注入 Codex。

在当前 Codex-first 路径中，Codex 保留原生检索与读取能力；Trace 只提供协作模型、来源地图和可观测 access lease。用户看到的是“可用来源、实际读取证据与待决定候选”，而不是底层 prompt 拼接细节。
