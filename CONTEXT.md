# Trace Runtime Domain Context

本页固定源码结构中容易混淆的领域词。它不是进度记录，也不重复 HTTP 路由说明。

## Product Workspace

用户在 Trace 中围绕“一件仍在变化的事”形成的权威产品状态：事项、原表达、材料、自己的理解、对照、工作和待复核结果。Product Workspace 独占 `web.sqlite` 的产品实体、版本和命令回执；页面、Agent 与 Codex Adapter 都不能另建第二份权威状态。

## Project Collaboration Runtime

项目目录里的协作模型、认知来源授权、接续、候选／采用、hook 与 evidence。它使用项目 `trace.sqlite`，与 Product Workspace 是不同生命周期。`packages/product/application` 当前实现的是这组项目协作用例，不能简称为 Product Workspace。

## Agent Run

针对一个 Product Workspace 版本执行的一次讨论、解释、比较或修订候选。运行、事件、工具证据和候选保存在 `agent.sqlite`；成功也不自动修改 Product Workspace。

## Content Source

经明确许可用于提供外部摘要和实际链接的只读来源。知乎搜索、全网搜索属于公共 Content Source；知乎 OAuth 用户数据属于账号授权能力，不能由 Agent Run 的公共检索许可获得。

## Local Host

组装页面、Product Workspace、Content Source 和 Agent Run HTTP Adapter 的本机进程。Local Host 只负责组合与生命周期，不拥有各领域规则。
