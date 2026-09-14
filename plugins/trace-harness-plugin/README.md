# Trace Harness Plugin · UI V1

这是一个独立的 DeepSeek Harness 插件，不构建 Harness 源码，也不接 Trace 后端。

## 本地构建

```powershell
npm install
npm run build
```

构建会生成 `lib/index.js`（宿主入口）和 `lib/client.js`（Harness 浏览器模块加载器格式）。

## 安装到 Web profile

从当前工作区执行：

```powershell
dsh plugin --profile web add .\trace-harness-plugin
```

重启或重新启动 Harness Web 后，右下角可以打开 Trace V1。

## V1 范围

- 刘看山占位悬浮入口与展开/收起
- 先接住面板：内存 Mock 记录、继续讨论提示
- 三条历史观察卡片
- 五类节点的静态非线性思考图
- 候选判断的采用/暂存/拒绝内存操作

V1 不包含真实后端、持久化、语音、图谱拖拽缩放、复杂动画或提醒气泡。
