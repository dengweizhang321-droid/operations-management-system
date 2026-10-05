# 商品经营总览速度试点：本次批准的生产采用

用户在具体候选交付后明确“上线受控应用维护”，本轮仅授权Django Prepared `cb6bbad9cb024baca54048b07bcb410f` / receipt `ba858d4d4906c30d0e765296e70869fb98ecf75e097cafe28fa164780680b203` 和Worker计划 `b3342808d4057947e72a22a8b324c047e9409ee13e3f60ddc65ee295a372c398` / release `20261005T063949Z-62c5bbb1bc2901ab` / manifest `d2b5d5b68afdc7349f5486539db0d4c628b233912fe9fa90d3150261ad18f9f3`，以及一次原KeepPostgres应用维护。旧e960未采用候选不是本次批准目标。不新增迁移、回填、权限/预算扩展、业务补跑、n8n定义或重启。

源码核心44ef、采用前文档main e933；Worker固定来源b767，app/lib683文件与受测源码完全一致，原helper/lifecycle保留。隔离开发与性能限制见 [试点交付](PRODUCT_OVERVIEW_SPEED_PILOT_20261005.md)。本次执行证据 `E:\codex-artifacts\product-overview-production-20261005`，成功动作均有直接控制器真实退出码；首轮拒绝与外壳采集错误单列保留。使用文件标准流，不因业务子进程持有输出流而杀服务。

## 开始与维护前验证

20:31原系统Status为Running/Ready/exact_release，12组件全部true；实际原Worker仍20261004T203845Z-d5c7953e916f69ec，Django仍E4。独立再次核候选收据/完整683与4源/前驱绑定通过。helper ready且busy=false，无activeWorkflow/storeExecutions/drain；原AI agent/workflow/space三个队列total0，备份console无非终态，n8n无非终态。

市场两历史running job均cloud paused、activeClaims0，原inference_result_unknown保留，不重启模型或视为已修复。正式PostgreSQL4080与n8n18800的PID及UTC创建时间已记录；不沿用旧文档中的历史PID。

只读本机API先确认sales/Django PostgreSQL单写、数据截止2026-10-04/throughYesterday=true；MCP不可用，采用用户指定本机只读来源。固定9月1—30/全平台全店/50条/净额降序的原full结果保存本地，仅商品聚合用于同范围等价核验，没有原始客户或订单数据。

## 前备份与当前阶段

原在线Backup直接控制器20:34:15–20:48:31 exit0，`daily-20261005T123515Z-3020fdbc5476`，已归档E并完成原保留收尾。manifest `a8afd039e5144876ecbe5c2477853ca5ca6af78bedf20b827c6a51c23bf09fc5`，dump `0397c6af53b26d66c47777d9f737c8207c57432381100d3fd10cd008f5a180c2`，content `0f4550afb6e56263104cba0957f4ee2ad1d59cbab64c7d07484a5d02cfa88519`。serviceStateChanged=false；原三份/两保护保持，淘汰旧10月5日010737恢复点，不能再引用其目录为现存备份。原releaseRetention成功清理8份旧载荷，不改变当前运行版本或链外候选。

Verify20:49:50–52 exit0，独立E55892/b284ddfb7908恢复20:49:52–21:00:51实控exit0。expected/restored content均0f4550、profileRestoreVerified=true、productionDatabaseTouched/serviceStateChanged=false、isolated_data_removed；原恢复与备份三文件/完整profile关联由非作者闭合。没有声称对已清理的私有库又执行第二次独立查询。

## 已进入维护并采用准确包

维护ID `0de74068f04c4d028c2890f4c3a0605f`。原EnterMaintenance21:05:32–21:07:59实控exit0，持久keepPostgres及drainedStopped=true。21:01三AI队列0、backupconsole无非终态、市场原paused/claims0再验，helper仍idle。仅应用停止，PG4080/n8n18800的PID/完整UTC创建时间保持。作者首轮PS自动日期转换误判false的结果保留，使用DateKind String及精确ticks重新比对true，非作者独立复核也true；不是服务重启。

原DeployApp cb6/ba858于21:09:40实控exit0，installed manifest `426b1ab97341774a0b68656897af10d6131979b7899e52bf64884255e82ab49e`、fingerprint f007。四业务源逐SHA与受审44ef完全一致；全部149迁移定义/100工具配置与原E4相同，app.previous E4保留。Harden21:11:26实控exit0，原限制ACL已满足无需改权限。未Install或新增迁移/回填。

Worker b334 apply于21:15:44实控exit0 activated，release20261005T063949Z-62c5bbb1bc2901ab / manifestd2b5；successor `315d3e389d15c539d0dd2ff52c6454a3cb136d25800e797d9e4953c870960413`、consumption `976850d28db8f3af743f345950093ed36e7bba875b739967b9c8f33a933a1207`、startupBinding `de951c085597e199dbda18ef13eb344c4a3c0c6e6808ca01345dc5d7fa675464`。没有再运行旧e960或新build。

后Backup21:21:56实控exit0，`daily-20261005T131344Z-42ab890f658c`，manifest `740b8e817223cd2e55fc028c1aca449b07b458d83d03bf7548483284fabac47c`、dump `337b6383d6e3d510ec5792f2de4371847a7588ce34ba097a41ba8a5cdff7becd`、content `31a4e387ff436bbfd41870160a990a01ad6990bad5ae48b9565a8e703df237bf`。Verify21:23:04实控exit0，后完整manifest/sidecar另存执行证据；该时点私有E55893恢复在途、尚未Exit/Start，后续完成结果见下文。

**全库前后比较未闭合。** 在线前备份与维护后备份content不同。前备份已被原三份/两保护策略淘汰，作者未在此之前保全完整逐表manifest；非作者仅保全完整校验结论和总摘要，不能再定位295表/49roles的全部变化。保留此证据缺口，不把未知变化认作自然写入或本次修改，不宣称全库严格相等；前备份目录不是现存恢复点。前原服务直到21:05仍活跃，本次Deploy/apply的4PY/5前端为读取/UI代码，149迁移定义及100工具配置保持，无Install、回填或业务写入命令，PG/n8n身份保持。非作者认为此缺口本身不要求继续停服或回滚数据：以后备份完整校验及独立恢复通过为恢复前置，并继续真实同范围full等价核验。不得恢复旧数据库制造相等。今后类似维护须在原淘汰前保全完整元数据。

后RestoreRehearsal21:23:04–21:33:00，直接控制器33764 exit0；原audit `ffe5a5c82f32445fb2848f9a7cc36b9c` / E55893 / `420b16b94785` completed。expected/restored均31a4，profile e559、profileRestoreVerified=true；productionDatabaseTouched/serviceStateChanged=false，isolated_data_removed。非作者独立核三文件/139迁移/295表49roles/终态/端口及原PG/n8n身份通过，仅判应用恢复前置PASS，不冒全库前后相等。

## 恢复过程及失败保留

首轮ExitMaintenance的原Django控制器因生命周期锁占用拒绝，维护marker保持；随后Start亦因maintenance active拒绝，没有启动效果。采集外壳29084/45120自身返回0，但stderr清楚显示失败；这两个零值不作为原操作成功。作者修正外壳传递LASTEXITCODE，原失败记录不覆盖。锁占用来源未确定；未清锁、强杀服务或扩大超时。

原Exit重试35440于21:38:39实际exit0、stdout maintenance_ended及marker不存在；原Start重试15472于21:38:49–21:42:54实控exit0/stdout started，准确d2b版本。本次首轮被拒绝不等于两次成功启动，不重放已成功操作。

## 实际生产已采用与限定验收

21:43:50原Status实测Running/Ready/exact_release，全部12组件true；VerifyStartup实控exit0/verified，启动绑定新d2b。17个实际首页assets全部HTTP200、逐字节与当前release/dist/client相同。PG4080/n8n18800的完整UTC创建身份保持；helper ready/idle、无drain；原钉钉stdout被动connected，未发送测试消息。原自然看门狗受保护路径补齐Django supervisor8764，healthy/all_components_ready；Root未单独手工补启动Django supervisor、未手工Run看门狗或绕过守护；应用Start按本次批准的唯一入口执行。

两次已完成自然看门狗分别21:47:24、21:49:24：TaskState=Ready、LastTaskResult=0，完成写入分别21:47:55/21:49:58，fresh新d2b/healthy/supervisorHealthy/12true。启动期间的不健康、identity_failed和正在运行267009／2147946720样本保留，不冒健康终态。E原三份/两保护通过，后备份仍在，前目录已淘汰；Postgres维护操作未决0。

固定正式9月1—30/全平台全店/无筛选/page1/50/净额降序，与改造前完整full对象独立语义深比较相等：全集合汇总、毛利分布、总数1290、筛选项、时间见证、第一页50行全部字段及snapshot c51c完全一致。不冒1290条每一行、其他范围或全库数据相等。作者3轮真实严格解码及快照复用成功，毛利测算切页和规格sales/summary真实200、浏览器pageerror0。隔离异常组合／权限／版本测试及构建沿用受审44ef源码的试点材料，不在正式环境注入故障。

## 正式性能与可视证据

本机实际采用后、固定上述9月范围，3轮API样本。首个启动后测量没有人为清缓存，服务端没有显式cache-hit标识；后续立即复用同范围。只记录有限样本，不称P95。原before完整页面约7508ms发生在独立恢复IO期间、与after负载和缓存不配对，不能拿来推导稳定生产提速倍数；配对隔离前后对照见试点文档。

| 实际场景 | 首批／接口完成 | 必要内容完成 | 条件与限制 |
| --- | ---: | ---: | --- |
| 启动后首次API测量 | 2361ms | 2440ms（分布再79ms） | 仍超过1—2秒目标，不用暖数据代替 |
| 立即重复同范围API | 39／49ms | 87／81ms | 两个重复样本，公共结果可复用 |
| 翻页API | 54／36／40ms | 同左 | 仅列表，50条、同snapshot |
| 排序API | 36／40／39ms | 同左 | 完整集合毛利排序，第一页 |
| 完整URL导航浏览器 | 框架468ms／真实明细564ms | 649ms | API已暖；此早期样本按DOM提交计时 |
| 主导航点击（追加绘制观察） | 框架99ms／明细1031ms | 1051ms | 同范围曾预热但TTL可能过期，非保证命中；首轮页面代码加载 |
| 主导航两次回访 | 框架84／62ms，明细227／211ms | 238／221ms | 上轮范围刚成功，可复用；无人为延迟 |

最后三次浏览器观察先记录真实DOM条件，再经过两次requestAnimationFrame；是绘制机会而非精确GPU时间。原始trace `product-click-painted-progress.zip` 与 `product-click-painted-measurement.json` 保全。原始帧实际wall-clock绑定点击：约298ms框架、1054ms明细已可用且分布仍加载；完成后的真实截图另存。未用网络mock、永久挂载、无界预取或新增等待制造阶段。

本地时间轴 `E:\codex-artifacts\product-overview-production-20261005\production-report.html`，图片为本机正式9月数据；与原120商品/3600销售的合成隔离lab不同。正式入口 `http://127.0.0.1:3000/?module=product&view=overview&period=custom&from=2026-09-01&to=2026-09-30`。原3138此时不可连接；新增只读HTTP预览服务启动被自动审批以“blocked by policy”拒绝，未换途径启动，改交付本地HTML/截图并打开正式只读页面。这个拒绝不影响正式业务。

## 独立结论与后续边界

非作者最终 `PASS_WITH_DISCLOSED_EVIDENCE_GAP`：准确包采用／原恢复控制器／启动绑定／12Ready／17真实字节资产／固定完整full独立深比较／两自然健康／原进程与E3两保护均通过；明确保留无法补齐的全库比较缺口。`final-production-review.json` SHA `9b250baee53a5f3ae38558f493d039c534b88bff155b934227d440aec785a3fa`，另存E证据。不把缺口清零，也不改数据制造相等。

源码完成、隔离验证通过、上述两准确候选生产已采用分别成立；暖范围收益与分区反馈实际成立，冷范围／新日期／并发P95仍不能宣称全面达标，生命周期锁竞争底层原因未确定。未推广全站，无新增迁移、回填、扩权、业务补跑或n8n定义／重启。

如需回退，先取得对应的新维护授权，按原生效链准备兼容的前驱业务源码回退候选，并走原Worker rotation与Django RollbackApp门禁；不直接改current／guard或重放本次旧plan。代码无新增schema，不能因性能回退擅自恢复旧数据库。当前app.previous E4及原Worker前驱保留，后E备份已实际恢复验证。

开发／候选来源树仍被当前部署来源引用，本轮暂保留codex分支/worktree，不为清理破坏来源或证据。本次许可不授予未来维护、任意范围补跑或继续全站推广。
