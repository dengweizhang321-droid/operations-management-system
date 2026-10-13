# Windows 权限及正式在线准备续接

2026-10-13。此记录补充原交付，不改变生产部署/启停/迁移/真实补跑的确认边界。

## 权限已实际解决

用户要求由当前会话处理 Windows 实际权限。通过系统正常 `Start-Process -Verb RunAs` 启动临时管理员进程，没有改变 UAC、系统权限配置或服务配置。

第一次只读检查确认 elevated=true，3000/PID 17184 和 5791/PID 23536 的路径、命令行均可读。证据 `admin-identity-probe-1f5764f907d3496fac5c1cf753ef7896.json`。这只证明本次临时提权有效，不表示普通会话永久拥有管理员权限。

随后在一个临时管理员进程内，持有经 SHA 核验的准备脚本文件句柄，依次调用原 Worker 在线准备和原 Django PrepareApp。未调用 apply、DeployApp、Start、Stop、正式 n8n 更新或真实补跑。

## Worker 在线计划成功

- plan SHA：`305a355a2c2e35f81c43433c2fccfff10ea05c497aedd5fd8662c6cafee3654b`
- 原计划文件：`D:/teruisi-runtime/teruisi-worker-sales/state/worker-release-rotation-plans/305a355a2c2e35f81c43433c2fccfff10ea05c497aedd5fd8662c6cafee3654b.json`
- 前驱：`20261011T090355Z-21c2645a63247749`
- 不可变候选：`20261013T040853Z-8517af2a5fa7310f`
- candidate manifest SHA：`f6c589d736b63a73daf3971b7d5b7263fec4f29307576f743775616a5acdd9ec`
- guard receipt SHA：`c564b1c86abf7d44c5123b1cafce581fae1c5d01d9734dff430b9c90d0b02af4`
- 官方 source fingerprint：`335e0db6d79b05d02e3f42cec836788b9b123708b677f261f20ef44d45878a5d`，5199 文件。
- 原发布合约测试 42/42 通过，0 skip/取消。helper SHA 与先前真实隔离 n8n 成功样本相同：`16acb5a03375d6332a8a9394d0ddf72f429962e19b18bad186d0348194897e4a`。

为符合原工具清单要求，候选建立了独立 Git 索引；候选的依赖 junction 只删除链接本身，原目标保持，随后原锁文件下独立 npm ci 成功。既有离线源码/产物 ZIP 未覆盖。所有原工具准备与核验均保留，未拿离线 dist 直接当正式候选。

## Django 准备的独立阻断

原 PrepareApp 在首个 `Assert-NoUnapprovedProtectedAiMigration` 中，按当前 BI active 走 `bi_app_addition.py successor`，明确拒绝：`BI append changes another migration or the reviewed step`。

独立只读重现得到相同原因。实际迁移源相对已部署 app 只有两个新增文件，无旧文件变化或删除：

- `backend/erp_reference/migrations/0003_jackyun_upload_audit_binding.py`
- `backend/sales/migrations/0011_jackyun_upload_audit_binding.py`

当前 BI 门禁核验的是既有 139 父代加一个已审定 BI 步骤的 140 目录；它不接受直接夹入其他迁移。独立 PostgreSQL 57 项通过证明功能与普通迁移演练，不替代生产迁移谱系/受控采用协议。

因此当前不是管理员权限问题。下一阶段需复用既有迁移治理机制，为这两条添加式审计迁移补齐明确的准入、安装、备份恢复、普通启动及后续版本兼容证明，并做隔离验证。不能简单修改固定计数、清空 BI active、伪造旧许可或删掉 gate；也不能单独部署 Worker 而遗漏它依赖的后端和迁移。

## 运行结果和证据

外部根目录：`D:/codex-artifacts/jackyun-unified-recovery-resume-20261013`。

- `online-admin-20261013-v1-worker-plan.json`：原 Worker 返回 planned。
- `online-admin-20261013-v1-failure.json`：保留 Django 原失败及原始有界诊断。
- `bi-successor-readonly.json`、`migration-preparation-gap.json`：只读原因与精确迁移差异。
- `online-admin-20261013-v1.launcher.json`：本轮整体退出 1，不能把 Worker 单项成功冒充整轮成功。
- `n8n-proposed-updates.json`：仅生成两条流程的拟更新内容，保留正式设置和调度；没有正式写入。

临时管理员进程已经结束，无本轮在途准备。原失败证据、源码、不可变 Worker 候选和在线计划均保留。后续源码/迁移协议若变化，应绑定新来源重新准备，不能把当前计划换绑新代码。
