# GPT-6 Astra：第9轮意见、过渡状态与回退边界

2026-10-11。只读复核真实AGY_ROUND9及原producer、collector、guard安装、Django部署代码。本回复不改冻结补丁47d73，不执行生产动作，也不把静态分析当现场验收。

## 保留分歧

- **不采用sidecar.trim建议**：原publishCanonicalWithSidecar明确写入并回读`hash + "\n"`精确字节。外部工具改成CRLF属于生产者证据变化，拒绝正确；不能放宽来接受并非原生产者生成的侧文件。
- **不采用静态禁止所有`~`**：合法目录名也可含该字符。纯schema解析不是物理准入许可；实际入口仍需原逐级lstat/realpath与双向根隔离。短别名全面对抗覆盖未完成应明示，不能用字符启发式代替物理检查。
- DAG实际为 **Envelope → Manifest → Plan → Receipt → Batch**，不是原文的Receipt再到Manifest。
- 四DB阶段和两个包不是“一次性原子生效”。原保护入口逐文件fence/CAS/rename并回读，随后追加successor；Django包再由原DeployApp更换。中间状态必须封存、验证并在失败时保留。
- “大面积溃决”“严密完备”等超出证据。已确认的是旧installed Django retention/verifier不兼容新plan/source字段及精确verifier字节；必须处理该具体消费者，不据此外推所有服务故障。

## 本次首次采用应封存的顺序

前Backup/Restore → 原完整维护/排空并确认相关应用已停 → **Worker apply → 仅工具更新的Django DeployApp** → 原HardenAcl/维护退出/Start及验收 → 后Backup/Restore/收尾。真实适用的每项动作、包/计划SHA、owner和验收必须列入后续精确批准范围。没有生产批准，日常备份PAUSED也不改变。

| 已确认状态 | collector应绑定 | 允许边界 |
| --- | --- | --- |
| apply前：旧Worker/旧Django | 两项predecessor | 原前备份/恢复在既有工具一致状态完成 |
| apply已passed、DeployApp未passed：新Worker/旧Django | Worker candidate + Django predecessor | 保持完整维护、排空及owner，只做精确过渡复验和Django工具部署；不安排Backup/retention或应用启动 |
| apply、DeployApp均passed：新Worker/新Django | 两项candidate | 完成原ACL/启动/验收后，才进入后备份/恢复及收尾 |
| 旧Worker/新Django | 本次不安排 | 新Django直接调用的verifier包含candidate key-files和自字节约束，不能拿它校验旧Worker；不能把倒序部署当无差别替代 |

代码依据：collector分别由已确认`worker-apply`和`django-deploy`的WAL passed状态选择两项身份；中间新W/旧D可明确表示，不需要假造相同Django manifest。原DeployApp检查维护/应用停止、prepared收据及精确前驱，再验证应用树。现有通用verifyBatch只强制EnterMaintenance < apply < ExitMaintenance < Start，并未独立规定apply < DjangoDeploy；因此上述局部顺序与过渡期间无Backup/retention必须在**实际封存操作表及其复核**中明确检查，不能归功于不存在的通用排序断言。

任一动作unknown时，即使文件看起来已切换，collector仍按最后确认状态拒绝不一致；先保留维护/owner并对精确原操作做独立只读协调。不得根据manifest单值手改WAL或重新执行未知动作。

## 回退

在新sourceBinding plan已经进入不可变发布历史后，旧resolver仍无法读取该历史；直接重启原AB包或用RollbackApp恢复旧Django工具并不能恢复完整兼容性。不得删除新successor/plan或回写旧WAL来让旧解析器通过。

最安全的故障状态是保持原维护/排空与owner、保全真实结果。后续应先完成精确已批准过渡的可证明收口，或另备明确批准的兼容前向修复/回退候选：需要恢复旧业务行为时，保留能读取现有sourceBinding历史的控制/解析工具及相匹配的Django工具，按原引擎产生新的后继记录并验证。这是“旧业务行为＋兼容控制工具”的新候选，不是直接恢复旧AB字节。数据恢复仍是另外的精确点/目标批准，不与代码回退混淆。

## 准备输出的额外协调更正

主代理一度在producer尚运行时读取到空stdout，并据此推断提前退出；之后正常完成并出现正式planned JSON。实际helper解锁使用child.once(close)，没有所怀疑的unref轮询；原构建在隔离staging/build中安装依赖，sourceRoot缺node_modules并非失败证据。本代理只读检查、未进行修复或私有复现，代码未改。该次过早判断保留为协调纠正，不能写成已证实的引擎故障。正式成功仍需主代理回读实际plan/sidecar/receipt/候选全部绑定，不能仅凭exit0。
