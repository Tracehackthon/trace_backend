# `@trace/observability`

Observability 保存结构化、可关联的 runtime 事件：`correlation_id`、`causation_id`、组件、操作、成功/失败、引用、耗时和错误码。它让 `doctor` 与维护者能够按一次操作追踪状态变化，而不把 Trace 变成全文监控系统。

事件契约刻意没有通用 payload：raw prompt、来源正文、凭证、工具参数、工具输出和隐藏推理不得进入此表。用户默认看摘要和 receipt；诊断场景才按 correlation 追踪安全事件。
