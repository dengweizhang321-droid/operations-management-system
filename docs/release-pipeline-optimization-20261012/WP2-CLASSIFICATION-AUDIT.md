# WP-2 发布分类与保障审计

日期：2026-10-12任务，Asia/Shanghai。集成baseSha：`b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354`。结论：规范按最终候选代码与已采用范围对齐，验证、数据库保障、维护、切换、恢复五项分别记录；**组合L3缺口未闭合，暂不合main，不生产发布。**

## 最终代码核验与正文归属

本轮未改`release-impact.mjs`、`release-batch.mjs`、admission或生命周期适配器。其base与集成候选字节一致；新增产品字节仅为CI设施、服务包装器退出码及离线收尾投影。固定五交付与合并关系见[交付表](DELIVERY-TABLE.md)，逐文件集合见[机器交付清单](DELIVERIES.json)。主检出不作为候选。

逐体核对`classifyImpact/V3`、`bindDeploymentImpact`、`recoveryDecision`、`requirementsForImpact`、`backupReuseDecision`、`validateToolsNoMigrationScope`，以及makeBatch/verifyBatch、原Worker plan/apply/Start、Django PrepareApp/DeployApp/迁移与已采用gate调用链。结论：

- v2恢复策略为display资格全部成立时reuse，否则full；26小时点、7天同点完整恢复、ACTIVE自然调度及当前摘要仍必需。原备份e仍PAUSED，不能据手工备份取得reuse。
- v3默认批次只有窄CSS/完整静态被动TSX证明、完整前驱/候选字节、非源码准备输入一致、Django/备份机制不变和精确副作用报告全部成立才not-required。GET、筛选、PNG、局部交互、文档、查询/启动/备份工具不因此自动零DB。
- v4不是普通fast模式；显式完整tools-no-migration与严格资格、精确批准，恰一次前Backup＋新installed消费链同点隔离Restore。f15已实际完成这个范围；不升级旧WAL、取消旧阶段或追认先前失败。
- 原Start在后端未就绪时可能迁移/复位权限/启动渠道；原真实部署输入和Start调用门必须独立核，不把Worker-only等同无副作用。Restart只作用同effective head，不能采用新候选。
- full/reuse/not-required是数据库保障决策；L0–L3是验证强度；KeepPostgres/Worker-only是维护及切换范围。这些不同轴不得压成风险标签。原integration gate、迁移保护、PNR、应用兼容回退与另批数据库恢复保持。

唯一正文为[验证与发布规范](../规范/验证与发布.md#发布影响验证与恢复策略)。`RELEASE_BATCH_WORKFLOW.md`移除重复分类/复用/v4正文，仅链接并保留原准备、封存与续接命令。启动优化和数据存储专题链接该正文。AGENTS不变。历史设计/验收报告保留原时点，不重写成新规则。

采用范围依据[WP-B](WPB-BASELINE.md)及[原最终采用报告](../release-final-closeout-20261012/FINAL_REPORT.md)：v3工具支持已随f15采用，普通零DB完整生产周期/净收益未测；缓存missing-parent资格、永久Status与全维护Stop选路兼容采用仍有独立缺口。离线草稿`acceptancePassed:null`；测试声明完整和静态摘要不能提供当前readiness。

## CI强度与组合放行

组合真实差异包括package.json以及未被CI所有权表映射的发布工具/测试路径；固定计划`requiredLevel=3`、全部18域。没有根据“仅新增npm脚本”或“基础设施”人工下调。L0实际21项切片通过而完整lint失败，L1本机58项及PS5夹具通过；13个L0/11个L1域缺口仍在。L2/L3业务HTTP/真实PG/完整冷启动尚未完成且入口不能发正式passed，不能凭合成SQL或CSS探针放行。

本次没有完成更高级别必要验证，因此保留集成分支并阻断main。没有为关闭缺口重写各业务测试、扩大所有历史故障修复或运行不安全test:unit通配符。最终组合验证与云端原失败见[统一报告](INTEGRATION-REPORT.md)。

## 2026-09-25至10-08历史对照

范围为下列可追溯的仓库生产记录与原公开摘要；不声明已经取得该时段所有发布的完整目录。逐份来源SHA在`HISTORICAL-SOURCES.json`。本轮不运行旧候选、Status/Panel、备份/恢复、业务HTTP或生产分类器；不读取dump、配置值或客户行。表中“full事实”描述原已执行保障，不给旧批次重新盖现行策略资格章。

减免判断分两层：迁移/权限/自动化/真实写链的正面证据足以否定“名称就是无影响”；要断言某批次满足精确机器分类或可省哪些动作，还需原完整前驱/候选集合、非源码准备输入及副作用复审。只有版本ID/资源匹配/无迁移或前后某些响应相等不足。缺这些输入统一标**无法据现有证据判定**，不造纸面display/full/reuse/not-required运行结果。

| 实际记录/来源 | 证据内的实际影响、切换与保障 | 当前分类资格判断与未完成边界 |
| --- | --- | --- |
| 09-25 [4163恢复](../evidence/jackyun-4163-recovery-production-20260925.json) | c695源码、67f Worker、原前驱/plan摘要；Worker/helper采用、原完整n8n业务补跑；Django未重部署 | 业务执行授权与代码采用分别核；完整前后源码/部署输入不在本次证据集中，精确减免无法据现有证据判定；历史DPAPI根因未知保留 |
| 09-26 [DPAPI重试](../evidence/jackyun-dpapi-retry-production-20260926.json) | 073d/e45、真实有限登录重试与共享错误分类器采用；前备份/隔离恢复及原完整业务验证 | 自动化/凭据与失败重试路径有真实变化，不能按Worker-only减免；精确策略无法据现有证据判定；真实运行未触发新增重试分支 |
| 09-27 [4726](../evidence/jackyun-4726-production-20260927.json) | e03d/816、精确关闭及一次原完整工作流，原plan/successor与启动绑定 | 写链/零效果关闭与业务补跑并非被动展示；精确减免无法据现有证据判定，不覆盖旧error |
| 09-27 [安全恢复](../evidence/jackyun-safe-recovery-production-20260927.json) | 75a8/945；一次Worker/helper切换；PG/Django/n8n保持；前点Verify/隔离恢复 | 恢复逻辑不受v3窄展示证明支持；缺完整非源码输入，精确策略无法据现有证据判定；自然失败分支当时待验 |
| 09-27 [推广聊天暂停](../技术专题/AI助手/ai-promotion-chat-pause-handoff-20260927.md) | 旧固定源误读后只重新准备bb4候选，前备份恢复；新工具未apply | **准备未采用**，不能算一轮完成发布；无法据现有证据判定减免；不以候选误认运行包 |
| 09-28 [统一安装](../evidence/integration-production-20260928.json) | 4aec组合、a649 Worker；迁移收据62→138、76步，前/installed独立恢复与受控安装gate | 受保护迁移实际发生，显然不能凭页面名称not-required；不重演现行精确classifier或宣称旧版本符合新v4 |
| 09-28 [备份保留](../运维/备份与存储/backup-retention.md#2026-09-28-生产验收) | 新备份链、E根ACL/中文运输/后台模块修复，四维护、实际导出上传/隔离恢复；原自动清理blocked保留 | 备份/生命周期机制实际变化，需要该链独立资格；当前精确减免无法据现有证据判定，最终成功不追认原blocked |
| 09-29 [七项组合与容量追加](../历史记录/性能与发布/optimization-production-20260929.md) | 2f1b/e980、e92追加Django；生命周期、Inspector、备份、12工作流；前Backup/恢复，后容量预检失败后单独采用修复并Backup/Verify | 工具/自动化/备份机制正面变化，不是展示免保；旧完整策略不升级；自然调度e仍PAUSED、历史退出根因及长期内存待验 |
| 09-30 [5400零成本](../evidence/jackyun-5400-zero-cost-production-20260930.json) | 精确业务任务修复/补跑的生产摘要，不是“零成本=零DB效果” | 部署输入/完整闭包缺失，无法据现有证据判定；业务授权不外延到未来重放 |
| 10-02 [网店方案二](../netshop-refactor/execution/20261002-production-adoption.md) | 22a/4dc、Django692；KeepPG Prepare/Deploy/apply/Start、前Backup/恢复、后Backup；实际五栏仍503 | API/跨域/来源与后端部署事实成立；无法据现有证据判定精确减免；已采用不等于业务全部验收，外壳尾挂exit-1保留 |
| 10-03 [SQL组合](../netshop-refactor/execution/20261003-combined-sql-production.md) | 8707 peer URL＋21d期限SQL；Django76f，Worker87保持，应用维护/前后保障 | GET查询/配置不能自动免保；完整非源码输入不足，无法据现有证据判定；不把已有索引或隔离速度当生产P95 |
| 10-03 [presence](../netshop-refactor/execution/20261003-presence-production.md) | f9/6b、迁移138→139，cache字段/回填/revision变化；295表比较、后Backup/恢复；财务真实403 | 存储/缓存/迁移明确变化，不能按读取命名not-required；实际身份缺口与外壳exit不可得保留 |
| 10-03 [财务兼容](../netshop-refactor/execution/20261003-finance-edge-production.md) | 精确本地签名身份兼容候选及实际采用/权限和业务验收 | 鉴权行为不属v3展示证明；缺完整部署输入，精确策略无法据现有证据判定；不据兼容补丁开放其他权限 |
| 10-04 [全部店铺](../netshop-refactor/execution/20261004-all-shops-production.md) | 5686/e4f Django、Worker87保持；原KeepPG；前后全部295表等价与各同点恢复；Start退出码未知 | 全表相等说明当时比较范围，不证明源码/部署影响无副作用；无法据现有证据判定not-required；月DTO取消和自然守护未闭合截点保留 |
| 10-04 [京东来源](../历史记录/自动化/京东/jd-query-source-adoption-20261004.md) | 原读取来源修复/后端消费者采用记录 | 传输/所属查询需契约及权限验证；非完整前后准备输入，无法据现有证据判定减免；不能凭GET或来源标题分类 |
| 10-05 [5478](../历史记录/自动化/吉客云/jackyun-5478-production-20261005.md)、[10-04任务恢复](../历史记录/自动化/吉客云/jackyun-oct4-recovery-production-20261005.md) | helper/任务安全恢复与原n8n完整执行，原前/后保障；部分外壳输出另回查 | 安全恢复与实际导入属于独立作用范围；精确减免无法据现有证据判定；不把独立底层成功改写外壳码 |
| 10-05 [商品试点](../历史记录/性能与发布/product-overview-speed-production-20261005.md) | Django426/139、Worker62c；前后Backup/Restore；原Exit锁拒绝/Start维护拒绝，外壳误exit0 | 后端查询/分区/契约实际变化，非被动显示；完整前manifest此前未保全，无法据现有证据判定精确减免；[WP4](WP4-TIMING-ANALYSIS.md)保留错误码冲突 |
| 10-06 [五项组合](../历史记录/性能与发布/performance-five-production-20261006.md) | 2f46/Django c51/139/Worker463d，冻结范围/业务四域/UI31验收；两Backup＋两Restore | 存储/查询/生命周期组合必须按实际闭包核；缺完整前后准备输入无法据现有证据判定精确减免；首Restore缺ID失败36.516秒保留 |
| 10-06 [BI两窗口](../历史记录/性能与发布/bi-cockpit-production-20261006.md) | 首139→140迁移/源查询；Plan34.351秒失败、真实传输漏准入，后继修复另采用；两个完整保障窗口 | 迁移和真实来源接缝有证，不能按驾驶舱展示减免；两个窗口不拼成一次成功；不凭最终Ready覆盖首次业务失败 |
| 10-06～07 [公共筛选/布局](../shared-filter-20261006/PRODUCTION.md) | ed208/339及后继布局组合，Worker/helper切换、Django d739/140保持；十UI文件、真实行为/原响应与资源、前后保障 | 事件/URL/filter/消费者语义不是v3被动TSX；完整非源码输入未齐，无法据现有证据判定减免；原生输入法未验保留 |
| 10-07 [广东入口](../guangdong-plan-entry-20261006/PRODUCTION_20261007.md) | 5cb/316，仅两UI＋导出列名，复用备货保存入口；只读实际UI/合成保存、前后Backup/恢复 | “UI入口”连接真实保存，不能按文本分类；缺前完整部署输入，无法据现有证据判定not-required；真实保存/外发未测 |
| 10-07 [京东客服](../历史记录/自动化/京东/jd-customer-service-release-20261007.md) | 716f/8d7 Worker/helper＋新n8n图启用，真实30日导入6947；前后Backup/恢复 | 自动化/导入和渠道变化明确，不按Worker-only减免；原失败6941、歧义与来源差保留，首自然执行当时未验 |
| 10-08 [天猫七日循环](../tmall-seven-day-gap-loop-20261008/PRODUCTION.md) | 5430/cff＋ff203/c203后继、Django02f/140；六图发布/真实补数/序列变化、前中后保障；末恢复 | 循环、幂等、真实导入/定义与机制变化明确；非GET/display；原部分M失败、自然runner失败、可选策略语法见证未验保留 |
| 10-08 [AI客服库存链](../ai-customer-inventory-chain-20261008/PRODUCTION.md)、[客服四店](../jd-customer-service-four-stores-20261008/PRODUCTION.md) | 由对应固定源码/候选/真实渠道与导入采用记录限定，不混入前一批天猫包 | 权限/工具或多店执行不能按业务页名称减免；本次未取得各完整前后非源码部署输入，无法据现有证据判定精确策略；限定已验与未验按原记录 |

上表不是重跑历史classifier。不能据“有Backup”认定它当时不能减免，也不能据“无迁移/固定响应相等”认定它可以减免。未取得完整证明的记录既不计为可优化样本，也不计为本轮验证通过。历史候选暂停、未部署和后来追加采用分别保留。

## 已证时序与后续候选

[WP4](WP4-TIMING-ANALYSIS.md)补齐f15完整T1=19小时52分5.160秒；原19小时42分42.973/42.976分别为必要验收/批次完成，维持原值。T2认证业务连续总秒未测；六unknown补证跨度属于T3且与T1/T2/子阶段重叠。26次准入3544.472秒是限定毛成本，正常同点Restore666.826秒不是故障恢复，也非可全部取消成本。

本轮仅对齐规则与记录，不实施WP4新并发、缓存启用、恢复阶段重排、自动hook或资源监控。这些需各自隔离等价/失败验证及独立范围，单列后续需求。当前三项候选产品/基础设施的生产准备及授权需求见统一报告；没有净省分钟数、SLA或“六次生产发布”承诺。
