# `@trace/collaboration-context`

此包定义可版本化的 `collaboration-model`、`source-activation` 与 `activation.lock`。它将冷启动协作方式、来源导航和项目/个人/团队 scope 分开：模型不是人格画像，来源地图不是来源正文，也不等于 Agent 已读。

新项目可从通用 starter 获得可查看的默认协作方式；个人化必须通过用户明确的 profile proposal / adoption 生成项目本地版本。安装新版 runtime 或 Plugin 不会重写既有模型/地图；旧的 `legacy_unlocked` 项目先显示状态，用户采用迁移后才生成 lock。
