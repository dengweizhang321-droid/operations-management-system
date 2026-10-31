# 271 失败后恢复状态的记账协调

用户授权：核清并修复发布记账，再继续准备已合并的 `9c184426` 制品；不执行应用部署、Start/Stop或迁移。本任务从该main提交建立独立 `codex/release-accounting-repair-20261101` 工作树，实际写入前冻结本目录程序并经独立复核。

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

现场证据和执行结果保存在 `D:/codex-artifacts/release-accounting-repair-20261101/`，供对照原件；用户给另一位AI的只读排查提示词为其中的`HANDOFF-PROMPT.txt`。本文件形成时尚未写入修复记账，执行结果待原生读端确认后记录。
