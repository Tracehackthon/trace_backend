---
name: Trace Web — Fixed Scene Family
description: 同一个山水场景中的接续；首页与在意的事保留各自参考图权威。
colors:
  home-ink: "#08241f"
  home-muted: "#506974"
  home-green: "#075540"
  matters-ink: "#08251f"
  matters-action-top: "#126851"
  matters-action-bottom: "#004b38"
  matters-submit: "#065e45"
  matters-reading: "#405f70"
  matters-milk: "#f5faf3"
  matters-rim: "#ffffff"
  matters-warm-node: "#dfb654"
typography:
  home-display:
    fontFamily: '"Trace Web Serif", "Songti SC", SimSun, serif'
    fontSize: "66px"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "0.6px"
  matters-display:
    fontFamily: 'var(--matters-serif, "Noto Serif SC", "Songti SC", "SimSun", serif)'
    fontSize: "86px"
    fontWeight: 600
    lineHeight: 1.22
    letterSpacing: "4px"
  matters-bubble-title:
    fontFamily: 'var(--matters-serif, "Noto Serif SC", "Songti SC", "SimSun", serif)'
    fontSize: "calc(25px * var(--matters-copy-boost, 1))"
    fontWeight: 600
    lineHeight: 1.34
    letterSpacing: "0.15px"
  matters-comparison-title:
    fontFamily: 'var(--matters-serif, "Noto Serif SC", "Songti SC", "SimSun", serif)'
    fontSize: "37px"
    fontWeight: 600
    lineHeight: 1.32
    letterSpacing: "0.3px"
  matters-input:
    fontFamily: 'var(--matters-sans, "Microsoft YaHei", "PingFang SC", sans-serif)'
    fontSize: "calc(22px * var(--matters-copy-boost, 1))"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  matters-action: "28px"
  matters-search: "42px"
  matters-composer: "44px"
  matters-search-panel: "35px"
  matters-badge: "10px"
  circle: "50%"
components:
  matters-button-primary:
    textColor: "#f4fff9"
    rounded: "{rounded.matters-action}"
    padding: "10px 25px"
  matters-button-secondary:
    textColor: "#527c67"
    backgroundColor: "#ecf8df9e"
    rounded: "{rounded.matters-action}"
    padding: "10px 25px"
  matters-search:
    textColor: "#365c51"
    rounded: "{rounded.matters-search}"
    padding: "0 24px"
    height: "66px"
    width: "626px"
  matters-composer:
    rounded: "{rounded.matters-composer}"
    padding: "12px 18px"
    height: "84px"
  matters-submit:
    textColor: "{colors.matters-rim}"
    backgroundColor: "{colors.matters-submit}"
    rounded: "{rounded.circle}"
    size: "52px"
  matters-search-panel:
    rounded: "{rounded.matters-search-panel}"
    padding: "27px 38px 33px"
  matters-change-badge:
    rounded: "{rounded.matters-badge}"
    padding: "4px 7px"
---

# Design System: Trace Desktop

## Overview

### 当前 Web 接入范围（2026-09-15）

本次是沿用原世界的接入与扩展，不更换视觉方向。默认入口已改为 [web-main.js](src/web-main.js)，不再是刷新即重置的独立原型。首页与在意的事保留原构图；一件事、对照、工作现场分别复用 [product/](src/product/) 中的既有派生模块。搜索 / 全部 / 工作列表是对真实对象的目录，沿用事项环境与本地宋黑字体，不是另一套概念图。下面七态细节仍记录独立 matters 组件能力；默认产品总览会进入统一 chain，搜索则进入实际内容目录，不再把旧七态演示当作持久化产品路由。

[资源锁](approved-assets.lock.json) 记录十二项正在使用的固定背景、鸟、完整字体和 vendor 字节；[资产入口](src/product/assets.mjs) 映射六背景角色。首页 / 事项 / 一件事 / 工作现场 / 对照各用自己的环境，不以统一为由改成同一背景。未来单独「我的理解」「结果回来」原型存在，不等于已替换当前内部页面。


**Creative North Star: "同一个场景中的接续"**

Mode: **Operate**。本文供维护桌面 Web 的工程师与 Agent 使用，记录当前实现，而非提出新的视觉方向。山水、雾、水面、岩石与光构成连续环境；内容由真正可操作的文字、图标、输入与异形玻璃承载。层级来自对象位置、停点、聚焦和变化，不来自一套默认仪表盘组件。

首页和“在意的事”共享场景语言，但保留各自构图权威。首页的六态仍属于同一首页场景；新增事项表面是独立的七图链路，不用首页参考覆盖它，也不反向重定义首页。

**Key Characteristics:**
- 清洁环境图与真实 DOM/SVG 内容分层，保留景观纹理。
- 宋体承载标题与思考层级，黑体承载正文、操作与输入。
- 不对称轮廓、细白高光、少量暖色节点；大面积阅读表面保持乳白中心。
- 小鸟与连线指向当前对象或停点，不是常驻摆动装饰。

### 视觉权威与实现依据

| 表面 | 权威与范围 | 实现入口 |
| --- | --- | --- |
| 首页 | [Trace首页交互状态_v1](../../../manunl/具体页面与视觉实现/桌面端/首页/Trace首页交互状态_v1/) 六张 PNG，静默总览、唤醒过程、思考接续、思考生长、工作接续、结果回流；基准为 1672 × 941。 | [首页样式](src/home.css)、[首页场景](src/home.js) |
| 在意的事 | [Trace在意的事完整交互链路_v1](../../../manunl/具体页面与视觉实现/桌面端/核心功能页面/Trace在意的事完整交互链路_v1/) 七张 PNG；状态对应见 Components。 | [事项样式](src/matters/matters.css)、[事项场景](src/matters/matters-screen.mjs) |

本文 token 提取自当前样式与 SVG 实现，前置 YAML 是已列 token 的规范记录；未列出的局部差异仍以对应源码为准。它不是全局 CSS 主题，也不能把事项 token 应用到旧讨论界面。材质、动画和组件静态片段见 [.impeccable/design.json](.impeccable/design.json)。

## Colors

### Primary
- **首页墨绿**：`home-ink`、`home-green` 保留首页文字与行动层级。
- **事项墨绿**：`matters-ink` 承载内容；主操作由 `matters-action-top` 到 `matters-action-bottom` 的轻渐变呈现；圆形提交使用 `matters-submit`。不能把渐变误记为一个平涂背景色。

### Secondary
- **暖光节点**：`matters-warm-node` 是连接节点的暖色边缘，配合轻晕与变化徽记。暖色不铺成整页警告色或大面积蒙层。

### Neutral
- **辅助与阅读文字**：`home-muted` 属于首页辅助文字；`matters-reading` 对应重新进入面的段落。事项其余正文有局部蓝绿层级，不强制合并为一个色值。
- **乳白中心与细白边缘**：`matters-milk` 用于大表面的径向中心；`matters-rim` 经不同透明度进入边缘与高光。环境图片本身的色彩不转换成一份虚构的平色主题。

**The 分表面配色 Rule.** 保留首页与事项各自的颜色作用域，不为“统一”而覆盖其中一方；真实实现与旧文档数值冲突时，核验当前样式再更新记录。

## Typography

- **首页**：默认 Web 使用同一来源的完整 `TraceSerif.woff2` 与 `TraceSans.ttf`，旧固定子集保留给 legacy；主标题采用 `home-display`，正文与操作保持黑体。首页缩窄样式仍由自己的 CSS 管理。
- **事项**：本地 [事项字体目录](public/matters/fonts/) 中的 `TraceMattersSerif-fixed.woff2`、`TraceMattersSans-fixed.woff2` 是独立固定文案子集，不替换首页字体。挂载时以实例专属名称注册，通过 `--matters-serif` / `--matters-sans` 引用，并使用 `font-display: swap`。
- **动态文字**：Web 使用完整 Source Han Serif CN（250–900）及 Noto Sans SC（100–900）本地字体；各模块 FontFace 保留独立名称但字节来自同一锁定原字体。系统 / emoji fallback 仍需保留，完整字体不等于罕见字和 emoji 全覆盖。
- **事项层级**：总览/搜索用 `matters-display`；重新进入页标题缩小到（46px）；气泡标题以 `matters-bubble-title` 为基础，中央主气泡与部分侧节点有局部字号；三段重新进入面以中央停点标题（43px）高于两侧（33px / 32px）；深度对照标题使用 `matters-comparison-title`。

**The 可写文字 Rule.** 标题、停点、示例摘录、输入和按钮必须是文字内容，不栅格化到参考图；用户新输入允许换行或在指定区域滚动，不借固定文案子集假设动态内容长度。

## Layout

### 首页：保留六图场景
- 左上品牌、右上搜索 / 全部 / 工作现场；不引入旧讨论侧栏。
- 原首页主要输入位置保留（x486 / y336 / w762 / h121，场景坐标）。节点、连接线与内容共享基准坐标，状态切换联动。
- 原型采用 hover/focus 轻唤醒、click 展开、Escape / 收起返回等实现约定；这些触发细节不是六图明示的产品事实。

### 在意的事：单一背景平面与缩放 UI
- 环境来自 [environment.png](public/matters/environment.png)，以 `center / cover` 填满宿主。只有 UI 场景按（1672 × 941）居中等比缩放：`scale = min(width / 1672, height / 941)`。不在缩放层再放第二张裁切不同的全屏背景。
- 总览标题居中，搜索位于其下（x523 / y230 / w626 / h66）；中央事项及五个侧事项是六个场景位置，不是均匀卡片网格。新捕获对象进入中央位置，此前对象仍能从共享搜索中找回。
- 重新进入面采用三段融合表面（x174 / y221 / w1390 / h551），以中间的真实停点为主；深度继续采用独立大表面（x329 / y279 / w1117 / h577），上方四个节点保持同一阅读顺序。
- 搜索态上移标题、上移并加宽搜索框（x448 / y169 / w777 / h69）；事项、曾说过的话、来源与现场放在同一可滚动结果面，不把参考图中的数量写成常量。
- 缩放小于（0.68）进入 compact 模式。正文补偿为 `clamp(1, 0.70 / scale, 1.36)`，并有局部位置、字号和高度修正。（880 × 620）仍是桌面场景缩放，不是移动端重排，也不代表已支持手机。
- 大段正文有独立滚动区域；compact 重新进入面的两侧段落和对照两栏使用更短的可滚动视窗。关系按钮与 composer 固定在内容区之外，不能随正文一起挤出操作面。搜索结果及原现场弹窗也各自滚动。

**The 正文与操作分区 Rule.** 先给动态正文留出真实滚动边界，再固定关系决定和输入；不通过截掉内容、隐藏操作或换成整页截图维持构图。

## Elevation & Depth

首页保留清洁山水玻璃景观的色调与构图，不用额外厚色蒙层遮盖纹理。已有异形玻璃核心与本地 Anime.js 继续复用；Codrops 仅借鉴交互结构，不复制受限制资源。

事项玻璃由 SVG 轮廓、裁切后的 backdrop blur、渐变薄膜、内缘高光和轻投影组成。小气泡的基础模糊为（7px）；仅中央主气泡接入场景对齐的背景折射采样。大面积重新进入 / 深度继续 / 生长表面使用（22px）模糊与乳白径向中心，不把全幅位移折射盖在文字下面。搜索和输入是更规整的浅玻璃表面，阴影只提供轻分离。

**The 大面乳白 Rule.** 大阅读面优先保持乳白中心，小主气泡才使用受限折射；玻璃效果失败时仍保留静态轮廓与可操作 DOM，不让装饰成为状态流的前提。

## Shapes

- 首页气泡保留各自不对称曲线与独立内容，不改成统一圆角矩形。
- 事项有基础气泡、三段融合面与深度继续面三种 SVG 轮廓。异形不能用单个 `border-radius` token 代替；YAML 的圆角仅描述真实按钮、输入、搜索面和徽记。
- 品牌直接复用 [首页图标源](src/home-icons.js) 中的线形 mark；事项搜索 / 全部痕迹复用同源图标。事项内容图标以轻底色圆形容器承载，仍为本地 inline SVG，不使用图标字体或图片里的假按钮。
- 栖息与起飞仅复用 [bird-perched.png](public/home/bird-perched.png)、[bird-takeoff.png](public/home/bird-takeoff.png) 两个已准备姿态；不生成第三种身份，不将鸟烘焙进背景。

## Components

### 同文档入口与共享对象

[路由入口](src/web-main.js) 切换各模块并隔离样式；首页“全部”进入真实痕迹目录，搜索进入实际检索，品牌返回首页。对象与版本由 [宿主 bridge](src/product/bridge.mjs) 统一持有并事务保存；首页只读取同一份数据投影，不建立第二份事项事实。

导航与刷新保留已写入本机的对象、草稿、来源和版本；URL 只标识对象和位置，不承载输入正文。返回保存 query / filter / anchor / scroll 信息，失效对象有明确空态，不替换成示例。模型与外部 Agent 仍未连接，手工材料和结果按用户输入标识；本地保存、关联、采用理解和外部送达不可混称。旧 observation query 与 Mock 讨论留在 legacy。

### 七张图对应一个状态流

| 参考状态 | 已实现的表达 |
| --- | --- |
| 01 静默总览 | 六个事项位置、当前停点、细连线、小鸟与已有对照提示。 |
| 02 悬停识别 | hover/focus 聚焦当前气泡、减弱其他节点并呈现来由提示；不写入变化。 |
| 03 点击进入 / 气泡生长 | 从所选气泡展开的短暂动画，可跳过；这是本地进入过渡，不是假网络加载。reduced motion 或动画服务不可用时直达重新进入面。 |
| 04 重新进入 | 当时为什么在意 / 上次真正停在 / 后来发生了什么三段融合表面；原现场、继续及先不带回旧理解都是独立操作。 |
| 05 新的对照 / 深度继续 | 当时在意 / 原来的理解 / 新的对照 / 当前停点四个节点；正文、关系按钮与输入分区。 |
| 06 搜索精确找回 | 实际匹配的三类结果与计数；事项、引文与来源回到同一个对象，而非复制展示数据。 |
| 07 变化折回总览 | 明确关系决定或保存表达可产生变化徽记；保存新判断才更新当前停点、生成对应分支并折回总览。仅打开或返回不制造变化。 |

### 操作、输入与来源

- **主 / 次操作**：圆润短胶囊。主操作为深绿渐变，次操作为浅绿薄面，普通文本操作保持透明；hover 加深或浅亮。已选关系同时使用 `aria-pressed` 与轮廓，不仅更换文案。
- **关系与判断分开**：“接为挑战”确认材料关系，不自动采用它的结论；“这次无关”不删除来源。没有对照源时关系按钮禁用。视觉上保留关系状态说明，不把主按钮颜色当作“已形成判断”。
- **先不带回旧理解**：改变本次上下文选择及输入草稿呈现，而非用覆盖层遮住原文；不删除历史示例原文。
- **composer**：独立 textarea、原现场入口和圆形提交。空白内容不能提交；Enter 保存、Shift + Enter 换行，输入法组合期间不提交。保存“当前判断”与保存“我的理解”是两个明确动作。
- **搜索与原现场**：结果分类和数量由当前数据产生；来源弹窗呈现归属、短摘录和示例说明，关闭后恢复触发位置的焦点。
- **键盘与动态**：按钮具有 `focus-visible` 轮廓；Escape 处理退出/返回，reduced motion 去掉过渡。当前搜索和草稿输入在 CSS 中覆盖了自身 outline，不能仅凭通用焦点规则宣称所有输入已有可见焦点环，更不能据此声明完整无障碍达标。

状态与行为事实以 [事项模型](src/matters/matters-model.mjs)、场景及路由源码为准。视觉/交互验收记录单独保留于 [事项任务记录](../../../docs/tasks/trace-matters-v1-prototype.md)，不在设计系统复制临时测试分数。本文不作像素一致、对比度达标、性能达标或完整产品验收通过的声明。

## Do's and Don'ts

### Do:
- **Do** 分别使用首页六图与事项七图的视觉权威，保留共享品牌、鸟与本地资源来源。
- **Do** 用真实 DOM/SVG 表达七态、变化、输入和来源；把背景限制为环境层。
- **Do** 保留大表面乳白中心、动态正文滚动区和独立操作区，并核验缩放后的实际可读与可操作范围。
- **Do** 将用户内容和旧演示分开，使用同一对象的当前停点驱动首页、事项与搜索；本地保存不能标为外部送达。

### Don't:
- **Don't** 将七张参考图做成全屏图片切换，或把新的事项构图提升为首页/旧讨论的全局规则。
- **Don't** 为统一外观顺手换用组件库默认卡片、厚色蒙层、另一套字体或新的小鸟身份。
- **Don't** 用打开页面、返回、悬停或材料关系选择伪造用户已经采用的新判断。
- **Don't** 将固定字形子集、880 × 620 场景缩放或静态组件演示等同于全字符、移动端、无障碍或完整产品验收。
