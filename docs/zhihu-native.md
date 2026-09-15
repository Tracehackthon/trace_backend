# 知乎与全网：Web、原生 Codex 和用户授权

Trace 用知乎回答和文章帮助你找到经验、分歧与适用情境；用全网搜索补充官网和外部资料。**两类来源分开查询，显示实际返回的标题、作者、摘要和原文地址，不把搜索摘要当全文，也不把他人的观点直接变成“我的理解”。**

本页对应工作区源码。接口与受控测试已实现；2026-09-15 已用实际 Access Secret 完成知乎搜索及本机 Web 真实来源展示。全网接口返回正常，但本轮未取得非知乎来源。**这不等于线上域名已部署，也不等于真实知乎 OAuth 账号联调通过**。独立 `trace-portal` 浏览器站不自动获得这些本机能力。

## 现在能做什么

| 入口 | 当前能力 | 边界 |
| --- | --- | --- |
| 本机 Web → 个人与设置 → 知乎与全网 | 搜知乎或全网，显示来源摘要、作者和原文链接；发起／检查／断开授权；用户点击后读取近期收藏 | 结果只留在当前面板；尚未接通“选取片段 → 确认对照 → 保存到当前事项” |
| 一件事／找个对照中的「知乎与全网」 | 打开同一真实接口面板 | 不用预填卡片或热榜冒充搜索结果 |
| 原生 Codex → Trace MCP | 搜索、查询连接状态、用户授权和最小范围读取 | 本机 Trace 服务持有凭证；工具不接收密钥、Token 或任意接口 URL |
| Trace Agent API → Codex | 每次请求明确开启知乎／全网检索，返回可校验引用与来源列表 | 默认关闭；最多 3 次查询，每次最多 5 条；不开放用户数据与登录工具，不自动修改理解 |

知乎是 **source provider（内容来源）**，不是模型供应商。当前 Codex adapter 负责推理和工具选择，知乎 provider 负责接口、鉴权、限流和来源规范化；未来独立远程 Agent／模型 adapter 不需要重写知乎协议。

## 配置本机服务

默认 `npm start` 不需要知乎。启用此可选集成时，需要先安装仓库依赖并构建 TypeScript：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

官方 CLI 的系统凭证库与 Trace 服务环境是两个独立入口：CLI 配置成功不会自动配置常驻 Trace 服务或云服务器。通过启动进程的环境或 Secret 管理器配置以下值。**不要把密钥放进 Git、前端变量、MCP JSON、命令历史、截图或可导出的日志。**

| 配置 | 用途 |
| --- | --- |
| `TRACE_ZHIHU_ENABLED=1` | 开启本机 provider 与 HTTP 路由 |
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 API 凭证；知乎搜索、全网搜索和授权用户 API 都需要它 |
| `ZHIHU_OAUTH_APP_ID` | OAuth 应用 ID，非密钥 |
| `ZHIHU_OAUTH_APP_KEY` | OAuth 应用密钥，仅后端用于换取用户 Token；不能替代 Access Secret |
| `ZHIHU_OAUTH_REDIRECT_URI` | 平台登记的完整回调地址，交换 Token 时原样使用 |

完成配置后，在同一进程环境运行 `npm start`。需要 Trace 调用 Codex 时用 `npm start -- --agent`；**搜索与 OAuth 本身不依赖启动模型**。旧进程不会自动读取新配置，请由维护者停止并重启对应服务，不要误停别的任务。

打开服务打印的本机地址，在「个人与设置 → 知乎与全网」检查状态并输入查询。配置错误、鉴权失败、限流和真正的空结果分开显示；没有演示内容兜底。启用集成不会修改既有产品库、自动抓取收藏或初始化项目。

## 在原生 Codex 中使用

按[插件使用说明](codex-plugin.md)连接本工作区构建的 MCP。MCP 的 `TRACE_PRODUCT_URL` 指向本机 Trace HTTP 地址（默认 `http://127.0.0.1:4173`），**不要把知乎凭证配置到 MCP 进程**。

可以直接说：

> 帮我找知乎上第一次带团队的真实经验，再查全网的相关资料。把两类来源分开，标出适用条件和分歧，附原文链接，先不要保存成我的理解。

| 工具 | 输入与行为 |
| --- | --- |
| `trace_zhihu_status` | 只查看配置与授权状态；不联网读取个人内容 |
| `trace_zhihu_search` | `query`，可选 `count`（默认 3，最多 10） |
| `trace_global_search` | `query`，可选 `count`（默认 3，最多 20）、`filter`、`search_db`（`all/realtime/static`） |
| `trace_zhihu_login` | 用户明确要求连接时生成短时授权链接；由用户亲自在浏览器确认 |
| `trace_zhihu_login_check` | 用户返回后检查一次；远程回调模式下在后端领取授权码并换取 Token，不轮询 |
| `trace_zhihu_disconnect` | 清除本机 Token 和待处理授权；不等于撤销平台授权 |
| `trace_zhihu_user_read` | 用户明确要求后读取 `contents/favorites/favorite_lists/favorite_items/followees`；默认 3、最多 20 条 |

授权用户接口不回退到开发者账号。分页只使用接口返回的 `next_offset` 字符串；收藏夹明细使用列表返回的 `favorite_id`。近期收藏和收藏夹列表不承诺全历史分页，Token 过期后需要重新授权。

## 你登记的是 HTTPS 回调

当前提供的应用 ID 为 **669**，回调为 **`https://trace.neutronm.store/callback`**。2026-09-15 实测该路径返回 Trace 首页 HTML，而不是授权接收器；需部署下面的路由，不能只依赖 SPA fallback。

本机 Token 不能保存在公共回调页。实现将“接收授权码”和“换取 Token”分开：

```text
本机 Trace 生成随机 state、一次性 verifier
  → HTTPS 回调服务只接收 verifier 的 SHA-256 challenge
  → 用户打开短时链接，回调服务绑定 HttpOnly / Secure cookie
  → 用户在知乎授权，知乎回到登记的 /callback
  → 回调服务校验 state + 浏览器 cookie，短暂持有授权码
  → 用户回到 Trace 检查连接
  → 本机后端用 verifier 一次性领取授权码，再用 App Key 换取 Token
```

这里的 verifier 是 **Trace 回调中转协议的领取证明**，不是声称知乎提供 OAuth PKCE。回调服务不需要 Access Secret、App Key，也不持有用户 Token。授权码不进入 Web JavaScript、模型响应或 Trace 数据库；浏览器回调立即跳转到不含授权码的结果地址。

### 部署回调中转

在能运行长驻 Node 进程的服务器上构建本仓库，只给该服务配置非密钥项：

```text
ZHIHU_OAUTH_APP_ID=669
ZHIHU_OAUTH_REDIRECT_URI=https://trace.neutronm.store/callback
TRACE_OAUTH_RELAY_PORT=4175
```

```sh
node apps/agent/oauth-relay-server.mjs
```

进程只监听 `127.0.0.1`。由已有 HTTPS 反向代理把 **`/callback` 和 `/api/trace-oauth/*`** 转发到这个进程，其他产品页面仍走原服务。不要把本机 `/api/zhihu/*` 或 `/api/agent/*` 暴露到公网。代理需保留查询参数和 `Set-Cookie`，禁用这些路径的访问查询、请求体和响应体日志；错误日志、APM 与 CDN 也不能记录授权码。

此版本使用**单进程内存事务**：约 5 分钟过期、最多 200 个待处理事务、每分钟最多创建 60 次、授权码最多领取一次；重启会丢失待授权事务。它不能直接作为无状态函数或多副本服务部署。现有域名若只托管静态页，需要增加受控后端路由；本次没有替用户发布、改 DNS 或重启线上服务。

### 必须保留的失败边界

- 平台必须原样返回 `state`。现有平台文档对该行为存在待确认点；**缺少 state 时停止授权，不以 Cookie 或用户点击替代校验**。远程中转会把该失败返回本机。
- 兼容 `authorization_code` 与 `code`；重复参数、两个字段冲突、跨浏览器回调和重放不接受。
- 没有已确认的刷新／撤销 Token API；当前只做本机断开和过期重授权。
- `authorized` 只表示允许访问该用户数据，**不是已核验的 Trace 账号身份**。公网多用户需另建认证、会话和租户隔离，不能复用本机单用户 Token 槽。
- 发起、回调、领取或交换失败不自动重试。未知结果应重新发起授权，不重放旧 code。

## 给 Agent API 显式检索权限

在现有[生成请求](../apps/agent/docs/protocol.md)中添加：

```json
{"retrieval":{"sources":["zhihu","global"]}}
```

该片段是请求的可选字段，不是完整请求。省略即关闭检索；`fresh` 仍不带入旧上下文，检索许可会进入上下文 hash。未配置来源时，在启动模型前返回 `RETRIEVAL_UNAVAILABLE`。

Codex 仅获得所选来源的动态工具。其原生浏览器、网络工具、shell、文件、其他 MCP 与 Skill 仍不开放；知乎相关环境变量会从子进程中删除。每次只向接口发送工具中的查询，不自动上传整段对话。

成功结果新增由宿主生成的 `sources`，包含 `id/source/title/author/url/excerpt/content_mode/fetched_at`。`citations[].contextId` 可引用实际搜索返回的 `id`，`quote` 必须出现在那条摘要中；模型自报的来源列表不能绕过校验。来源和生成结果保存在独立 `agent.sqlite`，不是产品库中的已确认材料。

## 本机 HTTP 路由

仅 loopback + 合法本机 Host；POST 必须带同源 `Origin` 和 JSON，不开放跨站 CORS。Body 不接受凭证。Web 接口按领域固定分组：**产品**是 `/api/product/*`，**公共来源搜索**是 `/api/search/*`，**知乎账号／OAuth 与用户数据**是 `/api/zhihu/*`，**生成 Agent**是 `/api/agent/*`。前端和 MCP 不再用请求 body 中的 `source` 选择搜索提供方。

| 方法 | 路径 | 输入 |
| --- | --- | --- |
| GET | `/api/search/capabilities` | 无；只返回两个公共搜索路由和本机启用状态 |
| POST | `/api/search/zhihu` | `{query,count?}`；固定为知乎社区搜索 |
| POST | `/api/search/global` | `{query,count?,filter?,search_db?}`；固定为全网搜索 |
| GET | `/api/zhihu/status` | 无 |
| POST | `/api/zhihu/oauth/start` | `{}` |
| POST | `/api/zhihu/oauth/check` | `{}` |
| POST | `/api/zhihu/oauth/disconnect` | `{}` |
| POST | `/api/zhihu/user/read` | `{kind,limit?,offset?,favorite_id?}` |
| GET／POST | `/api/agent/*` | 见 [Agent 协议](../apps/agent/docs/protocol.md)；生成请求与来源检索授权独立 |

旧 `/api/zhihu/search` 仅为已有本机调用方保留兼容，不写入新 Web、MCP 或 Agent 集成。它需要显式 `source`，新调用方应迁移到两个固定搜索路由。

## 验证与尚未完成

- 单元／HTTP／MCP 测试：`node --test tests/zhihu-native.test.mjs tests/agent-retrieval.test.mjs`。
- 真实 Codex CLI、受控模型与来源响应：设置 `TRACE_AGENT_WIRE=1`，运行 `node --test tests/agent-codex-wire.test.mjs`，同时验证 direct 与 code-mode 的默认关闭／显式开放路径；不是线上模型检索质量验收。
- 浏览器集成：`tests/zhihu-web.test.mjs`，显式设置 `TRACE_BROWSER_TESTS=1`；需已有 Playwright 和浏览器，可用 `TRACE_PLAYWRIGHT_MODULE` / `TRACE_BROWSER_CHANNEL` 指定安装。运行真实 desktop 服务和 HTTP provider，上游知乎仍为受控 fixture。
- **真实检索已验收**：provider 分别请求知乎／全网各 1 条；本机 Web 分别请求并渲染各 3 条，产品库保持 revision 0。全网结果本轮仍为知乎来源；`host=="help.obsidian.md"` 筛选返回空数组，非知乎来源覆盖仍待验证。
- **待真实授权联调**：将凭证安全注入实际部署后端、部署登记的回调、用户完成平台授权，确认 state 原样回传，再用最小一条 OAuth 授权内容完成验收。
- **待产品闭环**：搜索片段选择与事项关联、Trace Agent 回答 UI、独立线上前端接入及多用户授权存储。当前面板不冒充这些功能已经完成。
