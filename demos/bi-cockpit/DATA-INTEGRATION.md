# 现有系统研究与正式接线清单

基线31d0d806，远端main精确核实一致；原聊天worktree detached/clean，未切换或修改。生产状态依据最新版采用文档，不依据旧规划猜测。近期有效记录：`docs/JACKYUN_OCT4_RECOVERY_PRODUCTION_20261005.md` Worker10c9153e/Djangoe4f48e98/139；`docs/netshop-refactor/execution/20261004-all-shops-production.md` 五网店栏目指定范围资格，缺源仍保留。本阶段未对生产进行部署或维护验证。

## 已有可复用

| 内容 | 当前代码依据 | 接线约束 |
|---|---|---|
| BI与ERP汇总 | app/dashboard-module-view.tsx:52；backend/bi/query.py:110；backend/sales/summary.py:326 | BI当前仅ERP销售+最新库存、要求unrestricted scope；复用来源与修订合同，不扩大现权限 |
| ERP净销售/成本/退货/实际比较日 | backend/sales/query.py:242–302 | 源订单毛利还扣费用分摊，综合大毛利另算净销售−成本，额率必须同分子；保留覆盖而非用聚合零判已导入 |
| 财报与目标 | backend/finance/analysis.py:165,201,302；target_service.py:51 | completed自然月、missing月份、同口径目标；不移用为ERP任意日选期目标 |
| 六源八章单店全景 | backend/netshop/store_panorama.py:36,182 | 做专业承接，不在BI重建完整模块；身份未核验停止ERP关联 |
| 总览、平台/店对比、商品、推广 | backend/netshop/urls.py:10；product_insights.py:466,747,764 | context/coverage/date信封、SKU/SPU独立、商品×日人数不能当店去重访客；京东跟单/天猫净归因分别说明 |
| 库存、库龄、供货 | backend/inventory/query.py:124,531,715,745,836,987 | 固定公司最新快照与独立近30天需求；过期/低匹配可抑制建议，商品仓位与唯一编码区别 |
| 商品经营 | app/product-module-view.tsx:158,267 | ERP商品成本毛利可复用；平台同名商品不自动拼接 |
| 市场/客服 | app/market-view.tsx:244,582；app/customer-service-view.tsx:123,158 | 已采集榜单、会话标注仅辅助，不推行业份额或订单因果 |
| 导入/自动化/事务 | app/import-module-view.tsx:112；app/n8n-workflow-view.tsx:81；app/operations-view.tsx:362,829 | BI经营提示与来源摘要，日志文件任务交专业模块 |

## 需要身份关联或补充计算

- ERP店铺↔网店精确映射，财报店铺映射；拒绝名称近似关联。
- 平台SKU/SPU↔ERP货品的历史关系与归属日期，商品利润及库存关联资格。
- ERP选期同口径目标来源/聚合规则；现财报月目标不能直接用于ERP KPI。
- 全集合跨店增长贡献、缺源比较资格、唯一货品/仓位计数。
- 每个新汇总复验授权scope、修订、覆盖与日期；列表保持服务端筛选分页、硬上限、取消旧请求与迟到结果门禁。

## 确实缺源或尚未证实

- 历史库存快照回溯来源，不能用最新库存伪造历史。
- 已验证的单品ERP逐日映射合同、历史SPU下SKU关系、统一跨平台品类字典。
- 稳定匿名客户历史/复购、客服订单归因。
- 广告增量因果、利润ROI；现归因ROAS无法提供这些结论。
- 未导入财报月份、商品/推广缺日或缺字段；上线200不能证明全源完整。

## 视觉与导航依据

app/layout.tsx加载 globals.css→shell/top-navigation.css→styles/shared-theme.css。实际顶部绿色导航已由浏览器核验；旧左栏CSS不作依据。tokens保持品牌#396149/深绿#293f32/背景#f5f7f6/白卡、6/9/12px圆角、38px控件。

实际运行计算样式：body14px/400/22.4px、h1 20/400/26、h2 18/400/23.4；Demo h3 16/400/20.8、KPI24/600/31.2、表格筛选13/400/20.8、辅助轴12/400/19.2，字体栈一致。KPI标签按标签角色13px，未缩小内容塞版。

已有BI问题作为设计依据：趋势独立缩放且截负；库存健康分绝对数扣分却推公司稳定；未匹配销售误叫低动销；排行/风险按钮无钻取。Demo修正表达，正式BI代码本阶段保持原样。
