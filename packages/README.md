# packages/

分包按“稳定契约 + 单一职责”拆分，而不是按四层重复复制一套代码。每个包只能向下依赖，宿主、SDK 和 native 都在包外。

| 包 | 当前职责 | 禁止依赖 |
|---|---|---|
| `core/protocol` | 字段、协议版本、状态机和兼容性校验 | Codex、文件系统、SDK |
| `core/data` | 数据封装、必填字段、来源/父子 lineage、payload/envelope hash、链路校验 | 宿主 UI、Python |
| `core/storage` | SQLite 产品存储、开发期 JSONL 迁移/只读兼容、最新投影、revision/CAS、锁、revision gap/duplicate 检查 | 业务领域判断 |
| `core/change-set` | 变化提案、影响分析门槛、采用/发布/回滚 | 宿主 UI、Python |
| `core/runtime` | 组合领域服务，提供应用调用接口 | CLI 参数解析 |
| `core/context` | 作用域受限的 Activation Pack、读取指针、预算和禁止范围 | 宿主 prompt 拼接 |
| `core/retrieval-evidence` | 宿主原生 source lease policy、search/read/unclassified evidence、相对 locator/revision/hash 与隐私哈希 | prompt、来源正文、绝对路径、工具参数/输出 |
| `core/continuity` | 主题、讨论回合、认知变化、沉淀回执、激活回执 | 完整聊天转录、宿主推理 |
| `core/migration` | JSONL → SQLite staging、计数和源文件保留 | 删除旧证据 |
| `template/contract` | 能力/来源/上下文模板 Bundle、preview、instance lockfile | 直接覆盖用户实例 |
| `core/precedent` | 宿主无关的候选前例 payload、证据和 Change Set lineage | 知乎/宿主 transport |
| `core/case-capture` | transient prompt 的 hash-only proposal、显式 capture、source snapshot 与 precedent 入口 | hook 自动归档、完整聊天转录 |
| `integration/zhihu-precedent` | 独立知乎来源 → source_snapshot / candidate_precedent adapter | core 状态机、用户 adoption |
| `core/capability` | Skill 候选、入口/内容契约、认知源 provenance、验证和发行身份 | 具体宿主审批 |

现在 TS 垂直切片已覆盖 Change Set、Data Ledger、SQLite、Continuity、Activation Pack、候选前例 adapter、显式 prompt case capture、Capability Publisher 和模板冷启动。旧 Python runtime 已从 active tree 移出并归档到 `tmp/trace-python-runtime-legacy-20260909/`；当前 runtime 不再调用它。`python/sdk` 仅保留为 TS runtime 的薄 RPC 客户端，不是第二套 runtime。`apps/desktop` 与 `integration/deepseek-harness` 是刻意未实现的宿主边界，不能据目录存在推断已接入。

