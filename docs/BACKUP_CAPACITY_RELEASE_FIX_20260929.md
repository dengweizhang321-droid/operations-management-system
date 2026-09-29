# 上线验收发现的备份容量预检修正

2026-09-29。第 1—7 项已按本轮授权采用，系统已恢复，12 个组件就绪，配套 12 条工作流已发布。上线后备份在容量预检被拒绝，**第 1 项尚未完成生产验收**；本文件给出已准备的最小修正。

## 原因与验证

正式 PostgreSQL 的只读查询返回 `127.0.0.1/32`。新容量函数将其与裸字符串 `127.0.0.1` 比较，误报数据库身份不匹配。失败操作 `d3d9b96d17b042f797da773f17a8d58f` 已以 failed/ capacity_preflight 终结；尚未生成 dump，没有改动或删除受保护恢复点。

提交 `e92aeaf79d500bbfbcddda267ba973e19f0aae89` 已合入 main。唯一运行代码变更是 `tools/postgres-consistent-backup.py`：复用同文件已有的 `_canonical_loopback_address`，保留数据库名、用户、固定 IPv4 回环、端口、正整数容量及空间门槛。测试补入 PostgreSQL 的 `/32` 返回形式，并继续拒绝错误数据库、用户、端口、非回环、IPv6、零容量及布尔容量。

- 容量测试 1 项、一致性备份 31 项、无新增密钥 7 项、operator 环境 2 项，共 41 项通过。
- 正式数据库只读复现：旧函数失败，新函数返回 completed；当时数据库大小 15,467,378,355 字节。
- 固定来源准备完成，原完整 Wrangler/R2 往返门禁通过；没有修改已安装工具或绕过容量检查。

## 精确候选

| 项目 | 值 |
| --- | --- |
| 已运行 Worker/helper，维持该版本 | `20260929T005710Z-e980ef9414b72995` |
| 当前 Django manifest | `fd52d2f4cd8e9ab4ec1a20bac8c528042524fc15e18bb192ecbd04af22061287` |
| 修正 prepared ID | `87e41232b2f34ee59bfa248ee119faa9` |
| prepared 收据 SHA-256 | `45c05895858be1d03c42c164b7510d0d8aee6f88c4a5b79df3dd60e27ff7aff3` |
| 修正 Django manifest | `2643e0fee6163a885d651215f1814102fdbe8001376fd335cffe0d647b5f5583` |
| 修正工具 SHA-256 | `f24b200af039b73043a469ef07b4b6c50607f84064a343c75e6766f4242488ca` |

候选尚未采用。它保留最新 Inspector 补丁和其他六项代码，不需要新的 Worker 版本、数据库迁移或 n8n 定义修改。

## 追加采用与回退清单

原计划的一次应用维护已结束，因此追加短维护须单独确认。确认后：核对当前版本、在途执行、helper、备份持久记录和最新受保护恢复点；临时冻结周报检查，其他已升级的数据工作流使用维护排队协议；通过唯一 Worker `EnterMaintenance -KeepPostgres` 排空并停止应用；只采用上述 Django prepared 候选并 HardenAcl；精确退出维护，通过同一 Worker Start 恢复整栈和原渠道，再恢复周报原启用状态。

采用后重新执行完整备份、Verify、E 盘三份和两处保护回读，确认操作记录闭合；检查 12 组件、版本/启动绑定、原 PostgreSQL/n8n PID 和自然看门狗。保留此次失败记录，不将第一次失败改写成成功。

沿用已独立恢复通过并受保护的 `daily-20260929T012900Z-ad2817875f20`，manifest `b93fa5c4c939f5dfbec9758b4d8fe7d7274465cbb1df0eb16028ba55d0f61e40`；本补丁不改变业务数据或数据库结构。采用前失败保留在线版本；采用后启动失败保留维护记录，按原 operator 的兼容前驱应用恢复，不手改清单或恢复生产数据库。

每日 22:30 备份自动任务 `e` 继续 PAUSED。第一次维护错过的 10:00 京东四店计划不自动补跑；追加短维护也不授权未知效果重放或测试消息。

受限本机证据：`E:\codex-artifacts\optimization-integration-20260929\production` 中的 `capacity-reproduction.json`、`capacity-fix-live-readonly.json`、`backup-fix-prepare.json` 和 `backup-fix-prepare-verified.json`。
