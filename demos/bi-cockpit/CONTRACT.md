# 五套 BI Demo 协作合同

总控维护 shared/*、app.js、index.html、server.mjs、数据与计算、交互与文档。设计 Agent 只修改自己 demoNN/layout.js、layout.css、NOTES.md，不修改共享文件，不操作 Git/服务。全部合成数据，本阶段无生产 API。

layout.js 导出 `export function render(ctx) { return HTML; }`，可导出 `export function onAction(action, value, ctx) { return false; }`。调用 ctx.set(patch) 更新并重新渲染。ctx={state,model,ui,set,escape,money,percent}。

state: demo, start,end,platform,shop,grain(day/week/month),compare(previous/year/none),status(ready/loading/error/empty/missing),rank(sales/profit/delta),allShops,qShop,qProduct,productFilter(all/growth/decline/low/loss),selectedShop,evidenceDate,exploreLevel(platform/shop/category/product),explorePlatform,exploreShop,exploreCategory。

model: totals{sales,cost,profit,returns,positiveSales,margin,returnRate,target,spend,attributed,roas,coverage,delta,change,marginPp,returnPp,spendChange,roasPp}, baseline{sales,profit,...}, periods{current,baseline}, shops 数组{id,name,platform,sales,profit,margin,delta,change,share,growthContribution,spend,attributed,roas}, products 数组{id,name,category,sales,profit,margin,delta,change,share}, trends 数组{date,end,sales,profit,spend,attributed,roas}, inventory,finance。

金额 model 单位元；money(value) 自动格式，null 显示未覆盖；percent(value) value 为比率，null不可比较。

ui.kpis()：统一结果与目标6指标；ui.section(key) 返回完整区块，key=results/trend/shops/products/promotion/inventory/finance/quality；所有七域必须在每套可发现。ui.trend(metric='sales')，ui.shopTable()，ui.productTable()，ui.inventory()，ui.finance()，ui.quality()，ui.promotion()，ui.contribution(level)（按 state explore 范围生成真实共同数据贡献按钮），ui.evidence()（按 evidenceDate/selectedShop 展示局部明细与原范围区别），ui.panel(title,body,subtitle='')。

统一自动绑定 data-action：detail-shop/data-value=id、detail-product/id、detail-risk/id、module/路径、all-shops、select-shop/id、select-date/date、reset-evidence、explore-platform/平台、explore-shop/id、explore-category/类目、explore-product/id、explore-reset、explore-up、section/区块id、scenario/status、retry。select 的 data-field/state字段，input 的 data-field。不要伪造无 handler 的按钮。非通用 action 由设计 Agent onAction 实现。

每套外层自带 .demoNN 类；全局字体已匹配实际运行 body14/400/22.4、h1 20/400/26、h2 18/400/23.4、h3 16/400/20.8、KPI24/600/31.2、表格筛选13/400/20.8、辅助12/400/19.2。tokens 来自 HEAD31d0d806。不加缩放，不造主题。公共 .grid2/.grid3/.stack/.panel/.kpis/.muted/.caption/.row/.chips/.table-scroll 等可用。布局 CSS 须限定自身类，min-width:0，390px单列。

口径：综合大毛利额=ERP净销售额-成本，毛利率同分子/净销售；退货金额=负销售绝对值、比例=退货/正向销售；广告归因成交/推广花费=ROAS，不是利润率；ERP/平台成交/归因/财报分开；财报最近完整8月、9月缺失，固定公司范围；库存最新公司分仓快照10月1日已过期、需求9月5至10月4，切日期不伪造历史库存、不按店摊货值；SKU唯一商品/商品仓位区分。ERP日度目标为明确合成目标，正式需补源。

01均衡分区；02章节报告含页内导航；03对象矩阵选中后趋势详情；04图表与明细分屏选期/店/商品联动；05平台→店→类→SKU贡献探索，无法可靠关联库存/推广/财报必须止于上下文证据，不能推因果。
