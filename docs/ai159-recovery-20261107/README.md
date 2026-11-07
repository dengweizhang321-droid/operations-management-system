# AI159 原发布尾部恢复

目标应用提交为 `e030caba1271d47fced663649f288855234a02e2`。原批次已部署 Django、应用 ACL、完成 AI159 的结构安装和权限最终校验。原 Pi 升级以直接退出码 1 结束，原状态核对记录后继单元已失活；它此前已经切换并启动过，原升级意图保持 unknown。Worker 切换、退出维护和启动均待执行。

经独立审查后，使用已采用控制的 Node 在干净的隔离工作树执行一次：

```powershell
node tools/publish-prepared-main.mjs --recover-ai159 --operator-commit <审定的完整执行代码提交>
```

本入口固定原配置和发布目录。它单独记录执行代码的工作树、提交和树摘要，发布目标沿用冻结包原提交。先持有原准备队列、Worker rotation 锁和发布租约，并核验原执行者退役、Django 制品、AI159 原结构回执、维护窗和 Worker 前驱。正式 PostgreSQL 上使用已安装的 `integration_release_gate.py database` 在默认只读事务连接中核对 AI159 的实际迁移目录与权限。只有该检查成功才能恢复原 Runner 候选并使用原协调入口。

原 `STARTED.json`、`FAILED.json` 和准备包保留。新增证据位于原发布目录下的 `resume-ai159`，一次性启动 guard 位于原发布目录。共享发布尾部执行原 Worker plan、退出维护、启动与版本和就绪门禁，随后生成真实 `SUCCESS.json` 并通过原发布目录 CAS 更新 `PUBLISHED-MAIN.json`。记账成功后，确认正式 keeper 已接续，再释放此次临时 keeper。已有完整成功回执时，本入口只允许协调原索引和临时 keeper 的释放。其他在途状态需要保留证据并重新确认。
