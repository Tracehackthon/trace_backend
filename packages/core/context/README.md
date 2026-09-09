# context/

上下文领域包：负责作用域受限的 Activation Pack、来源引用、读取指针、预算和禁止范围。它不直接拼宿主 prompt；Codex/其他宿主只消费 pack，不把完整来源全文或隐藏推理自动注入。
