# `@trace/instance`

提供 `project init` 的项目边界协议。它只负责创建一次性的 project-local `.trace/`：实例锁、模板清单、来源 profile、SQLite 状态目录、候选目录、回执/备份目录和项目认知源目录。

初始化是 create-only，不覆盖已有非空 `.trace/`。`local`/`empty` 模式把来源放进项目；`external`/`team` 模式只把用户提供的来源 profile 复制为本地配置。可提交的 `project.json` 不保存外部来源绝对路径，模板 lock 只保存 source id、profile hash 和 scope。
