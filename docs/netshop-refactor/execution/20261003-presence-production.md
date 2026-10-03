# Presence139 已批准生产维护（进行中）

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

现在原139后备份进行中。随后必须独立恢复、Finalize/Exit/Start和真实原用户同月范围五栏/旧入口/六源验收；原月范围503仍未关闭，应用仍停止。仅在实际恢复和业务验收后更新最终结论。
