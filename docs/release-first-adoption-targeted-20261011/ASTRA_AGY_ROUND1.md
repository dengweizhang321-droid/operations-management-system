# Astra 对真实 AGY 首轮设计审查的事实回复

依据新 E 的 AGY_ROUND1_STREAM.ndjson 最终 result.response，仅作源码与现有测试对应；不新增生产执行、独立签名或代码变更。三核心仍为7d611补丁冻结。

| 审查点 | 实际事实／处理 |
| --- | --- |
| 历史大树规划成本 | 接受成本风险。原 release-payload-retention.mjs:51–101 完整解析链、检查 retained keyFiles、对仍存在的可清理旧载荷 hashTree；新步骤在维护内，会增加 CPU/I/O 与停机跨度。没有生产配对时长，不能承诺“几分钟”或短停机，也不删树校验换速度。共用 deadline 与16MiB输出边界保留。 |
| “planner 未调用 rotation，未由新 D 读新 W” | 此断言与源码不符：同目录 .mjs 第4/5行直接导入 worker-local-release-rotation/worker-local-release；:52 调用 resolveEffectiveReleaseChain({verifyInstalledHead:true})，:54 调用 verifyWorkerRelease，:101 再解析新链。固定执行路径是已安装 Django app/tools，故确实使用新 D 两工具读取新 W 的 sourceBinding 清单／历史链。新执行器同时核 D 清单和四模块哈希、精确新 head/chain。 |
| 规划通过是否等于删除／运行通信通过 | 不等于。该步骤不调用 -Execute、不删除载荷、不验证删除锁争用或权限变化，不证明运行中的 Django↔Worker 业务通信；其范围只是已安装解析器的真实规划消费兼容。后续 Start、startup/components/原任务验收仍是必需步骤，不能用 planner 替代。 |
| 动态 Backup receipt 与静态 batch 是否断层 | 既有引擎原生支持 `{receipt:<id>:backupDirectory}` / manifestSha256。verifyBatch 要求引用本批此前唯一 Backup；runApprovedOperation:554 只从最新 passed 操作 outputs 展开，经原 Unicode 参数编码执行。:612–615 再核 manifest、dump、expected/restored content；v4另核backupId。不是执行中重写封存参数或接受历史目录。 |
| 重算摘要的危险反例 | 新测试 release-first-adoption-targeted.test.mjs:48–68 覆盖策略降级、DB列表／协议修改、删减／增加／重排、旧/prepared operator与其他backup、caller command/stub及库存重算。:87–95 原消费者执行函数核badHead/badShape/badArray/badBytes/chainDrift/unconfirmed；:118–129原operation函数核same-point展开与8类错误回执、缺consumer。31项只是隔离原函数/低层native seam，不能签生产。 |
| 旧点与新工具兼容 | 原 maintenance:1181 只有 RequireCurrentDeployment 才比当前部署／配置摘要；Restore:1698 不传该开关。原 PG/service/evidence/依赖字节在双清单闭包内保持，D85cf两个新解析工具本次不改；新真实演练仍必须实际执行。 |
| 端口、空间、清理 | 原 RehearsalPort ValidateRange 为55432–55999；:1709已有监听即拒绝、不接管；新12hex目录存在即拒绝；:1714确有dump.sizeBytes×32+2GB容量要求，continuity:34使用free < required才拒绝，因此是至少该值而非严格大于。原数据目录与监听归属、清理结果保持，失败留人工回查。此前怀疑该容量公式为AGY虚构不成立，现依实际源码纠正。 |
| “生产零连接”／keepPostgres=true | productionDatabaseTouched=false是原隔离恢复的生产库未修改承诺，不应扩大成整个批次生产5432零连接：发布前全库Backup本来读取生产库，门禁也有部署／端口／状态核验。原维护许可要求keepPostgres双方布尔且一致，不是代码无条件要求true。具体scope可选择KeepPostgres，不改原语义。 |
| 旧65fc参数缺陷 | 主任务发现旧未执行sealer给maintenance传不存在的-Json并漏必需12hex RehearsalId。三核心不要求／注入-Json；真实原脚本继续强制ID。旧spec保留，新sealer修参数并机械核原PS AST。低层JSON seam的稀疏fixture不是可运行生产计划。 |

active absent 指批次所有权文件不存在，不是“没有运行的生产进程”。原AB仍为已批准闭合，旧unknown/false不回写。新候选、现场准入、实际消费者与演练的成功均仍须各自绑定精确对象；模型审查无生产批准权。
