# Storage

Storage 负责可审计 append-only JSONL / SQLite、最新 revision 投影、CAS、revision gap 与 duplicate 冲突检测。数据路径由 runtime / 调用方显式注入，源码不写死用户目录、认知源或环境地址；领域字段和 lineage 仍由 `core/data` / `core/protocol` 校验。

SQLite 产品模式按逻辑表隔离 change / data / continuity / observability。`TRACE_SQLITE_DRIVER=auto|node|sql.js` 允许运行时显式选择 driver：支持的 Node `>=24.2.0` 可使用稳定 `node:sqlite`，较早 Node 优先使用发行包内 `sql.js`，避免 ExperimentalWarning 与 node-gyp 依赖。

`doctor` 会展示 driver 身份与 warning；driver 不会静默切换。native driver 使用 WAL + `busy_timeout=5000`，sql.js 用受控文件锁、写前重载和原子替换维持本地多进程边界；两者都不提供网络共享盘并发承诺。
