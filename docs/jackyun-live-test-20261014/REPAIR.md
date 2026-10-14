# 2026-10-14 已授权恢复范围

用户明确批准四步：准备当前 Django 配套看门狗、受控恢复 supervisor、通过原批次解除发布占用、发布授权头修复并续接原请求真实测试。禁止新建临时计划任务。数据库无新迁移，不新增备份或演练。

## 已核验范围

- 当前 Django deployment SHA `4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321`。控制脚本相较 app.previous 只增加 17 行吉客云审计迁移准入及打包成员；Status 与所有权函数不变。supervisor 仅删除接受 app.previous 摘要的兼容，当前严格摘要检查保留。
- 新看门狗候选在 `D:\codex-artifacts\jackyun-live-test-20261014\watchdog-candidate-v1`，全部可执行字节与已安装 ff4e 版本一致，仅精确绑定上述已审实际 backend/supervisor 两个新摘要。原版本目录不修改。候选检查 control 已通过 Running/Ready/exact_release，supervisor 因旧状态摘要拒绝。
- 旧状态 SHA `15b0e4bf5fd663322239ed7f8badc86ef120ab4e0e5e4cd350d2388a0a072058` 明确 stopped；原 PID 与回执缺失，原 supervisor mutex 还将在写边界核验。归档器保留完整旧状态，不改历史内容。新状态只由原构造器创建。

## 顺序和停止条件

1. 原唯一 Worker `EnterMaintenance -KeepPostgres` 排空并停止应用。原批次 release active 保留；本次恢复属于原 owner 的修复，不通过新发布抢占。
2. 在精确维护 ID、drainedStopped、desired stopped、当前部署摘要、旧状态摘要、无 supervisor 进程/回执及原生命周期互斥全部符合时，`archive-stopped-supervisor.ps1 -Execute -MaintenanceId <精确ID>` 原子移动旧 state 到同受保护目录的 SHA 命名归档。任何漂移拒绝。
3. 原 `ExitMaintenance` 和唯一 `Start` 恢复同一 Worker/Django 版本；候选中原 `Restore-WatchSupervisor` 恢复当前 supervisor。候选健康检查通过后，原 `PlanInstall`/精确 `ApprovedInstallPlanId` 安装新 immutable 看门狗。保留原任务身份、触发器和 launcher；没有新临时任务。
4. 保存自然成功观察及修复证据，按原 reconcile 把旧只读检查 unknown 明确判为 failed/noEffect，保留旧 WAL；后续重新执行检查只接受修复后的新证据。全部原要求通过才由原批次释放 active。不得把旧失败改为通过。
5. 重新核对当前 Django 前驱、其他发布无占用，采用已准备 d9ccdd82 后端应用（PrepareApp ID `2eac13dfda7e4938a87a7acf71f0af72`）。应用实际仅修改授权 GET 的 revision 头。原迁移准入仍执行 successor 检查，不重放迁移。验证目标部署与必要服务后，使用原授权请求身份续接真实吉客云测试。

遇到维护/停止/启动失败先保留精确记录，核对实际进程与原命令结果，不重复盲调。状态归档后若尚无新状态且无法启动，旧归档原字节保留可供受控恢复，但不能为当前脚本伪造旧摘要兼容。新看门狗安装失败沿原安装器事务回退任务与安装记录。应用切换失败按实际 DeployApp 结果处理，不跨前驱复用收据，不把部署成功当作五表业务成功。

说明：安装器从候选调用 `Get-WatchSnapshot`，检查候选绑定，不要求损坏的旧绑定先健康；无需修改或放宽安装器。
