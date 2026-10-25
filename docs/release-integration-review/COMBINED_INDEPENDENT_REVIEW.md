# 任务 D 最终组合非作者独立复审

2026-10-10（Asia/Shanghai）。复审者没有修改实现，只新增独立负例、透明 watcher 诊断与本报告。遵守共享记忆启动协议、实际 AGENTS、开发交付、验证发布、运行启动、安全及导入规范；用户的第二阶段通知授权集成验收，未授予生产采用。

**结论：已审源码及 D 日备份修复通过本次非作者复审，可继续按实际生产前驱准备严格发布候选。当前没有发现未解决的本次源码阻断；C 的数据库快路径生产资格仍未闭合，必须保持拒绝。** 没有可信的最新 native scheduler 结果来源时，标准 collector 明确返回 `lastResult=unknown`、`latestAttemptCoverageVerified=false`。包装日志成功不能冒充最新自然调度成功。此限制是失效关闭，不是快路径验收通过。

## 精确来源与复审字节

- A 实现：`67622d61ee326dc610c498356e518ec2ec7fdd81`；B 实现：`9b9c76d4cab19283005a86b267d673bce7168130`；C 实现：`2b10f6021a0b5bda1f52424604bf697b17218e3c`。交付门禁见 [handoff-gate.json](evidence/handoff-gate.json)，不以分支存在代替交付。
- D 原组合：`433b41adbb99bc72502b0e54472378a7667be94e`，实现字节来自交付主线 `2b1b70160de4ec2619c41ba895084dfba205b79a`。
- D 修复实现：`58bce3f7709f36b5eb8c61f324d34facb65f4e67`。实际复验前后 19 份核心实现字节全部相同，见 [前摘要](evidence/independent-reviewed-source-before.json)与[最终摘要](evidence/independent-reviewed-source-final.json)。后续文档、入口去重或构建提交不自动扩展本次源码结论；实现字节改变必须重新复审。

| D 修复实现 | 物理字节 SHA-256 |
| --- | --- |
| `tools/release-daily-backup.mjs` | `4b77088b234734fcfedeb658c81c489771d26f320b0a66a1a5286417a7857705` |
| `tools/release-batch-admission.mjs` | `c154c9bee0f9b5cc45e4af6a56377045799959a55e8aff752cff86edf73a1c8f` |

源文件、独立测试及日志完整摘要见 [independent-evidence-manifest.json](evidence/independent-evidence-manifest.json)。报告只引用本复审亲自执行的检查；作者的全量、构建、PG 演练另由 D 总报告提供，不能混称独立实测。

## 独立发现与当前处理

| 发现、精确旧接缝及触发 | 独立原结果 | 当前修复与复验 |
| --- | --- | --- |
| 原 daily wrapper `:32–35` 未选择文件协议与 preserve；继承 EOF 或直接进程仍活时沿用 runProcess 默认 EOF/tree | 原 5 例中的协议例失败；直接读取真实 runProcess 默认值确认旧协议 | 当前 `release-daily-backup.mjs:69–73` 使用同一原期限、原 PS5 编码参数与子环境、`direct-exit-files`、`preserve`；独立协议例通过 |
| 原 `:13–15` 在锁前读取 ACTIVE，`Backup` 后才复读；锁获取时配置转 PAUSED | 原负例实际 fake Backup 调用 **1 次**，应为 0 | 当前 `:61–64` 在 started/owner 后、实际调用前复读 ACTIVE 与精确配置摘要；独立调用为 0 |
| 原 schedule/lock/root 初始化失败没有新 attempt，旧成功可被误当最新调度结果 | 原负例新锁失败前后库存完全相同 | 当前 `:25–43` 锁前 create-only started、错误保留 unknown；较新失败覆盖旧包装成功，标准 collector 另外保持 native latest 未证明 |
| 原包装只把期限给子进程，过期父预算仍可开始；迟到结果可写 success | 原过期父预算及迟到结果两例均未拒绝 | 当前 `:20–24` 与各动作/解析/落盘/owner 回读后复验同一绝对期限；两例通过 |
| 初修 success 已落盘后 owner 解除返回迟到，产生 `failure.json`，未来只看旧 success 会续跑 | 静态独立发现，通知作者；没有把尚未执行的旧例称实测失败 | 当前 `:53–59` 拒绝旧闭合不明与 failure marker，`:91–97` 另写 unknown 保留原 success 字节；独立 marker、owner 错误与落盘失败负例通过 |
| wrapper 没有能力观测“入口尚未被调用的调度失败”或“无法落盘的最新失败” | C 交接中已明确，D 独立确认其证据边界 | 当前 `:122–127` 及 admission 的标准 reader 不接受包装 success 为 native latest；C 数据库快路径生产资格保持阻断，需另行准备可信来源并独立验证 |

旧 5 例 **0 通过、5 失败**保留在 [independent-daily-original.log](evidence/independent-daily-original.log)，SHA `c19ee354c2ed35ed9be51ff9a03c0f8052b2eb8c2e5e57cd27ef0a10b5436cef`。中间 7 例及最终 11 例分别保留，不用后续成功反推旧代码原已通过。

## J01–J10 组合审查

| 项目 | 本次源码核验与独立证据 | 资格边界 |
| --- | --- | --- |
| J01 期限、退出与重试 | `release-batch.mjs:388–450` 在绑定摘要和所有 Status 尝试共享更早的父期限；`release-readonly-retry.mjs:16–44` 包含 query、等待和落盘；生命周期/Backup/Restore 无只读重试声明。独立真实 EOF 校准及落盘过期负例通过 | 不把函数预算等同于可硬实时中断同步 OS 调用 |
| J02 页面不能覆盖引擎/身份 | `release-lifecycle-step.ps1:30–36,44–66` 先原引擎直接 exit0，再验证 manifest、整数 PID、release、全已启用域与维护/drain；`assertCompleteReadiness` 固定实际 12 域；未发现页面200覆盖原失败的分支 | 未向生产引擎注入故障；完整域的实际生产采用回读留给获批批次 |
| J03 服务树保护 | 原 PS 传输固定内核句柄、Cleanup Preserve/Direct；Node `runProcess` 的生命周期 preserve 与只读 direct 明确分开。独立 probe 超时后直接 root 已退出，模拟服务后代仍活并自行到期 | 普通测试短预算 tree 清理未确认限制由 A 保留；不据本次模拟证明所有 Windows 树清理零遗留 |
| J04 收尾状态阻断 | `executeBatch:269–317` started/unknown 拒绝重放；每动作前准入与 closeout 的新 Status 保留，失败不写 completed 或释放 active。D 日备份 owner 错误、结果落盘失败及原 exit9 元数据负例通过 | 没有依靠早期 ready 或 HTTP 状态替代完成 |
| J05 完整实际前驱 | `release-impact.mjs:246–305,337–378` 比完整 inventory/字节与独立闭包；`app/api`/受保护路径严格；admission `:133` 读取实际 predecessor snapshot。复验真实历史 5050 文件前后快照，实际四文件混合变化仍 strict | 该历史快照不代替当前生产前驱；最终候选必须另核全部未采用 main 差异 |
| J06 恢复资格 | `backupReuseDecision:316–335` 同时要求 26h 点、7d 同点演练、目录/权限/软件/角色/序列/保留与连续成功日备份；`collectRecoveryCurrent` 仍调用原 Verify、ReleaseEvidence 与 Status；owned 序列要求严格大于现存最大 ID | 标准日备份 native latest 不明，当前生产数据库快路径 **未获资格**；未调用生产 Backup/Restore 或修改调度 |
| J07 派生身份复用 | 准备 session 只在同批内存中有界复用派生身份，每轮完整源/Node/npm/config 字节重读、源前后盘点；10min/24次、并发/异常/失效/watch 与 WAL 前/调用前门禁保留。动态 Django/Worker/helper/恢复检查在外部持续执行；原 apply/Start 的制品门禁保持 | 不把不可变字节复用误称可复用动态权限或维护状态；生产现场真实性仍须最终采集 |
| J08 原失败与历史未知 | journal 为 create-only 链；unknown 必须精确独立协调、noReplay，失败重试要零效果；历史行保全工具固定 scope/cutoff/HMAC 且原独立来源回执字节必需，合法重导不豁免 annotation/migration generation | 旧 3299/3302 聚合计数仍无法重建旧行基线，未伪造旧正常成功 |
| J09 报告与计时 | closeout report 保留 failed/unknown/协调及 `acceptancePassed=null`；父重试不再累加；按原结束区间裁剪取并集，文档收尾另记。UI 审计保留危险请求/网络失败，HTTPS favicon 精确分类还要求正常 HTTP 资源字节 | 本复审未实际跑新的浏览器验收或测生产不可用窗口；未叠加重叠节省或把切换跨度当停服 |
| J10 打包与保护闭包 | A helper 在 worker guard/bundled/keyFiles/adapter pin 与旧前驱首次新增 preflight 中可达；C preparation/timing/read-only/daily 模块在 runtime bundle/keyFiles/collector direct closure，TypeScript lib/package 与 D1 直接依赖 pin 保留；源码再算批次摘要不能替代旧批准 | 实际包、安装回读、精确前驱和最终批准范围仍须候选准备证明；本次只核源码与受限回归 |

## 独立实测与原失败保留

最终 `node --import tsx --test tests/release-integration-independent.test.ts`：**14/14 通过、0 失败、0 跳过，10.376 秒**。19 核心文件前后字节相同。日志 [independent-combined-final.log](evidence/independent-combined-final.log)，SHA `43ae58b15ece1405a26abb3b5f06d0cfd6d2b321ec04359e44ac9734312c5343`。

其中 11 个 daily 例完全注入 fake operator/lock，使用临时合成 schedule 与审计；包含共同期限、锁后暂停、较新锁失败、late marker、不重放、owner 错、exit9 脱敏、结果落盘失败和“wrapper 成功不能证明 native latest”。它们没有调用真实日备份。

三个进程/重试例由独立复审者创建有界 PS5/Node 子进程，未借用正式服务：

| 独立样本 | 最终实测 | 结果 |
| --- | --- | --- |
| PS5 原生后代保持双流的校准 | 直接 exit 303.139ms，EOF 2549.619ms，相差约2246.480ms | 真正建立继承 EOF 假设 |
| 同夹具文件协议 preserve | 299ms 返回 exit0/completed；后代在直接完成时仍活，之后自行到期 | 不等后代 EOF；不杀后代 |
| 只读根挂起、短寿命后代模拟服务 | 1100ms 原预算，约1072ms失败；root 已退出、后代仍活，之后自行到期 | 只清直接 probe；没有 tree kill |
| 只读 query 900ms + attempt 落盘后1001ms | 共同预算1000ms；调用一次、保留一次 attempt、拒绝成功 | 不在落盘后重置期限 |

上表是机制样本，不是生产启动分钟数或停服目标。初版第二个进程样本只验证 root 退出，随后补 PID 文件观测独立后代存活并重跑，原日志分别保留；最终只引用补强后的结果。

D 首轮作者联合入口中的 watcher 负例原失败保留 [joint-entrypoints.log](evidence/joint-entrypoints.log)。本复审使用透明 `fs.watch` preload，未改变实现与断言：原 case 单独 **1/1** 通过；同文件上下文 **23/23** 通过。事件日志中初 collect 没有观察到变化；`unrelated.txt` 正确忽略，缺失父路径 `absent` 创建正确使 recheck 失效。证据：[单例](evidence/independent-watcher-diagnostic-1.log)，SHA `0d33244353cb5615fa6cfc614baedabff8659118a486c06f876271904b1962fe`；[同文件上下文](evidence/independent-watcher-context.log)，SHA `759a67a7f89a49f71b2bb460a28b4d0369163afecf987396654fbe32bbc3fefd`。

首次失败当时没有 watcher 事件，**根因仍未知**；当前原断言通过不能反推首轮通过，也不能归因为资源争用或宣称已永久修复。没有放宽时间、变化失效或业务断言。

## 未覆盖与发布约束

- 本复审没有运行重型全量、构建、数据库恢复演练、真实生命周期切换、自然守护或业务验收；这些由 D 主任务错峰串行执行并独立标注范围。轻量样本不能证明生产规模达到 30–60/80–120 分钟预算。
- 无真实 `.dev.vars`、credentials、user/global npmrc 内容读取；无生产 collector/Backup/Restore/启停/部署/调度改写/业务写入/外部发送。仅历史 immutable source-snapshot 在原分类测试中作只读全文件比较。
- 标准 collector 的 native latest 未证明持续阻断 C 数据库快路径。可信 native 最后尝试、日备份实际采用、仍保留同点完整恢复与序列/cleanup 证据需后续具体授权和验证；不能只改 ACTIVE 或以手工备份解除阻断。
- A+B 默认第一批，C 默认第二批；机制首次采用自身严格。两批或合并替代均须绑定各自实际前驱、源码/制品/测试/回滚和精确维护范围；第一批已采用后，旧第二批计划失效需重做。
- 四类状态必须分别填写：本报告建立源码复审与有限隔离验证；没有建立生产候选资格、实际采用或最终批准。主线其他未采用功能不得顺带进入候选。
- 本次“开始集成验收”不是生产批准。用户仍须对最终精确候选另行明确批准。
