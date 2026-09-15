# Context

上下文层提供两类有界协议：`trace.context-record` Activation Pack 保存来源引用、读取指针、预算和禁止范围；`trace.context-skill-package` 把已经 lock-verified、编译后的 collaboration context 包装为绑定 Codex task/project 的虚拟 `SKILL.md`。后者封闭校验嵌套字段、固定边界与内容 hash，但不负责读取 profile 或自行授予来源权限。

在当前 Codex-first 路径中，Codex 保留原生检索与读取能力；Trace 只提供协作模型、来源地图和可观测 access lease。动态 Skill 包不写入全局 Skill 目录，来源地图也不等于实际读取。用户看到的是“收到哪一版上下文、可用来源、实际读取证据与待决定候选”，而不是底层 prompt 拼接细节。
