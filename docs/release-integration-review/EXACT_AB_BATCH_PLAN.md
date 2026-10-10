# 最后批准用：默认 A＋B 精确严格批次


2026-10-10，Asia/Shanghai。源码、隔离验收与候选已完成；本批次已封存，尚无生产批准、未执行或实际采用。此前 FINAL_RELEASE_PLAN 的 P01–P04/P06“批次未形成”属于上一交付快照。终审见 [v2非作者终审](BATCH_V2_FINAL_INDEPENDENT_REVIEW.md)，当前机器记录见 [最终AB批次](evidence/final-ab-batch.json)。生产前每步仍须由原引擎执行新鲜准入；静态封存/本次只读准入不提前关闭真实验收。

## 可供选择的范围

默认先采用 AB，再以采用后的实际前驱重新准备 C。AB 源码提交 5faac8151f59d66de72c3caead8cad916ea547da，候选 20261010T014638Z-97833d2f2b7e7bc9，manifest f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113，Worker plan 266a8574000a90cbeb5baf12fcba7bc2f4a8a06f0262f3b47d4ad73b9d0ddaee。仅 tools/tests/docs 124路径；不含开发main其余未获采用批准功能。Django保持实际237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9拥有方，不DeployApp、不新增迁移。

**唯一批准目标 batch SHA：9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15**。

完整文件 E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/approved-batch.json，原字节 SHA 896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347，12854217bytes。批次ID integration-ab-v2-20261010-c22d8dd69a；维护owner 11bf4a85aac56cecff7180a8fbb459f6；隔离恢复pre 4343c5618700/55592、post 34d6af76d635/55593；21步骤，STRICT/FULL。sealed-plan.json先写为validated-awaiting-authority-file，再create-only+fsync最后写approved-batch.json；只有后者存在、verifyBatch及两种摘要核对成功才构成封存，metadata文字不能充当批准。

共同实际前驱D5 20261009T080026Z-d5fb5b62de630ae2 / manifest 01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78。任何实际前驱/源/制品/工具/配置/权限/维护/排空/其他批次状态变化使旧准入失效；原CAS拒绝未知字节，不能重新认领或重放。当前固定准备来源仍AB。

ABC严格合并替代已经有精确候选：9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c、20261010T015810Z-ec9a7dfc12336d52、manifest0153c677b7202ce6dbfbc08647450058693a8e1869ea8058db534b503f8281aa。其engine batch尚未封存，当前来源身份为AB；用户若选择合并替代，先检出精确ABC、复验/封存/独立审查后再单独请求最终批准，不能拿本AB批准切换ABC。AB一旦采用，旧D5 ABC计划失效，第二批C重绑新前驱。首次采用C自身仍严格，native日备份最新unknown使快路径拒绝。

AB准备9.27分钟，ABC11.58分钟；两严格批各一轮准入/排空/切换/自然守护/收尾和两次新Backup/Restore，合并批只一轮但集中风险。候选准备差2.31分钟不是同范围提速；现存点恢复11.77分钟不能外推新批次成本。30～60/80～120分钟仍为待验证预算。

## 具体执行步骤（本轮均未执行生产动作）

| 顺序 | 精确operation | 阶段 | 生产/隔离效果动作 |
| --- | --- | --- | --- |
| 1 | reuse-reviewed-worker | prepare | 否 |
| 2 | backup-pre | backup-pre | 是 |
| 3 | restore-pre | restore-pre | 是 |
| 4 | entermaintenance | drain | 是 |
| 5 | apply-reviewed-worker | switch | 是 |
| 6 | exitmaintenance | switch | 是 |
| 7 | startworker | switch | 是 |
| 8 | preserve-pre-recovery | acceptance | 否 |
| 9 | verify-all-resources | acceptance | 否 |
| 10 | actual-readonly-ui | acceptance | 否 |
| 11 | unsigned-reader-permission-denials | acceptance | 否 |
| 12 | complete-component-readiness | acceptance | 否 |
| 13 | verifystartup | acceptance | 否 |
| 14 | install-reviewed-watchdog | acceptance | 是 |
| 15 | two-natural-watchdogs | acceptance | 否 |
| 16 | backup-post | backup-post | 是 |
| 17 | restore-post | restore-post | 是 |
| 18 | preserve-post-recovery | closeout | 否 |
| 19 | full-postgresql-deep-comparison | closeout | 否 |
| 20 | original-historical-audits-preserved | closeout | 否 |
| 21 | exact-final-readiness | closeout | 否 |

前/后新Backup/Restore使用原安装拥有方、完整profile/同manifest/dump/内容/角色目录/序列及原回执sidecar。旧演练不能替代。原raw JSON先保全，再解析断言；unknown/failed不改为正常成功。Restore隔离PG端口55592/55593，不触碰正式库。

EnterMaintenance保留PG、精确owner排空；原Worker apply受plan/guard/CAS约束；Exit/Start断言双manifest。原真实12域Running/Ready/exact_release、精确release、VerifyStartup、资源75项、实际只读UI四交互、未签名拒绝及两次自然守护都要在该次切换后重新验收。页面200不能覆盖任何引擎/版本/完成证据失败。仅Status的B只读重试共享240秒期限，生命周期/Backup/apply/业务动作不自动重放。

自然观测每个新digest先保存raw/sidecar/seenAt，malformed/缺失或非法时间、任何新鲜失败立即拒绝并保留；只初始旧基线可记不计数。要求同候选/fence/PID及完整12域、四名probe，两次自然健康。5秒采样不能声称未观察原生运行全覆盖。

后备份对比前后完整一致PG public快照的全部表/内容根/roles/catalog/migrations/software；任何差异fail/unknown，不自动豁免正常后台写入。SQLite25合同不是PG角色执行，原恢复目录/角色、实际401各属独立层。完整profile不包括R2 payload或n8n SQLite，不声明已验这些内容；本候选不改它们。新后备份可能按原轮换淘汰前dump，保存前JSON不等于还能恢复前payload。

## 入口、调度与既有通知效果必须明确批准

原apply会更换/新增下列受控主入口，原InstallStartup/VerifyStartup还会更新/验证启动LNK。下面三份主目录已有Git改动工具属于当前合法前驱，会被批准升级：worker-local-release.mjs、worker-local-release-rotation.mjs、worker-local-service.ps1。原字节已经create-only保存在本root的primary-before-*.bin，原Git补丁及基线2f55c396也独立保存在primary-original-working-diff.*；摘要见上述机器记录。当前原目录/4修改/2组untracked保持。文档及其他工作树不触及；执行前任一入口不属于已批old/new即原CAS拒绝。

| 受控相对路径 | 前驱SHA | 候选SHA | 效果 |
| --- | --- | --- | --- |
| package.json | ce38493daf69c5e122a78a56877bb29f0e9753c3705e0b2301597385cc72a890 | ce38493daf69c5e122a78a56877bb29f0e9753c3705e0b2301597385cc72a890 | 跳过相同字节 |
| 运行项目.bat | 3184e1461c07463cd8c12bb7d7813a4d5bcc15448fd64c2a0caba809d17b28e2 | 3184e1461c07463cd8c12bb7d7813a4d5bcc15448fd64c2a0caba809d17b28e2 | 跳过相同字节 |
| tools/operations-system-control.ps1 | 6037eb6357b4c98bf4a0fa6d03ae8f533671c03f1c8b6db1335dacb556bf7638 | 0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810 | 更换/新增 |
| tools/start-local-worker.mjs | 383351ab2ad69c7889a831e2e11646e6d3e8d4e43f87b02e0d5b53d13e1ed74f | 383351ab2ad69c7889a831e2e11646e6d3e8d4e43f87b02e0d5b53d13e1ed74f | 跳过相同字节 |
| tools/worker-authority-guard.mjs | 1bb5adea6d6c72ad0eceab30af17f2511e086ad0b2c40cb6845c0be8dc6aab6e | bbd18513fbeb3b6d7adb9956809f768458805b80959daba94669b31b87035210 | 更换/新增 |
| tools/d1-retirement-proof.mjs | 87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76 | 87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76 | 跳过相同字节 |
| tools/collect-d1-retirement-proof.mjs | 38117cb4405d64d6250e68d7ee22521029244bb6e2e283ac5e56a0cbc6b72295 | 38117cb4405d64d6250e68d7ee22521029244bb6e2e283ac5e56a0cbc6b72295 | 跳过相同字节 |
| tools/worker-local-release.mjs | 0e5d1c45d215158a5b765e1ea47345a940a10b41fcd0d0b645dc89cc5fd48e32 | bba3e24da195576e991f162084159314652c7077f0c7f0a3647319911203c0fa | 更换/新增 |
| tools/worker-local-release-rotation.mjs | 638d5ecbc212da64d535dc60ae5f656f7184e33d17593ae49f65a48870a425bd | 4c12dedf527e68a372061bc2d0f78ded9083246b8d37596990d718c6500591fe | 更换/新增 |
| tools/worker-local-service.ps1 | bc98f84683dbf5da0769be5eb4e0533c5c5c7eb35252d26c87613f38440f6e15 | 4c315221d5722b1b90abd8b25f16f95c3df588ab111f4ce4dd070f1b433ded80 | 更换/新增 |
| .runtime/worker-release-activation-fence.json | b4200aa85d551f0e9c63123437dbd15cb18cb45ad4976dcb65b8d0d0aa6f72df | d7c38840b6662dc5bc1b6f7ffbbd4fefa44671bd942699c37b78b2a49c6b779b | 更换/新增 |
| tools/process-deadline.ps1 | 原不存在 | 5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd | 更换/新增 |

watchdog采用单列第14步：原Install -Execute更新已安装script/helper/同源launcher、安装记录，更新/Enable/Start既有TERUISI Operations Watchdog。精确旧task XML/主体/触发/设置/action与launcher先绑定；任务Running时只读等待，实际Install只一次，不另Register未知任务。该step及collector pin实际DWS exe、精确PowerShell host及原脚本/helper、原主控制/Worker及backend supervisor依赖，未执行DWS或TestNotification。

StartWorker按既有已绑定config/dingtalk-startup.json和dingtalk-ask.json及原AI authority/配置门禁检查/启动钉钉Stream接收器与schedule进程。watchdog既有自动恢复和故障提醒可能运行，钉钉已有问数/调度行为也可能恢复运行；不是零外发承诺。最终批准应明确允许这套原有启动/自动行为，不授权手工消息、改调度定义或无关业务补跑。如果用户不批准其中效果，则先缩小/重新封存批次再批准，不能执行现批次后将其记未采用。

## 依赖、复审与仍需保留的限制

原Node/PS5 argv完整路径相等；PS7 watchdog、原PG17.11/脚本/1256拥有方源、原Python、完整Playwright与唯一Chrome版本实现都绑定真实物理摘要。每次collector先重新验证Python完整7918文件路径/SHA库存与启动hook/搜索路径，拒新增文件/变更/.pth/sitecustomize/usercustomize和非空PYTHONPATH/HOME/USERBASE，再调用原collector，保持原完整源/制品/动态身份/权限/维护/drain门禁。__pycache__整体未新增完整密码学闭包（部分原文件已列入执行files），沿用Python原mtime/size/hash缓存失效规则及原OS可信runtime边界；不声称任意native OS沙箱。

原全部WAL/queue/observations/successor/consumption/package审计根及Django文本审计、已发布恢复回执完整scope盘点保全；旧unknown/failed/reconcile不删改。历史D1/备份二进制payload和动态startup/monitoring状态不在这份历史审计内容盘点，不声称重新验证。当前实际就绪/owner另由每轮原门禁验证。旧3299→3302历史仍unprovable，不追写成功。

独立纯validator17+新增5、adapter/natural5、UI与adapter联合12、Pythonclosure2、隔离guard6、同拥有方SQLite25及所有原核心/限定候选测试分别列证据，不重复相加作一次完整测试。首失败、被拒草稿、fixture setup失败、前封存attempt、UI失败和主动中止只读旧sealer都保留；被替代batch不得作为批准目标。未运行新生产Backup/Prune、生产维护/启停/切换、调度变更、业务写入或外发。

## 回滚、未完成与计时

D5原manifest/guard/不可变包、原主入口字节及append-only successor保留。兼容代码回退走原受控plan/guard/owner，Django拥有方不变、不回D1。数据恢复必须另获精确仍保留恢复点/库/维护窗口批准，不包含在本批次批准中。started/unknown保留原WAL、精确只读回查/独立reconcile追加证明，禁盲目重放或手删active；只有原零效果证据齐备才原cancelUnswitchedBatch。

本次批准到必要验收、批准到完整交付、其他批次排队及真实备份/恢复/排空/切换/自然验收/文档收尾/失败协调续接均未测。实际入口不可用须现场采样，不能用切换跨度冒充。P01–P03/P06的方案/支持实现缺口经终审后闭合；P04永远是该次动态门禁，P05快路径拒绝保留。生产阶段真正验收闭合及文档/Git收尾分别记时间，不能提前宣布采用成功。

用户现在可先选择默认两批或ABC严格合并替代；默认AB的最终批准措辞可为：**“批准本方案唯一batch 9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15采用A＋B，并允许上述受控入口/启动快捷方式、既有钉钉接收与调度进程启动、watchdog安装启用启动及其既有自动恢复/告警；执行前重新验证门禁。”** 本任务当前通知不构成该批准。

最终同封存root只读UI四case通过：evidence/batch-v2-ui-authority-final.log。上一0fc66批次同root UI因在途sales读取导航取消失败，原失败保留；本版本仅增加正常导航/最终audit前networkidle等待，未豁免业务请求失败，瞬时inert断言保持。旧批次不再可批准。实际检查在仍运行D5上进行，业务源/75资源字节相同；它不能代替该次切换后完整原验收。

本批次collector绑定D专用worktree内21份支持源码与原日志/证据，以及E完整制品。采用完成或明确撤销前必须保留D专用worktree、固定AB准备来源和本E root；归档/清理使准入拒绝，不能为清理跳过pin或修改已批SHA。

最后同root原collector只读准入通过：evidence/batch-v2-admission-authority-final.json，返回batch及全binding与封存完全一致。该收集器原journalState建立本batch私有审计目录属于准备元数据，未批准WAL、未获取生产active owner，未执行任何operation；真实每步动态准入仍必须重新检查。
