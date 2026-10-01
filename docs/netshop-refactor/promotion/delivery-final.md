# A M4 最终候选交接

2026-10-01。业务冻结 `5e97bc8735736b3979914b84e59dd37cbc247af0`，独立Q定向复验通过；已正常推送并独立核验远端该SHA。普通合入Q83cebb38后为 `197cd214`，只新增三份复核测试，业务源不变。最终公开Home组合、main合并与工作树清理由I负责，本交付不提前称整体M4已获I验收。只推 `codex/netshop-promotion`。

## 1. 基线与实现

正式开工 `9d4830ee50232b956bdb9c1c7dd5b30564805355`；正常合并共享 CPC39bc及商品正式 main `77a26703b143288edd91fbab40c6741ed487e698`。保留 view=promotion、京东/天猫和选定01经营双栏、系统配色字号与顶部导航；删除旧深绿推广标题卡片，显示 ROI，内部 roas/平台归因金额÷花费倍数不变。

| 分区 | 已实现行为 | 来源边界 |
| --- | --- | --- |
| 5.1 | 花费、归因成交、ROI、展现点击、CTR/CPC、源订单、比较和主/辅费率 | 完成批次及manifest/state/raw/shop/product对账；整期店日不足主值null |
| 5.2 | 日/自然周/月、效率与成本、日期对象焦点、增减贡献 | 全集比较再搜索分页；焦点不改顶部整期汇总 |
| 5.3 | 多店投入产出、占比、变化、效率、覆盖；单店折叠 | 精确店铺列，跨店同ID分开 |
| 5.4 | 京东跟单SKU分摊/天猫推广商品、整期详情及精确P焦点 | 唯一真实映射才钻取；无ID核查桶，多义/未关联不冒无投放 |
| 5.5 | 真实计划单元ID/名称、贡献变化和关系，有条件启用 | 原管理员、京东志高商用设备旗舰店、1—7日，真实字段门槛 |
| 5.6 | 词原文、plan/unit/match、花费点击归因与变化，有条件启用 | 同上；原词文本不称独立平台词ID，缺字段说明缺口 |
| 5.7 | 原Panel/HTML/XLSX、观察与核查建议、来源追溯，禁用付费解释 | 原单店1—7日；原紧邻前等长基期单独标明，不冒本页F比较导出 |
| 5.8 | 金额订单定义、来源向量、店日覆盖、字段能力、映射与不可比项 | 未核归因窗口不造值，不推客户/自然成交/利润或增量 |

## 2. 来源能力矩阵

| 来源 | 核验能力 | 缺口/限制 |
| --- | --- | --- |
| jd_promotion | 花费、归因总订单金额、展现点击、订单行、跟单SKU | 不是广告增量、利润或客户数；触发/推广/跟单分别建模 |
| jd_sku_daily | 同平台×店铺×日期成交分母，可靠SKU身份 | 不能借另一店或日期成交填费率 |
| tmall_promotion | 花费、归因净成交、展现点击、净成交笔数、推广商品 | 未验收的计划/词及独立触发SKU关系不启用 |
| tmall_product_daily | 同店同日SPU成交配对分母 | 缺日/多义映射不补成整期可比 |
| 原京东诊断明细 | 指定店/管理员/1—7日计划单元词与原报告 | 未扩展到其他店、天猫或长周期 |

canQuery是资格，字段状态另验；unknown count=null不当0。主paired-whole与辅助matched各有范围、覆盖及来源，零匹配不可用。搜索只改对象列表，详情原整期。

## 3. 接口样例与消费合同

见 [contract-v1.md](contract-v1.md)。列表 `GET /api/netshop/promotion-insights`，详情同路径 `/detail`。完整DTO通过实际decoder及 `X-Netshop-Data-Revision` 验证；版本netshop-promotion-v1，CPC复用共享netshop-money-per-count-v1。

列表示例：`platform=京东&dimension=sku&startDate=2026-09-01&endDate=2026-09-07&periodKind=custom&trendGrain=week&objectKind=product&page=1&pageSize=20`，outlet为精确shopKey。P焦点用共享四元JSON productIdentity；详情使用本次真实rowKey/shopKey/objectKind/sectionToken，禁止自造token。列表拒绝详情专用objectId/shopKey。

十份完整actual Python→TS DTO在 `tests/fixtures/netshop-promotion/response-*.json`，[逐份来源](../../../tests/fixtures/netshop-promotion/README.md)记录精确产生版本：基础product/plan/detail、19/21部分配对、错位店日、缺ID，以及跨店P焦点/未关联/多义/详情。是独立合成PG实际输出，非生产数据。

## 4. 测试、截图与审查SHA

证据父目录 `E:\codex-artifacts\netshop-scheme2-20261001`；新轮CreateNew，旧失败不覆盖。

| 项目 | 结果/证据 |
| --- | --- |
| 最新作者reader770afc53 | 117/117 PG（44A+6Report+32shared+35公开接线），SystemCheck0/normal stop；promotion-query/author-review-deadline-12/foundation-pg-21f970cf488e |
| Root5e97直接相关 | 121/121 Node、相关lint/diff0；严格枚举12例、列表详情键、HTTP权威状态19例 |
| 前轮独立11cf | Node115、独立PG121；实际组件10/10与失效/恢复；promotion-review/final-11cf268d-086e9b65d5f449e5a5415c7a548a8ad4/review-final.json及ui-04-restored-active-source6.jpg |
| 实际双格式导出source4 | HTML45422B/XLSX18285B、13sheet含范围来源；480数字及929非空/标题一致；7空字符串保持原空白输出语义；版本4:a5db22ea0ecf，本期9/1—7/基期8/25—31均21源行 |
| 全库历史11cf | 3020tests/2999pass/0fail/21skip，concurrency4；build0；boundary583模块0；类型188继承诊断/A相关0，不称全库类型通过 |
| 新冻结5e97 | 全库3045 tests/3024pass/0fail/21skip，concurrency4、375.3秒；whole build0；boundary593模块/0违规；fresh类型188继承诊断/A相关0 |
| 新独立Q5e97 | PostgreSQL91/91；追加真实SQL/savepoint清理3/3；Node132/132+状态取消4/4；自己freshPG实际10DTO10/10；四阻断关闭，review83cebb38clean/pushed |
| 新Q测试Root继承 | Q三测试正常merge197cd214；新增TS枚举6+HTTP无限正文/取消4共10/10，lint0；业务仍与5e97逐字节一致，不重算全库测试计数 |
| 额外构建产物检查 | rendered-html.test.mjs 20项：18pass/2旧公共源码形状断言fail（stat-period-picker、shop内联nav aria-label）；该测试及shop-module与main77逐字节一致，已交I串行处理，原失败保留；不称所有检查全通过 |

Q-A01闭合字符串枚举、Q-A02每SQL同一65秒前后期限、Q-A03列表拒绝详情键、Q-A04坏401/403/409正文仍保留失效意义均已独立定向闭合。Q新回执为 `promotion-review/qa01-04-5e97bc87-f032712fcd58410bb1b962d1a8c180dd/q-a01-04-final.json`；四轮自有PG正常停止，旧失败不覆盖。旧Q的P导航目标/模拟返回不代替真实P/A公开Home组合。

I已普通合入5e97为干净实际业务组合 `0cca249977b486e06152eea87ed5a16169d545ef`。总控Q已复演6枚举拒绝、9HTTP正文权威code、期限后真实SQL0、列表专用键拒绝，以及实际JDsku/天猫spu的P详情→A精确list/detail调用和跨店/错维度/token/actor反例；真正Home父清理、取消与返回仍待最终工具及GUI回执，不能以接口调用替代。

I测试工具bdf2b817作者实际Home24/24，组合4be9b091792354ccb4f423becbd3648cde5b46d7已推集成分支；业务与0cca等价，总控独立Q真正Home24复验在途。此为I交接进度，未冒总控最终独立签字或main发布。

Root5e97全库/build/type原日志已逐文件SHA保全到 `promotion-integration/final-5e97`；`manifest-v2.json` 为准确回执，保留最初manifest.json中沿用旧boundary583计数的记录并明确更正为实际593。

Root06 source6七日实际JSON在 `promotion-integration/root-ui-pg-06/actual-capture-final-source6/manifest.json`，owning `6:cc2ab9667d7e`，自然周/6日对象焦点/精确商品详情/原报告两期。原HTTP字节在header+strict decoder通过后CreateNew保存，未改数字；用于I组合夹具，不冒公开签名或生产验收。

## 5. 公共修改请求

公共文件由I单写。已普通继承：CPC39bc、原报告ROI/paid/owning fencing feb53457、父失效d9dcdd67、API/SDK/slots/AI85e80b5a及0cb2e426、20198666测试窄化、promotionPrefs43bdf332及联合930/b43、可选provenance f4704834。返回焦点/排序、导出追溯两个旧P2在11cf实际页面/文件闭合；最终P/A条件导航门禁及main接纳由I核验。A不改公共路由/权限/gateway/中央AI/共享组件。

## 6. Teammate分支与工作树

各树根目录 `D:\.codex\worktrees`，后缀均 `\运营管理系统`。

| 树名 / 分支 | SHA与用途 |
| --- | --- |
| netshop-promotion / codex/netshop-promotion | Lead业务5e97、Q测试普通merge197cd214；独立npm/venv；3150/18150及私有PG49169已正常停止 |
| netshop-promotion-query / codex/netshop-promotion-query | 作者770afc53，仅3专属backend文件；各轮私有PG正常停止 |
| netshop-promotion-report-baseline / codex/netshop-promotion-report-baseline | 干净39bc，独立复现旧Report5teardown失败；I合法fixture修复保留guard |
| netshop-promotion-ui / codex/netshop-promotion-ui | 作者0a483ffe，专属组件/read/tests/QA；未启动ports |
| netshop-promotion-review / codex/netshop-promotion-review | Q83cebb38（含旧92959176）；独立依赖/PG/三新增Q测试，clean且远端一致 |
| netshop-promotion-demos / codex/netshop-promotion-demos | 43392781用户选定01；3196预览另留，旧2—5规范化1 |

无其他Teammate子分支/作者树。正常merge保留作者/Q历史；未自行归档、删分支或合main，I最终负责。

UI作者只读资源回执：本地/远端0a483ffe、clean；未启动PG/ports/browser；ignored只有独立node_modules及3个可再生Vite产物803,961B，没有必须额外保全的独有ignored材料。query作者14轮PG均result stopped/stopExit0，无自有PG/Python监听；14份原postgres.log已按原SHA CreateNew复制、复读相同、原件不变/凭据不复制，完整172份E证据摘要及两树资源见 `promotion-query/resource-handoff-author770-4d0ce229233b/resource-receipt.json`，SHA256 `28e26393221ae2d965091e60903a84ce9c6cf5fff2d7b5e9ec8bfb11fb47a9c3`。

Q资源 `promotion-review/qa01-04-5e97bc87-f032712fcd58410bb1b962d1a8c180dd/resource-receipt.json`，SHA256 `f7b1c6a200a7dfe62acdcc23c00847937818fb090a1f392822a4532ee6efe4a7`；49份namespace摘要清单sha256-manifest-resources.json。四自有PG55592/63239/49209/60102均stop0、pidfile不存在/连接拒绝；4份ignored原日志8,051B已CreateNew保全、SHA一致，无数据库数据/凭据复制。

## 7. 进程及忽略证据保全

Root仅控制自身QA3150/18150及其动态PG；已在I不再依赖在线资源后创建自身06两正常stop标记，frontend/reader exec均exit0，私有PG49169 normalStoptrue、所有3150/18150/18151/13150/49169无监听，原PID17056/46256不存在。旧3196预览继续保留。Root QA01重复版本初始化失败、02ready后stdin关闭、03线程连接耗尽私有16上限、04修复后24连续HTTP通过/正常停止、05自有3150占用guard拒绝均保留。03私有PG64126精确目录/PID核验后pg_ctl stop0、唯一helper51308另核验结束，不称整轮normal退出。06终态账号active/source6；后端新修复使用fresh独立PG，不称旧06进程热更新。

Root06停止前前端PID17056命令行精确带独占frontend-final.stop，reader PID46256精确带Root的venv/QA脚本/06路径。旧设计PID31040自然不存在后，base Python静态3196恢复为PID23528/session94217，源仍43392781；仅demo目录，未依赖Rootvenv，原用户IAB tab2保留且viewport override已reset，独立于正式QA清理。自有QA tab4两次文档API取得标签均CDP focus超时，关闭未确认；未改用未授权原生/UI机制、未关闭用户tab2，I收尾可核对该离线QA标签。

Root完整资源回执 `promotion-integration/root-resources-197cd214/resource-receipt.json`，SHA256 `09ba125e5c16abd1f6b15225659f6d234968b253dc3fce302dc328323bf92599`。25份不能再生原日志（20check/build/type/失败日志+5PG日志）逐文件CreateNew、原/后/目标SHA相同，原件保留；含额外mjs原失败。可再生ignored为node_modules/venv/构建及合成DB；无凭据复制。必要原报告/actualJSON/截图/PG回执已在上述独占E。I据五条件统一清理，A未归档或删分支。

## 8. 未执行的外部及生产动作

未部署、生产迁移/启停、真实下载导入/补跑、真实投放调整、事项创建/负责人保存、外发消息或付费AI。未复制生产凭据/浏览器profile或原始客户数据到测试环境。主线源码合并也不代表生产采用。
