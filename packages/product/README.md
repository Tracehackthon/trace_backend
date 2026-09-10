# Product application

这一层把稳定的 core 服务组合成用户能理解的操作：初始化项目、检查版本、迁移旧 profile、更新协作方式、启用 Codex hooks。它是 Plugin/MCP、CLI 与未来桌面端之间的共同产品边界。

它不把底层数据表、绝对路径、JSON 参数或状态机细节交给用户；所有可写操作均遵循 proposal → explicit adoption → apply → receipt。产品入口说明见[根 README](../../README.md)。
