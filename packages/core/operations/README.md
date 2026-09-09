# Trace Operations

提供面向真实用户状态的 `doctor`、`backup`、`restore`。操作只处理明确的绝对路径；`doctor` 显示实际 SQLite driver；备份带 manifest 和 SHA-256；恢复先写 staging、验证后替换，并在显式 replace 时保留被替换的数据库。native `node:sqlite` 用 checkpoint + `VACUUM INTO`；纯 JS/WASM `sql.js` 备份已提交的 SQLite 文件镜像，二者都要先通过 doctor 验证。
