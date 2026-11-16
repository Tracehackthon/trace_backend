# `@trace/instance`

项目 instance 定义每个项目自己的 `.trace/` 边界：实例锁、模板身份、项目本地 profile、SQLite 状态、候选、receipt / backup 以及可选项目认知源目录。它让不同项目、团队和来源不会共享隐式状态。

初始化以 `.trace/project.json` 是否存在来识别受 Runtime 管理的实例，不再把“非空 `.trace/`”等同于“已有 Trace 项目”。当 `.trace/` 只有旧回执、其他应用状态或用户文件时，Trace 可以在同一边界内**只创建缺失的专属路径**；proposal 会列出原有一级条目与新增路径。任何将要创建的目标路径若已存在、是符号链接，或其父路径不是目录，初始化就失败并指出冲突，不覆盖、不移动、不扫描已有文件内容。项目 descriptor 最后落盘，作为实例创建完成的标记；失败时回滚本次创建的路径。

`local` / `empty` 模式在项目内建立来源边界；`external` / `team` 仅将用户明确授权的 profile 保存为本地配置。可提交的 `project.json` 和 lock 只保存来源身份、hash 与 scope，不保存外部 root 或凭证。不同产品或旧工作流在 `.trace/` 中使用的数据库、采用回执与证据文件不会被导入或改写；Trace 只在不存在同名目标时与它们共存。

新 runtime 或 Plugin 不会重建 instance。早于 collaboration lock 的项目会被识别为 `legacy_unlocked`：用户先审阅 proposal，明确采用后才固化当前兼容模型/来源地图；SQLite、来源、能力、模板与 hooks 都不被改写。完整版本规则见[版本、协议与发布](../../../docs/versioning.md)。
