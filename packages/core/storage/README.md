# storage/

存储包只负责可审计的 append-only JSONL/SQLite、最新 revision 投影、CAS、revision gap 和冲突 duplicate 检查。数据文件路径由运行时/调用方注入；不在源码中写死用户目录或仓库路径。SQLite 产品模式按逻辑表隔离 change/data/continuity，并使用事务保护写入。领域必填字段和 lineage 校验由 `core/data`/`core/protocol` 负责。

SQLite 使用单一 driver seam：`TRACE_SQLITE_DRIVER=auto|node|sql.js`。`auto` 在 Node `>=24.2.0` 用稳定 `node:sqlite`，在更早的受支持 Node 优先发行包内纯 JS/WASM `sql.js`，避免 ExperimentalWarning 与 node-gyp 依赖。sql.js 以受控文件锁、写前重载、事务提交原子替换维护本地多进程边界；driver identity/warning 可由 `doctor` 查看，不能静默切换。WAL + `busy_timeout=5000` 是 native driver 的设置；两种 driver 都不构成网络共享盘的并发承诺。

