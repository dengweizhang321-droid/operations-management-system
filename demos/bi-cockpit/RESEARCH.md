# 实际联网调研 · 2026-10-05

信息组织与交互参考，所有实现自行编写，视觉统一TERUISI。官方文档正文/图示及GitHub许可已实际读取；没有运行商业后台、Power BI PBIX或Superset/Metabase服务。

| 方案 | 真实访问链接 | 已核实交互、借鉴与本系统适配 |
|---|---|---|
| 01 | [Shopify overview dashboard](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard) | 顶部日期与比较、KPI与趋势、卡片进入报告、指标局部来源警告。改为公司ERP结果、七域摘要和模拟专业跳转，避免套用单店成交/访客定义 |
| 02 | [Evidence Markdown](https://docs.evidence.dev/core-concepts/markdown)、[Variables](https://docs.evidence.dev/core-concepts/variables)、[Layouts](https://docs.evidence.dev/features/layouts)、[GitHub](https://github.com/evidence-dev/evidence) | 叙述文字与查询图表组合，变量同步筛选及标题，自适应Row/Stack。改为经营问题章节，结论受来源/比较资格约束；页内目录为本次适配，不声称现成控件 |
| 03 | [Power BI Matrix](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-matrix-visual) | 维度行列、层级、冻结行标题和局部横滚。改为平台/店铺经营矩阵；比率按分子分母重算，选行证据与全局KPI分开；公司库存/财报不能按店乱分 |
| 04 | [Metabase interactivity](https://www.metabase.com/docs/latest/dashboards/interactive)、[Drill-through](https://www.metabase.com/docs/latest/questions/visualizations/drill-through) | 图表点击更新筛选、带参数进入目标、查看明细。改为全期左图与局部右证据，返回保留范围，详情携带精确店/期/SKU |
| 04补充 | [Superset官方](https://superset.apache.org/)、[建图文档](https://superset.apache.org/docs/using-superset/creating-your-first-dashboard/)、[GitHub](https://github.com/apache/superset) | 官方首页可读交叉筛选、明细与统一指标。借鉴联动作用域：ERP可联动，库存快照与财报月保持独立。建图页仅官方搜索索引支持部分细节，直接正文未读成功 |
| 05 | [Power BI Decomposition Tree](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-decomposition-tree)、[Retail Analysis](https://learn.microsoft.com/en-us/power-bi/create-reports/sample-retail-analysis)、[Supply Chain Sample](https://github.com/microsoft/powerbi-desktop-samples/blob/main/Sample%20Reports/Supply%20Chain%20Sample.pbix) | 金额逐维度拆解、上层路径返回及末级联动。改为公司→平台→店→类→ERP SKU，金额加总而非率加总；没有身份映射时停止，相关证据不表示因果 |

## GitHub许可证及可复用范围

| 项目 | 实际许可链接 | 本阶段使用范围 |
|---|---|---|
| Evidence Core | [MIT LICENSE](https://github.com/evidence-dev/evidence/blob/main/LICENSE) | Core源码若实质复制需保留版权许可；Studio专属能力不能视为开源Core。本次只借鉴组织和交互，不导入源码 |
| Apache Superset | [Apache 2.0 LICENSE.txt](https://github.com/apache/superset/blob/master/LICENSE.txt) | 子组件可另有条款；本次不引入平台、字体或资产，仅自主实现交互 |
| Metabase | [官方raw LICENSE](https://raw.githubusercontent.com/metabase/metabase/master/LICENSE.txt) | enterprise外AGPL、enterprise内商业，嵌入另有许可。不能当MIT组件复制，本次不复制、不嵌入 |
| Microsoft样例仓库 | [MIT LICENSE](https://github.com/microsoft/powerbi-desktop-samples/blob/main/LICENSE) | 样例仓库许可不等于Power BI产品开源。本次不复制PBIX或样例数据 |
| Shopify | 官方商业产品文档 | 未找到该界面开源授权，仅参考模式，不复制Logo、素材、CSS或后台代码 |

## 访问失败与研究资格

- Evidence llms.txt、旧legacy Tabs/DateRange URL工具不可访问，改读当前Markdown/Variables/Layouts。另一个作者读取当前主页显示文档已更新，未拿旧组件代码当可复用依据。
- Superset建图页直接正文为0行；首页/GitHub许可证完整可读，建图部分信息仅来自官方搜索索引。
- Metabase GitHub许可网页没提取到正文，改读官方raw文件。
- Power BI页面有通用授权提示，正文、案例和图片链接可读；未登录产品、未运行PBIX。
- Shopify基础overview URL首次工具访问失败，using子页完整读取成功；后台需登录，未实操后台。

“适合TERUISI”的结论是本次设计推断，不代表真实业务数据接线或生产验收。各Demo的NOTES.md记录作者借鉴、改编和自身检查。
