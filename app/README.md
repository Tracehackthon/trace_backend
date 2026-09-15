# Trace Desktop Agent（UI Prototype）

## 本地界面更新

- 白绿色工作区：记忆列表、深度讨论、认知工厂。
- 记忆列表提供 DeepSeek、Kimi、知乎、Codex 来源标识、搜索和筛选。
- 对话中的“形成候选”进入认知工厂，支持来源回看、暂存回顾、确认采用及撤回。
- 桌宠输入可加入记忆列表，或新建深度讨论。
- 当前平台对话与已有置信度为示例数据。新候选置信度为“待评估”。
- 交互状态仅存于当前浏览器标签页的 sessionStorage；未接入平台账号、真实模型或长期记忆后端。

在此目录运行 `node server.mjs`，访问 `http://127.0.0.1:4173/`。请通过 HTTP 访问，不能直接双击 `index.html`。
入口脚本为 `src/workspace.js`，样式为 `src/workspace.css`，示例数据为 `src/data.js`。
原始 `src/main.js` 与 `src/style.css` 保留作下载版本参考，当前入口不再加载它们。

本地资源：Lucide 0.468.0（ISC，许可见 `public/vendor/lucide-LICENSE`）；DeepSeek、Kimi、OpenAI 图形来自 LobeHub Icons；知乎标志来自 Simple Icons。平台名称及标志归各自权利人所有。

`apps/desktop/` 现在包含可运行的桌面尺寸 Web 原型，用来承接 DeepSeek Harness 中的“继续讨论”。当前版本聚焦产品闭环：接收一条观察、进入深度讨论、查看现场与待回答问题，并在会话内形成候选状态。

```powershell
pnpm --filter @trace/app-desktop dev
```

默认地址：`http://127.0.0.1:4173/`。

Harness 可以通过查询参数带入现场：

```text
/?from=deepseek-harness&observationId=...&text=...&status=...&source=...
```

当前边界：

- UI 与交互为可演示原型，讨论回复使用明确标识的 Mock Agent；
- 不直接读写 SQLite / JSONL；
- 不自动保存用户输入；
- Electron / Tauri / Wails 壳和真实模型调用仍未接入；
- 后续通过 product application / MCP / SDK 接入 Trace runtime。

已经确定的集成方向：

```text
desktop renderer / main process
          ↓ explicit product application / MCP / SDK
Trace runtime（project-local .trace/state/trace.sqlite）
          ↓
core protocol / data / storage
```

桌面端与 Codex 必须共享同一项目本地 `.trace/`，不会另建隐蔽状态库。可复用的用户动作是：状态、来源安全摘要、候选 review、proposal、adopt、receipt；renderer 不得直接读写 SQLite/JSONL，也不得将输入框 prompt 自动入库。

进入真实 Agent 阶段前，仍需以 Change Set 固化 desktop event schema、版本与 replay fixture；将文件、网络和认知源权限转成可见且可撤销的确认；通过多次使用、恢复、backup/restore、不同 profile 的端到端验证后，才可标记 desktop runtime 已实现。
