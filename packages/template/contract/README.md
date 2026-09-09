# Trace Template Contract

模板只提供冷启动默认值，不拥有用户实例。能力模板、认知源模板和 Trace 上下文模板分别声明，再由 Bundle Manifest 组合。安装后生成 instance 与 lockfile；用户的本地修改通过 overlay 和新 revision 保存，模板升级不会静默覆盖。
