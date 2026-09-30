# 有版本的派生货币单价

A-F01由I决策并串行实现：交易金额仍为安全整数分，原MetricValue/CNY_CENT、COUNT、01协议不放宽。CPC等由合计金额除合计次数得到，可出现小数分，因此使用独立`metricSchemaVersion=netshop-money-per-count-v1`与`unit=CNY_CENT_PER_COUNT`，不冒百分比RATIO。context仍netshop-insights-v1且没有金额值，未换旧context语义。

TS类型/decoder/比较/格式在`lib/netshop/insights-contract.ts`；Python专属validator/比较在`backend/netshop/insights_common.py`；`InsightDerivedMoneyMetric`显式呈现。新PromotionMetrics.cpc用该类型，其他金额、CTR/ROAS仍旧MetricValue。旧01均价与访客价值当前尚未核验，保持原DTO占位。

分母明确为clicks/item_quantity/transaction_customers_sum/product_day_visitors_sum。金额分子和次数分母必须安全整数，可用时分母严格正，点击CPC花费非负；value必须有限且等于未舍入商，来源、basis和覆盖引用不可省。分母0/负、缺字段/缺日、覆盖不足不算价格，值为null并明示原因；该派生类型不接受partial/sum/source_value_only。辅助匹配子集必须用已明示的独立完整范围引用，不能冒整期。

后端先合计再除，不平均日价；前端只除100并格式为元/点击等。比较使用未舍入值，同版本/分母种类/basis/来源方可相对比较；基期0/负/缺失分别说明。101分/3点击合法，小数分伪装旧金额拒绝；0分/正点击保持0。

件均额、商品成交客户累计均额、商品访客累计价值分清，商品累计客户不是可信订单数，不命名真实客单价，访客累计不是店铺去重UV。旧uvValue单位是元/商品访客累计，不能原值当分使用。此扩展不新增业务事实、角色授权、迁移或真实模型调用，金额核心与实际源定义保持。
