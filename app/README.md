# Trace Desktop Agent（UI Prototype）

## 本地界面更新

- 登录页改为浅绿色河流全屏场景，背景由用户提供的参考图提取并重新合成。
- 路径的四个节点带错峰呼吸光晕和扩散光圈，文字已加粗；页尾居中展示“认知涌现，点亮Trace飞鸟效应”，窄屏独占一行。减少动态效果设置同时禁用节点动画。
- 水面折射与四只飞鸟由 `src/river-scene.js` 渲染；近处飞鸟避开登录内容和底部文字。右上角内容已移除，系统开启减少动态效果时默认静止，页面隐藏时暂停绘制。
- 登录页样式为 `src/auth.css`，场景素材为 `public/scenes/river.png`。知乎 OAuth 配置与未配置时的错误提示沿用原有实现。

- 白绿色工作区：记忆列表、深度讨论、认知工厂。
- 记忆列表提供 DeepSeek、Kimi、知乎、Codex 来源标识、搜索和筛选。
- 对话中的“形成候选”进入认知工厂，支持来源回看、暂存回顾、确认采用及撤回。
- 桌宠输入可加入记忆列表，或新建深度讨论。
- 当前平台对话与已有置信度为示例数据。新候选置信度为“待评估”。
- 交互状态仅存于当前浏览器标签页的 sessionStorage；未接入平台账号、真实模型或长期记忆后端。

在此目录运行 `node server.mjs`，访问由 `TRACE_DESKTOP_PORT` 指定的本地地址（当前验证地址为 `http://127.0.0.1:4383/`）。请通过 HTTP 访问，不能直接双击 `index.html`。

## 知乎登录

登录页按附件实现了知乎 OAuth 2.0 Authorization Code Flow。已使用知乎 App ID `669` 验证授权地址生成及浏览器跳转到真实授权页；确认授权仍需由用户在知乎页面完成。必须提供知乎 OAuth 应用后台的 App ID、配套 App Key 和已登记的 redirect_uri；截图中的“绑定知乎账号”不能作为 App ID 的依据。缺少配置会返回明确错误，不会自动登录演示账号。

```powershell
$env:ZHIHU_APP_ID = 'your-app-id'
$env:ZHIHU_APP_KEY = 'your-app-key'
$env:ZHIHU_REDIRECT_URI = 'https://yourdomain.com/callback'
$env:TRACE_DESKTOP_PORT = '4383'
node server.mjs
```

服务端将十分钟有效的一次性 `state` 绑定到发起登录浏览器的 HttpOnly Cookie，校验回传的 `state` 后使用授权码换取 token，再请求知乎用户信息，并检查 HTTP 状态及响应体内的业务错误码。知乎 token 在服务端请求用户信息后不再保存，也不返回给前端。用户记录和会话当前仅保存在进程内存中，重启会清空；未实现持久化注册数据库。生产环境仍需要 HTTPS、持久化存储及完整会话生命周期管理。

按知乎现行[官方文档](https://developer.zhihu.com/console/api/v3/docs)，回调授权码的参数名为 `authorization_code`；换取令牌时请求字段仍为 `code`，请求使用 `application/x-www-form-urlencoded`。前端兼容旧的 `code` 参数，也兼容 hash 参数。官方文档未承诺回传 `state`；本项目继续要求返回且验证该参数，不会将 Cookie 当作缺少 `state` 的替代验证。若知乎实际不回传，应先与平台确认受支持的请求关联机制，再完成生产接入。

排查时需要区分未返回授权码、未返回 `state`、登录过期、浏览器不匹配及令牌交换失败。只看到裸 `/callback` 不能证明是回调地址登记错误。配置的回调地址仍需与知乎登记值完全相同，本地当前使用 `http://127.0.0.1:4383/callback`。授权链接不要收藏或重复使用。`127.0.0.1` 只指向浏览器所在电脑；对外部署应登记实际的 HTTPS 域名和固定回调路径。

知乎授权页中的 Trace 图标由知乎保存的应用资料决定，本地页面的图片和样式不会修改该页面。官方 OAuth 申请资料要求图标至少为 256x256，可通过原申请渠道联系 `openplatform@zhihu.com` 更新 App 669 图标。`public/logos/trace.png` 是从用户原始图案生成的 512x512 PNG，可用于提交；App Key 无需出现在图标变更材料中。当前未完成知乎端图标更新及真实登录全流程验证。

2026-09-15 实测：从 TRACE 重新发起登录并点击知乎“确认授权”后，知乎授权页直接显示“出错了！请稍后再试。”；页面日志显示知乎 `/oauth` 提交请求以 HTTP 200 返回业务错误，未跳回本地回调。尚未取得业务错误详情，不能据此认定为回调地址登记错误。本地已修复官方授权码字段名与表单编码不一致的问题，并通过 10 项测试；这些测试不代表知乎真实授权流程已成功。

仅测试 UI 时，可在非生产环境显式设置 `TRACE_AUTH_DEMO=true`，同时清空知乎 App ID / App Key。真实模式完全禁用演示授权。运行 `npm test` 检查错误处理和演示隔离，运行 `npm run build` 检查语法。
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
