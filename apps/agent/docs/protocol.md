# Web Agent 运行时与 Codex 接入协议

- 日期：2026-09-15；读者：Trace 后端、Web 接入与宿主适配开发者。
- 状态：**本机底层 v1 已实现；Web 页面未改，默认运行开关未替用户开启。** 当前 CLI 0.153.4 的真实协议及真实模型闭环已有验证；验收边界见[生产计划](../../../docs/production-plan.md)。
- 权威实现：[Agent 后端](../README.md)。本文说明设计和调用方责任，不把静态站点部署、多租户运行或外部检索写成已完成。原 manunl 入口保留导航，不维护两份协议。

## 1. 两条接入方向不能混为一谈

原来的 `trace-codex` MCP 让 **Codex 领取 Trace 工作上下文，再把结果送回 Trace**。本次补的是反方向：**用户在 Trace 提问，由 Trace 后端启动一次 Codex 执行，取得回答或候选**。不把当前桌面 App 中的聊天窗口当成服务端，也不要求另开一个人工操控的 Codex 任务。

选择 Codex App Server 而非只运行 CLI 文本命令，是为了获得线程/轮次身份、结构化结果、持续事件、工具回调和中断协议。[OpenAI App Server 官方文档](https://learn.chatgpt.com/docs/app-server)。

```text
Web 调用方：确定事项、输入、模式/epoch、选区和已选择来源
  ↓ HTTP：同源本机接口，前端不持有模型凭证
AgentService：请求去重 → 核验产品版本 → 固定 ContextPackage
  ↓
CodexAdapter：启动独立 app-server 子进程 → initialize
  → 新 ephemeral thread/start → turn/start
  → 向模型提供目录，正文通过本次范围内的动态工具按需取用
  ↓
持久化 SSE 事件 → 结构/引用/版本校验 → answer / revision_candidate
  ↓
Web 展示候选；用户采纳是另一个产品领域动作
```

## 2. 职责、已有能力与本轮不做

| 层 | 本轮责任 | 不能代替什么 |
| --- | --- | --- |
| 产品库 `web.sqlite` | 事项、理解、草稿版本、来源、contextMode/epoch 的权威状态 | 模型运行记录 |
| ContextAssembler | 显式目标、准确选区、当前版本、来源范围、预算、fresh 排除规则 | 全历史检索、来源联网核验 |
| AgentService | 生命周期、去重、并发、超时、旧请求失效、候选校验 | 用户采纳、正文保存 |
| CodexAdapter | 真实执行、受限工具、流式结果、thread/turn 身份 | 产品事实/权限的最终裁决 |
| 独立 `agent.sqlite` | 请求、快照身份、实际工具事件、候选、错误、重放游标 | 第二份 canonical matter |
| Web 调用方 | 提交意图、显示 pending/terminal、断线重连、只显示匹配目标 | 伪造完成、边流边改理解 |

支持四种 purpose：
- `discuss`：围绕当前输入讨论，不强制修改理解。
- `explain`：解释明确片段或当前事项，不冒充读过未提供的原文。
- `compare`：比较当前允许的片段，说明条件差异和不确定性；**不是网络搜索**。
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

示例 revision、matterId 和选区必须替换为实际值；偏移为 JS UTF-16 code unit，不能切开 emoji surrogate pair。可选字段为 `selection/sourceIds/previousRunId`；其余均必填。`revise` 必须有理解草稿选区。没有开放任意 `cwd/model/provider/token/sandbox/autoApply` 字段。

首次返回 `202 {run, replay:false}`，包含服务器生成的 runId、绑定事项/epoch/版本/hash 和事件游标。同一 requestId、同一请求精确重放返回同一 run；变更任何字段返回 `409 REQUEST_CONFLICT`。失败重做需用户发起**新 requestId**，不是自动重复一项可能计费的工作。

如果 POST 响应丢失，先 `GET /api/agent/requests/<encoded requestId>` 或重放原请求，不另造请求身份。

## 4. 上下文与真正的 fresh

ContextPackage 默认最多 64 KiB。请求输入另限 16000 字符；选区、显式来源放在优先位置。需要的显式内容超限直接拒绝，不截成失去意义的半句话；可省略历史/停点按片段省略，并在 `omitted` 返回原因。

- `resume`：默认允许当前停点、当前已保存理解、原表达；不默认带入整份文稿、工作 intake、全部来源、所有旧讨论或个人 Skill。
- `fresh`：不带旧停点、旧理解、原表达或隐式来源。用户**这次明确选择**的选区和来源摘录仍可使用。
- 继续上一轮：可给 `previousRunId`，服务端最多带回六个成功祖先的输入/回答，并标记旧 Agent 内容不是事实；必须同一事项、模式、epoch 和产品版本。
- 进入 fresh：调用已有产品命令 `chain.action / FRESH_CONTEXT`，由产品服务增加 epoch；不能只改生成请求字段。resume 同理使用已有 `RESUME_CONTEXT`。
- 每一次 run 都新建 Codex thread；即使 `resume` 也由 Trace 重建明确的有限历史，不隐式恢复一个已被污染的 Codex 会话。

模型初始输入只包含片段目录、身份/版本/角色和当前用户输入。正文只通过：

| 工具 | 输入 | 实际范围 |
| --- | --- | --- |
| `trace_context_read` | `{id}` | 精确读取本 run 已允许的片段 |
| `trace_context_search` | `{query}` | 对本 run 片段做字面匹配，最多五条短摘录 |

工具不能打开路径、URL、其他事项或数据库历史。每次调用重新核验版本和取消状态；工具事件只记工具名、成功与实际提供的 contextIds。最终引文必须逐字属于**工具实际返回**的正文或搜索摘录，而不只是存在于可用但没读过的片段内。

## 5. Codex 运行时隔离：不能只靠 prompt

使用每次新建的空临时工作目录，放置 `.git` 边界；`project_doc_max_bytes=0`。禁用本进程的 Hook、插件、继承 MCP、记忆、宿主 Skill、Shell、文件/图片/浏览器工具和子 Agent；不修改全局 Codex 文件。MCP 名称和 Skill 路径由运行时查询，只用于本次禁用，不放入 HTTP 返回或业务日志。

真实验证发现两项容易遗漏的区别：
1. `skip_host_skill_discovery` **本身不足以清除全部 Skill 目录**。需要获取当前可见 Skill 清单并通过本次 thread 配置逐一禁用；负例实测 `skills.list` 为空、`skills.read` 拒绝未开放包。
2. 使用 `tool_mode=code_mode_only` 的模型，需要保留 Codex 的隔离 Code Mode 调用容器，否则工具实际返回 `code-mode host is disabled`。该容器不是任意 Node/Shell：本次 wire 测试的 `process/fetch/require` 均不可用；可调用工具集合仅为时钟、空 Skill 接口和两个 Trace 工具。另设 `agents.enabled=false`，不能只关闭旧 multi_agent feature 标志。

动态工具和所用配置依赖 CLI 版本，因此当前固定验证 **0.153.4**，遇到未知版本先失败，不盲目假定配置还保持相同边界。只发送 stdout 协议，不公开 App Server 端口；本机登录由 Codex 自己管理。隔离是这一版本/配置的实测能力，不声称对任意未来模型目录、管理员强制配置、同用户恶意进程都有通用安全保证。

## 6. 状态、SSE 与失效

```text
queued → running → succeeded（仅回答或候选）
                 → failed / cancelled / stale / timed_out / interrupted
```

默认一次运行；并发超限 429，不排一个没有容量界限的队列。默认总超时 180 秒，含启动握手；过期/取消先尝试 `turn/interrupt` 并关闭本次拥有的子进程。迟到事件不能从 terminal 回到 succeeded。

SSE 类型：`run.queued/run.running/runtime.connected/runtime.started/tool.completed/output.delta/run.<terminal>`。
每条事件包含 `runId/sequence/matterId/contextEpoch/contextHash`。`output.delta` 是**待验证的结构化 JSON 片段**，不是可直接写入正文的文本 patch；最终 `run.succeeded.data.result` 才是解析后的结果。若页面需要逐字展示 answer，可在后续 UI 接入时做受限增量 JSON 解析；本轮不伪装成已改好页面。

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

**没有 `apply` Agent 接口。** 领域采纳仍由用户明确发起，并在现有产品命令层校验目标/版本。这一版也没有把候选自动伪装成原型里的 `example-suggestion`。后续接 UI 时应新增专用的“采用真实 Agent 候选”领域命令，绑定 runId 和版本，再实现撤销；在此之前结果可展示、复制和由用户手工编辑，不能宣称已经完成自动采纳。

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

1. 普通测试：命令入口、精确重放、SSE 游标、取消/超时/迟到回复、fresh/历史范围、选区/引文、数据库恢复、传输错误。
2. 实际 CLI + 合成 provider：捕获真实发出的模型请求，核验 direct/code-mode 两类工具边界、旧内容和宿主 Skill 不泄入、拒绝越界读取。
3. 实际 CLI + 实际模型：临时产品库的随机原表达 → 真实工具读取 → 对应答案及引用；fresh → 新 thread → 旧片段读取被拒绝；整个过程产品状态保持不变。

CLI wire 的合成输出不是真实推理。真实模型的少量通过用例也不是通用内容质量评测；领域关系判断、长对话、全部来源/部署组合仍须后续测试。
