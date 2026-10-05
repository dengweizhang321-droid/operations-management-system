# 库存性能独立验收清单（2026-10-05）

本清单从基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494` 的实际导航和源码建立。当前用户要求独立分支、全部库存子页面验证且不合并、不准备发布、不操作生产；此要求覆盖历史默认立即合并与候选准备流程。审查者不修改业务源码。

| 子页面/详情 | 实际入口与主要读取 | 适用交互与必须回归 |
|---|---|---|
| 库存总览：健康分布、优先补货、近30天健康明细 | `app/inventory-module-view.tsx` overview；`/api/inventory/overview?view=overview` → `inventory_overview` | 首开/重入、公共与库存类型/健康筛选；当前近30天明细按销量固定排序、最多50货品，无用户排序或分页控件；全部筛选集合统计、全局质量门禁、健康六类及180天边界、成本覆盖、映射和计划创建源 |
| 创建备货计划详情弹层 | 总览健康明细按钮；使用已读取 mapping.samples/warehouseOptions，保存时库存 writer 回读权威 | 打开/关闭与字段默认值；计划数量人工覆盖、人工创建、零/缺成本、入库仓库和全局门禁；本审查禁止外部钉钉投递 |
| 库龄分析：指标、双轴分布、明细 | age；`/api/inventory/age-analysis` → `inventory_age_analysis` | 首开/重入、搜索/公共筛选、风险/10区间/卡片、分页/刷新；全部筛选集合指标分布，缺库龄/缺成本、库龄数据优先与库存回退、CSV同口径；固定权威排序 |
| 备货计划：流程统计、计划明细 | plan；`/api/inventory/overview?view=plan` → `inventory_overview` + `query_plans` | 首开/重入、搜索/公共/计划状态、分页/刷新；状态和数量人工编辑、草稿/已确认混选、权威更新冲突、已确认采购事项；写入外部同步禁止真实调用 |
| 采购备货任务详情弹层 | 已确认计划“生成采购任务”；当前计划字段，`/api/inventory/work-items` 保存 | 打开/关闭、来源计划与状态门禁、数量/类型/供应商/预计到货日；测试使用隔离数据库/桩 |
| 钉钉备货群消息确认详情弹层 | 已确认且采购/供应商完整的选择，“发送钉钉群”；POST `/api/inventory/replenishment/dingtalk/group` action=preview | 以纯浏览器夹具模拟预览响应，测打开/关闭、目标/机器人/正文及选择条件；不连接DWS、不允许action=send，原生用户预览全部POST405 |
| 滞销清理：卡片、策略、清单 | stale；`/api/inventory/age-analysis` 自动限定 stagnant/slow/aged | 首开/重入、公共/风险/库龄/卡片筛选、分页/刷新；缺销量仅库龄风险，服务端保存再次复验，不删除/调减事实，CSV一致 |
| 滞销清理事项详情弹层 | 清理清单“创建清理事项”；`/api/inventory/work-items` | 打开/关闭、来源 key 与策略默认值、只接当前有效清理候选 |
| 京东入仓：指标、RDC/DC区域、行动建议、SKU明细 | inbound；`/api/inventory/inbound-monitor` → `inventory_inbound_monitor` | 首开/重入、公共/供应商/风险卡片、分页/刷新；正向7/30/90销量、区域映射兼容、成本和供应商缺口；不得冒充京东原生指标 |
| 广东入仓：风险分布与型号明细 | guangdong；`/api/inventory/guangdong-monitor` → `monitor` | 首开/重入、公共与风险/供应商、分页/刷新；精确广东仓、人工风险/健康跟进、生产周期和缓冲、下单剩余库存完整历史、版本化导出 |
| 广东型号设置详情 | 型号“编辑”；当前页原值，`/guangdong-monitor/items` PATCH | 打开/关闭、人工覆盖/恢复自动、版本fencing与写后回查、库存变化重置；无生产写入 |
| 广东监控清单（二级） | “监控清单”；`/guangdong-monitor/watchlist`、products、preview、template/export | 首开/重入、本地清单搜索/分页、型号搜索；启停/备注、粘贴/XLSX预览、版本化完整导出；全清单有界2000 |
| 广东供应商备货周期（二级） | “供应商备货周期”；`/guangdong-monitor/suppliers` | 首开/重入、供应商全列表；生产/安全天数保存、版本fencing与型号回退；现无筛选/排序/分页 |

共同验收：全六Tab日期不改变固定权威销量窗；URL筛选前后退/刷新恢复；快速筛选和翻页旧响应迟到；跨范围失败不能冒旧范围为当前；同范围刷新保留并提示旧结果、失败重试；新来源版本不误标旧快照；缺数据和区域读取失败。每个使用缓存的页面须分别测量，不能推断收益。

缓存审查重点：按数据库、实际PG角色、authority、principal/权限、完整基行范围与来源版本隔离；库存、销售、ERP、映射/运营设置、人工状态/计划/广东设置修订均需覆盖；上海日改变stale/最晚下单等计算时失效；事务中绕过；前后来源版本不一致时不入缓存；TTL、条目、字节容量上限；返回行复制防 `_quality`/建议暂停的原地 mutation 污染缓存；缓存不削弱完整筛选集合统计和排序。

下游必须回归：`backend/inventory/consumers.py` BI overview/dashboard、商品经营库存投影及系统数据集/AI只读查询的旧接口兼容；补货服务 `replenishment_plan_sources` 不得复用未提交事务或过期门禁。

既有UI工具 `tools/verify-guangdong-ui.mjs` 覆盖广东设置/清单/周期及viewer，是合成API工具；`inventory-ui-lab.mjs` 以实际库存组件与原globals双版本挂载、动态回环端口、无生产连接，记录shell反馈、绘制/完成、请求数与字节以及主动忽略abort的迟到响应。它不挂载真实Home/shell，不作为业务PG性能或全主页代码加载证据。

基线已确认风险：主五Tab无显式只读刷新按钮；旧结果状态仅按projection/Tab分离，未与完整筛选键关联，切换条件失败可保留旧范围统计；主五Tab每次轻交互反复完整组装库存/销售匹配/健康，后分页；广东先完整投影后过滤，但剩余库存历史已有当前页边界。无用户排序入口，应记录固定权威排序等价，不能声称测过不存在的操作。
