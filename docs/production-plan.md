# 底层生产阶段计划

- 日期：2026-09-17。状态：**源码交付基线与后续生产计划，不是已发布承诺**；不设置未经确认的发布日期。
- 范围：本仓库产品后端、Agent 执行与 Codex 接入。Web 页面与另一个前端仓库只列联调依赖，本轮不改。
- 推荐首个交付形态：**单用户本机服务，Codex 作为可替换执行适配器**。先让一份固定来源的后端可安装、可验证、可恢复，再决定云端形态；不是先拆微服务或重做 Agent。

## 当前源码基线与离生产还差什么

本仓库当前 `main` 已包含 Host Session/Sensemaking/Router/Activation/Repository Guard/Privacy/Capability 的本机闭环。它证明的是代码、协议和受控 fixture 的可回放行为，不等于某台机器已安装本版本，也不等于远程 Web/Agent 服务已部署。启动时 `TRACE_SENSEMAKING_MODE` 默认 `disabled`；只有服务端明确配置 `fixture-dev`、`profile` 或 `shadow` 才启动 worker，不能把 fixture 结果当真实供应商质量验收。

| 现场依据 | 判断 | 对应动作 |
| --- | --- | --- |
| Product Workspace 已持有 Host Session、WorkflowFinding、路由、激活、Guard、privacy 与 capability 编排 | 本机领域闭环已实现，但仍须维护 schema/backup/容量 | 保持 web.sqlite 单一 owner、独立 append-only/CAS 表和 migration/recovery 演练 |
| `apps/agent` 的 resident worker 支持 disabled/fixture-dev/profile/shadow | worker 可运行不等于真实 provider 质量或公网服务 | 用服务端 profile/ExecutorRegistry、lease/health 和受控 fixture 验收；没有真实凭据保持 disabled |
| `scripts/package.mjs` 已携带 `apps/desktop` server、`apps/agent`、Product Workspace host 模块 | 文件进入包不等于目标机安装、数据库迁移或运行健康 | 以固定 release manifest 构建，分离 package/install/upgrade/backup/restore 验收 |
| 当前主线已合并 Host Session/Sensemaking 代码，工作区仍保留用户本地 `artifacts/` 等排除目录 | 远程 Git 身份不等于本机运行身份 | 发布时精确暂存受管源码，排除数据库、缓存、私有配置和派生包 |
| 本地未发现 `.github/workflows`；未核验远端 CI/分支保护 | 不能声称新后端已有 CI 发布保障 | 先提供可独立复跑的模块检查，再确认托管端权限和真实检查范围 |
| 原生 runtime backup 不覆盖 Web/Agent，运行上限但无归档 API | 能保存不等于能长期维护 | 增加 web.sqlite/agent.sqlite 两库备份/恢复、容量与归档演练 |

上述失败来自上一轮验收记录，不是本轮重新触发的故障。并行进行的知乎适配不计作本计划已交付能力；其完成后必须独立提供联网来源、权限与最终关联的证据。

## 按闸门推进，不按文档数量推进

### S0 · 收敛入口（已完成源码切片）

**交付**：仓库 README 只解释角色与启动；产品介绍单独保留；API 随实现；历史原型退出当前事实。增加单一启动入口，校验端口/数据位置，不接管旧服务。

**出口**：首次运行不需学习 MCP 或复制多组环境变量；原服务数据位置不变；开关、端口冲突和隔离启动有测试；Host Session 页面与高级 worker/恢复入口可发现。文档整理不算生产上线。

### S1 · 可持续运行的本机底座（仍需独立演练）

| 工作项 | 负责边界 | 验收条件 |
| --- | --- | --- |
| 服务生命周期与健康 | HTTP 宿主 / 后端 | 基本 HTTP/worker health 已存在；仍需验证启动失败不留锁、端口竞争、正常停止、崩溃恢复、磁盘写失败不损坏产品数据，并区分进程、存储、CLI 与模型检查 |
| 版本与上下文 | 产品领域 + AgentService | 引入对象 generation / revision 前先保留保守 CAS；跨事项编辑不误接候选，删除重建同 ID 和 fresh 切换必须拒绝旧结果 |
| 运行维护 | AgentStore / WebStore | worker lease/attempt/错误定位已存在；两库可恢复备份、归档上限、强杀后 interrupted 与恢复副本重放仍需演练 |
| Codex 兼容 | CodexAdapter | 维护通过验证的版本范围；升级需 wire 边界负例及合成数据 live 闭环；不因报错删除隔离校验 |

**出口**：从空库和既有库副本都完成“启动 → Host ingest/生成 → 断线续读 → 取消/崩溃恢复 → 重启 → 恢复备份”。产物版本、配置摘要、实际测试对象对应，不能只附源码测试截图。

**可推迟**：目录抽包不是先决条件。若抽出产品 domain，保留兼容导出与 HTTP 契约，逐项迁移，禁止同时改库 schema、换协议和重做页面。

### S2 · 可让 Web 正式接入的业务闭环（Host workflow 已覆盖局部）

**后端交付**：真实 `revision_candidate` 的显式采用命令；绑定 run/事项/选区/版本，幂等回执、冲突拒绝、撤销记录。不允许通过旧原型假候选或客户端提交最终 host 绕过。

**接入交付**：保持一份 API 协议，补最小调用客户端/fixture；对提交丢响应、SSE 重连、stale、取消、错误、重新发起明确状态。请求 ID 不因重试改变，不隐式换模型。

**出口**：Host Session 已可通过 HTTP 完成“attach → event → Stop job → candidate/finding → routing → activation/preflight”，但 Agent 正式理解修订、运行中失效通知和完整页面验收仍按上述 CAS/receipt 规则独立验证，不能把 Host finding 直接写成 canonical understanding。

**外部来源**：知乎/全网检索作为独立 provider，显式 opt-in；来源事实与模型解释分开。OAuth 凭证不得流入模型输入、通用事件或前端配置；真实查询、返回来源、用户选择、确认关联逐步验收，不用 adapter 存在替代端到端。

### S3 · 可复现的本机发行与小范围试用（包已扩展，验收仍需目标机）

**交付单元分别命名**：本机产品/Agent 服务包；Codex Plugin/runtime 包。可以同版本发布，但不能把其中一个包的测试当另一个包的验收。

1. 从已确认的固定来源构建，采用输入白名单，排除 `.trace`、临时库、私人配置、测试输出、无关 Electron 依赖与设计原件；保留实际所需资源和许可。
2. manifest 记录来源 revision/必要变更身份、运行版本、协议与兼容范围、文件 hash、目标平台；当前 manifest 不足的字段需补齐。
3. 在干净目录/目标机器运行**实际包**：安装、首次启动、Host attach/event/job、生成/回流、升级、备份恢复、失败回退；修复既有发行安装失败，不能跳过后称发布通过。
4. 明确托管 CI 权限、触发路径与两类产物的检查，未经授权不改公共工作流、签名或正式发布配置。

**出口**：实际分发包与验收包 hash 一致，且业务闭环在该包上通过；一次小范围试用能在不丢内容的情况下升级并退回兼容版本。版本文字或上传成功不是业务验收。

### S4 · 远程 Web 方案（仍未实现，不阻塞本机底层）

| 路线 | 必须补齐 | 适合的前提 |
| --- | --- | --- |
| 本机连接器 | 配对与撤销、设备身份、短期凭据、精确来源约束、重连、浏览器数据到权威库的显式导入 | 用户使用自己的本机 Codex 与本地内容 |
| 云端后端 | 账号/租户隔离、密钥与模型费用归属、隔离 worker、任务队列、数据驻留/删除、审计与恢复 | 产品需要无本机进程、跨设备、统一服务运行 |

两者均不是把监听改成 `0.0.0.0` 或加 `CORS:*`。不要把个人 Codex 登录直接共享成多租户服务。执行平台、费用与身份方案需明确选择后再实施。

## 验证入口

本次合并到 main 的范围、通过与既有失败见[2026-09-15 合并验证](validation/2026-09-15-main-integration.md)，不是生产发布声明。

以下从仓库根目录执行；开发测试先安装锁定依赖 `corepack pnpm install --frozen-lockfile`。**启动服务不需要这一步。**

| 检查 | 命令 / 入口 | 能证明什么 |
| --- | --- | --- |
| 新启动入口 | `npm run test:local-entry` | 配置、占用端口、无写入预检、真实 HTTP 挂载 |
| 产品领域和存储 | `corepack pnpm --filter @trace/app-desktop test` | 状态、事务、版本、回流与资产锁 |
| Agent 普通回归 | `corepack pnpm --filter @trace/app-agent test` | 运行/传输/HTTP；实际 CLI 与模型默认 opt-in 跳过 |
| 实际 CLI / 模型 | [Agent 验证](../apps/agent/docs/operations.md#验证) | wire 测工具与输入边界；live 测实际模型闭环，会使用账号额度 |
| TypeScript / 全仓 | `corepack pnpm check:all` | 依配置执行类型、审计、根测试及 Python；不能替代未列入的 Web/Agent 专项 |
| 发行 | `tests/native.test.mjs` 的实际 package/install 测试 | 仅在对准要交付的包且不跳过失败时成立 |

上一轮本机 Agent 21/21、wire 2/2、live 合成内容闭环有通过证据；发行安装项仍失败，其他回归曾显式排除此项。原始日志在工作区 `artifacts/trace-agent-runtime-20260915/`，不将其作为未来改动自动有效的验收。实际完成 S1—S4 时，要更新当前交付基线与失败记录。

## 下一次实施的最小范围

先做 **S1 的服务生命周期 + 健康检查 + 两库备份恢复**，暂不扩模型与新宿主。其后做 S2 真实候选采用；有可恢复闭环后才进入 S3 分发。

每项实现指定负责模块，给出失败样例和验收证据；没有功能确认就不跨到 Web。若首批使用者明确必须使用远程站点，则先完成 S4 路线选择，但不能因此跳过身份与权威数据设计。
