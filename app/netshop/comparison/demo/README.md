# 店铺与平台对比 · 五版设计候选

本轮范围是设计、字段映射、隔离合成 Demo 和独立复核。用户选定版式后才开始系统改造。这里的 HTML 不挂载到正式 `view=platforms`，不调用任何业务 API；示例值不代表真实经营数据。

开工基线：`c7c6c2a4c012dd60af0565b97b2d2f11f9246c0a`。本树随后同步了总控main协调记录 `daf211644efffdc762c0d33c1faba992cf082df7`。总控 `interfaces.freezeStatus=not_frozen`，F 等待既有总览01交接；P/A 的新接口尚未合入。`docs/netshop-refactor/02-shared-contract.md` 是语义草案，新路径不是已验收接口。

## 五版

| 版式 | 组织方法 | 使用场景 | 参考 |
| --- | --- | --- | --- |
| 均衡对比看板 | 摘要、同指标趋势、效率、结构、比较表 | 日常快速对比 | [Tremor overview](https://blocks.tremor.so/templates) 的统计与图表组合 |
| 横向指标矩阵 | 店铺/平台为列，指标为行 | 同时看对象差距、缺字段与覆盖 | [Grafana](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/create-dashboard/) 的变量重复面板思路 |
| 表图联动工作台 | 明细表与所选对象图表分屏 | 从排名追踪变化和指标分布 | [AG Grid](https://www.ag-grid.com/javascript-data-grid/integrated-charts-range-chart/) 的表格/图表联动思路 |
| 六章经营报告 | 规模、效率、趋势、结构、推广、可比性分章 | 月度复盘和依次核查 | [Metabase](https://www.metabase.com/docs/latest/dashboards/introduction) 的 dashboard tabs |
| 可比性审计视图 | 对比图为主、对象纳入和缺数原因并列 | 先判断比较是否成立 | [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout) 的分区网格组织思路 |

参考仅用于布局思路，Demo 使用原生 HTML/CSS/JS，不引入其依赖或复制其实现。色值来自基线 `app/styles/tokens.css`：品牌 `#396149`、导航 `#293f32`、底 `#f5f7f6`、正文 `#33453a`、边界 `#e7ebe9`。正文14px、次要12px、章节18px；增长红、下降绿。

## 当前六分区状态

| 编号 | 设计覆盖 | 正式实现与验收 |
| --- | --- | --- |
| 3.1 | 平台成交/ERP净销售分源，本期、基期、差额和增长展示 | 待冻结集合/指标协议、选版及真实只读接线 |
| 3.2 | 加权效率矩阵与分布，拒绝默认综合评分 | 待销售与P/A可信分子/分母接口 |
| 3.3 | 日周月趋势、绝对值/有效基准归一，0/负/缺失说明 | 待共享日历和完整趋势DTO冻结 |
| 3.4 | 类目/未知类目、集中度、价格带及同款缺源说明 | 待P完整结构接口与版本化映射 |
| 3.5 | 投入、归因成交、ROAS/CTR/CPC及跨平台限制 | 待A同平台定义与店日配对覆盖接口 |
| 3.6 | 两期对象集合、覆盖、排除原因与范围变化说明 | 待F历史候选/覆盖与身份协议 |

Demo 交互验证与正式 PostgreSQL/权限/查询验证分别记录；本轮没有后端查询实现，不能把UI验证记为数据库或生产验收。正式专题钻取的目标必须在依赖合入后由I核实真实存在，本轮详情仅为演示。

## 使用

在本独立工作树运行 `python app/netshop/comparison/demo/serve.py --port 3170`，打开 `http://127.0.0.1:3170/`。只绑定回环，GET/HEAD读取Demo，CSP禁止业务连接/表单/iframe；不使用 `.env`、数据库、登录态或R2。

设计选择仍待用户；只推送 `codex/netshop-comparison`，由I负责接纳与后续串行合并、清理。公共入口、路由、权限、共享算法和底座文件未变更。

接口、字段映射、已知源限制与后续正式验收见 [dependencies.md](dependencies.md)；设计协议边界样例见 [contract-sample.json](contract-sample.json)。这些材料不是新正式接口的冻结版本。

本轮已通过27项合成UI回归及独立Q的26项补充检查；完整完成表、截图、提交/树清单和未验证项见 [handoff.md](handoff.md)。用户尚未选版，正式改造和PG/真实权限验收尚未开始。

2026-09-30 用户追加统一字体、色调、栏目位置并要求导航置顶。五版已统一顶部墨绿主菜单＋下方横向栏目；04章节导航也横排置顶，按两层导航实际高度避让。复用本树已批准 `app/styles/tokens.css` 的字节一致Demo快照 `system-tokens.css`，由局部 `system-frame.css` 适配现系统字体与14/13/12/18/24字号；不修改公共样式。当前28项检查通过，样式独立复核通过，预览已刷新。
