# 维护、备份与恢复

## 健康检查

```powershell
trace doctor
```

它检查当前项目的 SQLite 完整性、协议记录、revision 连续性、数据链与 runtime event 表。输出只显示安全的组件、状态、引用、耗时和错误码；不会显示 raw prompt、完整来源正文、凭证或工具参数。

## 备份

```powershell
trace backup create
```

Trace 默认在 `.trace/backups/` 创建备份与 manifest。可指定目标：

```powershell
trace backup create --file <备份文件绝对路径>
```

备份 manifest 记录 SHA-256、表清单、文件大小与创建时间。

## 恢复

```powershell
trace backup restore --file <备份文件绝对路径> --replace
```

恢复会先写 staging 并运行验证；只有验证通过后才替换当前状态库。被替换的状态库会保留为 pre-restore 文件。

## SQLite driver

Node `>=24.2.0` 默认使用稳定 `node:sqlite`。Node 22–24.1 默认使用随发行包提供的 `sql.js` asm fallback，不会加载实验性的 `node:sqlite`，也不需要 node-gyp 或本机编译器。两种 driver 都只接受单条 SQL statement；`all()` / `get()` 只接受只读查询（含安全的 CTE `SELECT` 与完整性检查），避免 driver 差异把查询接口变成写入路径。

这是本地项目状态边界，不是多用户共享目录或网络文件系统的并发承诺。需要诊断 driver、correlation 或底层状态时使用 `trace --help --advanced`。
