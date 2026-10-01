# C 平台原生趋势接线准备

2026-10-01，总控允许只读 owning 候选 `f0ad462dab3237f0276d544457809537aba873ed` 作字段设计。该候选不是本栏目已验收依赖，也未合入 C；实际 main、SDK `seriesPlatforms` 接线和独立 Q 完成后，由 I 发准确 SHA，C 才普通同步实施。M5 真全景目标与最终 Home/C 签名接口验证另有门槛。方案1和已验收单店成果保持。

## 精确字段映射

| C 输入或字段 | owning 候选字段 / 接法 |
| --- | --- |
| mode=platform、主图平台对象 | `seriesPlatforms`，仅1–2个精确京东/天猫，配 `seriesGrain`，不同时发 `seriesOutlets` |
| 完整授权比较集合 | 两独立窗口、全部已验证 RAW 三元组仍传父 `rawOutlets`，最多50，page1/pageSize100，核 candidateCount=returned、无hasMore；主图不缩主汇总/候选 |
| 本次平台趋势意图 | `requestedScope.platformSeriesIntent={grain,platformNames}`；按原请求和主图实际可映射平台验证 |
| 完整平台原生数据 | 独立 `platformSeries`，schema `netshop-sales-platform-series-v1`，不改原 `series` 的 RAW 形状 |
| 平台对象匹配 | `items[].platform` 对 `platform:{name}`；own identityKey 为紧凑JSON `["platform",name]`，不当RAW key |
| 平台成员完整性 | `rawMembers`、`rawCandidateCount` 精确等于本栏目已完整读取的父 source.items 中该平台两期union；唯一、同平台、同渠道三元组、原UTF8顺序。不可只比成员计数或可见排行页 |
| 桶原值 | 原8列 compact tuple，经 `restore_period_point` / `restoreSalesPeriodSeriesPoint` 恢复；直接投原净额/原生数量/存储毛利/净额减存储成本及原可信订单组数，不在C累加店/日订单、均值或利润 |
| 桶日期 / 观察证据 | 原current/baseline独立自然桶，C真实期/平台/桶范围观察引用；完整性始终unknown。与父完整RAW item的导入日期核对，不能改成F店日complete |
| 平台订单 / 均值 | owner SQL distinct `(platform,shop_name,channel,ERP order_no)`；原观察均值仅来源证据展示，不称付款客户客单价 |
| 版本 / 状态 | 原 scopeKey、snapshotToken、sales/ERP pair、metricMetadata完整保留；platformSeries与父一致，401/403/409整体失败，503清本源原规则不变 |

## 无来源与无记录

- 某F平台没有合法 ERP alias/channel 时保留对象和 unmapped 状态；不为了取得空平台而发 `rawOutlets=[]` 的全源查询，也不猜渠道。其他合法平台的完整汇总仍可查看。
- 有合法父RAW范围的平台即使两期没有导入记录也可选该平台，由 owner 按原授权验证后返回 `availability=unavailable/no_records`、rawMembers=[]和完整空桶。C保null/no_records，不补业务0，不把未授权403降成无记录。
- 当前无行而基期有行的RAW成员必须保留。按C完整source.items精确验证成员，堵住50成员删到49仍自洽的隐藏成员漏洞；不能只信 platformSeries 自报 rawCandidateCount。
- 原成本、历史映射、真实零成本未证状态保持；有记录的0与无记录null分开。ERP主指标仍partial/unavailable，未知完整性不生成增长或指数。

## 实施及验收门槛

1. I提供实际 main SHA及最终 owning contract / SDK key，普通同步；只改已分配C adapter、strict decoder、UI与专属测试。
2. 原三次同65秒：完整prime → 同pair平台opt-in（不借旧prime snapshot）→ C完整序列化后同新snapshot/pair复验。不按平台或桶新开预算/RPC。
3. 独立PG验证>4 RAW的平台、两期成员进出、同号跨RAW隔离/同RAW周月去重、授权空平台、缺映射/无记录、0负缺基准、撤权/409/末503及完整成员遗漏拒绝。
4. 原两期全集、F完整carrier/实际P/A整期覆盖、每ERP桶观察、原生单位/未知成本、完整向量与2MiB不变；最大日期日图超限必须真422，120日及366周/月已有成果按源码/范围继承，平台组合另实测。
5. 使用新的实际平台capture验证双期图/展开店铺/自定义取消返回/日周月及字号；前端不变的旧单店三粒度结果按源摘要继承，不相加冒独有用例。
6. 最终普通同步M5实际main，确认S/P/A真目标、由I组合真实Home及签名C接口，再交独立Q。单店阶段通过和候选文档不代表M6完成。

本文件只有字段和接线需求，没有消费候选source、复制其他工作树代码、改公共权限/算法/路由、连接生产或启动新服务。
