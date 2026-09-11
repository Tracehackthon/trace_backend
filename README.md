# Trace

> **让 Agent 不只完成一次任务，而是在多次协作中逐步理解人、项目与团队，并把这种理解变成用户看得见、能决定、可验证的长期能力。**

Trace 是面向 AI Agent 协作的**认知演化产品**。它工作在 Codex 等原生 Agent 之上：不重造聊天、不抢走检索和推理，也不把所有对话塞进“记忆库”。

它解决的是一个更实际的问题：当你和 Agent 连续做项目、反复讨论、读取外部来源、发现协作问题时，什么值得被带到下一次？谁确认它？它适用于哪里？升级之后会不会覆盖原来的工作方式？

Trace 把这些原本散落在聊天、Wiki、prompt、Skill、项目文件和个人脑中的变化，变成一条**可见、可选择、可回放的协作链路**。

## 你实际会遇到的问题

| 没有 Trace 时 | 有 Trace 后 |
|---|---|
| 新会话重新解释自己、项目和未完成的问题 | Agent 能在项目边界内看见已确认的协作方式、来源入口与待解决事项 |
| 不知道 Agent 用过哪些资料、到底沉淀了什么 | 能看见已授权来源、实际访问 evidence、候选和未决事项 |
| 一次好讨论直接被塞进 prompt、Rule 或 Skill | 先成为候选；讨论、验证、采用后才影响未来工作 |
| 每个人的知识库和工作方式不同，冷启动只能泛泛而谈 | 使用通用 starter 起步，再由用户明确形成个人 / 项目 / 团队 profile |
| 更新 runtime、模板或 Plugin 时担心旧项目被覆盖 | runtime、Plugin、profile、模板和协议分别版本化；迁移必须显式采用 |
| Agent 能力越积越多，却不知道从哪来、是否仍有效 | 候选能力保留来源、范围、验收与验证证据；发布和回滚都有 receipt |

## Trace 给用户的产品体验

### 1. 从 Codex 对话开始，而不是从配置开始

Trace 的日常入口是 Codex Plugin：

```text
$trace 帮我开始这个项目，并说明什么会被保存。
$trace 我现在的协作方式和来源边界是什么？
$trace-adapt 我希望你更适配我的工作方式。
$trace-review 你沉淀了什么，还有什么等我决定？
$trace 我升级后需要做什么？
```

你不需要日常填写 CLI flag、SQLite 路径、协议版本或 JSON。Trace 先理解你的意图，给出可见 proposal；只有你说“采用 / 确认”后，才执行初始化、profile 更新、旧项目迁移或 Codex hook 变更。

### 2. 让 Agent 真正使用原生能力，而不是再造一个检索器

Codex 仍然负责：搜索、读取、推理、调用工具、写代码和交付。

Trace 负责：

- 提供用户已授权的认知来源入口、范围、预算与隐私边界；
- 记录“已提供 / 已搜索 / 已读取 / 未分类访问”的安全 evidence；
- 让用户知道一次协作使用了什么，而不把“给过来源”伪装成“Agent 已理解”；
- 防止来源正文、绝对路径、prompt、凭证和工具参数被通用写入状态库。

因此，Trace 不是另一个替代 Codex 的 Agent；它是让 Codex 协作变得**可治理**的产品层。

### 3. 让沉淀变得可见，而不是让 Agent 静默记住一切

一次讨论、一次失败、一个知乎前例或一个 prompt，不会自动成为长期知识。它们先进入可见的候选区：

```text
真实协作
  → 线索 / 失败 / 外部前例 / 新判断
  → Trace candidate
  → 用户讨论、采用或拒绝
  → source snapshot / precedent / collaboration profile
  → 能力候选、发布或激活
  → 后续结果支持、限制或撤回
```

用户会看见：候选是什么、为什么出现、建议适用范围、哪些证据不足、下一步可以怎样继续。

用户默认不需要看见：数据库表、lineage、内部 hash、工具参数、凭证、隐藏推理或完整来源正文。

### 4. 逐步适配每个使用者，而不伪造“我早就懂你”

Trace 的冷启动 starter 只提供通用、可解释的协作原则，例如：先接住未完成思考、讨论与沉淀分开、明确执行就执行、证据优先、不要盲从。

真正的适配发生在用户使用过程中：

```text
通用 starter
  → 用户明确表达协作偏好、项目边界与来源授权
  → versioned collaboration model + source activation map
  → 项目本地 lock
  → 在以后相关工作中被带回
  → 由用户和结果继续修正
```

个人、项目与团队 profile 分开保存；公共模板不会携带任何人的历史认知源、绝对路径或私密上下文。

## Trace 的产品组成

| 产品面 | 用户获得什么 | 当前状态 |
|---|---|---|
| **Trace for Codex** | `$trace`、`$trace-adapt`、`$trace-review` 的自然语言入口 | 已实现 |
| **Local MCP** | 状态、proposal、adopt、apply、receipt 的标准控制面 | 已实现 |
| **项目 Trace Space** | 每个项目独立的 `.trace/`、profile lock、SQLite、备份与恢复 | 已实现 |
| **认知来源接续** | 受控 source lease、来源路由与真实访问 evidence | 已实现，Codex 保留原生检索 |
| **候选与案例沉淀** | transient → capture proposal → source snapshot → precedent | 已实现，完整案例必须显式选择 |
| **能力治理** | 候选能力、验证、发布预览、明确 approval 与 rollback receipt | 已实现为底层发布能力 |
| **知乎外部来源** | HTTP transport 与候选前例 adapter 的分层边界 | 已实现 transport / adapter；产品化调用继续迭代 |
| **桌面端 / DeepSeek Harness** | 未来宿主接入位置 | 刻意未实现，不伪造完成状态 |

## 一次真实使用会怎样发生

```text
1. 用户进入一个项目，对 Codex 说：
   “$trace 帮我开始这个项目，并说明你会如何使用我的认知来源。”

2. Trace 展示 proposal：
   项目边界、starter、来源模式、哪些数据会创建、哪些内容不会保存。

3. 用户采用后：
   项目获得独立 .trace/、协作 profile、来源地图、SQLite 与 receipt。

4. 用户继续正常与 Codex 工作：
   Codex 自己搜索、读项目和已授权来源；Trace 只记录安全 evidence。

5. 讨论中出现值得留下的发现：
   Agent 提出 candidate，而不是静默把它写进 prompt 或 Skill。

6. 用户在 $trace-review 中决定：
   暂不处理、保留摘要、保存脱敏片段、保存私有案例、采用为 profile 或进入能力验证。

7. 下次相关工作：
   已确认且仍适用的协作方式、来源路线和能力才会被带回；后续结果可以支持、限制或撤回它们。
```

## 新用户、旧用户和更新后的项目

Trace 把“安装新版”与“迁移用户项目”严格分开：

| 发生的事 | 不会自动发生的事 |
|---|---|
| 安装 / 更新 runtime | 不会覆盖已有 `.trace/`、SQLite、来源、模板、能力或 hooks |
| 安装 / 更新 Codex Plugin | 不会迁移 profile、不启用 hooks、不初始化项目 |
| 使用新 starter 初始化项目 | 不会把 starter 反写到旧项目 |
| 检查版本差异 | 不会执行升级或重建状态 |

已有 lock 的项目继续使用自己的 profile。更早的项目会显示为 `legacy_unlocked`，先让用户审阅兼容配置；只有明确 adopt 后，才把当前配置固化为 lock。未知协议、缺少 upcaster 或 source profile / lock hash 漂移会 fail-closed，不会静默“修好”。`external` / `team` profile 被有意修改时，先审阅新 profile，再显式执行 `trace source update --file <绝对路径> --confirm true` 写入新的 lock。`local` 与 `empty` 属于项目拥有的来源边界：前者固定在项目 `.trace/source`，后者始终不发出来源 lease；它们不能借由 profile update 变成外部来源，切换来源必须走未来单独的 source-selection migration。

## 3 分钟开始

### 连接 Codex（只需一次）

Trace runtime 安装后，直接双击安装目录里的：

```text
Connect-Trace-to-Codex.cmd
```

它会先显示将要连接的 Plugin，询问你是否确认；成功后回到 Codex 即可使用 `$trace`。该动作只安装 `trace-codex` Plugin 与本地 MCP。它不会创建项目、读取认知源、修改旧项目、迁移 profile 或启用 hooks。需要替换已有 Plugin 时，再由维护者在 [Native 发行与安装边界](native/README.md) 使用显式维护命令。

### 在项目中开始协作

```text
$trace 帮我开始这个项目，并告诉我什么可见、什么不会保存。
```

详细安装、权限、proposal / adoption 与更新行为见 [Trace Codex Plugin](docs/codex-plugin.md)。

## 当 Plugin 暂不可用

CLI 是恢复、自动化和运维入口：

```powershell
trace status
trace upgrade
trace doctor
trace backup create
```

它与 MCP 使用同一套项目实例、profile lock、runtime 和存储语义；但日常协作优先 `$trace`，不要把用户推回一长串 CLI 参数。

## 文档

- [从 Codex 开始使用 Trace](docs/codex-plugin.md)
- [第一次使用与项目初始化](docs/getting-started.md)
- [日常协作、候选与沉淀](docs/daily-workflow.md)
- [让 Agent 逐步适配使用者](docs/personalization.md)
- [版本、协议与旧用户迁移](docs/versioning.md)
- [产品架构与边界](docs/architecture.md)
- [Codex 原生检索与来源 evidence](docs/host-native-retrieval.md)
- [维护、备份与恢复](docs/operations.md)
- [完整文档导航](docs/README.md)

## 对维护者

协议、SDK、adapter、CLI 和发布工具是产品的支撑层，不是默认用户入口。查看 `trace --help --advanced`、`packages/README.md`、`apps/README.md` 与 `native/README.md` 前，请先明确你在做的是产品使用、宿主接入、运维恢复还是协议开发。
