# Change Set

Change Set 是 Trace 对“一个判断或产品行为正在改变”的统一治理对象。它将 `proposed → analyzed → validated → adopted → promoted` 与 rejected / rollback 分开，并以 `lineage.input_refs`、`output_refs` 锁定到具体数据 revision。

它不是普通用户需要填写的表单。用户在 `$trace` 中看到的是“这次变化会影响什么、为什么值得采用、怎样验证、如何回退”；application service 将该讨论转换为 Change Set 与 receipt。未经用户或团队明确采用的候选不能借由 Change Set 自动变成能力、模板或规则。
