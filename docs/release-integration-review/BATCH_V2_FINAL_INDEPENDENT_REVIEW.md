# v2 精确严格批次非作者终审

2026-10-10，Asia/Shanghai。审查者没有修改实现，没有执行生产 Backup、Restore、维护、Apply、Start、Install、调度或 DWS。新增验证仅为纯函数/私有临时文件夹具和只读文件、Git、摘要核验。初轮报告和失败日志均保留。

## 结论与精确范围

**第9版本的v2支持源码、独立负例与下列精确封存结构通过本轮非作者复审；没有发现新的源码/批次准备阻断。** 同一root真实只读UI四case通过（86请求、64资源观察、6个精确图标阻断、1个有见证的synthetic取消，危险/失败/缺失均0）；原collector最终回执的batch及全部binding与冻结spec完全相同，已独立读取原JSON/log和UI原审计，见 [只读回执复核](evidence/batch-v2-current-readonly-independent.json)。这两项观察对象是现有D5，属于准备资格；生产批准、真实切换后验收及实际采用仍未发生，执行须用户对最终精确范围另行批准并由原流程每步重新准入。

第8版本 `0fc66a5f…` 随后真实UI审计失败：原collector成功不能覆盖 `/api/sales/summary` 导航时 `net::ERR_ABORTED`。第9仅在正常导航和最终audit前等待networkidle，未将瞬时inert断言移到加载完成以后，未扩大允许abort集合或降低原失败拒绝。第8静态证据和失败保持，旧版本不能作为批准目标。

| 绑定 | 精确值 |
| --- | --- |
| 固定 AB 源提交 | `5faac8151f59d66de72c3caead8cad916ea547da` |
| Worker 候选 | `20261010T014638Z-97833d2f2b7e7bc9` |
| manifest | `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| 原 worker plan | `266a8574000a90cbeb5baf12fcba7bc2f4a8a06f0262f3b47d4ad73b9d0ddaee` |
| 最终 v2 root | `E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2` |
| 精确 batch | `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15` |
| batch 文件 SHA | `896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347` |
| Django 拥有方 | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`，不 Deploy |

冻结检查器调用候选自身的原 `verifyBatch`，确认 **strict/full、21步、12个真实域、12,854,217 bytes**。collector4502个文件，UI390个文件，原 Backup 每步4048个文件。11个私有支持文件物理摘要逐一匹配 collector；新 collector、Python模块/库存、原入口保全清单另行核验，见 [当前批次结构](evidence/batch-v2-sealed-current-independent.json) 与 [当前冻结支持绑定](evidence/batch-v2-current-frozen-support-independent.json)。21份源支持文件与封存时声明摘要相同；确定性相对路径/摘要集合的SHA为 `e096576a7ab3c27b7efedfd348734362866d925e6a60acc6a1644e9744400855`，算法在机器记录中声明。本报告不把前三/第五/第六/第8 attempt 的结果替换成最终 batch 的结果。

ABC 限定源码/候选仍依照此前 [范围复审](SCOPED_SOURCE_REVIEW.md) 和 [组合终审](FINAL_INDEPENDENT_REVIEW.md)；本报告没有宣布 ABC 的 v2 engine batch 已封存或生产采用。AB 采用后，C 必须以新的实际前驱重新准备；当前 native latest 日备份调度仍 unknown，C 恢复快路径资格仍 false。

## 修复后独立验证与失败保留

| 验证层 | 实际结果与边界 |
| --- | --- |
| 原 validator17＋独立5负例 | 独立22/22通过；完整7项software、原Python ASCII profile内根、catalog摘要类型、audit库存归属/计数、原四名probe均严格验证。首轮独立5失败保留。 |
| 自然观察/原回执保护 | 独立5/5通过。malformed JSON、invalid/missing at 先保存原字节/sidecar/seenAt再拒绝；新失败不能跳过；原失败/unknown回执不能被成功覆盖。首轮3失败保留。 |
| UI support | 独立7/7通过：精确图标版本/来源/类型；旧请求5秒延迟与新请求拒绝；malformed completedAt拒绝；窗口前旧200不能充当恢复；非ERR_ABORTED网络失败和POST均失败。首轮malformed状态1失败保留。 |
| Python 动态启动库存 | 作者2个夹具由审查者独立实跑2/2通过；新文件/改字节/.pth/sitecustomize/usercustomize/搜索路径拒绝。没有重新哈希实际7918个运行文件或调用生产collector；其真实门禁回执由主任务提供。 |
| owner 隔离层 | 原最新6个guard负例和25个业务/权限/迁移/写路径合同日志均确实OK。此前独立SQLite cwd/URI/constructor拒绝3例通过；不重复计成另外一套独有guard覆盖。installed1256/1256与private1264/1264此前独立逐SHA匹配，另8＋2测试、config/tools/SQL均显式声明。 |

独立 [适配器＋UI12项](evidence/batch-v2-adapter-ui-independent-final.log)、[validator22项](evidence/batch-v2-validators-independent-final-second.log)、[Python2项](evidence/batch-v2-python-closure-independent.log) 是分组结果，不与作者重复导入入口叠加计数。原全量439文件覆盖仍是13＋426个不重叠文件集合；测试数不能将重复wrapper再加成新的全量。没有在本轮重跑重型测试、构建或恢复。

原17通过、独立5失败、自然首轮3失败、UI审计/动态行定位失败、前五轮owner夹具失败及后续成功、前三次sealer失败/自有只读进程终止全部保留。本审查补充表达式首次误用了 `config/ask.json`，已按实际 `config/dingtalk-ask.json`修正读取并保留 [首检记录](evidence/batch-v2-final-approval-support-independent-first.json)，没有修改实现或原回执。

## 支持闭包与原严格操作

最终复制的关键支持字节：adapter `8d5f3f1f705c5b0264683b546b731eeddb9dbff3ff5102bea7ed5042d28ed714`；validators `7ada759aa35fabc1cf12ba22e51d4b517b2c7dae5c83315feb485188c33b3f2e`；UI audit `904d57eece6d64283d8b8b1e1ecf10faf3f197b270f00d96facf6f1e234eed57`；collector `4147f5267f35a24fe025b5ad92b89f4eda1b7a078aedb1d45de3383a1dfc929f`；Python closure `6dee00c17e11898459e03d8910ae943b5ec8e67ac248e0358e4e7a2ea501b6f6`。完整文件表在上述独立证据中。

collector 是已 pin 的只读 wrapper：每次先复验完整 Python 路径/摘要库存，再以原 ABI `collect <batch> <tests> --phase <phase>`调用未改的原 collector。AB/ABC均走子进程，未启用C内存复用。父绝对期限继续传递；完整身份、原Worker前驱/候选、权限/现场、原准入/排空/切换/收尾检查没有变成缓存标签。Python库存7918＝base stdlib2397＋DLLs42＋venv全sitepackages5479；拒搜索路径和新启动钩子。pyvenv.cfg明确匹配原Python312/3.12.10、无base sitepackages。

Playwright完整包和唯一Chrome版本树均进入UI command及collector。B UI模块从准确的 `source-snapshot/tools`导入；运行模块从runtime `tools`导入。私有UI adapter保持原B策略，只给真实SSR精确HTTPS图标 `?v=xiaote-20260922`阻断例外，随后必须通过正常HTTP候选图标字节验证；其他外域、版本、query、业务写和请求失败不被豁免。声明的synthetic搜索取消仅限窗口内原请求、ERR_ABORTED、恢复200及真实清空DOM；窗口完成后只允许旧请求5秒内迟到回调。

21步实际绑定包含原新pre Backup/完整独立Restore、原维护排空/Worker Apply/退出维护/Start、完整公开资源、实际只读UI、两真实未签名GET拒绝、原Control Running/Ready/exact_release/精确release＋12域、原VerifyStartup、单独watchdog Install、两个自然观察、原新post Backup/Restore、完整PG前后深比较、历史原字节保全和最终原状态。Start绑定Worker/Django双manifest与同一个maintenance owner。只读Status重试不能重放变异步骤。

保存恢复材料依赖同一batch中确已passed的Backup outputs，使用不可变AB支持的dir/manifest token，再从原WAL取id/dump/content；核同点id、rehearsal/port、manifest/restore原sidecar、dump/profile/sequence/清理。完整前后295 evidence /296 profile table库存及roles/catalog/migrations/content深比较，不推断合法数据变更；任何真实变更必须阻断并独立说明。

sealer只生成新私有attempt。metadata先fsync；create-only `approved-batch.json`最后fsync发布。异常明确区分authority不存在、存在但持久化未确认、已确认但报告失败，不能留下有效batch却谎称没有封存。metadata的 `validated-awaiting-authority-file`本身不能证明已封存，须核实际authority文件和原verifyBatch。

## 主工作树保全与最后批准范围

只读确认主检出仍有四个已有修改和原untracked文档。三个工具修改的实际字节分别等于AB原前驱CAS输入，未来原Apply会替换它们；不能将“业务源码未变”写成“主工具文件不变”。最终root保存12个protected路径的前/后SHA，其中6个需更换的现有文件原字节已独立核对并pin；新增process-deadline原先不存在。原MD与untracked文档未被触及。三工具原Git patch21315bytes/SHA `6d0d3c8b9f884f9c053fcfae1cb5b1b64f7f79591b21a3c68672dbe8bc53e30e`及基线 `2f55c3965e60b139381b6cc31ed868bcfe99a7bf`已create-only保全；独立git diff原字节与归档patch相同。不得在执行时盲目还原旧脚本绕过当前guard。

原Apply除受控入口外会原调用InstallStartup/VerifyStartup更新受控启动LNK。原Start按已pin的 dingtalk-startup/dingtalk-ask 配置检查/启动接收器。watchdog是单独批准的原Install：更新脚本/helper/installation、Set/Enable/Start既有任务，复用精确原launcher；运行后按既有策略可能自动恢复或发送故障通知。实际DWS exe `52e31332acadb06a34110c90ec3ac5cd9779fde705d9848497af1f3923fcaeab`已在watchdog步骤与collector，审查者只哈希，没有执行DWS。未来managedAfter在对应步骤pin，未放入pre-admission全局哈希造成前驱误拒绝。

用户最后批准必须包含此精确batch/candidate/manifest/plan、12入口升级和原字节保全、受控启动LNK、现有接收器、独立watchdog任务与既有自动通知范围。准备期间没有执行这些行为。执行前若主脚本不再匹配已批准old/new SHA、拥有方/前驱/来源/权限改变或存在unknown/失败，原流程必须拒绝；不能重新bless、手删历史或重放未知变异。

collector仍引用D专用worktree的原支持源码/日志和E原artifact，采用或明确撤销前须保留这些路径。提前archive/删除将使精确文件门禁拒绝；不能为清理改摘要或跳过pin。

## 未验证范围与计时

SQLite25项不是生产写测试或真实PG全角色执行。原完整恢复、当前PG catalogue/roles及真实unsigned401提供各自层证据；原恢复的policySyntaxEquivalenceVerified=false/空witness保持原值。PG profile不覆盖R2/n8n状态。pyc整体尚未形成完整密码学闭包，部分既有执行files已列SHA，其余沿用Python原mtime/size/hash缓存失效规则和原可信runtime/OS边界；接口guard不是libpq/ctypes等任意native代码OS沙箱。

当前已实得的只读UI四case与资源字节结果属于原D5现有服务观察，不能称候选已采用。原只读采集57144.7006ms、现存全点恢复706423ms是各自样本；原复审/协调/失败耗时没有单独完整采样。本轮没有批准→必要验收/完整交付、排队、生产各阶段或实际入口不可用数据。必须用后续原事件/实采样报告，不能累加母子计时或以切换跨度代替停服。30～60/80～120分钟仍为待验证工程预算，不由隔离小库、单恢复样本或准备速度证明。
