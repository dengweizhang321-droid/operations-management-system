# AB 补充只读验收与原批次续接

2026-10-10。原AB已获批准并完成切换，但UI验收三次失败，整批未完成。本方案已经形成精确可审查材料；**尚无真人补充批准，未执行补充控制器或原批次后11步**。原失败不改成正常成功，生产候选不改变。

## 唯一补充批准目标

- supplement SHA：`0bcad05b44a127e63bb0c38ad16046d282eb529e47cf0c7d9022fac248f6cac2`。
- 文件：`E:\codex-artifacts\release-integration-review-20261010\AB-ui-supplement-20261010-0820-final\supplement.json`。
- 文件原字节SHA：`9776837c7ce7ac271848659217135c58b9df85563f13a13b77ad8b44e4ef3dda`，22份支持文件全部封存；机器交付见 [SEALED_SUPPLEMENT.json](SEALED_SUPPLEMENT.json)。旧0800/0815草稿不构成批准目标。
- 原批准batch：`9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`，保留最早批准 `05:28:51.000Z`。
- 精确failed锚点：`b68be115be0dc4061a1aca79df78eaabf2ed858e76e2c1bdb96c8c178e507556`，`08:08:11.698Z`。前9步骤各一次passed，后11尚未执行，active仍属9。
- AB源码 `5faac8151f59d66de72c3caead8cad916ea547da`；release `20261010T014638Z-97833d2f2b7e7bc9`；Worker manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`；Django仍 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。
- 新UI SHA `2ae444e2bc6f337c6940a7f15a37b5d569257aeed76b3c98058955fe8ddb6118`；实时完成屏障 `5055f2d5c80cbc5bd1e99cc951010cbc0aab587b3298a05ed0f8a90e0ef80f71`；控制器 `97e66370260154a38387b77f3d852112d9583d51f0682b37a9080deaa9032570`。

## 新范围及验收

仅将第10步换为经复审的只读验证新尝试：实时等待本次请求finished/HTTP200、完整成功商品详情DOM，再执行原四视口与键盘返回。action/read/DOM共用绝对期限，异常取消、错误版本/响应/DOM、写请求及资源不符仍失败；原日期取消、搜索清空、客服保留行inert/当前店铺详情四组断言保持。独立 [UI审查](UI_FINAL_REVIEW.md) 和 [控制器审查](CONTROLLER_FINAL_REVIEW.md) 均通过，声明未覆盖部分保留。

验证分开报告：真实隔离Chrome＋原route audit共16 runner tests；独立期限5；作者控制器17（含实际已采用旧引擎、隔离临时WAL）；独立控制器8。没有将这些不同scope相加称一次完整suite。中间失败、夹具前置拒绝和修正后的复验日志均保留。补充尚未作为正式批次执行；独立只读准备检查也不能替代原WAL中的补充新尝试。

非作者源复审后的一次 [真实只读准备检查](READONLY_PREPARATION_UI.json) 于08:23:31.463Z完成四case/86个GET审计，dangerous/failures/missing均0、无业务写入。检查脚本与最终脚本仅私有输出root不同，helper原字节相同；该结果没有写原WAL、不关闭9，最终补充仍要在真人批准后真实执行一次。Scoped lint退出0，0 errors/2个测试未使用变量warnings；未因告警修改已封存测试字节。

最终 [封存独立审查](SUPPLEMENT_FINAL_REVIEW.md) 再核scope/原字节、22/22单链接常规文件/路径闭包、45条原WAL、原assertions/covers和两非作者复审关联，status=passed，仅限准备审查。PowerShell日期自动转换造成的首读误报经Node原字节确认并保留更正，原封存未修改。

新控制器先校验原authority原字节、原op签名、exact failed event/at、真人新批准、22份新pin及原collector/命令闭包；导入已采用AB旧engine、旧rotation lock和原collector。持原锁确认唯一active/无unknown/前9passed/后11未开始，原引擎fsync新started后才写绑定parent event/新command/maxAttempts1的create-only补充意图，再执行新只读UI。原完整动态准入/身份/权限/维护/排空/全源/制品检查逐步继续，无C缓存或快路径。

新UI真实exit0、原stdout断言、完整audit/四case及新文件回验全部通过，才保存补充raw摘要及receipt，并由原引擎追加明确 `explicitly-approved-readonly-validation-supplement` 的新通过尝试；receipt明确 `originalAttemptSucceeded=false`。旧三次unknown/failed/proof不删改，不调用`reconcile(passed)`伪称原失败完成。

后续仍为原批准的11–21：未签名权限拒绝、12域就绪、VerifyStartup、既有watchdog Install/Enable/Start、两次自然守护、后Backup、55593隔离Restore、恢复保全、全部PG深比较、历史审计、精确最终就绪。已passed的前Backup/Restore、维护/apply/Exit/Start不重放。原批次此前批准的既有钉钉接收/调度进程及watchdog自动恢复/故障告警范围保持；没有新增手工发送、调度定义变更、正式数据恢复、DeployApp、迁移或C采用。

新UI若失败/中断，保留unknown和一次意图，不自动重试。若新UI通过但原tail后来阻断，独立核对该补充receipt/原WALreason/精确现场，按原协议协调tail，使用**原engine CLI**续接；单次补充控制器拒绝再次进入或占用输出槽。只有全部原验收及收尾通过才写completed并释放active。

## 未决事实与计时

实际状态/两段入口异常/前恢复点/保护与回滚见 [生产记录](../production/REPORT.md)。旧D5 Worker于前置Restore期间退出后由原supervisor重启的根因须定点追溯；不将恢复收据false覆盖实际异常，不预先关闭该事件。后恢复期间重新采样入口并保留异常；如发现误杀正式树或其他安全缺陷，仍阻断并提出精确修复。

后备份前后全PG deep compare任何差异均拒绝，不豁免后台写入；还未执行的范围保持未完成。必要验收闭合与全部Git交付分别记时；原批准时间不因补充批准重置，两个批准时间同时保留。失败/协调/排队/续接以及子阶段耗时按父WAL去重，采样不可用区间不使用switch span代替。80～120分钟工程预算本次已超出且未闭合，未证生产达标。

D5兼容回退必须以当前AB实际前驱重新准备原受控计划；生产数据恢复另需精确点/库/窗口批准。本方案没有执行回退、删除active或跳过收尾。

## 审批与操作交接

[发布批次协议](../../RELEASE_BATCH_WORKFLOW.md#一批批准范围编排与续接)要求“第一轮采用的现场适配／任务验收脚本也在独立复审和批次批准范围内”。修正版脚本摘要和新增补充控制器超出原9精确范围，因此需要用户对上述唯一补充SHA的明确批准；原AB批准不重复索取。建议回复：**“批准补充方案 0bcad05b 并续接 AB。”**

收到该批准后，依据真实user item ID/time保存E final `human-supplement-approval.json`（explicitHumanApproval=true、精确supplement SHA、实际approvedAt、新的userItemId），原AB item和旧时间不能复用。执行工作目录固定为 `D:\运营管理系统-sales-django-release`；不更改其5fa源码。以实际新批准时间替换下列占位值，单次运行封存控制器：

```powershell
Set-Location -LiteralPath 'D:\运营管理系统-sales-django-release'
& 'C:\Program Files\nodejs\node.exe' 'E:\codex-artifacts\release-integration-review-20261010\AB-ui-supplement-20261010-0820-final\supplement-controller.mjs' execute 'E:\codex-artifacts\release-integration-review-20261010\AB-ui-supplement-20261010-0820-final\supplement.json' '0bcad05b44a127e63bb0c38ad16046d282eb529e47cf0c7d9022fac248f6cac2' '<实际补充批准ISO UTC时间>' 'E:\codex-artifacts\release-integration-review-20261010\AB-ui-supplement-20261010-0820-final\human-supplement-approval.json'
```

继续保留旧D专用worktree、固定AB候选clone、E9与本补充材料，待真实闭合再按规范清理。最后的Git提交/合并/推送核对见本目录DELIVERY.md；Git交付不代表生产completed。
