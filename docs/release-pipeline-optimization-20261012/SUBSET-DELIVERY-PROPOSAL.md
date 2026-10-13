# 已验证成果的精确子集交付方案

本文件下述私有索引方案是`dc94e649`时的历史截点。随后仅建立并验证独立送审分支，未合main或生产采用；实际分支、提交、文件闭包及新基线验证见[子集复核报告](FINAL-SUBSET-REPORT.md)。原方案树和来源摘要继续保留，不冒充新分支HEAD。规范中候选CI命令已明确标为待采用。

2026-10-13。按用户选择2，**本文件是可审方案，不执行main合并或生产采用**。完整CI候选、原失败、pending和所有证据继续保留。本轮不扩大全域CI、完整应用冷启动或历史lint治理。

## 基线与精确拟交付树

最新origin/main已前进至`5368e5014a418234bb2e8e436ce9e62012531c14`，包含其他任务的京东浏览器前检修复及报告。本轮没有合并这些变化；完整CI候选仍以原b3c6018c为历史基线。拟子集以5368为仓库底座，保留其全部现有文件，只覆盖下列已交付的五个源码/测试文件，加资料闭包。

只用独立`GIT_INDEX_FILE`模拟，未创建子集分支/提交、未改真实索引或检出：

- 五文件源码/测试树：`295f3ba0b482fdff62768df7fbcfcf7b6880b58d`。
- 43份资料＋五文件组合树：`dce3de7bf4f69b617e7d2def20ce2927f94309a0`。
- 实际diff只有明确五文件及文档；**不含package.json/package-lock、.github、tools/ci、tests/ci或业务模块变更**；diff --check通过。

上述树是Git只读组合证据，不是生产候选SHA。5368不是已采用生产source-snapshot；其其他未采用字节也不自动获准进入将来的生产包。真生产方案必须另按实际前驱完整清单生成窄范围候选，不能直接用最新main冒生产前驱。

完整逐文件来源提交、Git blob、原长度/SHA、Markdown闭包和拟树在[SUBSET-FILES.json](SUBSET-FILES.json)。本方案建议分别审查S0、S1、S2，不把“局部断言通过”写成全部门禁满足。

## S0：仓库资料，13份正文/投影及30份链接证据

| 文件 | 确定来源 |
| --- | --- |
| docs/release-pipeline-optimization-20261012/WPB-BASELINE.md | `74c5e6330b88248c7ebcc778e32310c5b46631d3` |
| docs/release-pipeline-optimization-20261012/WP0-INVENTORY.md | 同上 |
| docs/release-pipeline-optimization-20261012/WP4-TIMING-ANALYSIS.md | `39feb86c7c51b9b8c99232840bf55ad1b0027a02` |
| docs/release-pipeline-optimization-20261012/WP4-TIMING-EVIDENCE.json | 同上 |
| docs/规范/验证与发布.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/规范/数据存储与迁移.md | 同上 |
| docs/RELEASE_BATCH_WORKFLOW.md | 同上 |
| docs/STARTUP_RELEASE_OPTIMIZATION.md | 同上 |
| docs/release-pipeline-optimization-20261012/WP2-CLASSIFICATION-AUDIT.md | 同上 |
| docs/release-pipeline-optimization-20261012/HISTORICAL-SOURCES.json | 同上 |
| docs/release-pipeline-optimization-20261012/WP5-RELIABILITY-FIX.md | WP-5固定交付`4968baedd7ac3fa0948258cdc854fd25045fe8cd`的原报告 |
| docs/release-pipeline-optimization-20261012/WP5-RELIABILITY-GAPS.md | 同上 |
| docs/release-pipeline-optimization-20261012/WP3-EVIDENCE-REPORT.md | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |

为使这些正文链接独立可读，额外选择的30份资料包括原交付表/JSON、前一截点INTEGRATION-REPORT/REVIEW、GIT-GOVERNANCE、实际被链接的WP-3/5证据及证据属性文件，**逐项全列在下面的资料清单**。它们引用完整CI候选历史，不代表启用CI。原报告日期/失败和“未合main”截点保留；本方案及CONTINUATION-REPORT更新当前事实，不用新成功覆盖旧失败。

依赖：本次来源固定Git提交、最新main已有规范/实际采用报告，以及原文件相对链接目标；无新工具/运行依赖。验证：逐文件blob/摘要、链接闭包、代码一致性、规范仅一处正文、JSON与完整差异；文档无须生产构建。风险：历史计时/盘点只适用原截点；缺完整前驱/候选/部署输入继续“无法据现有证据判定”；T2认证连续秒与净收益未测。**仅仓库交付，不需要生产采用；不能以资料入库启用CI、调度或发布新代码。**

## S1：PS5真实退出码必要修复（三文件）

产品提交`2f21c238d2a4766caad547d08be63acab769ab08`，完整交付`4968baedd7ac3fa0948258cdc854fd25045fe8cd`。

| 文件 | 内容 / 完整来源 |
| --- | --- |
| tools/operations-system-service.ps1 | 仅持原Process.Handle、拒null退出码并保非零；Git blob `94b4d6c83a3051a4916b496a777d662d743609df`；SHA-256 `38b1e5b2de4e20c6a0e75a8a8ab400c738a7fb0bdfae64803cfe14d97d48e97d` |
| tests/operations-system-service.test.ts | 原测试入口及两shell退出/锁回归；完整提交同上 |
| tests/operations-system-service-exit.test.ps1 | 私有脚本/互斥：0/9/259、null、后代输出、异常释放；完整提交同上 |

完整依赖和调用边界：Windows PS5、现有pwsh、.NET Process/Mutex；既有`运营系统.bat`与package的system脚本；`operations-system-control.ps1`唯一总控、`worker-local-service.ps1`唯一引擎；引擎自己的process-deadline、release/rotation/guard及已安装Django控制器、PostgreSQL、原mutex/receipt/manifest/desired-state/维护/排空/authority/ACL/启动绑定。**没有修改或重新实现这些依赖。** 其仓库字节与本轮基线关系在[SERVICE-DEPENDENCIES.json](SERVICE-DEPENDENCIES.json)核定；其实际冻结运行版本/进程/权限/配置仍要在将来精确采用时重新核验，Git字节相同不证明现场就绪。

适用验证：原受影响17项、两shell真实失败/259/null/后代与锁异常；原系统生命周期/提前准备接缝；本轮deadline13项及两shell真实竞争协调给相邻合同补证，不冒完整12组件启动。该修复不在前端构建图、成功CLI/JSON/锁名/argv结构保持。原44中的13个旧batch.recovery夹具与1个尚未安全stub全部HTTP的watchdog case仍留在完整报告；它们不是本入口的新代码差异，不能写全系统发布可靠性通过。

剩余风险：500ms轮询没有新的总终态期限，日志/JSON尾部与输出增长旧边界未重写；拿到失败不能判后台完全零效果或重放；永久Status安全修复/全维护Stop兼容采用没有被本修复顺带完成。**旧普通Status/Panel现场诊断仍受原禁用边界，不能因本脚本修复就调用。**

仓库可送审的是这一个退出码修复；**真实宿主包装器要另行兼容采用**。合main也不会自动更新用户主检出的保护绑定或已安装入口。本轮没有生产候选/plan/维护窗口；它不属于v3被动展示，也不在v4精确十工具白名单，不能拆分后沿用f15授权或减少保障。

## S2：原离线收尾报告扩展（二文件）

产品提交`0ac64cefaa6e4398a24e578a33f25414e768d8bd`，完整交付`2538b8d5b51824a23bfc58f511d120c9c7cb8d2d`。

| 文件 | 内容 / 完整来源 |
| --- | --- |
| tools/release-closeout-report.mjs | 原模块增加安全进程/检查集合/候选前驱/历史新鲜度/V2终点投影；blob `65ac8e485f2b5abddc08eebd660b7a7bbb06b1ca`；SHA-256 `4fa19af7f938018a52df30d626e1159b87ad6973d7c9ad750a2be2d6214ea668` |
| tests/release-closeout-independent.test.mjs | 原独立测试扩展；完整提交同上 |

完整运行依赖：Node≥22.13（本轮实际24）、锁定TypeScript，以及既有四个本地模块闭包：本模块、release-impact.mjs、release-readonly-retry.mjs、worker-local-release.mjs；所有literal imports/builtin与逐模块SHA在[REPORT-DEPENDENCIES.json](REPORT-DEPENDENCIES.json)。其中worker模块导入node:sqlite但本调用不创建SQLite；其他构建/进程/联网/生命周期导出不调用。真正执行仅safeRead/canonical/hash、安全错误/进程投影、原journal/回执/计划/观察文件读取与新目录create-only写入；不查询业务HTTP/PG，不执行journal，也不重放发布。静态/literal动态依赖列出不等于它们所有导出在本路径运行。

输入依赖：原spec/批准摘要/连续WAL及所提供回执/log/sidecar/计划/版本/运行观察/交付回执的原字节与SHA。不存在或不完整字段列缺口；有冲突的绑定拒绝。21项独立报告＋6内容指纹＋3计时/字节相邻回归及两原批次离线适配已在相同产品字节验证；不无理由重跑前五任务。

剩余风险：原缺测试验证器版本、测试级前驱、delivery batch digest、部分f15原回执/独立runtime/source等输入边界保持，不能伪造补齐。报告始终`acceptancePassed:null`、historical-observation-only，完成声明不授当前readiness，supersedes不覆盖V1；没有自动hook/独立验收/生产收尾消费者采用。CLI/output schema原语义保持，但新增字段的未来消费者必须另审。

**仓库离线CLI独立使用不需要Worker/Django生产发布**。运行包source-snapshot包含不等于工具已被实际调用；若要安装到生产消费者或自动hook，必须另行准备调用者/位置/权限/绑定/失败方案与授权。它不能借拆分得到生产验收成功或数据库恢复资格。

## 严禁纳入这个子集的内容

整个WP-1 package验证入口、.github工作流、tools/ci与tests/ci实现及所有后续CI修正留在完整候选；本轮已验证的PG/浏览器/制品基础设施只是其部分能力，完整业务HTTP/角色PG/12组件冷启动/完整角色浏览器仍缺。测试夹具的test-only加载兼容、Linux大小写probe、模块缓存和Docker运输修正同属CI/验证支撑，**不以“修复已过局部测试”悄悄混入子集启用默认CI**。

新并发/缓存默认启用、阶段重排、自动报告hook、日备份调度、历史分支治理、生产部署均不纳入。原63项lint/112警告、13/11域准入缺口、旧失败与未测保留。资料和产品功能验证不抵消这些原完整CI门槛；子集适用验证必须依真实调用/依赖确定，不能靠删除文件清单或修改requiredLevel取得通过。

## 后续仓库和生产分别判定

当前建议把**S0资料＋S1退出码修复＋S2离线报告扩展**作为精确送审候选范围，而非批准合入范围。下一阶段若决定交仓库，需要在届时最新main上固定组合树，对五文件与依赖字节、必要组合检查/链接/构建适用性和lint范围独立复核；215b的整CI构建不能冒充5368拟树的构建，原测试通过也不能自动作最终新HEAD完整passed。若同一改动仍需要未完成的高级别验证，保持该项候选，不转移为“拆分无需验证”。

main合并、主检出同步、生产采用是三个状态。此次均未执行；主检出用户改动由原任务继续处理。只有后续精确仓库范围/门槛审查决定才可以按既定授权进入交付；运行采用仍需新的具体候选、实际影响/维护/切换/恢复及授权。此方案不批准真实启停、迁移、数据写入、调度或外发。

全域CI/完整应用冷启动与十历史文件lint只整理为[分阶段清单](L3-MINIMUM-CHECKLIST.md)，按用户最新指令不实施。当前CI补验与原失败更新见[续做报告](CONTINUATION-REPORT.md)。

## S0完整逐文件附表

附表由私有索引来源清单生成，包含全部43项及确定来源，不把链接证据变成运行依赖。

| 文件 | 确定来源提交 |
| --- | --- |
| docs/RELEASE_BATCH_WORKFLOW.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/STARTUP_RELEASE_OPTIMIZATION.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/release-pipeline-optimization-20261012/.gitattributes | `4968baedd7ac3fa0948258cdc854fd25045fe8cd` |
| docs/release-pipeline-optimization-20261012/DELIVERIES.json | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/DELIVERY-TABLE.md | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/GIT-GOVERNANCE.json | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/HISTORICAL-SOURCES.json | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/release-pipeline-optimization-20261012/INTEGRATION-REPORT.md | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/INTEGRATION-REVIEW.md | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/WP0-INVENTORY.md | `74c5e6330b88248c7ebcc778e32310c5b46631d3` |
| docs/release-pipeline-optimization-20261012/WP2-CLASSIFICATION-AUDIT.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/release-pipeline-optimization-20261012/WP3-EVIDENCE-REPORT.md | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/WP4-TIMING-ANALYSIS.md | `39feb86c7c51b9b8c99232840bf55ad1b0027a02` |
| docs/release-pipeline-optimization-20261012/WP4-TIMING-EVIDENCE.json | `39feb86c7c51b9b8c99232840bf55ad1b0027a02` |
| docs/release-pipeline-optimization-20261012/WP5-RELIABILITY-FIX.md | `4968baedd7ac3fa0948258cdc854fd25045fe8cd` |
| docs/release-pipeline-optimization-20261012/WP5-RELIABILITY-GAPS.md | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/WPB-BASELINE.md | `74c5e6330b88248c7ebcc778e32310c5b46631d3` |
| docs/release-pipeline-optimization-20261012/evidence-integration/local-ci--summary.json | `7ccb0f111555912a1554d0d5ceabaa57265d8f1f` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/.gitattributes | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/baseline-tests-final.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/changed-lint.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/cli-create-only.json | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/existing-closeout.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/first-adoption-f15-input.json | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/first-fixture-failure.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/historical-1009-input.json | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/offline-verification.json | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/static-drift.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp3/tests-final.log | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/affected-regression.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/after-ps5.json | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/after-ps7.json | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/baseline-failures.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/before-ps5.json | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/before-ps7.json | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/changed-lint.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/deadline-safe.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/django-ps5.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/django-ps7.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/first-regression.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/release-pipeline-optimization-20261012/evidence-wp5/lint.log | `f1b086bbfd9872ae9b1cef7e0ceb62d30ae69db5` |
| docs/规范/数据存储与迁移.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
| docs/规范/验证与发布.md | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` |
