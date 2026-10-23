# 首批明确选择 fresh、不复用会话的入口

当前入口仅为 adapters/fresh-adoption-entry-v2.mjs，对应 E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs，SHA `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`。旧8bf入口因ENTRY03路径字面量把\t解为TAB而停用，E原件与原handoff保持，repo仅在adapters/history中存档。

固定候选21c2/manifest6cff/plan0af不改。入口先仅用Node内置模块检查scope/batch/tests/self的单向SHA绑定、固定manifest与全部keyFiles、已知导入闭包、TypeScript解析配置、完整node_modules原path/length/content树和末尾每文件／目录身份及成员，再复验pins，最后才import候选原API。初稿先import再检查的NRT-ENTRY01成立，原稿保留，不能作为最终版本。

新tests.evidence含唯一 `{kind:"first-adoption-execution",mode:"fresh-no-reuse-v1",path:<绝对入口>,sha256:<入口SHA>}`；入口不硬编码自己的SHA、testsSHA或batchSHA。保留collector原in-process transport和精确closure，禁止通过删transport切换。预算使用与原runner相同的readOnlyRetry.totalTimeoutMs优先级和1800000上限。

显式命令为 `node <固定v2入口> qualify <新spec> <新scopeSHA>`，或在人类批准后 `node <固定v2入口> execute <新spec> <新scopeSHA> <真实明确批准ISO UTC>`。qualify调用原collector的admission分支，不调用executeBatch、不预先Backup或占有active；原collector可能初始化空批次目录，失败证据可写_observations。execute沿用原executeBatch/runApprovedOperation；每个边界内部完整source/toolchain/config前后复核和原artifact/ACL/process/drain/CAS保留，不创建session，不使用缓存observer override。

此选择不等于全系统连续排他验证，也不能称“更严格”或生产已通过。默认cached CLI仍保留且未被本入口的验收证明；原CLI本身不会强制执行这条外部entry声明。用户精确批准的操作范围必须明确指定新入口argv，不主张新增通用引擎强制模式。

最后动态采样后只作轻量self/spec/tests检查，并再次核5秒、非负新鲜度。返回后的stale记录保留stage/attempt/statusObservation；存证失败附saveFailure代码而不覆盖原stale错误。原executeBatch已在beforeOperation前保存采集的stages/attempts，不能称此前该位置全部丢证据。CLI终端catch仍只输出message；需保留原输出，或由主任务调用export捕获typed qualification错误，不冒称已测试CLI全部失败序列。

最终轻量26/26（10真实小树bootstrap＋13原engine受控＋3实际路径字面量/原spec测试），11.941秒。bootstrap测试使用私有小目录及真实模块导入，engine使用固定候选原verifyBatch/validateNoDataCollector/executeBatch，控制live collector/native动作与bootstrap结果；并非实际生产PG或全树qualification。首fixture读dev工具字节被原候选校验拒绝，正确重绑候选路径后通过；原始日志保留。旧缓存路径1个missing-parent用例仍未闭合，不宣称215全绿，不借214必要profile证明缓存可用。

ASTRA_FRESH_ENTRY_HANDOFF_V2.json SHA `eb49809771d041d33467750b7c99ac0fb31bda1ab08606e1a65040f73b65d33d`。真实新scope封存、完整readonly qualify、独立AGY及Git由主任务接续。197个未知进程引用仍是独立生产阻断，qualify通过不授予维护、切换或Backup授权。
