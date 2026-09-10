# `@trace/host-codex-skill`

这是旧式 Codex 用户级 Skill 安装器的安全边界：拒绝 symlink/路径逃逸，采用 staging、原子 rename、显式 approval 与 rollback receipt。它只处理明确声明的 Skill 文件，不静默覆盖用户目录。

当前日常产品入口是 `trace-codex` Plugin + MCP；此包仍作为兼容/维护能力存在。Plugin marketplace 安装由 `native/install-codex-plugin.mjs` 负责，两者不会因为 runtime 更新自动触发。
