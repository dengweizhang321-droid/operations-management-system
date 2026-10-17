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

第二批预检进一步复现：原通用传输会给全部argv加引号，WSL专用解析器把选项当shell命令（exit127）。仅此有限观察通过固定Python、无shell的subprocess argv转接，不修改全局传输；保留三项原观察、时间与输出限制，并实际验证双shell到WSL的传输。

第三批先在只读 VerifyPrepared 等待 Django mutex 时失败，原子进程51112未取得锁即退出；独审后将该只读阶段原件与SHA保全，在同一证明及制品上只协调一次重验。重验通过，原生Worker完整复验结束后，EnterMaintenance子进程68080在Worker最外层参数守卫退出（exit1，538ms）。该守卫只接受旧恢复779dd编号，Pi桥要求的原ca1bc编号因此在加载任何库、取得mutex或调用Django前被拒绝。此前仅mock native结果的驱动测试未覆盖这条实际入口，补充真实PS5/PS7入口与跨文件路由验证。

第四批修复只增加Pi原编号的有限入口，保留旧恢复的精确验证，继续由proof版本和内容绑定各自的桥。第三批RECOVERY-STARTED、FAILED及全部原件保留，第四批使用新源码、新制品及新plan，不重放第三批；机器绑定第三批六份原件、原Worker字节和精确direct-exit证据，要求无下游记录、无Pi恢复intent及原双前驱未变。仍保留原maintenanceId和recoveryAttemptId，不换身份绕过unknown。

实际准备、发布和恢复采用状态以 `D:/codex-artifacts/pi-publish-recovery-20261017-v4` 的原始步骤和最终回执为准；前三批证据在不带版本、v2及v3的同名目录保留。本源码报告不代替生产成功回执。

## 用户要求暂停：2026-10-17 21:02

用户明确选择“现在暂停，回家继续”。立即停止新增开发、验证与生产发布。第四批入口修复、驱动与测试差异保存在隔离worktree `D:/.codex/worktrees/pi-publish-recovery/运营管理系统`，未提交、未合并、未准备或采用第四批制品。驱动18项已通过并经独审；新增真实入口测试尚未通过，PS5/PS7的debugger边界停止断言失败，须修正测试后完成入口独审，不能记录为已验证。

生产仍是第三批之前的原双前驱，未进入新维护、未写Pi恢复intent、未Deploy或apply第四批。之前BAT失败后的应用尚未恢复，正式Pi尚未启用。续接须先核对现场、最新main和原证据；WSL只读有界观察sleep会自然到期，不把休眠/重启后的旧观察当成当前证明。保留所有原失败与started，不自动重放。用户在本对话回复“继续发布”后再恢复任务。

## 21:32 用户明确续接

用户回复“继续发布”后，重新核对最新main仍51eb7d76，只有原PostgreSQL监听，无新维护、drain或Pi恢复intent。重新记录有界只读WSL观察，保持无宿主挂载和interop的原配置。

入口测试改为独立私有子进程，在实际生命周期函数的debugger边界记录后以Exit17结束；避免throw被调试器吞掉后误入函数体。真实PS5/PS7参数入口、Worker→Django的Begin/CompleteDrain/End路由及新旧恢复私有契约合计3项全部通过（46.827秒）。该测试不返回模拟原生维护成功，不触生产锁、服务或数据库。原始结果保存在v4的bridge-entry-tests.log。v4驱动18项通过，包含原v3拒绝证据变动拒绝；gate与三条WSL只读adapter字节未改，复用其原有效验证，不重复付费模型、全量测试或备份恢复演练。
