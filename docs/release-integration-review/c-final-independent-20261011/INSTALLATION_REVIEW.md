# V4 跨组件安装与旧包保护独立审查

当前 V4 **存在一个旧包引用未知值阻断 IG04，不能据本审查采用**。其余下列安装与兼容性静态绑定核对通过。审查只覆盖开发交付 `030024542ef76be081f69023fefb0601dd4d06b5`、batch `65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2`、guard `04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd`；V4 已封存而未获批准。用户最新“一次前备份＋针对新工具链隔离演练”由主任务交接，新策略正在开发，本报告不为未来代码或批次签名。

实际只读重算外部 JSON raw SHA `340e88afaa2dc3eb670f09a229442b5c42e153e3fa41a967403ab32a27822675`，纯 canonical batch／collector、SourceBinding、计划与 W3032 manifest58cc、D1e11 receipt10db／manifest85cf一致。31 个小文件记录见 [INSTALLATION_AUDIT.json](INSTALLATION_AUDIT.json)（SHA `48b73287643dec04b257a1326032b4574030a11eb0bb50541ead806d7d633d8e`）；完整结论见[机器报告](INSTALLATION_REVIEW.json)。未重新扫描完整 source、制品、依赖或旧包树。

| 项目 | 实际核对 |
| --- | --- |
| 新 W → 新 D | 20 步中 apply6 → previous guard7 → DeployApp8 → HardenAcl9 → ExitMaintenance10 → 双 manifest Start11；过渡段没有 Backup／Restore／retention。完整执行仍非双包原子事务。 |
| 消费工具闭包 | 维护／Stop 固定旧 Worker；切换后固定新 Worker。Django 操作的 app/tools pins 按部署前后库存切换。2933→2933 的声明差异恰为两个工具＋特定 CF 缓存，两新工具与 W3032 逐字节一致并匹配 keyFiles。 |
| Backup／prepared 模式 | V4 四 DB 步均从 installed app/tools/django-postgres-maintenance.ps1 调用。该文件2167–2194仅允许 prepared Verify／RestoreRehearsal，绑定精确 receipt，仍导入 installed app service library；不能把 prepared Backup 当受支持入口。后 Backup 的清理消费新 app 中的两个兼容 resolver。这里只核路径与源码，未执行恢复演练。 |
| 回退 | 旧 installed resolver765–769的 exact keys拒绝 sourceBinding；新 resolver772–783支持并验证其字段。回退必须准备兼容新历史的新 successor和配套控制工具，不能直接装旧 resolver、删除历史、借旧批准或自动恢复数据库。尚无真实回退演练。 |
| app.previous | 原／私有保全副本 deployment.json相同121d805f；3468文件／fa434f8e是原保全声明，本次未重算全树。guard将原包和保全树复验、引用检查、WAL末核置于 DeployApp前，保全记录与guard已pin。原DeployApp2130实际会删除旧app.previous，所以未知引用不能视为空引用。 |

**IG04（P1）：有关解释器命令行缺失时，V4 引用审计可通过。** [guard:113](../../release-no-data-adoption-20261011/adapters/adoption-scope-guard-v4.mjs#L113)只检查顶层数组；114行对每个CommandLine／ExecutablePath调用检查，而71行把null视为无引用。合成powershell.exe的CommandLine=null、ExecutablePath为系统host时，真实V4函数与循环返回references=[]，最后116行也可通过，无法排除其读取旧app.previous。最小[私有VM反例](guard-null-process-counterexample.test.mjs)保留[原失败日志](guard-null-process-counterexample.log)：0/1、118.4421ms、Missing expected rejection；这证明守卫接缝，未证明实际生产有该引用。

修复须采集足够的固定进程身份来界定有关解释器／受管进程，必要CommandLine／ExecutablePath缺失则记录unknown并阻断DeployApp；不能把null作为无引用。对可证明无关的系统项保持窄范围处理，补缺字段负例并复审新的guard／scope字节。当前16项作者VM全部原日志与来源SHA已核，203.3251ms、16/16；它们覆盖跨盘短名／长junction／空格／最近真实祖先／未知盘符／EACCES，**没有覆盖本反例**，未重复运行。

支持范围仍是盘符限定实际路径／命令token，不支持UNC、relative/env/encoded、任意脚本解析或全系统handles证明。旧1160 metadata／818 process／215 task只读快照不是新的动作前准入，也不能消除IG04。新用户策略须在新字节、新精确恢复点／工具闭包与新批次上复审；V4仍有前后Backup／Restore四步，不能原地借其批准或签名减免。

本轮只写本目录审查与私有VM证据，没有生产CLI、Status、HTTP、SQL、任务／进程枚举、锁、备份、维护、部署、删除、源码修改或外发。Git收尾由主任务统一处理，旧报告与封存对象保持原字节。
