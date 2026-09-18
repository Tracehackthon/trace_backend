# Web Agent Runtime 调用协议

- 日期：2026-09-17；读者：Trace 后端、Web 接入与宿主适配开发者。
- 状态：**本机底层 v1、provider-neutral executor 接缝、Web 回答与候选采纳闭环已实现；默认运行开关未替用户开启。** Codex `0.155.0-alpha.2.6` 的协议 fixture、bounded-analysis 兼容路径和 native Codex 第一条纵切已有验证；native 的审批/交互输入会持久化为等待态，并通过同源 HTTP 显式继续。验收边界见[生产计划](../../../docs/production-plan.md)。
- 权威实现：[Agent 后端](../README.md)。本文说明设计和调用方责任，不把静态站点部署、多租户运行或真实知乎联调写成已完成。原 manunl 入口保留导航，不维护两份协议。

## 1. 接入方向与执行器不能混为一谈

原来的 `trace-codex` MCP 让 **Codex 领取 Trace 工作上下文，再把结果送回 Trace**。本协议是反方向：**用户在 Trace 提问，由 Trace 后端启动一次受控执行，取得回答或候选**。执行器可以是本机 Codex、由 Trace 驱动工具循环的模型网关，或实现 Trace 协议的完整外部 Agent。它们共用同一产品请求、上下文、事件和结果校验，不能把某个桌面聊天窗口当成服务端。

Codex profile 选择 App Server 而非 CLI 文本命令，是为了获得线程/轮次身份、结构化结果、持续事件、工具回调和中断协议。[OpenAI App Server 官方文档](https://learn.chatgpt.com/docs/app-server)。另外两种执行器不依赖 Codex；配置与协议见 [Agent profile](profiles.md)。

```text
Web 调用方：确定事项、输入、模式/epoch、选区和已选择来源
  ↓ HTTP：同源本机接口，前端不持有模型凭证
AgentService：请求去重 → 解析服务端 profile → 核验产品版本 → 固定 ContextPackage 与 profile revision
  ↓
Executor：CodexAdapter / ModelAdapter / ExternalAgentAdapter
  → 只提供目录，正文通过本次范围内的 host tools 按需取用
  ↓
持久化 SSE 事件 → 结构/引用/版本校验 → answer / revision_candidate
  ↓
Web 展示候选；用户明确接受后由 Product Workspace 做独立 CAS 事务
```

## 2. 职责、已有能力与本轮不做

| 层 | 本轮责任 | 不能代替什么 |
| --- | --- | --- |
| 产品库 `web.sqlite` | 事项、理解、草稿版本、来源、contextMode/epoch 的权威状态 | 模型运行记录 |
| ContextAssembler | 显式目标、准确选区、当前版本、来源范围、预算、fresh 排除规则 | 全历史检索、来源联网核验 |
| AgentService | 生命周期、去重、并发、超时、旧请求失效、候选校验及受信任采纳编排 | 绕过 Product Workspace 直接保存正文 |
| ExecutorRegistry | 只允许服务端配置的 profile，固定 owner/version/revision，不静默回退 | 浏览器自带 endpoint/model/token |
| Codex / Model / External Agent adapter | 真实执行、受限工具、能力声明和执行身份 | 产品事实/权限的最终裁决 |
| 独立 `agent.sqlite` | 请求、快照身份、实际工具事件、候选、错误、重放游标 | 第二份 canonical matter |
| Web 调用方 | 提交意图、显示 pending/terminal、断线重连、只显示匹配目标 | 伪造完成、边流边改理解 |

支持四种 purpose：
- `discuss`：围绕当前输入讨论，不强制修改理解。
- `explain`：解释明确片段或当前事项，不冒充读过未提供的原文。
- `compare`：比较当前允许的片段，说明条件差异和不确定性；本身不授予网络权限，需要显式 `retrieval` 才能搜索。
- `revise`：只输出 `understandingDraft` 精确选区的替换候选，不自动应用。

本轮不接：外部 URL 抓取、任意磁盘读取/执行、多 Agent 协作、自动发送材料、来源关系自动确认、正式理解自动改写、云租户认证与 Vercel 静态页面的本机连接器。

## 3. 请求协议：前端传意图，不传执行权限

先读取现有 `GET /api/product/workspace`，取得 `revision` 与目标 `chain.sessions[matterId].contextMode/contextEpoch`。再提交：

```json
{
  "protocolVersion": 1,
  "requestId": "browser-generated-uuid",
  "expectedRevision": 12,
  "matterId": "matter-id-from-workspace",
  "contextMode": "resume",
  "contextEpoch": 0,
  "purpose": "explain",
  "profileId": "local-codex",
  "input": "这里的条件为什么重要？",
  "selection": {
    "field": "understandingDraft",
    "start": 0,
    "end": 6,
    "text": "这里是原选区"
  },
  "sourceIds": []
}
```

示例 revision、matterId 和选区必须替换为实际值；偏移为 JS UTF-16 code unit，不能切开 emoji surrogate pair。可选字段为 `profileId/selection/sourceIds/previousRunId/retrieval/threadId`；其余均必填。省略 `profileId` 使用服务端默认值，显式值必须来自 capabilities。`revise` 必须有理解草稿选区。没有开放任意 `cwd/model/provider/endpoint/token/sandbox/autoApply` 字段；`threadId` 只能恢复服务端绑定的 native profile thread，不能把 cwd 或权限带入请求。

首次返回 `202 {run, replay:false}`，包含服务器生成的 runId、绑定事项/epoch/版本/hash 和事件游标。同一 requestId、同一请求精确重放返回同一 run；变更任何字段返回 `409 REQUEST_CONFLICT`。失败重做需用户发起**新 requestId**，不是自动重复一项可能计费的工作。

如果 POST 响应丢失，先 `GET /api/agent/requests/<encoded requestId>` 或重放原请求，不另造请求身份。

## 4. 上下文与真正的 fresh

ContextPackage 默认最多 64 KiB。请求输入另限 16000 字符；选区、显式来源放在优先位置。需要的显式内容超限直接拒绝，不截成失去意义的半句话；可省略历史/停点按片段省略，并在 `omitted` 返回原因。

- `resume`：默认允许当前停点、当前已保存理解、原表达；不默认带入整份文稿、工作 intake、全部来源、所有旧讨论或个人 Skill。
- `fresh`：不带旧停点、旧理解、原表达或隐式来源。用户**这次明确选择**的选区和来源摘录仍可使用。
- 继续上一轮：可给 `previousRunId`，服务端最多带回六个成功祖先的输入/回答，并标记旧 Agent 内容不是事实；必须同一事项、模式、epoch 和产品版本。
- 进入 fresh：调用已有产品命令 `chain.action / FRESH_CONTEXT`，由产品服务增加 epoch；不能只改生成请求字段。resume 同理使用已有 `RESUME_CONTEXT`。
- bounded-analysis 的每一次 run 都新建 Codex thread；native profile 则在服务端指定的项目 cwd 中创建持久 thread，并且只有请求显式给出同 profile 的 `threadId` 时才 `thread/resume`。Trace 不把任意 HTTP cwd、token 或权限转交给 Codex。

模型初始输入只包含片段目录、身份/版本/角色和当前用户输入。已保存正文只通过：

| 工具 | 输入 | 实际范围 |
| --- | --- | --- |
| `trace_context_read` | `{id}` | 精确读取本 run 已允许的片段 |
| `trace_context_search` | `{query}` | 对本 run 片段做字面匹配，最多五条短摘录 |

工具不能打开路径、URL、其他事项或数据库历史。每次调用重新核验版本和取消状态；工具事件只记工具名、成功与实际提供的 contextIds。最终引文必须逐字属于**工具实际返回**的正文或搜索摘录，而不只是存在于可用但没读过的片段内。

### 可选的知乎／全网检索

请求可添加 `retrieval: {sources: ["zhihu", "global"]}`，也可只选择一种；省略即关闭。该许可参与上下文 hash，不改变 fresh 的旧内容排除规则。未配置 provider 时在启动模型前返回 `RETRIEVAL_UNAVAILABLE`。

仅开放允许的 `trace_zhihu_search`／`trace_global_search` 动态工具，输入 `{query,count?}`；每次最多 3 次查询，每次最多 5 条结果。默认不授予知乎用户数据或 OAuth 工具，也不启用 Codex 原生 web_search。

这是 Agent 的进程内、run-scoped provider 依赖，不是浏览器把任意 provider 指进 `POST /api/agent/runs`，也不经由公开 Web 搜索路由转发。Web 的公共搜索固定在 `/api/search/zhihu` 与 `/api/search/global`；知乎 OAuth／用户数据固定在 `/api/zhihu/*`；Agent 只接受已验证的 `retrieval.sources` 许可，不能借此获得 OAuth 或用户数据权限。

`result.sources` 由本机 host 的真实来源注册表生成，不接纳模型伪造的 source metadata；`citations[].contextId` 可用实际返回的 `external:…` ID，`quote` 必须是该条摘要中的原文。工具事件增加来源名、条数和查询 hash，不记录凭证。完整配置、来源字段、MCP 与授权协议见[知乎接入](../../../docs/zhihu-native.md)。

## 5. 执行器隔离：不能只靠 prompt

三个 profile 都经过同一 run-scoped tool bridge：工具名必须在本次目录中、总调用预算 12，每次调用重新检查产品版本、profile revision、撤权和取消状态；实际返回片段才可进入引文校验。服务端凭据只用于连接配置中的固定 endpoint，不进入请求正文、工具结果、事件或运行账本。远程响应限制 512 KiB、禁止 redirect，公网地址只允许 HTTPS。完整差异与外部协议见 [profiles](profiles.md)。

### Codex 专属隔离

#### `bounded-analysis`（默认）

使用每次新建的空临时工作目录，放置 `.git` 边界；`project_doc_max_bytes=0`。禁用本进程的 Hook、插件、继承 MCP、记忆、宿主 Skill、Shell、文件/图片/浏览器工具和子 Agent；不修改全局 Codex 文件。MCP 名称和 Skill 路径由运行时查询，只用于本次禁用，不放入 HTTP 返回或业务日志。

真实验证发现两项容易遗漏的区别：
1. `skip_host_skill_discovery` **本身不足以清除全部 Skill 目录**。需要获取当前可见 Skill 清单并通过本次 thread 配置逐一禁用；负例实测 `skills.list` 为空、`skills.read` 拒绝未开放包。
2. 使用 `tool_mode=code_mode_only` 的模型，需要保留 Codex 的隔离 Code Mode 调用容器，否则工具实际返回 `code-mode host is disabled`。该容器不是任意 Node/Shell：本次 wire 测试的 `process/fetch/require` 均不可用；可调用工具集合仅为时钟、空 Skill 接口和两个 Trace 上下文工具；显式开启检索时额外包含允许的知乎／全网工具。另设 `agents.enabled=false`，不能只关闭旧 multi_agent feature 标志。

动态工具和所用配置依赖 CLI 版本。bounded-analysis 仍只使用已登记的隔离 fixture；native Codex 则在首次连接或二进制/Schema 变化后，通过 `pnpm qualify:codex-app-server` 对同一可执行文件生成 Schema，并做不启动模型的 `initialize → account/read → thread/start(ephemeral)` wire probe，形成用户本地资格记录。未知版本只有通过这套具体证据才会放行，不能仅凭 semver 或服务端声明；未资格验证仍 fail-closed。只发送 stdout 协议，不公开 App Server 端口；本机登录由 Codex 自己管理。隔离是已实测版本/配置的能力，不声称对任意未来模型目录、管理员强制配置、同用户恶意进程都有通用安全保证。

#### `native`

由服务端 profile 固定真实 `projectCwd`，每次启动做 `realpath` 和目录核验，不伪造 `.git`，不注入 `history.persistence=none`、`project_doc_max_bytes=0` 或 `ephemeral=true`。因此 Codex 可以按项目实际规则读取 AGENTS、skills 与 Codex config，也可能发起命令、文件变更、权限或 MCP elicitation；这些请求会产生带 `state:"waiting",recoverable:true` 的安全 `runtime.approval.required` / `runtime.input.required`，并等待客户端显式响应。`POST /api/agent/runs/:runId/approval` 接受 `accept|accept_for_session|decline|cancel`，`POST /api/agent/runs/:runId/input` 接受问题答案；响应经过 same-origin、run/thread/turn/item/method、schema、CAS revision 与 idempotency 校验。安全摘要只保留动作类型、项目相对路径和网络主机，不保存原始命令、绝对路径或 secret。断线、超时、取消和重启均 fail-closed，绝不自动批准或猜测用户输入；native 线程的 `threadId`、`turnId`、`itemId` 会进入运行事件和 runtime 投影，取消时使用 `turn/interrupt`。

## 6. 状态、SSE 与失效

```text
queued → running → succeeded（仅回答或候选）
                 → failed / cancelled / stale / timed_out / interrupted
```

默认一次运行；并发超限 429，不排一个没有容量界限的队列。默认总超时 180 秒，含启动握手；过期/取消先尝试 `turn/interrupt` 并关闭本次拥有的子进程。迟到事件不能从 terminal 回到 succeeded。

SSE 类型：`run.queued/run.running/runtime.connected/runtime.started/runtime.item/runtime.approval.required/runtime.input.required/runtime.interaction.resolved/tool.completed/output.delta/run.<terminal>/run.adoption.changed`。
每条事件包含 `runId/sequence/matterId/contextEpoch/contextHash` 以及安全的 profile identity（id/kind/owner/version/revision，不含连接与凭据）。`output.delta` 是**待验证的结构化 JSON 片段**，不是可直接写入正文的文本 patch；最终 `run.succeeded.data.result` 才是解析后的结果。若页面需要逐字展示 answer，可在后续 UI 接入时做受限增量 JSON 解析；本轮不伪装成已改好页面。

游标用 SSE `id`；重连带 `Last-Event-ID` 或 `?after=N`。服务保存事件并从下一条补发；终态后自动关闭。断开 SSE 不取消模型，页面要停止执行必须调用 cancel。慢消费者超过缓冲预算被断开，但仍可按游标恢复。

**v1 保守 CAS**：任何产品 workspace revision 变化都会使正在执行的旧请求 stale，包括另一事项的编辑。运行期间每 250ms 检查，工具/输出/完成前再检查。已完成记录保留为历史，但查询时 `usableAsCurrent=false`。这是有意的保守边界，避免删除重建同 ID、模式切换或改文稿后错接旧结果；未来可引入对象 generation 和细粒度 revision，再减少无关失效。

Web 还应按当前选中的 `runId + matterId + contextEpoch` 接收流。后端不把“切换了哪个页面”当业务状态，也不会主动把结果插入任何讨论或草稿。

## 7. 结果与采纳边界

模型必须返回 `answer/replacement/citations/uncertainties`，未知字段、长度越限、不存在的 contextId、非逐字引文或非修订请求的 replacement 都会使运行失败。

服务端附加：
- `kind=answer|revision_candidate`；
- `adoption=not_applied`；
- `target.matterId/baseRevision/contextEpoch`；有选区时带准确选区和草稿版本；
- `canonicalStateChanged=false`。

修订候选通过 `POST /api/agent/runs/:runId/adoption` 处理：`accept` 与 `undo` 需要新的 `commandId` 和当前 `expectedRevision`，`dismiss` 不改产品状态。接受绑定 runId、resultHash、事项、context epoch、基础 revision、草稿版本和 UTF-16 精确选区；Product Workspace 在单一事务中应用现有局部建议逻辑，只改变 `understandingDraft`，不保存为正式 `understanding`。同一采纳命令可安全重放；撤销只在当前草稿仍保留这次 Agent 来源身份时成立，后来编辑不会被旧撤销覆盖。`autoApply` 始终为 `false`。

## 8. 本机调用示例（不改 Web）

在**同一个本机 Web origin** 下的调用方可按下列顺序接入：

```js
const workspace = await (await fetch('/api/product/workspace')).json();
const matterId = workspace.host.chain.matters[0].id; // 实际 UI 用用户明确选择的事项
const session = workspace.host.chain.sessions[matterId];
const requestId = crypto.randomUUID();
const response = await fetch('/api/agent/runs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ protocolVersion: 1, requestId,
    expectedRevision: workspace.revision, matterId,
    contextMode: session.contextMode, contextEpoch: session.contextEpoch,
    purpose: 'discuss', input: '帮我厘清这里的条件和未确定之处。' })
});
const submitted = await response.json();
if (!response.ok) throw new Error(submitted.error.message);
const runId = submitted.run.runId;
const events = new EventSource(`/api/agent/runs/${runId}/events`);
for (const status of ['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted']) {
  events.addEventListener(`run.${status}`, async () => {
    events.close();
    const run = await (await fetch(`/api/agent/runs/${runId}`)).json();
    // 核对当前 runId/事项/epoch；仅 succeeded && usableAsCurrent 可作为当前候选。
    console.log(run.status, run.result, run.usableAsCurrent);
  });
}
// 显式取消：fetch(`/api/agent/runs/${runId}/cancel`,
//   {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
```

浏览器自动发送 POST Origin；脚本须显式设置。启动配置、独立服务命令和测试命令见[运行说明](operations.md)，各路由索引也在该文档的“调用入口”节。

## 9. 部署、持久化与恢复

- 集成后端：`apps/desktop/server.mjs` 只增加 Agent middleware 与生命周期关闭；HTML/CSS/页面 JS 没有改动。默认 `TRACE_AGENT_ENABLED` 未设时不创建 Agent 数据库，不运行 Codex。
- 独立后端：`apps/agent/server.mjs` 要求显式选择产品库；面向脚本/本机受控路由。只有一份 Agent 库的 owner 可执行；端口冲突不静默绕过。
- `agent.sqlite` 有独立 application_id、schema、完整性检查和 workspace 绑定。已有产品/认知库无迁移；错误库失败关闭。请求、上下文和结果属于敏感本机业务数据，不把它们写入终端诊断日志。没有添加加密承诺。
- 每个新 run 持久化安全的 profile identity（id/kind/owner/version/revision/capabilities），不持久化 endpoint、可执行文件路径、credential env 名或值。旧 profile 漂移或撤权后运行不可继续，历史成功结果也不再标记 `usableAsCurrent`。
- 重启遇到 queued/running，记为 interrupted；不会自动重放不确定的模型执行。用户检查记录后决定是否发新请求。
- 不自动裁剪用户结果。上限 1000 runs、4096 普通事件/run、128 KiB 输出、12 次 Trace 工具调用。磁盘不可写会停止执行并拒绝新请求；恢复存储后重启，不能靠吞异常显示成功。
- 回退：正常停止自己管理的服务，取消设置 `TRACE_AGENT_ENABLED` 后启动原 Web 后端；保留独立 Agent 库。删除历史/归档工具尚未实现，维护时先停服务并备份，不操作正在使用的 SQLite/WAL 文件。

### 静态 Vercel / IndexedDB 是另一部署边界

本机底层不能让云上静态浏览器直接 `spawn codex`；也不能把浏览器 IndexedDB 冒充当前 SQLite 的权威状态。本轮提供可复用 `readWorkspace + Adapter + HTTP` 接缝，不改 `trace-portal`。

若接入那一路，需要另做其中一项：
1. 本机连接器的显式配对、origin 白名单与会话凭证，并确定 IndexedDB 内容如何以授权快照进入服务；或
2. 有用户认证和权威业务存储的云后端，再接各租户隔离的 Agent runtime/API。

不能以宽松 CORS、公开个人 Codex App Server 或复制个人登录凭据来替代这些机制。

## 10. 验证分层

1. 普通测试：命令入口、profile 选择与漂移、无 Codex 的模型/外部 Agent 工具闭环、远程取消、凭据隔离、精确重放、SSE 游标、取消/超时/迟到回复、fresh/历史范围、选区/引文、数据库恢复、传输错误。
2. 实际 CLI + 合成 provider：捕获真实发出的模型请求，核验 direct/code-mode 两类工具边界、旧内容和宿主 Skill 不泄入、拒绝越界读取。
3. 实际 CLI + 实际模型：临时产品库的随机原表达 → 真实工具读取 → 对应答案及引用；fresh → 新 thread → 旧片段读取被拒绝；整个过程产品状态保持不变。

CLI wire 的合成输出不是真实推理。真实模型的少量通过用例也不是通用内容质量评测；领域关系判断、长对话、全部来源/部署组合仍须后续测试。
