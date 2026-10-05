# Demo 04：图表与明细联动分屏

主工作区：左侧全选期趋势 / 店铺贡献 / 商品结构三个分析视图，右侧局部证据。日期点与店名只缩小右证据；上方公共筛选改变全局KPI。商品聚焦另有局部 SKU 金额与详情按钮，不改总期结果。下方折叠面板保留全选期全部店铺、完整商品、推广、独立库存、财报和质量，不删核心内容。

参考实际联网读取：[Metabase dashboard interactivity](https://www.metabase.com/docs/latest/dashboards/interactive)、[Drill-through](https://www.metabase.com/docs/latest/questions/visualizations/drill-through)、[Superset](https://superset.apache.org/)。借鉴图表点选更新筛选、携带范围到证据与明确交叉筛选作用域；分屏、全期 / 局部标签和停止关联提示为 TERUISI 适配。没有复制源码或资产；Metabase 具有 AGPL / 商业双许可，Superset 为 Apache 2.0，各自范围见统一 RESEARCH.md。

全部业务计算调用共享 createModel / aggregate / createUI。矩形条宽度仅为图形尺度，ERP、广告、库存和财报指标不混算。右侧广告按局部期间及店铺计算，缺源不补零；公司库存和月利润不随局部选择伪造归属。演示缺推广时局部花费 / 成交显示未覆盖。

交互：切换分析视图；点日期；点店铺贡献条 / 店名；查看全店、排名、店名过滤；商品筛选 / 聚焦 / 详情；局部全清；折叠来源；打开模拟专业模块；返回保留状态。loading / error / empty / missing由共享入口控制。

适用：经营变化调查与证据复核；优势是范围清楚、证据就近。代价是局部与全局需要明确说明；窄屏为上下两块，表格仅局部横滚。正式实现复杂度较高，需日期 / 身份 / 来源覆盖契约与深链路接线。

作者自检：node --check 通过；使用实际共享模型 / UI 渲染默认、店铺视图+店日选择、商品视图+负毛利SKU聚焦、empty、missing 五种场景，8个域标识完整，无抛错或 NaN。浏览器实际字号、尺寸和控制台验收由非作者 / 总控完成，未测项目不标通过。
