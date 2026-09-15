# 历史原型：不是当前默认入口

当前运行与持久化以[本机 Web README](../README.md)为准。以下保留历史原文。

## 以下为上一轮独立原型的历史基线
# Trace Desktop Agent（UI Prototype）

## 首页接入「在意的事」（2026-09-15）

默认 `/` 保留已有首页，首页的「全部」、气泡与搜索已接入「在意的事」完整交互原型。不是打开一套数据互不相关的页面：同一文档中的首页、总览、搜索、重新进入面共用 `prototype-session.js` 的一份内存状态。

视觉权威分开：
- 首页：[Trace首页交互状态_v1 六图](../../../../manunl/具体页面与视觉实现/桌面端/首页/Trace首页交互状态_v1/)。
- 在意的事：[Trace在意的事完整交互链路_v1 七图](../../../../manunl/具体页面与视觉实现/桌面端/核心功能页面/Trace在意的事完整交互链路_v1/)。
- 不使用旧单张首页概念图，不把后续「一件事」「工作现场」「找个对照」模块混入本次接入。

### 运行与检查

在本目录运行：

```powershell
npm run dev
npm run build
npm test
```

默认地址 `http://127.0.0.1:4173/`。`build` 是源码语法检查；桌面分发产物由 `../../plugins/trace-harness-plugin` 的 `npm run build` 生成。无需新增框架、在线字体或 CDN。

### 可以直接复放的路径

1. 首页 → 右上「全部」→ 在意的事总览。
2. 悬停气泡 → 点击并生长展开 → 重新进入面 →「看看它改变了什么」。
3. 在「新的对照」里接为挑战或选择这次无关；写下自己的判断并保存 → 折回总览。
4. 点左上 Trace 回首页，中央事项显示同一最新停点；再次点气泡或搜索新句子，仍回到同一件事。
5. 在首页留下一点，创建独立 `capture-N`；不覆盖收藏示例，不自动附上不存在的对照来源。较早输入仍可搜索。

挑战只改变关联，不等于采用结论；无关不会删源；「先不带回旧理解」隔离本次上下文和草稿；空白不保存；原文、用户引文和示例均保留所属事项。

### 路由与交互

| URL | 页面 |
| --- | --- |
| `/` 或 `/?view=home` | 默认首页，接入共享事项状态 |
| `/?view=matters` | 在意的事总览 |
| `/?view=matters&matter=collection&step=reentry` | 同一件事的重新进入面 |
| `/?view=matters&matter=collection&step=deep&tab=comparison` | 新的对照；tab 另支持 care / understanding / stop |
| `/?view=matters&q=收藏` | 分类搜索，数量由实际匹配记录计算 |
| `/?view=discussion` | 原 Mock 讨论页 |
| `/?state=thinking` 等首页状态参数 | 保留上一轮首页的独立交互演示，不把展示用状态当成共享事项事实 |

- 首页右下「交互原型」仍可切换旧首页示例；默认 live 首页才使用共享事项流程。
- 显式 `view=home` / `view=matters` 优先；否则出现 `from`、`observationId`、`text`、`status`、`source` 任一参数（包括空值）时仍进入讨论。
- `Esc` 收回/关闭；`Ctrl/Cmd + K` 搜索；`Enter` 保存，`Shift + Enter` 换行。组合输入期间不提交。
- 首页与 matters 使用 History API，不整页跳转；Back/Forward 重放导航，不撤销已经保存的判断。
- **刷新、新窗口或新的页面文档重置**，没有 localStorage/sessionStorage/数据库写入。整页进入旧讨论不共享事项；若浏览器实际通过 BFCache 恢复旧文档，可继续该文档的内存状态。

### 实现与资源边界

- `src/main.js` 负责路由、单一状态 owner、样式隔离与 mount/destroy；原 `src/discussion.js` / `src/style.css` 相对本次接入基线未改。
- `src/prototype-session.js` 联结首页投影和 matters；`src/matters/matters-model.mjs` 是纯 reducer/selector；`matters-screen.mjs` / `matters.css` 是真实 DOM 场景。
- 新山水环境位于 `public/matters/environment.png`；文字、按钮、SVG 轮廓、关系线不烘焙进背景。复用 Anime.js 4.5.0、派生玻璃核心与 `src/home/scene-glass.js`。
- 大阅读面使用轻量 SVG 乳白核心和背景模糊，选中小气泡使用场景对齐折射；无逐帧重建大位移图。
- `public/matters/fonts/` 的两份固定文案字体子集及 OFL 保留；动态中文走系统 fallback，未全局安装字体。
- 小鸟沿用已获授权脚本修复 alpha 的两张资源；此次 PNG 字节没有改动。是停驻/起飞两姿态，不是自然振翅动画。PNG 同名 `.json` 保留可恢复 prompt/origin，生产原件留在 artifacts。
- 主尺寸 1672 × 941；880 × 620 仍为缩放桌面场景，正文可滚动、操作固定，不宣称移动端适配。

### 本次实测与限制

- 源码检查和 33 项单元测试通过。
- 独立浏览器回归最终 32/32，通过真实保存→首页→重开→搜索闭环；实际观察到 BFCache 恢复后监听器工作。历史引文误标与测试等待条件失败均保留，不抹为首次通过。
- 插件构建、真实打包 `file://` / preload 的隔离 Electron 6/6 检查通过；没有外网请求。未验证实际 Overlay 最终业务状态。
- 七态及 880 两尺寸截图复核：经过两批局部修正，独立 reviewer 的最终 disposition 为 **ship（本轮 UI finish 范围）**；不是像素级复刻认证。4 项定向排版/滚动检查通过。
- Electron 开发 CSP 警告仍在；完整 GPU 性能、真实 OS 输入法及精确对比度数值未验收。
- 不调用真实模型/知乎，不发 Codex 消息、不持久化。示例来源没有真实 URL 时显示示例摘录，不伪造外部链接。

完整步骤、失败/复跑、服务归属和证据见 [在意的事任务记录](../../../../docs/tasks/trace-matters-v1-prototype.md)。上一轮首页的独立交付见 [首页任务记录](../../../../docs/tasks/trace-home-v1-assets.md)。

## 原讨论界面与后续集成

原讨论界面聚焦产品闭环：接收一条观察、进入深度讨论、查看现场与待回答问题，并在会话内形成候选状态。

```powershell
pnpm --filter @trace/app-desktop dev
```

默认地址：`http://127.0.0.1:4173/`。

同一讨论界面也会在 `plugins/trace-harness-plugin` 构建时复制到原生桌面插件中。原生入口从本地文件加载，不依赖 `4173` 服务；候选状态通过隔离的 preload bridge 返回悬浮插件。这里仍是演示交互，不代表已经接入 Trace runtime。

Harness 可以通过查询参数带入现场：

```text
/?from=deepseek-harness&observationId=...&text=...&status=...&source=...
```

当前边界：

- UI 与交互为可演示原型，讨论回复使用明确标识的 Mock Agent；
- 不直接读写 SQLite / JSONL；
- 不自动保存用户输入；
- Electron 本地页面与候选 preload 已存在；Tauri / Wails 与真实模型调用未接入；
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

