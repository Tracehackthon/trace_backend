# 2026-09-15 main 合并验证

本次是源码提交，不是生产部署或发行包验收。

## 来源与范围

- 远程基线：`0ca5b5aaeba26595de97960f32829e6b80280856`，保留其 16 项后续提交。
- 已完成工作快照：`46fe5f3afad9fc9289740cf239506e1582979a42`，涵盖本机 Web/产品命令、Codex 工作及上下文包、Agent 后端、启动入口与文档整理。
- 未完成的知乎/OAuth 专项保留在原工作区，不包含本次新增 provider、OAuth、MCP 或 Agent 检索适配。
- 在独立 Git worktree 合并；未切换原工作区、未重启原服务、未迁移数据库。依赖复用本机已安装目录，未声称完成独立联网安装验收。

## 合并处理

- MCP 同时保留原生 dialogue/decision/review 和本地 context/work receive/return 工具。
- README 保留精简入口，同时补回上游对话引擎导航与 Windows 插件安装入口。
- 旧讨论实现已从 main.js 拆到 discussion.js；上游 handoff 过渡更新迁到实际模块，不覆盖默认 Web 入口。
- Harness Overlay 保留上游姿态/折叠动效与本地 native bridge，修复合并后的联合类型引用。
- 增加两份 hash-locked vendor 文件的 LF checkout 规则。首次 Windows 检出曾转换为 CRLF；恢复原字节后，通过资产锁并在全新 checkout 输出复核哈希，未修改 approved-assets.lock.json。

## 最终结果

环境为 Windows、Node 22.23.1；以下不是所有平台的兼容声明。

| 检查 | 结果 |
| --- | --- |
| 根 TypeScript 检查与编译 | 通过 |
| MCP runtime 依赖物化 | 通过，218 文件 |
| Harness Plugin 类型检查与构建 | 合并类型修正后通过；未做原生 UI 运行验收 |
| Web/领域/SQLite/工作回流 | 资产换行修正后 **116/116** |
| 根测试及 evals | **144 通过、2 失败、3 opt-in 跳过**；下述发行安装单项显式未运行 |
| 根 README 安装入口与固定资源 | 修正后 7/7；不是首次全绿 |
| 实际模型执行 | 本次未运行，不消费模型额度；历史模型验证不作为合并后重测 |

根测试命令：

```sh
node --test --test-concurrency=1 --test-skip-pattern="distribution retains product documentation" tests/*.test.mjs tests/evals/*.test.mjs
```

两项失败位于 `tests/dialogue_engine.test.mjs` 的 adapt/review 路径，报 `sql.js` 的 `Aborted(OOM)`。在另一份**未修改的 origin/main 基线**编译后单独运行同文件，仍是 1 通过、同样 2 失败，证明当前环境下远程原版也存在该问题；本次未改动底层存储来掩盖它。

`tests/native.test.mjs` 的完整 distribution 安装单项未再次运行：此前已有磁盘不足及安装目录交换失败，且本次不是构建发行包。不能据此称完整根测试全绿或正式安装可用。

## 留待后续

优先处理 Node 22 的 dialogue/sql.js 兼容失败及发行安装路径；生产化仍按[阶段计划](../production-plan.md)推进。测试日志、临时输出和用户数据不进入本次源码提交。
