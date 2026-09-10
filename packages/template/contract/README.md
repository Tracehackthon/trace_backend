# Trace Template Contract

模板契约只提供冷启动默认值：能力模板、认知源路由与 Trace 上下文分别声明，再由 Bundle Manifest 组合。安装后生成项目 instance 与 lockfile；用户的本地修改写在 overlay / 新 revision 中，模板没有所有权。

新模板只默认进入未来的项目初始化。已有项目不会因为 runtime 或 Plugin 更新被覆盖；真正模板升级需要 preview、三方 diff、明确 adoption、backup 与回滚。当前尚未实现可声称安全的一键三方合并，因此产品层不会伪造这种能力。
