# Pi150 发布启动失败的前向恢复

用户在 2026-10-17 明确要求代为发布。原 main f3748d8e 的 Pi149→150、权限、Finalize、Worker 激活和退出维护均有真实成功回执；原 Start 在完成集成迁移的校验阶段失败。原 FAILED 及全部封存来源保持原字节。

## 根因与修复

`integration_release_gate.py` 的 release/database 分派遗漏 Pi150，因保留的 Tmall149 active 进入旧的147/148→149严格校验，拒绝含0084的新源码。修复只增加优先的 Pi active 分派；Pi 校验失败立即失败，不回落旧代，不放宽迁移、权限或来源验证。

生产只读复现：旧门禁报 `Only the exact reviewed147/148-to149 migration delta is supported`；修复门禁在 `default_transaction_read_only=on` 下验证通过，返回 complete / migrationCount150。没有以该只读验证执行 migrate、授权、启动或模型调用。

## 恢复边界

当前 helper 和应用均未启动，普通维护不能获得5791应答，因此使用严格绑定本次 f374 失败的有限维护桥，经原 source Worker EnterMaintenance 和 Django 原构造路径进入维护。保留原活动锁、备份/PG fence、进程与完整性核验；不伪造 helper 应答，不手写维护标记，不重放未知操作。

修复涉及运行工具，完整差异范围计划要求 Worker 与 Django。新前向计划以已经激活的 f374 Worker 为精确前驱，两个新制品绑定同一提交，按 Prepare/Verify→维护→Deploy/HardenAcl→新 Worker plan apply→退出维护→原 Start/VerifyStartup/ready 执行。旧 Pi Install/ProvisionRoles/Finalize 和旧 Worker plan 不再调用。原 Start 内的无 pending migrate 命令及权限恢复仍由原控制器执行，不宣称完全没有数据库命令。

数据库保障沿范围计划的 verified-current，使用原 Verify 检查现存恢复点，不增加全库备份或隔离恢复，也不把旧备份称为新的150快照。

## 验证与交付

- 门禁10项测试通过，覆盖Pi优先、失败不回落、旧代路由与原证据拒绝。
- 前向驱动17项私有测试通过，覆盖成功绑定、逐步失败/unknown停止、重复提交拒绝、证明/前驱不符、仅采用新plan、成功与catalog回执。
- 新旧维护桥的2组私有契约均通过，每组实际使用PS5和PS7。新桥覆盖真实只读进程元数据补齐，无法证明身份时保留拒绝；没有通过忽略其他终端规避检查。
- 独立审查确认原Pi150/Worker激活/启动快捷方式/退出维护证据一致；持久supervisor状态与候选兼容。既有watchdog driver失配不阻断显式Start，本轮不冒称其自动守护已恢复。

第一批bbc9制品在只读预检阶段遇到WSL自动停止及原PID63044被无关CUA进程复用，未进入维护、未写恢复intent或RECOVERY-STARTED；所有原件保留。只读有界Linux sleep经实际探针证明可保持WSL，不启用业务服务或改变隔离配置。对有原始完整身份的进程，以创建时间及命令身份确认数字PID复用后，仍执行普通关联性检查；可能的原后代、身份不明或原进程继续拒绝。

实际准备、发布和恢复采用状态以 `D:/codex-artifacts/pi-publish-recovery-20261017-v2` 的原始步骤和最终回执为准；首批证据在不带v2的同名目录保留。本源码报告不代替生产成功回执。
