# 发布优化精确子集：main仓库交付

2026-10-13。主协调聊天“评估发布流水线优化方案”（01a13006-3f65-7b91-aa00-6a0a80594722）在用户休息期间工程代决策授权范围内，独立复核并批准`c48411325e77adf81d445c05ffae6bf5178cb783`的S0/S1/S2仓库合并。**仅精确子集已合main；完整CI未合、未完成，生产未采用。** 没有准备生产候选、启停服务、部署、迁移、业务数据写入、启用调度或真实外发。

## 合并与远端事实

- 合并前fetch与远端回读仍为`5368e5014a418234bb2e8e436ce9e62012531c14`，无新增main增量；保留其他任务的京东前检变化。
- 在独立工作树创建`codex/release-validated-subset-main-20261013`，从5368执行正常no-ff合并；合并SHA为`9ccdae84d691b348d588821b153be586297d6777`，父提交为5368及c484，没有冲突。
- 合并树`0be9f64c22e7fab24812d3fc2a0bb6ae82409db9`与获批c484完全相同。base→合并恰为64文件：五源码/测试＋59份资料；无package/lock、工作流、tools/ci、tests/ci、业务/前端/构建配置delta。
- 普通push已将origin/main从5368推进到9cc；fetch回读9cc，`merge-base --is-ancestor c484 origin/main`为0，完整CI的dc94检查为1。未强推，未改写旧提交。
- 本文与[evidence-main/subset-main-scope.json](evidence-main/subset-main-scope.json)是授权允许的两份新增交付资料，故最终base→HEAD为66文件。最终文档提交自身与最终远端main的完整SHA/回读绑定在create-only交付回执`D:/codex-artifacts/release-pipeline-integration-20261012/MAIN-SUBSET-DELIVERY-V1.json`；仓库文件不能自写其所在提交SHA。

原[子集复核报告](FINAL-SUBSET-REPORT.md)、[原方案](SUBSET-DELIVERY-PROPOSAL.md)、[实际64文件清单](SUBSET-ACTUAL-FILES.json)、旧INTEGRATION/CONTINUATION及notMerged字段保留各自截点。本文件说明现在状态，不把旧失败、未合并、未测或unknown改成成功。清单逐项原来源、候选文件提交、Git字节及依赖见原64文件清单；新两文件只记录仓库集成，无新运行代码。

## 六任务的交付与当前采用范围

| 任务 | 固定交付/实现SHA | 本次main采用范围与集成SHA |
| --- | --- | --- |
| WPB基线与WP0盘点 | 74c5e6330b88248c7ebcc778e32310c5b46631d3 | S0原基线/盘点及证据资料，集成9cc；不是执行清理或改变生产基线 |
| WP1 CI | 3558ba18ca9eed8971bf67e7e54220519596dc80 | 不采用运行实现或完整分支历史；仅资料引用完整候选；dc94及所有失败继续保留 |
| WP5可靠性 | 4968baedd7ac3fa0948258cdc854fd25045fe8cd；原产品2f21c238d2a4766caad547d08be63acab769ab08 | S1三文件候选提交97282a6bced9752f32deb35ba346475e3a32a11c及S0原报告，集成9cc；只保退出证据，不认领全系统可靠性 |
| WP4计时 | 39feb86c7c51b9b8c99232840bf55ad1b0027a02 | S0报告/JSON，无运行代码改动，集成9cc |
| WP3收尾证据 | 2538b8d5b51824a23bfc58f511d120c9c7cb8d2d；原产品0ac64cefaa6e4398a24e578a33f25414e768d8bd | S2两文件候选da7f110f54fb67e069e767c1f91cf1584cd82847及S0资料，集成9cc；离线投影，不安装自动hook |
| WP2分类与历史审计 | f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3；子集规范派生279870fc09772aee7d3c7156fe2e164d30abef92 | 四规范链接/正文与审计/历史证据，集成9cc；明确CI为待采用候选，保持验证强度、DB保障、维护范围、切换和恢复独立判定 |

完整五包顺序集成SHA仍见[原交付表](DELIVERY-TABLE.md)，不把复制子集的main合并误写成六次生产发布。条件WP0G本轮只保盘点/治理证据，清理执行数0；独有恢复、未合CI、用户改动、正在核验的树和正式绑定继续保留。未批量删除历史远端分支，不移动/删除运行目录、备份或归档。

## 适用验证、独立审查与失败边界

获批树的新检查为S1 17/17、S2 21/21、指纹6/6、计时3/3，0失败/0取消/0跳过，改动JS/TS lint退出0；S1包含PS5/PS7真实0/9/259/null、直接父退出/后代输出与锁异常释放，以及原隔离维护/竞争/准备接缝。结果原stdout/stderr与摘要见[evidence-subset/results](evidence-subset/results.json)，不是完整12组件冷启动。

主协调独立审阅产品diff、依赖与规范，逐份解码校验五测试记录的原输出摘要、63成员Git长度/SHA及64差异，未发现该工具范围新增阻断。协调者自己的首次辅助审计因Windows默认GBK解码Git中文路径失败，改显式UTF-8后复核成功；保该事实，不计为产品测试失败或抹除原CI失败。

合并没有改变获批树或依赖，因而复用此精确树的适用检查，不重复全量测试。合并后再次核63成员摘要/逐文件提交、五源码与原WP5/WP3固定字节、scope和ancestry；新增两份资料检查JSON、相对链接/锚点和完整diff。原164链接检查是子集截点，新资料检查另记于evidence-main。没有生产构建/应用图改动，不拿215b的CI构建当本HEAD构建；真正生产候选仍需自己的准备及适用验证。

完整CI留在`codex/release-pipeline-integration-20261012` / `dc94e6492ce34457529581239f2b682bb6d36264`，它的L0完整lint仍63错误/112警告，L0/L1仍13/11域准入缺口，真实PG业务HTTP/角色浏览器/完整应用冷启动适配器未验收；L3 pending和workflow failure保留，不认领已完成能力。这些是完整CI能力的阻断；已验证的工具子集没有CI入口或依赖，不通过修改requiredLevel、忽略规则或删除同一产品失败来取得通过。若以后更强验证由实际影响要求，仍须完成，不能沿用此次局部验收。

Windows原夹具超时、1263900字节ModuleAnalysisCache dirty、隐藏成员运输、Docker机器ID两流、PG临时Unix服务和Linux大小写probe的原失败/修复见[续做报告](CONTINUATION-REPORT.md)及固定完整候选原始证据。基线进程树旧负例、WP5原13个recovery及未安全stub的watchdog边界不改写；当前成功不追认旧退出码。S2仍`acceptancePassed:null`、historical-observation-only；原缺输入/前驱/validator/delivery digest不伪造补齐。

## 仓库、主检出与生产分别交付

S0资料只需仓库交付。S1仓库修复已合，**真实宿主包装器未生产采用**，永久Status/全维护Stop修复也没有顺带采用；原普通Status/Panel现场禁用边界保持。S2离线CLI仓库可用，没有自动hook或生产消费者采用；create-only/历史两批输入核验明确复用原字节记录，不授运行就绪。

用户主检出仍`2f55c3965e60b139381b6cc31ed868bcfe99a7bf`，六处修改及未跟踪报告/process-deadline保持原状，由原任务继续处理。没有stash/reset、自动同步或覆盖。远端main前进不等于主检出同步，也不改变冻结生产source-snapshot/正式入口。

生产方案仅保留：S1以后需固定真实入口/调用者/PS工具链与完整实际前驱，生成兼容必要字节的精确候选，独立列strict验证、默认full数据库保障、维护/切换/恢复及批准；它不是v3被动展示或v4十工具白名单，不沿用f15授权，不把最新main全部未采用字节直接装生产。S2如要消费者/自动hook，另固定调用位置/权限/输入绑定/失败处理并做消费者验收。以上均未准备或执行。

T1已知f15完整交付19h52m5.160及原必要验收终点；T2认证业务连续中断仍未测，T3保区间并集/父子关系，不能累加重叠故障与恢复区间，不承诺净省分钟数。全域CI、完整冷启动及历史lint继续仅列[P1–P5/H后续阶段](L3-MINIMUM-CHECKLIST.md)，不扩本轮工程。

本次保留完整候选、独有恢复证据、来源开发分支与工作树供最终独立核验；清理另按正式绑定/保全/进程重新核验，不因本子集已合而删除未合CI或生产材料。共享记忆更新为“精确子集已合main；完整CI仍候选；生产未采用”。
