# 店铺与平台对比 C v1

用户已定版方案1；顶部导航、字体、墨绿配色和日期控件复用系统公共板式。设计 Demo 与正式组件分离，正式页不引用 demo JS、夹具或私有日历。

当前为 M6 在途记录。正式父 main 为 `b7fafb482b39fb82382f7ab42e54175b89b9eece`，C 普通同步合并为 `ad4adb9cedd0f8a41128878fcea3b48ecaf503a0`。P/A 已验收依赖继承；本文件不是 main 合并或生产采用回执。

## 六区交付范围

| 编号 | 实现 | 验证与条件 |
| --- | --- | --- |
| 3.1 | 完整精确候选配对后服务端分页，本期/独立基期/差额/变化/份额，持续对象贡献 | P/A 拥有方合计；ERP 窄 consumer 等 I 发布后接线。缺记录不能推导为退出或零值 |
| 3.2 | 指标矩阵、完整候选分布、列设置，无综合评分 | 比例合计分子分母；真实去重订单/客单价、毛利/退货待 Sales 证据；商品日客户/访客非店铺 UV |
| 3.3 | 同指标真实日/自然周/月桶，绝对值及指数 | 每期第一个自然桶须完整且正；0、负或缺失不跳桶、不补零，长度不同不缩放金额 |
| 3.4 | 每主图对象完整商品集合的标签/价格带/TOP5/TOP10/成交商品数 | 当前来源标签 cohort，不称官方/跨平台/历史分类；价格带按成交均价；同款映射未验证保持 unavailable |
| 3.5 | 花费/归因金额/ROAS/CTR/CPC/主整期费率及两期变化 | A 的 JD SKU/TM SPU 独立拥有范围；不同归因并列观察，不混排归因效率；错误不当缺数 |
| 3.6 | 两期完整授权候选并集、真实存在/字段覆盖/资格/原因及各参与版本 | 双 F 完整 envelope、C 附加覆盖和 A 所属 scope 全保；来源前后复验，不称分布式原子快照 |

## 请求与比较集合

固定只读 GET `/api/netshop/comparison-insights`，专属版本 `netshop-comparison-v1`。公共注册仅 I 单写。

- 继承 F 七键 platform/outlet/dimension/startDate/endDate/periodKind/snapshotToken。
- `comparisonScope` 为 `comparison-scope-v1`，仅 mode、metricSource、category、coverageFilter。分类为 all、unknown 或带精确 platform/sourceId/label/evidenceVersion 的 label_only；服务端复查真实来源版本和候选，caller 不能宣称 verified_id。
- `selectedBaseline` 独立 JSON：previous、yearAgo 或 custom(startDate/endDate)。用户两期分别是两份合法 F 的 current；每手动窗口不超过366日。F 原 previous/yearAgo、完整日历与覆盖字段不改名或裁剪。合法所属派生367日无法当第二个 F current，C 明确422，不截去一天。
- chartObjectKeys 最多4个真实候选精确键，只影响主图；店铺键为 `shop:`+平台/店铺复合键，平台键为 `platform:`+平台。平台与子店从不混排加总。
- 完整候选、汇总、分布与源覆盖不随 page 或 chartObjectKeys 改变。coverageFilter 仅控制查看页。完整对象在前，不完整与定义不可比对象分区查看，增长/下降排序只用有效比较值。
- 三张表共享一个服务端排名页：scale.items 是完整 row，efficiency.items 和 promotion.items 只是该页同序精确 objectKey 引用。浏览器解引用展示，不聚合、不遍历页。
- 整体2MiB、65秒后端期限（含 actor、两个 context、拥有方、序列化和末复验）、90秒前端同范围期限及最多2次完整读取；超限明确拒绝，不裁覆盖或候选。401/403 清除旧结果；409 完整恢复；迟到响应不能覆盖新范围。

## 指标定义

| 指标 | 来源与定义 |
| --- | --- |
| payment / quantity | P 商品日成交金额（整数分）/成交件数，完整集合合计 |
| visitors / customers / transactionOrders | P 商品×日累计；跨商品不证明去重店铺客户或订单 |
| conversion / visitorValue | 同源客户累计÷访客累计 / 成交分÷访客累计；后者独立 CNY_CENT_PER_COUNT 协议，非客单价 |
| spend / attributedPayment / roas | A 花费/所属归因金额/归因金额÷花费。京东成交订单额与天猫净成交额不同，归因窗口未知保留说明 |
| ctr / cpc / spendRate | A 点击÷展现 / 花费整数分÷点击 / paired-whole 同店同日完整商品分母费率；CPC 不先舍入 |
| erpNetSales / orderMargin / largeMargin | 待 Sales 窄拥有方：净销售、订单毛利金额、大毛利率；不复刻成本/仓库/退货算法 |
| erpOrderCount / averageOrderValue | 仅可使用可靠订单身份的去重分母，source_line_key 不算真订单；旧件均净额不当客单价。当前尚未就绪时值为空 |
| returnQuantity / returnRate | 待 Sales 原退货件数及明确原分母，不用缺行推定零退货 |

比率差用共享百分点比较；其他同定义指标用共享相对变化。基期0或负不能强算增幅，绝对差额可在两期完整且同定义时保留。金额、数量与比例单位不互换。

## I 协调需求

公共 comparisonIntent（业务 URL 可分享）、comparisonPrefs（同账号历史绑定）、原 onApplyPeriod 和原 atomic onDrill 精确范围/返回由 I 单写。C 只消费公共 props，不另建 router/history。P/A 目标已真实 main；S 在并行开发，最终合入前由 I 核验真实目标。

I 已批准在 C adapter 只读调用已 main P/A 拥有方窄 helpers。P：_source/_base/_window_rows/_cohort/_annotations/_metrics/_extra_metrics/_visitor_value/_category_evidence/_counts/_derived_buckets/_share/_money。A：_validate/_read_facts/_Reader.totals/_metric。范围、日期和名字均从 validated F/真实 actor 取，保留字段 presence、原比率与覆盖，不复制 SQL 或利润算法。未来 owning API v1 变动需 C 组合回归。

Sales provider 尚未冻结时为 dependency_pending，不称已验缺源；不得复制其他树 WIP、旧500排行或93天管理员页替代两期全集。缺分类映射时 ERP/A 不回退全店、按成交份额摊广告或猜同名商品。

## 证据与交接状态

设计：demo/evidence 的31项及独立复核为合成设计验收，继承不冒正式查询验收。正式 C 作者 PG、Node、UI 和 Q 最终证据/SHA将在冻结交接时补充；各次失败证据保留，性能不当生产 P95。

所有写代码 Teammate 独立工作树。只推 C 栏目分支；main 合并与最后资源/工作树清理由 I 协调。本轮未部署、操作生产数据库、启停正式服务、迁移、真实导入或发送。
