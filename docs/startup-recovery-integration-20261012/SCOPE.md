# 待批准的精确恢复范围

本包尚未获新增生产范围批准，也未执行维护、停止、重启或任务修改。原 f15 批次仍为 49 条 WAL、Start unknown；业务包已经切换，不等于发布验收完成。

最终计划：`E:/codex-artifacts/startup-recovery-integration-20261012/RECOVERY_PLAN_FINAL_V1.json`，SHA-256 **dc4f2de71423097a53f26b37e4a10bdd6ee541f9aef3c8b9005c068239a7a5c2**。它绑定 112 个源码／工具文件及全部原 49 条 WAL，Worker `6cff8886…`、Django `85cf0699…`、原规格 `960c5c3e…`、原所有者和未知事件均不换绑。

拟批准以下一次有界恢复，以及通过后的原批次续接：

1. 在原 rotation 锁和同 PowerShell 线程的 watchdog 互斥内，重新核验源码、角色、所有权、原 WAL、部署、ACL、旧缺失回执仍缺失、安装计划及有限旧诊断 actor 观察。未知或变化即拒绝。该 actor 观察不是全操作系统排他证明。
2. 创建本次精确维护意图 `12c465652dbc4b5f9f54d0b0f30eeb3a`，`keepPostgres=true`、`drainedStopped=false`。它会使所有新非 health Django 业务 HTTP 返回 503，并拒绝新的 protected background／console backup job；不终止已在途请求、作业或诊断。随后真实调用原 Wait-AutomationDrain，等待 helper、console/PG fence、后台及请求 activity lease；不能以 marker 存在代替排空。
3. 对 **23 个原服务根＋69 个已逐实例声明的后代，共 92 个实例**执行有界停止。每个对象绑定出生、镜像／命令摘要及父链，动作前全体持有并重新验证内核句柄。未声明后代、复用、身份不明均拒绝；不按 python/conhost 等名字授权。只对已经通过初始存活验证且一直持有的同一对象确认自然退出，不给初始已死对象免验。原 Worker 43884/3692 不属于这 23 根的额外终止名单。
4. 调用原 Worker EnterMaintenance KeepPostgres，补停有合法原回执的 Worker、helper、Django/AI/Pandas 等原整栈组件并完成原 stopped/drain 门禁；PostgreSQL 保留。达到原全停条件后，调用原 ExitMaintenance，再调用原 Start 生成新的合法进程回执。不是伪造历史 configFingerprint，也不是重放原 unknown Start。只运行 D85 封存的既有启动逻辑及其必要断言，不新增数据库迁移、权限重置、业务修正或人工写入，也不跳过原断言。正常既有自动业务仍可能写入，不能把此次恢复说成全系统零数据库写入。
5. 通过新只读诊断确认应用状态，限定调用原 supervisor 恢复路径，必要时启动正式原 `django-runtime-supervisor.ps1 -Action Run -Execute`。正常监控、本地 outbox 和原自动恢复语义继续；长期进程不继承本次运输 deadline。356 是已观察到的本地 pending 文件数，不是本包发送 356 条消息；不手工调用通知、whole Check Recover 或测试通知。
6. 达到原完整 healthy 条件后，使用原安装器采用九文件候选 **3e46d2454ddb0879c36ead3b27305d5f128e6bacc40f245d0404324b21e07280**，原真实 PlanId **39e6df7e0608e78c641bb8941a84a6eb5a837ce85dc9fdd10b7d0cd3d5123097**。只更新既有 watchdog TaskAction 指向新 immutable version，并写 installation/原事务审计；保留 triggers、principal、RunLevel 和原回滚流程。旧 add91 版本不改、不删，日备份调度不改；原健康断言不删。
7. 释放互斥后等待真实自然健康快照，并独立验证原 Start 的当前完成条件。仅使用原 reconcile API 补充完成证据，保留旧 unknown；再用原 6989 fresh entry 和原批准时间续接剩余七项验收／closeout。这里不以恢复安装器返回值冒充自然验收，也不宣称后续七项已经执行。需要的后置事实只能在实际恢复后采集。

失败规则见 [FAILURE_CONTRACT.md](FAILURE_CONTRACT.md)。进入修改阶段后的失败保留或 create-only 恢复本次 own marker；退出维护调用即使清门后报错也进入该处理。不会自动删外部门、重试停止或重启、清理 owner 或改旧 WAL。写围栏自身也可能失败，会记录 containment failure；不能保证硬件／权限故障下绝无门禁空窗。部分停止仍报告部分状态。门未合法解除前业务 503 将持续，需要针对真实失败闭合；不是先启动无限维护再等待未开发的恢复思路。

本次不新建／重做 Backup、Restore 或发布后两项数据库阶段，不变更正式应用字节、SourceBinding、原 19 步规格或旧审计。原一次全库 Backup 和同点新消费链隔离 Restore 已有真实证据。现有永久 C389 修复尚未采用到正式 Django 85cf；其它人工／非观察范围的旧普通 Status 调用风险不因此自动消失，恢复期间不得另起这些调用。

采样包只请求固定 CSS、ready 和无凭据 reader GET，分别记录静态 200、ready 状态及 401/503；不将它们合成业务资格。只读现有 natural watchdog，不调用 Check。时间统计沿用原批准 `2026-10-11T15:25:28Z`，包含开发、人工、UAC、维修和原验收全部等待，不回填采样空档。

精确新增批准后，才将真实 approval 记录与计划绑定、生成 ASCII bootstrap。模板已验证，最终含批准时间的 binding/boot 尚未生成；启动时必须核 boot 自身 SHA 并持其句柄，以已批准闭包加载。Windows UAC 必须由用户确认，不能代点或绕过。
