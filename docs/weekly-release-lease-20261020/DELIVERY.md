# 周报发布租约交付

- 分支：`codex/weekly-release-lease-20261020`
- 基线：`d498852c8f016c916f13a703bc7396fdfc01883d`（开发期间从 `f5c68845` 前移后已 rebase）
- 候选代码提交：`4a9c37c7e686a8defda949b8600f5c6b7ed94cf6`
- 变更：工作流服务等锁前租约、发布器有界租约写入/刷新/清理、周报准入与发布器测试、新逆投影、验证器有限 profile。
- 验证：PS5 夹具 48/48、PS5 逆投影通过；发布器 52、争用 5、验证器单元 8、优化边界 3 通过；`git diff --check` 通过。PS7 与完整验证器因本机无 `pwsh.exe` 未执行，详见[报告](REPORT.md)和[证据摘要](evidence/SUMMARY.json)。
- 发布范围计划：`full`（worker+django），`migrate=false`，`databaseProtection=verified-current`；未执行迁移、备份恢复或生产维护。
- 未合并、未部署、未重启服务、未执行周报发送或外部通知。合并与上线需要单独指令；上线时按既有发布门禁重新准备和验证制品。
