# Patches

`patches/` 是产品组合的显式覆盖层：它可以替换 profile / bundle 的声明式配置，但不能绕过协议版本、直接改领域状态，或把公共默认值静默覆盖到用户项目。

每个会长期使用的 patch 都应有对应 Change Set、适用 scope、目标版本、验收与回滚目标。用户 project 的 profile 更新仍由 proposal → adopt → backup / receipt 执行，而不是在拉取仓库时自动应用 patch。
