# Trace Effect Evaluation Foundation

这套目录先验证 **不依赖模型的第一层效果**：Trace 是否为正确项目选择正确正式页、生成受控读取指针、保持 pointer-only 边界，以及是否拒绝被 profile 排除的来源。它不把“模型写出更好文字”伪装成已经证明的结论。

## Case contract

每个 `cases/*.json` 是一个 synthetic golden case：

```json
{
  "case_id": "retrieval-zh-001",
  "prompt": "只用于测试执行，不写入 eval snapshot",
  "expected_pages": ["wiki/context-boundary.md"],
  "forbidden_pages": ["wiki/private-finance.md"],
  "max_pointers": 3
}
```

fixture prompt 和 fixture source body 是测试输入；`scripts/run-evals.mjs` 输出的 snapshot 不保存它们，只保存 case ID、hash、相对页面引用、指标和 artifact hash。

## Layer 1：确定性 activation evaluation

```powershell
corepack pnpm eval:pair
# 或分别运行：node scripts/run-evals.mjs --variant baseline / --variant trace
corepack pnpm test:evals
```

- `baseline`：相同 cases，但不进行 Trace retrieval；用于建立“没有 activation”这一确定性对照。
- `trace`：使用 profile 的 MyWiKi retrieval 与 `activation_excluded_paths`。
- `eval:pair`：为同一 fixture 生成 `baseline` 与 `trace`，输出 `snapshots/evals/<pair-id>/baseline/eval-manifest.json`、`trace/eval-manifest.json` 和汇总 `pair-manifest.json`；此目录默认不进入 Git。
- `test:evals`：除 golden retrieval 外，还会以真实 `trace internal codex hook-stdio --route-from-event-cwd` 回放全部 cases、验证双项目 cwd 路由和 SQLite 的 pointer-only 边界。

当前 hard gates：

- expected pages 必须命中；
- forbidden pages 必须为 0；
- 无关任务不得激活页面；
- 返回数不得超过 `max_pointers`；
- hook replay 必须保持项目路由正确、pointer-only snapshot count 为 0、durable locator 为相对安全路径。

## Layer 2：真实 Agent 语义 evaluation（尚未自动化）

Layer 2 要对同一个干净项目分别运行 `baseline` 与 `trace`，固定模型、模型版本、工具权限、cwd、上下文预算与 prompt，并记录最终 artifact、实际读页证据、scope/adoption 判断、用户纠正次数、完成 turns 与延迟。

Codex 目前的 hook contract 没有提供通用“文件已读取”事件，因此不能仅从 `pages_considered` 推断 Agent 已读来源。接入真实 Codex read/tool trace 后，才能把“指针已提供”升级为“页面已读取”；在此之前 Layer 2 必须用来源引用和最终 artifact 进行人工或宿主级判定。
