# Trace Migration

提供 JSONL → SQLite 的可验证迁移。迁移只读取旧状态，不修改源文件；先校验协议、revision 连续性和哈希，再写入同目录 staging 数据库，完成后原子替换目标文件。旧 JSONL 保留为回滚证据。
