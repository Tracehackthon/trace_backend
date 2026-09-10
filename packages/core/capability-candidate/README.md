# `@trace/core-capability-candidate`

此包把“可能值得复用的协作发现”表达为可审阅的能力候选：语义变化、适用/不适用范围、触发条件、输入输出、验收与来源 provenance。候选状态可以是 pending、adopted、rejected 或 superseded。

候选不是已发布 Skill。它必须连接到可核验的 evidence 与 Change Set，经过验证和用户采用后，才可交给 `@trace/core-capability` 的发布流程。`$trace-review` 应让用户先看候选的理由、范围和未决问题，而不是把它静默替换到用户 Skill。
