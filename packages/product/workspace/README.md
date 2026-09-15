# Product Workspace

Trace Web 产品状态的权威 Module。它集中维护事项、原表达、理解、来源关系、对照、工作、命令版本、持久化回执，以及 Codex 工作交接记录。

## Interface

- `src/index.mjs`：浏览器安全的状态转换、选择器与产品命令。没有文件、数据库或网络访问。
- `src/workspace.mjs`：Node 本机 Adapter，导出 `createProductWorkspace()`；封装 `web.sqlite`、事务、CAS、幂等回执和同源 HTTP 处理。

`apps/desktop` 只负责页面和本机宿主组装；`apps/agent` 只通过产品快照读取能力使用这里的状态，不导入 desktop 实现。
