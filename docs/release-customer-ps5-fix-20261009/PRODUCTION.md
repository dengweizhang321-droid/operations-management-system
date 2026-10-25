# 发布提速与客服四店修复：新批次生产采用

用户于上海时间 2026-10-09 08:40:46 明确要求“执行这个修复后的新批次上线”。批准的是固定源码 e1f384e1e348b666da30d78e35d408aa882415b8、Worker 20261008T182600Z-f5d4b05177d17010、严格完整 19 步批次 8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af。主线随后进入的吉客云及交互功能不进入本次固定制品。

本批采用发布流程提速实现和客服四店手动导入修复。没有执行真实四店导入、历史店名归并、补数、生产数据恢复、日常备份调度启用或 n8n 工作流定义修改。日备份仍暂停，本批含导入和生命周期改动，使用完整前后备份与隔离恢复，未获得纯展示快路径。

正式准备、构建和相关测试在批准前完成。批准后仍复验原前驱、源码与制品完整性、全部外部工具绑定及现场状态；没有重新执行 npm ci 或构建，也没有删掉原部署、权限、排空或完整性门禁。Django 准备包 d6c3fcad7380480896b1f972c84c4279 经实际应用输入闭包和原收据复验后使用，部署 manifest 为 237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9。

## 启动步骤的独立协调

原启动主体 PID30872 在 09:40:46 完成，原 timing 记录 252999ms；Worker 入口和客服固定查询恢复 200。但生命周期适配器 PID55372、编排 Node37476 持续等待返回。原启动进程已退出、独立原 Status 显示 Running/Ready/exact release、12 个组件全部就绪，原 VerifyStartup verified，精确新 supervisor33224、manifest72ec 与门禁已解除均核验通过。

独立复审据此证明启动的实际目标状态完成；原 exit0 未观测，不能捏造。仅在核对 PID、创建时间、父进程、固定 exe、精确批准命令/Encoded payload 及子进程身份后结束等待外壳。没有使用 killtree，也没有终止生产服务。适配器唯一子进程为其精确 conhost；编排 Node 无直接子进程。原 WAL 的 started 保留，由原 reconcileOperation 按独立证据闭合为 passed，再用同一批准 SHA 和原批准时间 execute 续接，已完成的维护/部署/切换/启动没有重放。后台子孙持有输出句柄导致 EOF 等待与现象一致，属于原因推断，完成状态证明不依赖该推断。

相关证据位于 E:/codex-artifacts/release-customer-ps5-fix-20261009/production：independent-start-completion-observations.json、independent-start-completion-reconcile-proof.json、stalled-adapter-closed.json、stalled-batch-host-closed.json、start-reconciled-result.json、原 journal。异常核查、独立原状态查询、协调和续接准入全部计入批准到完成的总时长。

## 历史查询差异的独立协调

原 customer-historical-query-preserved 在 10:02:02 返回 unknown，正式入口立即停止后续步骤。固定旧基线中 10 月 1–7 日总会话 3299、切肉机 932，而当前为 3302、935；其余店铺及旧店名历史数量和全部店铺枚举一致。没有改写原基线、删数据、重导或直接把原字面等值断言记成成功。

独立使用原 DPAPI 域 reader 凭据及参数化 RepeatableRead READ ONLY 事务聚合，确认当前用户为 teruisi_customer_service_reader，INSERT/UPDATE/DELETE 权限全部 false。created_at 不晚于基线的当前各范围计数仍为 3299/1424/932/837/106/29018，与原计数相同；新增 3 条均由原切肉机 cs_4f5a5ad18dbd4020253308fa4f59daaa58682be285d071332b921e0e7b8c395d 批次创建于 09:02:36，维护前，维护后新增 0、部署后更新时间变化 0。原 09:00 自然执行 7480 的完成计划、Oct7 日批次与独立监控账本均绑定，查询运行源码和实际 Django 查询字节未变。原自然重导更新过既有记录的 updated_at/批次/version，故这里只证明历史数量/店铺范围保全及新增来源，不宣称客户内容逐字相同。

在保留 unknown 和字面比较失败记录的前提下，用原 reconcileOperation 按独立实际数据保全证据闭合，再同批续接；没有重放该操作。证据为 customer-historical-independent-reconcile-proof.json 及 observations、customer-historical-reader-aggregate.json、customer-history-reconciled-result.json。原工作流自然执行作为独立业务事实记录，不算成本批手动导入或补数，也不宣称本批验收了原工作流所有业务结果。未保存原始客户资料。

## 四店界面与图标请求

原四店浏览器验收在 10:14:15 进入 unknown 并停止。另行只读诊断保持原两个入口与全部四店任务断言：初始“请选择店铺”、没有文件时不能导入、四家规范名称及顺序精确、逐店选择保持、客服页面“会话店铺筛选”均完成。最后的全 blocked 判定失败；实际仅为四个已中止的 https://127.0.0.1:3000/favicon.svg GET，resourceType=other，没有 POST 或外部业务请求。

HTTP 图标返回 200，字节 SHA-256 为 38e1742e3c1a5228876c3394cc3cbb597658c1a1dc309fcc30fac91ccb23e7fc，与批准制品 dist/client/favicon.svg 相同。保留 customer-ui-diagnostic-failed.json；没有允许 HTTPS 请求、外部请求或任何 POST，也没有上传或点击导入。这个请求与浏览器图标 HTTPS 尝试现象一致，原因属于推断，不依赖该推断证明界面验收和零业务效果。

## 最终状态查询的独立协调

原最终全量制品/现场准入在 10:55:31 通过，随后 final-readiness-closeout 查询在 10:56:08 进入 unknown，原入口再次保留批次停止。独立仅调用一次原只读 System Status，于 UTC02:58:37 返回 Running/Ready/exact 本候选，12 个组件全部 true，supervisor33224/port41040、Worker72ec/Django237f 精确绑定及恢复清理证据保持。原查询失败的具体原因未观测，不能归因为短暂故障、编码或其他原因。

以独立原实际状态满足全部四个最终断言和完整组件就绪的证据，按原 reconcileOperation 闭合；原 unknown/失败原因未知的事实保留，没有重放服务动作或伪称原 exit0。proof 为 independent-final-readiness-reconcile-proof.json 及其 observations；后续同批 execute 仍须原完整准入，再只闭合批次和释放所有权。

## 完成后的共享准备目录位移

本批在 11:03:20 已由原工具完成并释放所有权；11:05 的独立读取仍为源码 e1f。共享准备检出 D:/运营管理系统-sales-django-release 的原 Git reflog 显示另一个候选准备在 11:06:46 从 e1f 切到其后继 224963800233a8b2ff06f66091217d39d204c1ea（吉客云修复）。本任务没有重置或修改该新来源，也没有把它带入已采用的不可变制品。

已采用版本的事实以本批执行时完整源码/依赖/工具准入、原 WAL、不可变 release/source-snapshot 和实际 Worker/Django manifest 为准；不能再声明当前共享准备目录仍为 e1f。源位移后，旧 e1f 准备/计划的当前来源绑定已失效，后续不得继续用旧证据新执行发布，必须按新来源和实际前驱重新准备、绑定和批准。这个完成后的位移不会回写或改变本批已采用版本。相关 SourceScope 证据随独立生产复审保全。

## 最终验收与计时

全部 19 项原步骤已闭合，末次 closeout 完成于上海 2026/10/9 11:03:20（UTC 2026-10-09T03:03:20.676Z）。4 项独立协调保留原 started/unknown 与全部证据；没有跳过步骤或重放未知生产动作。最终原 Status 为 Running/Ready/exact approved release，12 个组件就绪；两次新的自然看门狗、开机配置、资产及权限核验完成。前后恢复均 profile/sequence true、内容摘要匹配、productionDatabaseTouched=false、serviceStateChanged=false、isolated_data_removed。当前三恢复点为发布后点及两保护迁移点，前点已由原保留策略淘汰，不能再称可用恢复点。生产 PostgreSQL 与 n8n 三个被跟踪进程的 PID/父进程/创建时间保持。

本次新批准到原批次全部必要验收完成 **142.578 分钟**。原 drain/switch 执行跨度 31.227 分钟；这包括门禁及启动协调等待，不是精确停服。切换期间 HTTP 入口采样失败窗口为 14.716–14.767 分钟（上海09:25:25首次失败，09:40:10首次恢复）；客服固定查询对应观测界限为14.766–14.884分钟。后隔离恢复开始前，10:40:40另观测到单次2016.2ms入口请求TimeoutError，随后10:40:42恢复，不能由单次超时认定停服。入口约每秒、客服约每三秒采样，2 秒请求期限，记录的是观测界限，不能当全业务 SLA。

| 阶段 | 原 durationMs 累计（分钟） |
| --- | ---: |
| 原互斥排队 | 0.007 |
| 候选复用与各次初始准入 | 17.782 |
| 前备份 | 15.322 |
| 前隔离恢复 | 14.484 |
| 任务排空与应用维护 | 8.220 |
| 部署、加固、Worker 切换及启动 | 7.454 |
| 必要业务/界面/组件验收 | 11.924 |
| 本批真实补数或业务执行 | 0.000 |
| 后备份 | 12.341 |
| 后隔离恢复 | 13.250 |
| 最终就绪与收尾 | 3.320 |

以上原 duration 累计不含独立协调未写 duration 的跨度；实际总等待以批准到 closeout 的墙钟时间为准。累计未覆盖的墙钟残差 38.474 分钟，包含这些协调、指令间隔和调度，不能丢弃。

| 独立协调 | started 到 passed 墙钟跨度（分钟） | unknown 到协调（分钟） |
| --- | ---: | ---: |
| step-startworker | 18.952 | 原 started 保留 |
| customer-historical-query-preserved | 8.897 | 8.844 |
| customer-four-shop-production-ui | 4.519 | 4.431 |
| final-readiness-closeout | 4.957 | 4.339 |

原启动主体实际记录 4.217 分钟，另列于上述启动完整跨度之内，不能重复相加。首次组合批准到本批必要验收闭合为 **566.278 分钟**：首次执行至安全取消 25.094、修复及新候选准备 46.206、等待新的明确批准 352.399、本次完整执行 142.578，四段均保留。开发报告提交推送及独立复审最终收尾的结束时间另记 production/DELIVERY_COMPLETED.json，不从总交付等待中隐去。

真正避免的是批准后重复 npm ci/构建和未改变 Django 应用的重复准备；完整构建 549.041 秒、相关测试、组合制品、计划和回滚方案前移到批准前。批准后仍重新做候选/前驱/工具/现场绑定、每步复验、排空与权限/启动门禁、原任务验收及严格前后备份恢复。四项现场异常增加了实际等待，本批没有证明比历史约 63 分钟更快，不能宣称已达到稳定生产提速指标。纯展示快路径在本批未使用，日备份仍 PAUSED；启用正式备份调度需另行明确授权，不能从本次上线许可推导。

证据根 E:/codex-artifacts/release-customer-ps5-fix-20261009/production，RESULT.json 为完整计时与结果，journal/ 为原规范化 WAL，production-evidence-manifest.json 为文件 SHA 清单，INDEPENDENT_PRODUCTION_REVIEW.md/json 为独立生产复审；正式恢复点 payload 保持在受控业务备份根，未复制到开发证据目录。源码与开发验证仍以本目录 REPORT、INDEPENDENT_REVIEW 及 FINAL_CANDIDATE_REVIEW 为准；58 新发布验证与此前准确闭包复用的 254/43/11 证据不能表述为新执行全仓测试。


本批实际计时与 [隔离同条件对照](../release-wait-optimization-20261008/isolated-timing.json) 分开报告。隔离样本为一次小合成数据库/私有 HTTP 机制验证，266.80→47.61 秒不能当生产停服或稳定性能承诺。原 2026-10-07 约 63 分钟记录也不与当前不同范围的严格采用直接作性能承诺。

首次组合批准 UTC2026-10-08 17:37:04 的 [旧批次失败与安全取消](../release-customer-combined-20261009/PRODUCTION.md) 仍保留：25.0943 分钟到取消、修复与新候选准备、等待重新批准和本批执行分别列示，不能只展示成功续接后的时间。
