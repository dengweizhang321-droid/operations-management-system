# 本次规则与普通功能短流程

| 类别 | 旧规则 | 最终规则 |
| --- | --- | --- |
| 机器支持且完整证据证明无业务数据及部署副作用的展示功能 | full/reuse；复用资格不足退回两Backup＋两Restore | v3封存not-required，数据库操作列表为空；源码／制品全字节、路径／硬链接／重解析、身份／权限／ready、原Worker排空与切换、功能验收和收尾全部保留。 |
| 经审查确实只读、但未进入机器支持边界的后端查询／权限功能 | 完整保护 | 继续严格/full，列缺口。GET、Django摘要不变、前端目录或手写布尔不授资格；权限与生命周期分别加强相应验证。 |
| 写逻辑变化、结构兼容 | 完整保护 | 首轮暂保原严格流程；后续按具体写风险选择恢复点／前备份，隔离写入与旧版兼容检查单独设计，不一次自动化所有类别。 |
| 迁移、批量修正、存储、备份或恢复工具机制变化 | 完整保护 | 本次影响专案；未知类别保留full并说明原因。 |
| 本轮精确十工具首次采用 | 原65fc未批准20步骤／四DB | 新v4严格分类与限定迁移闭包，19操作：一次原发布前Backup、一次切换新工具后的同点隔离Restore，额外固定只读新消费链规划；无发布后Backup／Restore。并非借尚未采用的not-required结论自动免保护。 |

首轮实际常用支持边界是同结构CSS展示值与符合被动字面量边界的静态TSX。必须以实际生产前驱到最终候选完整差异、请求和副作用／启动及部署输入、迁移／写入／导入／存储／依赖、精确源码和制品的验证及独立复审闭合。没有第二功能或合批组仍可单独发布；合批不是此规则的前提。

“无数据影响”描述本次代码与部署动作对持久业务数据的影响，不要求业务数据库停止自然变化，不建设全系统行级归因账本。隔离Restore的同点内容／权限／序列相等是恢复忠实性验证，不是发布前后生产全库相等。正常导入的自然数据变化不被自动归因于发布。

## 本轮首次保护及切换

封存顺序：prepare → 原installed Backup → EnterMaintenance/KeepPostgres → StopWorker → W apply → 原previous目录引用与完整保全核验 → D DeployApp → HardenAcl → 新installed固定无参数只读planner → 原installed同Backup收据RestoreRehearsal → ExitMaintenance → StartWorker双清单 → 显示／权限／业务闭包／原Startup和AggregateStatus／自然watchdog → 最后Startup收尾。

Restore使用本批唯一passed Backup的真实目录、manifest、dump、content和backupId；禁止历史点、prepared／旧operator或重算摘要删减／降级。独立12hex ID、55433/E原隔离端口／目录，原容量dump×32＋2GB、profile／sequence／cleanup／productionDatabaseTouched=false／serviceStateChanged=false保留。两个原DB操作的声明预算各1800000ms，原cap不改；超时或未知保持原owner／维护／排空／WAL，不自动重放、删步骤或恢复数据库。

只读planner从新installed D的原两个兼容消费者读取新W/sourceBinding历史，核新head/chain及工具字节；不执行删除，不替代启动／权限／业务通信验收，其历史树I/O计入维护跨度，不承诺秒级或净分钟。正式切换仍需精确新范围批准，原旧批准和WAL不得中途减免或换绑。

## 配置合同与独立恢复治理

唯一原固定workerDevVarsSource支持协议既定共享硬链接；其余源码／证据／npm配置仍按原single-link规则。证据会话只对精确固定配置change先pending，再同步全字节、祖先物理路径、dev／ino／nlink／size／mtime／ctime与不更新基准相等才清pending；访问时间不作为构建输入。普通source/npm/unknown/rename仍拒绝，完整制品三元组共享身份门禁不改，不用TTL接受新字节。

日常备份继续原周期／三份／保护规则。建议恢复演练独立每月使用最新已验证恢复点，重大PG、存储、备份及恢复机制变化额外触发；暂预留60分钟机器窗口＋30分钟人工核查，属于规划假设，待实测修订。当前调度健康与任何异常单独呈现处理路径，不把普通功能变成补跑完整演练。本任务不启用调度、不新建重复调度、不做新生产备份／演练或业务写入。
