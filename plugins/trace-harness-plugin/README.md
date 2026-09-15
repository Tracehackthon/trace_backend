# Trace Harness Plugin · Web + 原生桌面

同一套 Trace Overlay 现在有两个入口：DeepSeek Harness Web profile 插件，以及独立运行的原生桌面悬浮插件。不构建 Harness 源码，也不接 Trace 后端。

## 本地构建

```powershell
npm install
npm run build
```

构建会生成 `lib/index.js`（宿主入口）和 `lib/client.js`（Harness 浏览器模块加载器格式）。

同时生成 `lib/desktop/`：Electron 原生入口、透明桌面 Overlay，以及内置的深度讨论页。

## 安装到 Web profile

从当前工作区执行：

```powershell
dsh plugin --profile web add .\trace-harness-plugin
```

重启或重新启动 Harness Web 后，右下角可以打开 Trace V1。

## 运行原生桌面插件

```powershell
npm ci
npm run desktop
```

运行后，刘看山以透明、无边框、置顶的桌面 Overlay 出现在主显示器工作区。透明区域不阻挡其他应用；点刘看山后，卡片与面板在当前桌面展开。系统托盘菜单可以显示、隐藏或退出插件。

“继续讨论”会打开插件内置的原生讨论窗口，不要求另行启动 `apps/desktop` 的 `4173` 开发服务。候选状态会回到悬浮插件中的对应观察。Renderer 开启 `contextIsolation` 与 sandbox，不直接获得 Node 权限。

## V1 范围

- 刘看山悬浮入口与展开/收起，Web 与原生桌面复用同一组件
- 先接住面板：内存 Mock 记录、继续讨论提示
- 三条历史观察卡片
- 五类节点的静态非线性思考图
- 候选判断的采用/暂存/拒绝内存操作

V1 不包含真实后端、持久化、真实语音、图谱拖拽缩放或安装包签名。当前原生入口先验证 Windows 桌面交互，尚未完成 macOS / Linux 验证，也没有接管系统开机启动。
