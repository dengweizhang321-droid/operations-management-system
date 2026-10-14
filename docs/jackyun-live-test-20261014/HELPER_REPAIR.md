# 完整恢复中的既有闭合回执兼容修复

2026-10-14。Django授权头修复已采用为manifest `8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac`。真实执行8956在A遇到既有version1回执与新create-only回执的路径冲突，未进入B/C/D/E。原回执、临时文件、预备计划、reservation、control及失败execution全部保留。

最终修复只在原publisher完成新执行/人工授权、适用的凭据就绪和新鲜零效果核验后，调用原`assertClosedPreflight`，原样复用未绑定消费者的version1/2/4回执。绑定执行的3/5/6/7和未知版本不扩大；没有删除回执、修改active、取消create-only或放宽owner/fence。

- 主线功能提交：8f9aefd26dd947dac64e782db52dd71d6596ac86、1630fb51f259d7c28adb58351b99eef1075240d0。
- 最终Worker组合源码：`D:\codex-isolated\jackyun-unbound-closure-source-20261014`，commit `22df75fdb375cd825dab6bcf2b3f6924025dcd12`。完整8265文件相较实际Worker前驱仅修改`lib/jackyun/preflight-recovery.ts`和对应测试；115个helper输入与受测源码一致。
- 最终前置回归46项通过，0失败/取消，覆盖人工/自动旧回执、跨日、损坏证明、凭据未就绪和迟到效果。此前5种提交后响应丢失导入用例通过；最终扩展未改导入处理，不把早先49项日志改称最终源码的全套结果。三类冲突均保留修复前失败日志。
- 8956另经只读检查确认A终态、无B/C/D/E、四类业务路径不存在，control/reservation/计划摘要一致，原8548闭合证明有效。

仅支持version1的候选`20261014T021818Z-19974b88cb69ab22` / plan `a627810179515a66a950813cd29fbbed118cd5b937ca3030bcf5f25756399ea8`未采用，保留在`legacy-helper-adoption`追溯，**不得再发布该候选**。最终准备和采用只使用`unbound-helper-adoption`。

## 生产范围与恢复边界

前驱Worker为`20261013T145450Z-fe391dce49a258cf` / manifest51aefd56...；正式Django保持8b4fed2c...。Worker源码树中的backend是其历史源码闭包，**不是Django候选，不得从该树DeployApp**。本次没有正式n8n定义/调度变更、数据库迁移、Django/PG停机或新备份/演练。

沿原全局rotation锁和唯一生命周期入口：BeginWorkerDrain → 排空 → StopForRelease → 原applyApprovedRotationPlan精确SHA → Start RequireReady → VerifyStartup → EndWorkerDrain。原文件/依赖/进程身份、启动绑定和fence保留；其他业务在途时遵守原排空门禁，不结束其进程或接管owner。

每步create-only记录started和结果，未知先回查、不重放。apply前失败且head未变时按原同版本恢复；apply后保留successor/消费回执及drain，按实际候选恢复或另准备合法后继回退，不直接启动已fence旧包，不作数据库回退。

## 真实接续

部署完成并核对实际head后，`resume-after-8956.mjs`重新验证零业务效果及reservation，经正常系统POST对逻辑8548/已失败8956取得下一次授权。旧授权已绑定8956，不能换绑新execution；新POST仅一次，未知保留intent。

由原A完成中断后的active推进和计划衔接，不由操作脚本写业务恢复记录。成功须跟踪A/B/C/D/E并回查货品、分仓库存、库龄、销售、组合装五类精确批次、内容/原文件摘要、归属行数和日期。预备计划8956为实际采集日2026-10-14、销售2026-08-30至2026-10-13；最终以原机制核实的计划为准，不冒充历史快照。部署和五表业务完成分别报告。

## 监控附加证据采集的有界修复

10:40的自然检查实际为Worker status_error（各Django组件和HTTP正常），随后卡在Get-WatchEvidence第392行的Get-Content -Tail160，持续占用CPU而未推进监控。原失败Snapshot已通过同用户PowerShell命名管道只读保全；未输出局部凭据变量。实际12MB日志尾部有超长单行。

主线553dc0a5仅把附加PostgreSQL日志读取改为最多256KiB、最多160条完整行，并标记截断/不可用；原Snapshot健康/身份判断保持。8项边界测试及36项监控回归通过；实际日志只读验证读取256KiB约114ms，无日志改写。独立watchdog候选复用ceee全部其他字节及原绑定，仅main脚本改为344daf4c...；健康快照已通过。

受控恢复仅暂停原任务下一次触发，在保留失败快照、精确PID41708/创建时间/命令行/当前用户及无业务子进程条件下结束该持有句柄的证据采集进程，不结束进程树或业务服务；随后原PlanInstall/Install更新原任务Action并重新启用。失败按原安装事务回退并恢复任务启用意图。无临时计划任务、原触发器和权限保持。此修复单独安装，不进入已冻结的Worker候选；Worker候选中的历史watchdog源文件不代表正式独立看门狗版本。
