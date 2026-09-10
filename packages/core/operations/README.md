# Trace Operations

`@trace/core-operations` 提供针对真实项目状态的 `doctor`、`backup`、`restore`。它是 CLI / 自动化 / 维护入口，不是普通用户的每日协作界面；日常用户通过 `$trace` 看摘要和下一步。

- `doctor` 核验项目链路并显示实际 SQLite driver；
- `backup` 生成 manifest 与 SHA-256；
- `restore` 先写 staging、验证后替换；显式 replace 会保留被替换数据库。

native `node:sqlite` 使用 checkpoint + `VACUUM INTO`；`sql.js` 备份已提交的 SQLite 文件镜像。两种 driver 都需要先经 doctor 验证，也都不承诺网络共享盘上的并发语义。
