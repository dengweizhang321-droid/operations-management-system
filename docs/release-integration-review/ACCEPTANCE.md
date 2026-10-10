# 最终组合联合验收清单

第一阶段所有执行项当时均为 **待执行**。第二阶段当前结果见[组合报告](REPORT.md)及[非作者逐项复审](COMBINED_INDEPENDENT_REVIEW.md)。下面保留原预期断言。H-A/H-C历史交接阻断现已凭精确最终证据闭合，H-R恢复快路径资格仍拒绝；源码/隔离通过不代替[发布方案P01–P06](FINAL_RELEASE_PLAN.md)生产步骤。最终记录提交/文件SHA、夹具、日志、退出码、原失败与清理，通过/失败/未覆盖/阻断分别表达。

| ID | 文件/接缝 | 联合触发条件与必须保留的断言 |
| --- | --- | --- |
| J01 | release-batch / lifecycle-step / process-deadline / readonly-retry | 真实PS5/PS7/Node子进程直接exit0，孙进程分别继承stdout/stderr/双流；再加入Status瞬态失败和B重试。文件协议完成不等后代EOF；总预算取A父期限与B预算更早值；Start/apply/Backup/Restore及业务计数恰好一次，unknown不能自动重放。单次预算不泄漏给永久supervisor；A预算字段处理与C完整环境身份精确兼容。 |
| J02 | lifecycle-step / Control / Worker service | 主页200或曾ready，同时原引擎exit9、非法/不完整JSON、无完成证据、迟到结果、错误release/manifest/PID、缺真实已启用域、维护/drain owner错。全部拒绝passed；页面健康不能覆盖引擎和身份失败，bool/小数PID及任意12键不能冒充就绪。 |
| J03 | runProcess / native cleanup / service / watchdog | 生命周期超时保留主体/精确元数据与占用；只读探针仅结束其持有内核句柄的直接子进程；模拟正式服务后代仍活。普通测试树在原预算内清理，短预算未确认树退出须失败并明确pending，夹具拥有者精确收尾。禁止泛化killtree、taskkill映像名或端口归属猜测。 |
| J04 | batch-admission / readonly-retry / closeout-report | 恢复完成后首次Status瞬态失败、可重试后通过；再测身份/权限/manifest/未知错误、落盘超时、父预算耗尽和全部重试耗尽。仅精确只读Status获得声明重试；原错误与attempts create-only保留；失败不得写completed、释放active或用早期ready替代收尾门禁。 |
| J05 | release-impact / full source inventory | 实际前驱完整文件集合比较，增加app/api导入写路由、鉴权/权限/配置/依赖/自动化/迁移以及混合UI变化；加入删除/改名/闭包变化。无法证明必须strict，Django manifest相同不够。正例覆盖C窄JSX/CSS/PNG/被动布尔显示；反例含资源URL、submit/disabled、事件调用、assignment/new/tagged template/custom is/return副作用，全部拒绝展示。 |
| J06 | admission / recovery catalog / daily wrapper | 日备份PAUSED、缺回执、最新失败/unknown、超过26小时、恢复非同点/超过7天、dump或sidecar变动、被轮换淘汰、权限/软件/schema/序列漂移、缺清理证明。任一均拒绝快批次；手工点不能冒充自然调度成功；不自动启用e/解除保护/增加第四个长期名额。完整前后恢复验证由第二阶段隔离库完成。 |
| J07 | preparation-evidence / in-process collector / guard | 预备身份复用后修改源/Git index/npmrc/config/toolchain，缺失父目录创建、watcher错误、跨批/并发、10分钟/24次边界、结果对象外改、异常dispose；均失效。每轮完整字节读取及动态进程/权限/维护/排空/恢复资格仍现场核验；drain/apply/Start/closeout的完整检查不减少。WAL后失效保留unknown。 |
| J08 | journal / reconciliation / historical preservation | 原started/unknown/failed/reconcile链不能重写；重复续接只跳过同批已确认passed。证明零效果前不得重试，已开始切换不得取消；错批/错操作/观测SHA/不重放声明拒绝。历史聚合旧基线保持unprovable；同截点/同范围行身份与内容、来源回执及迁移标记负例覆盖，合法重导不伪称原内容不变。 |
| J09 | closeout-report / admission-timing / UI audit | 最新操作unknown但旧completed存在、缺回执/日志/hash或未覆盖验收；报告保持release-incomplete及acceptancePassed=null，明确未测。父操作和子attempt/admissionStage/engine/validation区间不重复相加；执行区间按真实结束后裁剪并取并集。实际源码UI、正常资源SHA与精确被阻止图标分别验；未知网络错误/危险请求继续失败，ServiceWorker封锁。 |
| J10 | source snapshot / packer / guard entrypoints / final batch | 对实际前驱→批准组合全量差异列文件/内容/依赖原因。主线未批准功能不得入候选；A helper和C新模块必须在runtime/保护入口/适配器/安装/恢复闭包中可达且pin准确。旧前驱首次新增helper、安装中断、前驱变动/旧计划、篡改工具/制品/声明重算batch SHA均拒绝。 |

## 并发、安全续接与回滚补充

- [ ] 两批/两个runner争用原互斥、active owner、request gate；后到者明确阻断，不能交错变异动作。
- [ ] WAL fsync started后进程中断、完成后结果丢失、collector阶段失败、回执落盘失败；保留原事件和脱敏观察，不伪造exit0。
- [ ] 旧v1未决批次使用原固定代码/协调入口；新v2不换绑旧批准、参数、工具摘要或恢复回执。
- [ ] Worker-only严格保持BeginWorkerDrain→StopForRelease→apply→Start→EndWorkerDrain；typed lifecycle、唯一顺序/owner，拒绝IncludeBackend/伪step/额外写动作。解除失败仍留gate；完整流程使用原维护能力。
- [ ] 原前驱兼容代码回退、失败门禁和启动绑定在隔离演练验证；迁移PNR/数据库恢复范围单独判断，不恢复D1、不删guard/authority/journal。
- [ ] 两次自然守护等实际采用验收项写入最终批准方案；本轮隔离通过不冒称已在生产执行。

## 当前阻断与不确定部分

| 编号 | 精确出处/触发 | 后续修复或取证要求 |
| --- | --- | --- |
| H-A | A `65c7b8a9560d7143e77f992a6728d42461aead69:docs/release-process-deadline/INDEPENDENT_REVIEW.md` 列helper未进入workerGuardEntrypointPaths；后续67622d61作者REPORT列guard首引入/恢复8项，独立报告尚未封存 | 这是历史阻断待最终闭合证据，不宣称当前源码仍有缺陷。由最终A交付提供最后源码/旧前驱首次引入/中断恢复/最终非作者复审及SHA对应证明。 |
| H-C | C `f11db8a11ad07ebc346a86b8062226d1289419a5` 未含最终复审/交付；现场未提交报告仍写最终待封存 | 取得最终精确源码、日志、计时范围和非作者审查结论；中间78项/12探针不能冒充最终组合回归。 |
| H-R | 发布历史/任务C方案记录日备份e为PAUSED；D本阶段未实时复核 | 快路径资格默认未获证明，最终现场任一资格缺失必须拒绝；日备份采用另需配置授权，本任务不代办。 |
| U-01 | runtime-risk的R01代理退出、R03部分状态保留、旧closeout根因/单请求截止 | 未因A/B/C完成而宣称修复。第二阶段按最终变化复核影响，确属发布阻断时列具体文件/触发/修复要求；不无关重构。 |
| U-02 | 历史3299→3302只有聚合旧基线；旧前备份载荷被策略淘汰 | 不补造旧行证明或宣称旧dump仍可恢复；新行基线/当前保留回滚点需新取证。 |
