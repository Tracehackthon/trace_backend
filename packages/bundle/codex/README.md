# Codex bundle

当前只声明组合边界：`core/runtime` + Codex adapter + Continuity/Activation Pack。不会在 bundle 内复制用户认知源或运行时状态；产品模式使用 SQLite，开发兼容模式使用分离 JSONL，冷启动模板必须先 preview，再生成 instance lockfile。
