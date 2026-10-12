# 有限续接与诊断版本更新范围

原 dc4f 恢复已完成 92 个声明实例退出、原 Enter/Exit 和原 Start；36568 是新 Worker supervisor。失败发生在 restore-supervisor 的可选字段读取。原失败、49 条 f15 WAL、owner、Worker 6cff / Django 85cf 与原批准时间不变。

本次只更新诊断候选：旧 3e46 / Plan 39e6 → 新 0b8566624e19e44bdc4f556fb9f0baa541d3f35dbf695c00d06b00ba16de9abb / 原工具实际 Plan 50999d5e653050d95cb860484538050c89a21819dcec8d14beecb80f07814bae。9 文件中仅 Backend/Supervisor wrapper 增加对既有 process-deadline.ps1 的哈希校验与加载；不改正式 Django/Worker 包。

续接包 CONTINUATION_PACKAGE_V2.json：e9d4ca56d1488e3a37435cedeac07642e06dadb3d90bee8e32cca05ec69713ed，137 项封闭 pins。原 V1 0c188 保留。完成前缀真实记录、失败退出、当前 Worker receipt/desired、原 49 WAL/owner/源码和 exact own a23 marker、drain absent 全部复验。持原 rotation 与同线程 watchdog mutex，先用新只读诊断确认当前完整 Ready，再以 held-object 删除本次精确 marker。

只执行四项：restore-supervisor、verify-ready、install-diagnostic、verify-installation。不重放停止92、Enter/Exit、Start；不新增 Backup/Restore、迁移、业务写入或日调度变更。Supervisor 恢复仍原 Run 生命周期；安装仍原 healthy/Plan/TaskXML 判词，仅批准的新 Action/version/installation/transaction 变更，Triggers/Principal/RunLevel 不变。

撤门后失败尝试 create-only 恢复相同 own marker。I/O 或权限错误可能使 containment 本身失败，必须记录并停止，不能保证全系统排他或必定回补；不删除外部门。围栏存续期间新非 health 业务请求503，新受保护后台/console job被拒，已在途工作不因此终止。

当前仅开发/机器只读资格完成，尚未此新版本批准、未生成真实批准运输包、未续接。原3e/39e批准不自动接受新版。用户确认此精确版本更新后，记录独立 approvedAt，通过已审模板生成 ASCII/全闭包持读运输，再请求真实 Windows UAC。原 f15 6989 后续验收仍使用原 2026-10-11T15:25:28Z 批准；新版本时间不能替代它。原 Start 补证及剩余七项验收/closeout 尚待真实恢复结果。
