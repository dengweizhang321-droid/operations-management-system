# 271 失败后恢复状态的记账协调

记账修复阶段的用户授权：核清并修复发布记账，再继续准备已合并的 `9c184426` 制品，该阶段不执行应用部署、Start/Stop或迁移。本任务从该main提交建立独立 `codex/release-accounting-repair-20261101` 工作树，实际写入前冻结本目录程序并经独立复核；后续用户另行授权的上线结果见末节。

原271发布完成了后台部署、WorkflowAutomation 154→156 Install/Finalize、Worker切换和维护退出，但原Start在DjangoEnsure真实exit1。因此原STARTED/FAILED及失败输出必须保留；不能补写原SUCCESS、Start结果，也不能套用仅支持无迁移Pi尾部的resume或其他批次的恢复入口。现有adopt-live也明确拒绝这种STARTED无SUCCESS，本程序没有调用或修改它。

后续独立Django Start在2026-10-31本地23:12:26留下action_completed，Worker PID21620的完整Invoke-WorkerSystemStart记录completed，并创建当前canonical supervisor29232。相应源码把实际完成收尾包含在该函数的try内，失败才会改outcome；这证明恢复作用完成，不证明历史外层退出码。新回执对外层exit明确记null，并以本次当前身份、原生部署/权限、启动绑定和ready检查为依据。

当前Django并非原准备包逐字节未变：原manifest为212c21a9、appFingerprint为7ab92282；现manifest为13e944f3、fingerprint为ed98e922。仅有`tools/workflow_automation_catalog.json`从6bf7b89e变为2620a423；在当前3159行原生指纹中只还原这一叶，精确得到原fingerprint。该after字节等于03f6e474及目标9c的Git对象。新回执记录“原271基础+这一个精确覆盖”，不改PREPARED，不用相同sourceRoot伪装当前仍是原包。

## 程序边界

- [EVIDENCE.json](EVIDENCE.json)绑定30份原始记录及此次已核目标；[reconcile-accounting.mjs](reconcile-accounting.mjs)只支持精确271。默认核对当前状态，不改应用或发布索引；会写任务外部证据和原生控制器自身诊断日志，不宣称生产文件零写入。
- `--apply`要求普通权限、相同交互用户和干净已提交的程序来源。沿现有发布queue→d08单参数rotation锁，核控制代际、原记录、实际来源/版本/指纹、退出控制者、合法当前supervisor、维护退出及ready。
- 只有独立的`accounting-recoveries/<UUID>/ACKNOWLEDGED.json`、旧catalog字节备份和原子CAS替换`PUBLISHED-MAIN.json`属于修复写入。原FAILED、PREPARED、runtime deployment、bootstrap配置和已安装bundle不改。回执明示原失败、后置恢复及本次只改记账三件事，`publicationPerformed=false`。
- 顶层`deployed_and_ready/startupVerified/readyVerified`指本次当前观察，服务启动快捷方式检查不冒充原Start完成。`mainCommit/source/sourceTree`继续使用Worker271及manifest中的源树对象，不跳到尚未部署的9c。修复后用原readLivePublication读端核验，再另行调用固定prepare-only。
- 若写入后回读失败，不自动重放；记录catalog是否已替换或是否尚无法确认。CAS变化保持他人索引，不覆盖。此程序不是通用恢复框架。

## 必要检查

语法检查通过；4个仅私有临时文件/内存的检查通过：精确单叶差异闭合及未解释差异拒绝、独立ACK及旧catalog保全、初始漂移拒写、最终CAS不覆盖外部写入。没有跑应用功能测试、原生冷启动或既往全量比较。独立Sol复核写边界、锁/CAS、读取契约及事实表述；Astra只负责本次难点的限定方案咨询，未代替独立审查。

现场证据和执行结果保存在 `D:/codex-artifacts/release-accounting-repair-20261101/`，供对照原件；用户给另一位AI的只读排查提示词为其中的`HANDOFF-PROMPT.txt`。

## 已执行的记账修复

冻结程序提交`23feb2592ff2375f47bf5b1986d26a81c1c30318`，脚本SHA`2890b772f957ebe80efdbfa2c9d9bf306e42b967ccd6c44b03c4bcb845fabaf5`。独立Sol核对最终普通权限断言及默认实际观察后放行精确`--apply`；未重跑已验证部分。通过仅按需运行、无触发器的普通权限临时任务执行，token记录`elevated=false`，程序exit0；临时任务在完成后按精确名称/动作核对清理。

新独立回执：`D:/codex-isolated/main-manual-release-20261016/accounting-recoveries/33861058-703c-40c5-ba9d-816565c8ce65/ACKNOWLEDGED.json`，SHA`80798697d68e0117f50869cf9c51fa38020b17618661336a263f8a48b0e2a453`；旧catalog原字节保存在同目录。替换后的catalog SHA为`f9c5c33bf2c9ef96315b50514db06e84ada6877cabb67f757027c32143ebb55c`。原`readLivePublication`已核验回执摘要、现役三元组、Worker271来源和ready，执行回执为外部证据目录下`run-33861058-703c-40c5-ba9d-816565c8ce65/COMPLETED.json`。

原STARTED/FAILED/Start结果缺失状态和PREPARED均保持，后置恢复outerExit仍为null；没有应用部署、启停、迁移或业务写入。成功后不得重跑此精确适配器；旧catalog前置摘要已故意失效。已继续调用原固定`--prepare-only`，冻结目标9c、基线271、Worker+Django、migrate=false，制品结果由原生PREPARED及准备队列回执判定。

## 制品已就绪，未上线

原固定准备请求`9d2da1f6-3d93-4ff1-b739-aac742443ef5`返回`prepared`，选定目标`9c1844264bc03ce175b2b773b5cb66685ef7ce86`，原生结果`prepared-only`、`publicationPerformed=false`，入口exit0。包为`D:/codex-isolated/main-release-packages/9c1844264bc0-9cc04cda-13e944f3`；原生`publish-9c1844264bc0/preparation/PREPARED.json`摘要`dc66cd0095e627501bd1b55476f41b792e18dd227478ce63195a63926ddacdd5`，已与请求和队列结果核对。Worker候选为`20261031T184030Z-d8fbcdbe3bf6cba1`，Django准备ID为`5e570db8fc784513adb1220b996bc490`；范围为Worker+Django、无数据库迁移。入口自带的发布前置检查亦通过，没有追加功能验收。

同一冻结9c源码的37成员控制包材料也已通过现有安装器的准备及只读材料校验，位置`D:/codex-artifacts/release-accounting-repair-20261101/control-materials-9c184426`，bundle SHA为`fe4e34dcea03ad77c47c288bd572841ae69428bb05147893f69c452102d45aa6`，installId为`2dd7a5cc-1695-4a3c-ae5c-81eb4cac826a`，`adoptionPerformed=false`。此步骤同样使用普通权限、无触发器的临时任务，完成后已按精确动作核对清理。控制材料未采用，现固定入口仍为原3e代。

完整交付绑定见外部`DELIVERY.json`。本次应用准备请求由现已采用的3e控制代生成；不得在未处理冻结请求兼容问题时，先换成新控制代再声称可透明消费旧请求。准备阶段未执行上线动作；后续授权后的实际结果见下节。修复程序及本报告在独立任务分支保存，不改变已冻结9c源码。

## 用户授权后的应用上线

用户随后明确“上线”。通过原3e固定发布器及普通权限一次性任务发布上述9c应用制品，未重建制品、未采用新控制包。原生在UTC2026-10-31T19:35:58.861Z（上海11月1日03:35:58）写出`SUCCESS.json`，status为`deployed_and_ready`、startupVerified与readyVerified均为true；固定入口exit0。`PUBLISHED-MAIN.json`已绑定这份真实成功回执，SHA为`91e12a0dc9ed7b78251bacbae8a5bc987ee8554cc97cf831f48a917dee123347`。此前独立恢复承认仍作为历史保留，当前索引已由正常发布成功记录取代。

Worker现役为`20261031T184030Z-d8fbcdbe3bf6cba1`，Django manifest为`5361fd19af3e5b21fd6013538a04a3b45faa203b741302639bd938e32b55e81b`。本次无结构迁移；原生维护退出、启动与就绪门禁均已完成，没有追加业务功能验收。临时发布任务按精确名称、动作和完成状态核对后已清理。[PUBLICATION.json](PUBLICATION.json)保存回执绑定，[TIMING.json](TIMING.json)区分发布器日志开始、原生STARTED、成功和入口退出；没有取得原始用户消息时间，不冒称这些区间是用户授权后的总等待或连续停机时间。

应用上线完成时，新控制包尚未采用。《验证与发布》要求控制采用与应用发布分别授权，已向用户单独询问；后续明确授权及采用结果见下节，没有重复发布应用。

用户询问新控制包内容后，已只读比较3e与fe4的MANIFEST：35→37个代码成员，仅`tools/release-scope-plan.mjs`修改，新增`tools/release-copy-rules.mjs`和`tools/release-copy-git-sources.mjs`，其余34成员字节相同。新包对应任务3的实际复制/构建输入分类、同次Git缓存复用及精简计划；触发模式仍为manual-only。任务1/2/4仍是方案，不因这个控制包获得实施。采用影响后续发布工具行为，不改变已上线业务版本。

## 新控制包已单独授权并采用

用户明确回复“授权采用新控制包”。原安装器首次普通权限调用进入S4后，在`controlProcessSnapshot`返回第一帧时超过默认`timeoutMs=30000`，原记录仅一帧`related=[]`，没有达到规定的三次连续空帧。原[BLOCKED](CONTROL-FIRST-BLOCKED.json)保留；安装指针为同installId/intent的`installing`，不能手写成成功。已核原Node/包装进程退出，dispatcher/hook/config三入口均为本意图允许的新摘要。

经独立Sol对原API边界作最小复核，使用同一冻结9c源码的公开`adoptControlUpgrade({directory,resume:true,timeoutMs:600000})`单次续接。该选项受原1800000ms上限约束；保留同一installId与intent、原v1 queue→v2 queue→native rotation顺序、三空帧、代际、摘要、任务定义和CAS全部条件，没有修改工具、永久默认超时或应用生命周期，没有调用ForTest或私有锁。

续接普通权限exit0，原生S5/TASK/S6/S7完成，在UTC2026-10-31T20:09:44.497Z写出`adopted`，installId仍为`2dd7a5cc-1695-4a3c-ae5c-81eb4cac826a`，当前bundle为`fe4e34dcea03ad77c47c288bd572841ae69428bb05147893f69c452102d45aa6`。原生TRANSITION含三帧、legacyWindowConverged=true、productionDeploymentPerformed=false，摘要`ccf8711be74f5a64ec951e33731c64ce6035d0c8d8707ad520f229d5b769f419`。最终安装状态摘要为`67da8603f65d377d7cab11381919e31894faa96b680038770fd41052e2256f9c`，见[CONTROL-ADOPTION.json](CONTROL-ADOPTION.json)。

应用的9c成功回执和发布索引未变；没有重新部署、重启业务或运行新的准备/功能验收。两次采用调用的临时任务均已按精确名称/动作和退出状态清理。原始输出、进程与同意图续接记录位于`D:/codex-artifacts/release-accounting-repair-20261101/control-adoption/`，原失败不被最终成功覆盖。
