# 独立源码仓库与远程管理

`trace-runtime` 源码可以导出到任意绝对目录，再作为单独 Git 仓库管理。导出器不会带出 `node_modules/`、`dist/`、`tmp/`、SQLite、缓存、用户 Wiki 或凭证；如果目标目录已经是 Git 仓库，后续导出会保留目标 `.git`，只替换源码快照。

首次在目标目录初始化：

```powershell
git init
git status
git add .
git commit -m "chore: import Trace runtime source baseline"
```

添加真实远程地址前不要使用占位 URL：

```powershell
git remote add origin <YOUR_TRACE_RUNTIME_REMOTE>
git branch -M main
git push -u origin main
```

远程 URL 由用户选择，本仓库不会猜测、创建或推送到未知远程。
