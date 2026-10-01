# 原始 ERP 平台趋势协议 v1

作者基线为实际 main `a845eb560acc6a1803282de3c826acd1a153dabe`，随后普通快进继承 `a50e53281410a2716ddb615df33c2ca1a080b4b1` 的公共 TCP/TLS 期限修复。此文交付专属 owning source 候选；新 SDK 键由 I 接线，独立 Q 复核后才可发布 main。无生产采用、迁移、GRANT、真实业务、下载导入或模型调用。

## 请求与范围

仍是签名 `netshop_periods_v1`，新增唯一字段 `seriesPlatforms`：1–2 个不重复的精确 `京东|天猫`，必须同时给 `seriesGrain: day|week|month`，与 `seriesOutlets` 互斥。不选任何趋势时不新增响应字段；原 RAW ≤4 趋势请求和 DTO 保持原字节语义。两个独立原窗口各 1–366 日，不扩大外部日期规则。

父 `rawOutlets` 缺省或空数组仍表示全部已授权两期候选；显式非空 ≤50 三元组保持原字符串、渠道、投影匹配及权限规则。平台选择必须属于显式父 RAW 平台集合。原生 resolved_category cohort 应用于同一父事实；商品专题类目不是 ERP 标签证据。q/page 只变列表，平台成员、趋势和 periodTotals 取完整父授权两期 union，不缩到当前期、500 排行、第一页或前四店。

平台名称不授予权限。事实始终经过原 `_apply_principal_scope` 平台 OR 渠道规则及仓库筛选。scope None、仅仓库范围或精确平台 grant 可返回授权窗口中的空平台；渠道授权须以原过滤器在所属真实事实中执行精确平台/投影 `exists()` 布尔核验，包含仓库条件，不输出其他事实、不猜店名/渠道归属。不能证明授权返回 403。授权平台在父窗口/cohort 无事实则为 no_records；不能以无记录掩盖未授权。

## 响应与完整恢复

新增独立 top `platformSeries`，`schemaVersion: netshop-sales-platform-series-v1`；父 requestedScope 加 `platformSeriesIntent:{grain,platformNames}`。名称按 UTF-8 排序，意图绑定父 scopeKey/snapshotToken；q/page 不在整范围 token。原 `series` 的 RAW 身份形状不变。

平台 header 含原完整 current/baseline、父 scopeKey、intent、同种完整 sales/ERP pair 向量、原 metricMetadata；basis 增 `grouping: exact_source_platform`、`membership: complete_authorized_parent_raw_union`。有序 item 是 `{platform,identityKey,rawMembers,rawCandidateCount,availability,current,baseline}`。identityKey 是紧凑 JSON `["platform",platform]`，不是 RAW 三元组 key。rawMembers 为父实际授权两期 union 中该平台全部精确三元组，按 UTF-8 三元组排序并唯一；不以 q/page 缩减。

有成员时 availability 为 available/null，无成员时 unavailable/no_records，rawMembers=[]，两期仍给全桶且事实为 null/no_records。当前无行但基期有行的成员仍保留；有行且金额 0 为真实 typed 0。负净额、缺可信 order_no、未知成本证明保持原状态。成本、计算毛利和报告毛利的字段存在、历史成本/映射、真实零证明仍 unknown/unverified_source，不可把展开原值 0 宣称主要成本/毛利指标已验证。

采用现有无损 `native-period-tuples-v1`：windowColumns `[startDate,endDate,endExclusive,days]`，metricColumns 原十一项顺序，pointColumns `[window,values,rowCount,trustedOrderCount,missingOrderNoRows,netAmountPerOrderValue,observedDateCount,observedDateRanges]`。范围元组仍 `[startDate,endDate]`。`restore_period_point` 和 `restoreSalesPeriodSeriesPoint` 恢复完整原 native period；原均值 value 单独存储，不换成日均值平均。完整严格解码校验列长度/顺序、primitive 枚举、安全整数、所有日期桶、分母和值、原期、观察日压缩范围、向量、父范围与成员。观察日期完整性始终 unknown，完整日期桶不是完整结算证明。

平台聚合在 owning 后端使用原 `sales.analysis.expressions`，按精确 source platform 和日/自然周/自然月分组。每桶订单为 SQL DISTINCT `(platform,shop_name,channel,可信ERP order_no)`：跨 RAW 同号不混，同 RAW 跨天同号在一周/月只计一次，不累加每日订单数。客单均值使用该桶完整同范围净额/真实订单组数，非付款客户客单。自然周 Monday–Sunday、月按原窗口剪首尾，非滚动七天或按日数摊值。

## 期限、容量与交接

一个 owning RPC 内复用原单次 65 秒 monotonic 和签名 UTC 到期时间，所有平台/桶/成员/订单查询、actor 前后、版本前后及序列化共用期限。单 SQL 仍 min(既有设置,7 秒,剩余时间)，不新增 RPC、缓存或 grant。完整父信封加平台序列受 2 MiB UTF-8 门槛约束，不截桶、不扩大 MAX。

实际隔离 PG 两平台 50 RAW，current 366 日、baseline 365 日共 1,462 桶：完整 bare DTO 266,705 字节，真实注册/HMAC loopback HTTP 信封 266,750 字节。它证明该合成规模的完整形状可用，不保证任意未知大父候选都可用；超过总预算明确拒绝。正负金额/零/无记录、>4 店和周 distinct、q/page 不缩、空平台/拒权、仓库/渠道四角色、actor/version/UTC、原 RAW/None、Python/TS 和实际签名 RPC 的作者证据独占存 E，失败首轮原样保留。

I 最小接线请求仅 `lib/django/sales-consumer-reader.ts` 新 op allowed keys 增 `seriesPlatforms`；已有 seriesGrain、actual owning validator、同 decodeSalesPeriodsForRequest、2 MiB/期限/401403409/取消规则继续复用。不修改 SDK、公共 views/urls、旧 client 或共享 HTTP helper。C 的 prime→完整 union 选图→同 expectedRevision opt-in 三次读取共用其 outer65，属于 C/I 组合责任。

最终 clean commit、文件 hash、实际命令结果、原始 HTTP receipt SHA、动态 PG/HTTP 正常关闭和剩余 I/Q 状态见作者 E manifest；作者执行不冒称独立复核或正式采用。
