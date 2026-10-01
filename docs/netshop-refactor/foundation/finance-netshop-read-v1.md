# I公共财报专题读取 v1

2026-10-01，I专属作者Teammate；codex/netshop-finance-support，独立树 D:\.codex\worktrees\netshop-finance-support\运营管理系统。准确开工父73f23edbfb0b4d348e408175607a86e9fc4d7d58是I已测接线候选，开工actualmain为3fd37357，不能冒称本core已main。I独占旧annual17行改动cda2d860已通过普通merge c09f79c8同步本树，未cherry-pick/替I改旧文件，也未借未冻结Sales op或Sales query算法。

## API与精确接线请求

- 新Python文件finance/netshop_reads.py：validate_netshop_read(payload)，read_netshop_finance(principal,payload,*,deadline=None,annual_provider=None)。
- 新内部client netshop/finance_netshop_client.py：validate_finance_request(payload)，read_finance_netshop(principal,payload,*,deadline=None) → (data,finance_revision)。
- 新TS lib/netshop/finance-netshop-contract.ts：validateFinanceNetshopRequest、decodeFinanceNetshop(data,request,owningRevision)。
- 新固定operation netshop_finance_read_v1，schema finance-netshop-read-v1；只在现签名POST /api/finance/consumers/query使用，不创建新任意URL代理。请求仅operation、shopKeys（1—50原生JSON二元组）、months（1—24显式自然月）、year、可选expiresAtEpochMs/expectedRevision/snapshotToken。canonical key如["京东","同名店"]，非F outlet分隔符；空范围、非规范键、重复项、日范围、SQL/caller URL均拒绝。

I串行接线需要：

1. finance.consumers 的validate/execute增加新op早dispatch到本模块，不改变旧三search shape/权限。
2. finance.views.consumer_query 对新op直接单次read_netshop_finance、沿原verify_principal和finance JSON响应/owning header；不套旧_consistent_read两次loader重开65秒。旧op完全保留。
3. 原annual_progress增加shop_pairs可选参数及facts/targets/promotion精确过滤在5001候选scan/分页前，由I cda2完成；None原行为保持、[]明确空。新wrapper只调用支持该参数的provider；不支持时dependency_pending，禁止全域第一页后筛店。

没有修改旧finance.analysis/annual/consumers/views/权限/源模型、利润/目标算法或旧TS reader；未注册API/共享入口/S/C页面。本作者新core仍需Q/I实际组合复核后采用。

## 原拥有方DTO、basis与缺数

monthly复用get_finance_analysis完整原DTO；不重新计算利润/目标，不把native current/previous/yearAgo/年度累计重解释为F日范围。请求含未导入月份时保留requestedScope及monthEvidence，actualMonths明确为原完成月份，carrier selectedMonths是实际读取月份；不得把缺月金额当完整期间，别的店也不自动代替。非整月日范围由S另标实际自然月边界，此op不接受startDate/endDate、不按天线性摊月。

原_metrics默认0，shops还会省略“销售与毛额0、无月目标”的店，因此：

- 额外fieldEvidence为精确pair×实际相关月×12原字段的rows/amountPresent/ratePresent矩阵，current及原native previous/yearAgo各有单独状态；无行/NULL不升级成0。
- monthEvidence.metadataVerified只说明FinanceMonth完成、当前batch完成并包含该month的结构关系，不声明原工作簿字节/网店映射已核验。
- currentMetricStates/comparisonMetricStates只在对应实际月、全部请求pair的原amount presence与已核关系成立时，引用拥有方原current/comparison数值。profit仅纯direct或纯原fallback路径；混合不假装完整。真实numeric0可available，即使原shops省略。
- 推广费、原默认/聚合率缺额外证明，明确unverified_source；raw carrier的BPS不作为已证实指标。成本NULL、缺月、无记录、未验证关系分别说明，不能补0成本/利润。
- annual是原精确provider全年目标与实际可用月累计进度；target=None、实际目标0、无财报金额null与缺月分别保留，category/month/project目标不冒全店年度目标。annual grossMargin/promotionFeeRatio字段本core仍显式unverified，不能借默认0冒证明。
- metricSemantics闭合声明finance_month / finance_year_progress / finance_year_target、原BASIS_POINT，不混日/月年；网店采集身份映射unverified，dailyAllocation与distributedSnapshot均false。

完整carrier保留全原财报字段（包括其原目录/项目引用），不是只含S已证实金额的简化对象。S/C应消费明确状态与年度目标，不把raw默认值当已验证事实或推事件因果。

## 权限、版本与预算

四role viewer/analyst/operator/admin且scope None，按原analysis/annual门槛，不套businessSource admin-only或search的不同scope规则。真实AppUser仅查询email/role/status/scope/version五列，前后比对；普通缺actor/撤权失败403，无自动GRANT或新增列。

Finance owning_revision是安全整数rev:12位lowercase digest，精确请求＋actor绑定scope/snapshot，前后复核finance版本、month batch metadata，无cache。新的expiresAtEpochMs是签名body UTC安全整数，只按同机时钟收缩父剩余期限，不声称跨域/分布式原子快照。

65秒覆盖入参、actor、SQL前后、provider、body/序列化与末核，父deadline不可延长；已有正在执行SQL不会由此helper强杀，到期不再启动read SQL，允许事务cleanup。2MiB核算完整operation/data信封；unsafe scalar/超容量明确422，不截carrier/字段/月份。

HTTP client固定native finance reader env命名和HMAC协议，无writer/任意caller URL/SQL；401/403权威状态和409版本失败不读取上游body，通用消息不回显；2MiB/body/deadline及完整native scope/类型绑定保持，原其他路径不变。

## 作者验证与独立范围

E独占根：E:\codex-artifacts\netshop-scheme2-20261001\finance-netshop-support\author-20261001T112409+0800-5853b823e68249c5b061dcb4569ad5be。

- oldannual cda的窄独立PG3测先交I：None原DTO序列化字节/值与immutable73原Git源码在同PG相同；[]empty；跨平台同名native180000/120000分；5002无关年度目标令旧全域>5000拒，exact ZZZ非首页目标预过滤后可读。评审未写该旧file，仅签该子集，不称新wrapper Q-ready。回执annual-cda-independent-narrow.json。
- 新core作者private PG最终final06共18通过：native完整monthly/annual、真实0但shops省略/NULL成本/缺月、no target与目标0、5001之前scope、四role/scope/live actor/cache、合法writer触发revision变化/actor变化、父/UTC deadline/2MiB、native signature与401/403/409体不读、未知URL/SQL/重复JSON/错误scalar/basis。仅私有fixture/in-process签名，不冒已接真实public RPC。
- 按既有runtime声明在私有PG模拟5个finance SELECT table和原grant_actor_read；真实五列actor查询可读，撤version后failclosed503且事务已回滚，没有自动补GRANT。仅私有fixture角色，无生产权限变更。
- 实际PG DTO送严格TS decoder7项通过/无skip；四个小DTO原字节保全为repo fixture后，默认环境7项也通过。检查完整carrier/owning header/scope/month/value units/presence/default0/全年target身份与原progress/预算。定向lint、backend boundary/diff通过；全库typecheck exit2、188继承诊断，新增两TS文件0诊断。未执行真实来源或UI验收。
- run01全15失败保留：测试误用直接revision行重写被既有guard正确拒，非越过guard修复；改为正常原protected writer变更。后续正常run与独立annual3证据分别保存，不相加冒独有用例。
- 自有venv/npm、动态私有PG，runner仅两专属finance/netshop测试模块及其子方法、拒主目录/5432/无E fallback；最终命令、SHA、静态检查、PG正常stop与独有尾日志保全见作者交接。

未生产部署/维护停服/迁移/重启、真实下载导入/补跑、付费调用或外部通知；不能把候选、新op未接线或作者测试称生产采用/独立Q完成。
