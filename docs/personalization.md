# 让 Agent 逐步适配使用者

Trace 不把“适配用户”做成一段隐藏的、越来越长的系统 prompt，也不从聊天里猜测人格。它把适配拆成三个可见、可版本化且可撤回的对象：

```text
协作模型（如何一起思考 / 何时执行）
  + 认知源地图（何时值得去哪里找）
  + 本轮宿主访问证据（这次实际读了什么）
  → 编译成当前 Codex 的受控协作上下文
```

这使 Trace 能让 Agent 有连续性，又不把“熟悉感”伪装为 Agent 已经读过全部历史。

## 冷启动：给所有人的起点，而不是复制某个人

`trace init` 默认写入 **Trace Cognitive Collaboration Starter**。它来自经过实际协作提炼出的通用协作方式：

- 把不完整的表达当作正在形成的思考，先连接真实张力，而不是立刻套诊断问卷；
- 讨论时先给最小而有用的关联或区分，留下继续思考的空间；
- 友好不等于附和：有冲突、限制或替代方案时说清楚；
- 用户明确说“实现、保存、发布、验证”后，切换到执行，不把执行请求变成辅导；
- 区分运行事实、来源材料、用户观察与推断；候选、采用和发布是不同状态；
- 不静默保存 raw prompt、私有来源正文、工具参数或推断出的个人特质。

这是一份 `scope: starter` 的协作契约，不含任何人的聊天历史、姓名、偏好标签或私有 Wiki 内容。它解决“第一次用就不会很生硬”，但不声称已经理解该用户。

## 个人 / 项目适配：显式配置，而非自动画像

真正属于某个使用者的内容放在项目本地 `.trace/profiles/`，默认被 `.trace/.gitignore` 排除：

```text
.trace/
├─ profiles/
│  ├─ source.profile.json          # 访问根与 host-native policy（本地）
│  ├─ collaboration-model.json     # 协作契约（本地）
│  └─ source-activation.json       # 来源入口地图（本地）
└─ instance/
   └─ activation.lock.json         # 只含 id/version/SHA-256，可提交
```

`activation.lock.json` 不保存外部根路径、来源正文或协作条款正文；它只锁定当前生效的模型和地图身份/hash。因而用户和团队能知道“此项目此刻用的是哪一版”，又不把个人上下文上传到项目仓库。

查看当前生效配置：

```powershell
trace profile
trace sources
```

`trace profile` 显示 Agent 当前依据的协作原则、执行边界、来源地图和 lock；`trace sources` 显示授权/预算以及 Codex **实际**搜索、读取的安全证据。前者是“应如何协作”，后者是“本轮实际做了什么”，不可混为一谈。

## 配置一个新认知源

外部 / 团队来源的 import profile 可以同时带入一个协作模型和来源地图。它们是文本契约和导航，不是页面正文：

```json
{
  "source_id": "my-cognitive-source",
  "root": "<仅本机的绝对路径>",
  "user_id": "local-user",
  "formal_prefix": "wiki",
  "read_enabled": true,
  "write_enabled": false,
  "host_retrieval": {
    "mode": "native_observed",
    "allowed_prefixes": ["wiki"],
    "max_reads_per_turn": 8
  },
  "collaboration_model": {
    "protocol_id": "trace.collaboration-model",
    "protocol_version": "0.1.0",
    "model_id": "example.personal-collaboration",
    "version": "1.0.0",
    "display_name": "My Collaboration Contract",
    "scope": "personal",
    "principles": ["用已确认的上下文连接当前问题，不假装读过未读材料。"],
    "open_discussion": ["问题尚未成形时，先讨论张力，不默认套问卷或立刻拆任务。"],
    "explicit_execution": ["用户明确要求执行后，给出可验证的实施和证据。"],
    "epistemic_practice": ["区分来源事实、个人观察与推断。"],
    "boundaries": ["不把未采用的候选、私有正文或推断出的特质静默写入长期状态。"]
  },
  "activation_manifest": {
    "protocol_id": "trace.source-activation",
    "protocol_version": "0.1.0",
    "manifest_id": "example.personal-source-map",
    "version": "1.0.0",
    "source_id": "my-cognitive-source",
    "display_name": "My Cognitive Source Map",
    "summary": "该地图只导航与当前问题相关的正式页。",
    "activation_profiles": ["open-discussion", "explicit-execution"],
    "entry_points": [
      {
        "id": "collaboration",
        "label": "协作方法",
        "kind": "capability",
        "purpose": "讨论人-Agent协作、上下文或沉淀边界时使用。",
        "triggers": ["协作", "上下文", "沉淀"],
        "locator": "wiki/capabilities/collaboration.md"
      }
    ]
  }
}
```

初始化时导入：

```powershell
trace init --source external --source-profile <配置文件绝对路径>
```

`locator` 必须是相对 Markdown 路径，且必须落在 `host_retrieval.allowed_prefixes` 内。Trace 拒绝绝对路径、`..` traversal、未知字段和不在授权前缀中的入口。地图中的 locator 只是“值得原生读取的导航提示”；Codex 尚未读取前，不能说它已经知道该页。

## 在已有项目中显式更新

不要手改 `.trace/profiles/` 让 lock 漂移。把下一版协作模型和来源地图（只含 `collaboration_model` 与 `source_activation`）放到一个本地 JSON 文件，再显式更新：

```powershell
trace profile update --file <配置文件绝对路径> --confirm true
trace profile
```

更新会验证协议、scope 与来源前缀，写入新模型/地图、刷新 hash-only lock，并在 `.trace/backups/activation-profile-*/` 保存旧配置。没有这条显式更新路径时，Trace 遇到 profile 与 lock 不一致会 fail-closed，而不是悄悄让 Agent 在未知配置下运行。

## 在 Codex 中实际发生什么

每次 `SessionStart` / `UserPromptSubmit`：

1. Trace 按 hook 事件的 `cwd` 找到当前项目，不会用错其他项目的人或来源；
2. 读取并校验当前协作模型、来源地图及 hash lock；
3. 仅把版本化协作条款、地图中的安全相对 locator、当前来源 lease 和预算编译给 Codex；
4. Codex 决定是否用自己的搜索/读取能力访问相关正式页；
5. Trace 在 `PreToolUse` / `PostToolUse` 只检查读取预算、记录访问 evidence；不写入 raw prompt、来源正文、工具入参与输出；
6. 值得保留的内容仍经过 `proposal → adopt → publish`，不会因为“适配”自动变成记忆或 Skill。

因此，适配不是一次性灌入更多上下文，而是随着用户显式维护的协作契约、认知源地图和真实工作证据逐步变好。用户始终能用 `trace profile` 知道 Agent 被要求如何协作，用 `trace sources` 知道 Agent 实际访问了什么，并可通过版本更新让它继续演化。
