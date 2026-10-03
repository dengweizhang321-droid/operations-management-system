# Presence139 已采用；真实页面独立验收进行中

用户在候选交付后明确回复“批准”，包含本次138→139迁移、五派生字段cache-only回填及追加维护。原不删除业务记录、不强清槽、不补跑下载导入、不扩权/预算、不新建密钥或调用付费模型的边界保持。本页记录进行中事实，不把安装或回填阶段当最终业务恢复。

实际证据目录：E:\codex-artifacts\netshop-scheme2-20261003\presence-production。

- 原唯一Worker KeepPostgres维护id `3b796c2d78f2480e85fc33283d7c23a7`，上海07:31:50进入并完整drain/appsStopped。PG20664/n8n16852及创建时间前后保全；未重启二者。
- 前备份 `daily-20261002T233512Z-4650b0189acd` / manifest `eaaa91a7a4b11d164ca55646b02b1304abfa4496013f16362be5b4bb927e6047`、dump `2e5d0192cd7e3120628ead62aab54bd4ee0afe9c6347b9985b1b9ce8a7ad52ae`、content `710ea62bee54f256eb60627916b0c77aa0e35628f3aef02c71805fcb05c61e95`，Verify成功。创建时间晚于本窗口维护标记；138/295表/49角色。
- 原独立恢复 `9b0f9d473a5d` / E / 55897实际07:48:46—07:57:25完成，内容与profile一致、生产未触、临时DATA已正常清理。旧02:12后备份0f0593已按原策略淘汰，不再当现存点。
- 原max3/pins2（9月28/29）不变。本次before三固定文件另create-only到私有 `private-pre138-safety-copy`，逐SHA/size完全一致；它是此次关键迁移安全材料的临时保全，不冒正式Protected名额或自动生产回滚许可。后续如需恢复仍须原Import/Verify和明确恢复许可，不为了轮转丢掉唯一前材料。

## 真实门禁拒绝与必要修复

原Plan第一次因PATH存在两个Git程序、应用解析拼成无效可执行路径拒绝，源实际clean，未生成op目录；仅本次进程PATH固定既有Git后原门禁通过，系统PATH不改。

旧候选76b7/1b447的Plan16c84成功，Deploy在任何切换/迁移前被拒：精简staging被送到full-source candidate inventory校验。修复仅控制器Deploy路径及PS用例：完整受保护op/source做candidate admission，实际staging继续deployment/manifest/复制验证，不弱化门禁。源码 `f9dccf048d76df4a8be135f71de361678b119994` 独立PS5/7各4正5负及额外1正6负通过、normalpush main及远端核验。原Plan16、旧包及失败保留，未覆盖或冒已采用。

新candidate `d14774de6ba8342cece1dc492cca3a1300e498e1599c07548203975bd2ce0107` 继承无变core/profile，精确更新controls与Q证据。实际Prepare `03817dc986f648f9aaed763b37838f49` / receipt `b51e09ce01b25a1dc6a0eee19e4e60fdec4d7ace633239bb017fa00cf825cb89` / manifest `6b1312c4387713b32a88d3393bb9993484898b916d9f75666790f7cde897056f` / fingerprint `3365c763dc69d003e8f8abc8daea404233a2f50a5328d1efe1ee9c4eebe76930` 绑定父76f，非作者包delta PASS。

新op `f839551d823b4eeba52e114fb9220b37` 原Plan、Deploy、HardenAcl、Install实际通过。正式唯一0004已提交；installed SHA `e5d45e1cdd7a4ee545f3c55de3c342c48f8ca3d3fa3e720f8b3398130500359f`、journal `b824f0e9d4d9fc9c459db9edbd65651e3e255b365a5ab7f30d93acd203568e42`、committedSteps1，模型预算/版本校验通过。应用仍停止，尚未Finalize或启动；不能再说生产仍138。

## 回填状态

第一writer执行首50批触5秒期限停止，原run `cache-writer-21af24d19df949288ead185e9f115892`只有intent/failed、无batch complete。随后原netshop_reader≤7秒/只读PK≤1000逐页覆盖全部1,999,139行：目标1,232,499、最小ID323987/最大2041333、五cache任一非NULL全表0；全局修订前后889/同digest且同before。非作者据原atomic+guard及完整metadata确认“无已提交缓存效果”，原失败不改、不称业务成功。

原选择计划为PK IndexScan，从0会经过32万无target前缀；未用ANALYZE，不冒测得P95或全部根因。新明确运行仅将初始after-id设323986，绑定完整扫描SHA `9192bd36f4f1828153197c29b4933e6c9ccaeaa1b652b585ab4a1120fb755f82`及live889；无target遗漏，原50/100、5秒批内、7秒SQL、2MiB、原global→行锁/CAS/修订guard保持。E driver `7bf21a1bc4adfe56d30eeb9fdf57960b70ab81a69f04bc17c9326e9bdca88eb5`与调用壳新pin经非作者增量复核，新目录执行，不自动重试旧意图。

新run实际完成：247段、24650原批次、scanned=changed=1232499、CAS miss/alreadyCurrent0、最后ID2041333、1823.172秒、exit0，原业务成功标志仍false。非作者逐50049个E原文件重算每个receipt/全局修订链，预期889→25539、完整digest e40e78b1867a14dba9e5a06d9b03bd1d4d9cbddb6c9946528b4816219209093b；该E审不冒数据库查询。

独立Q代码36e在Root原netshop_reader/固定原服务7秒/只读/PK≤500实执行，全表1,999,139原业务列SHA `54428a069153336b2a24fead9b789d56597e48b0478b1e60476d91795723907e` 与before完全相同，目标1,232,499、无效basis残余0、五tuple原SQL/实际cache三态差异全0；MATERIALIZED每批复用计算，不增加单SQL预算。最终result SHA `5ca88c62681fb246ca701f8be868bc06329b5a39402e74eecd28f8d4d2fd4076`，完整代码/受限E固定摘要块与原件保留，不存业务行或凭据。

上段安装阶段已结束。后备份、独立恢复和原Finalize均已成功，已ExitMaintenance/原Start恢复应用；以下是实际后续结果。

## 维护恢复与数据保护结果

后139备份 `daily-20261003T013934Z-3b127c662b68` / manifest `d867108593889b798637af032d1437bcf8fe7845644d12c37d036c43100586ef`、dump `200bdf0309b097897adc50f3033f1250d48d87be1cdc04e93cd0064f075c3585`、content `07793ef9dc80d4312cc852e1216bff39167a0121509bc2c1de05b834037fffce`，原Backup/Verify exit0。E独立恢复 `9aabe9418ee5` 实际09:52:48—10:01:31完成，内容/profile一致、生产数据库和服务未改，隔离DATA正常清理。原Finalize exit0，opf839 release verified。

前后295表完整比较：只有django_migrations、netshop_rows五cache字段和netshop_data_revisions改变；原netshop业务列全表摘要完全相同，其他292表行数/根摘要、49角色设置、34项权限/authority/范围/导入批次关键表均一致，私钥行0。修订25539及完整digest与24650步原回执重算一致。原三份/两保护规则未改：当前后139加9月28/29两保护点；before138由原轮转淘汰，完整三文件仍在上述私有安全副本，不把已淘汰目录冒现存恢复点。

原ExitMaintenance已返回maintenance_ended、维护/排空标记消失；原Start已返回started，Worker/helper仍 `20261001T164608Z-4dc26d0ae8921e88` / manifest `87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9`，Django采用6b/源码f9/139。10:09:28原系统Status全部12组件Ready/exact_release，原VerifyStartup verified。PG20664/n8n16852及创建时间与before逐项相同。原受保护Restore-WatchSupervisor入口复验后返回，原Status为running/healthy；不直接手工启动业务进程。Start外层采集管道仍尾挂，子Start已退出但外壳退出码尚未取得，另行审计，不冒完整外壳exit0。

10:19只读核验helper ready/空槽；原5413仍error且未删除。维护期京东原自然5600于10:00启动、10:11失败，原安全重试5603等待，未人工重放或取消。自然看门狗10:19/10:22两个完成轮次均task result0、healthy/四探针200；既有钉钉被动日志connected/错误流0字节。市场被动业务观测仍unknown/no_confirmed_failure，结构健康不冒其真实业务成功。

原Start PS子5460已经退出，尾挂的是本任务pwsh29100（creation10:04:06.294962）。独立元数据复核后，Root重验exe/creation/命令SHA、原子已退出和直接子仅conhost，使用单进程Process.Kill()只关闭准确外壳，未用树终止/服务Stop。Worker supervisor/helper/workerd/PG/n8n五进程创建身份逐项不变；外壳exec实际exit-1，原Start退出码不可得而非exit0。10:22:45再次原系统Status全部12Ready/exact_release。原件 `outer-shell-tail-closure.json` 与 `final-system-status.json` 保全。

实际原用户9月1—29日五栏、目录/六源、01旧入口及ERP仍在逐项独立验收。新01主请求200/9.2795秒、店铺detail200/2.2392秒已构成当前一次真实正例；其他栏目结果未出前不宣称全部恢复或稳定P95。

## 实际页面进展与新阻断

同一原用户Chrome、原9月1—29日范围：P商品SPU page1/size5为200/3.9602秒，A同店SKU为200/9.4288秒，C原previous/SPU/平台成交/source all为200/22.5285秒。实际表格均正常、无alerts，owning revision均25539:e40e78b1867a；这些是当前生产正例，不冒任意范围或稳定P95。

S同店同月SPU section=performance仍失败：403响应头21.100929秒，最终90.002977秒cancelled/ERR_ABORTED，CDP无完整body，不能把它记为21秒完整响应。页面清空旧范围数据并提示来源权限失效，六源/八章节尚未验收。财务reader10:29:00原被动日志为Forbidden /api/finance/consumers/query；正在核验财务专题持久身份与原签名本地管理员路径的兼容差异，不放宽权限、不造用户、不把推断冒实证根因。该项阻止“五栏目生产全部完成”。

当前首页HTML真实17个唯一/assets引用逐项HTTP200、长度及原bytes/SHA与准确Worker87包dist/client相同。没有沿用旧15条hashed URL或凑固定数量，原件 `current-assets-verification.json`。17静态资源通过不替代全景业务验收。

目录同原范围200/0.9134秒，实际5行目录及当前快照/映射未核验标签保留。财务兼容缺口静态证明：原F/sales的exact reserved本地管理员在HMAC校验后复用actor_fence，finance专题却强制AppUser存在；原财务一般读取也没有此新增持久身份前提。实际Worker87仅提取非敏感flags为local-direct=true/runtime=development，准确编译authorization资产包含local-build=true且优先返回reserved，构成该路径强静态证据；未捕获原请求principal，不冒直接观察。Root已委派m6作者在普通隔离树 `D:\codex-isolated\netshop-finance-edge-compat\运营管理系统` / `codex/netshop-finance-edge-compat` 做最小兼容补丁，readiness_review独立复核；不建用户/GRANT，不改原签名、role/scope、其他财务证据权限或预算。当前未采用该补丁，S403仍保留。

原01切旧模式实际23行ERP店铺明细、sales summary200；原ERP同日期实际29日表，单次缓存读0.08285秒，另自然进入读5.5248/5.6396秒分别保留，不混为同一性能样本。非作者真实UI结果 `foundation-review/presence-production-review/browser139-actual/browser-results-meta.json`，结束后Network采集关闭，原tab留ERP同日期店铺，无新业务或AI动作。

身份兼容作者提交 `a129ea002ba2bb472b098489cc44f8221c1382e8`（父0b55af6e），两文件/运行源码10行；作者独立私有PG实际14项通过、原finance/access实际7迁移、50875正常Stop。独立审查未完成前不合主线或采用，该隔离结果不冒生产全景恢复。
