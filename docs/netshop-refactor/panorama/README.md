# 店铺全景 · 五版设计交付

2026-09-30，角色 S。当前交付阶段为**设计完成 / 合成 UI 验证**。用户选定版式后才开始正式栏目改造；本交付没有业务 API、PostgreSQL 查询或正式页面接线。

基线：首次核验 `c7c6c2a4c012dd60af0565b97b2d2f11f9246c0a`；已同步总控发布的登记提交 `daf211644efffdc762c0d33c1faba992cf082df7`。该登记明确 O 在途、F 尚未启动、共享契约与 P/A 接口未冻结。草案 `netshop-insights-v1` 不是可调用协议。

## 观看方式

静态预览：`http://127.0.0.1:3160/?layout=1&shop=jd-demo`。顶部可切换五版、店铺、日期、比较与演示状态。直接打开无 shop 参数的入口先要求明确选择店铺，不隐式选第一店。

```powershell
node app/netshop/panorama/demo/serve.mjs
```

服务器仅监听回环 3160，只服务四个静态资源、仅 GET/HEAD；无 gateway、数据库、凭据、定时任务或远程依赖。3160 为 S 候选资源，已把启用情况回报总控；未启用配套 18160/18161/13160。旧临时 3140 仅本任务静态进程已关闭，避免与 P 候选冲突。

| 版式 | 信息结构 | 适用场景 | 截图 |
| --- | --- | --- | --- |
| 01 章节驾驶舱 | 左索引 + 五卡 + 大趋势/经营侧写 + 八章 | 日常巡店与全面阅读 | [01](evidence/layout-1.png) |
| 02 经营报告 | 报告封面 + 章节导读 + 逐章叙述/表图 | 月度复盘 | [02](evidence/layout-2.png) |
| 03 主题工作台 | 左侧八章、单章主区、右侧来源与专题入口 | 逐项深入查看 | [03](evidence/layout-3.png) |
| 04 明细图表分屏 | 日期表固定在左，右侧当日明细与章节 | 核查日期波动 | [04](evidence/layout-4.png) |
| 05 经营脉络看板 | 四组并列主题、八章展开、重点商品速览 | 快速把握经营结构 | [05](evidence/layout-5.png) |

设计引用：森林绿 `#396149`、深绿 `#293f32`、应用背景 `#f5f7f6`，来自已提交 `app/styles/tokens.css`。字体沿用 Inter / SF Pro Display / PingFang SC / Microsoft YaHei / system-ui；涨红跌绿。没有改共享 tokens、公共日期组件或总览01。

参考信息组织方式：[Tremor Dashboard](https://github.com/tremorlabs/template-dashboard-oss)、[Metabase sections](https://www.metabase.com/docs/latest/dashboards/introduction)、[Elastic UI](https://eui.elastic.co/)、[AG Grid charts](https://www.ag-grid.com/javascript-data-grid/integrated-charts/)、[Grafana groupings](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/create-dashboard/dashboard-groupings/)。未引入上述库或复制其代码。

## 八章节完成表

下表的“完成”仅指设计覆盖与示例交互；所有正式功能、权限、来源和旧页回归仍待 F/P/A 合入后的实施。

| 编号 | 已完成设计 | 真实实现与条件 |
| --- | --- | --- |
| 2.1 | 平台/ERP/归因分组，本期/实际基期/差额，订单件数与客单价、趋势及日期明细、贡献入口 | 订单分母交 F/P 冻结；P 提供全集变化贡献；ERP consumer 独立复用 |
| 2.2 | 浏览/访客/收藏/加购/下单/支付、商品累计转化和访客价值；高访客低成交入口 | 搜索、停留/跳失按源字段与聚合证据；缺店铺去重 UV 与付费自然访客源 |
| 2.3 | 商品数、集中度、类目贡献、增长下降及商品表；精确身份详情 | P 完整集合结果；当前档案/库存只作快照，不判断历史新品滞销 |
| 2.4 | 花费、归因、ROAS、点击/CPC、费率、趋势、分布，带范围进入推广 | A 提供店日配对、CTR/曝光/订单与对象结果；不复制其计算 |
| 2.5 | ERP 净额、成本、订单毛利、大毛利率、退货与贡献，原销售/商品经营入口 | 单品需映射；退货件数与率需领域 owner 确认分母；月财报不摊为日利润 |
| 2.6 | 新老买家、企业购与复购/B端占比的具体条件缺口 | 天猫原买家字段经 P 公开；企业购范围/子集证据、匿名客户与历史未核验 |
| 2.7 | 年度目标、月财报、进度及已记录事件，只读入口 | 有界同店财务 consumer 交 I/owner；历史同期由所属接口供给，不虚构月目标 |
| 2.8 | 来源截止、缺日、字段可用性、映射、比较、版本展开及原记录入口 | 原链路状态仅上海今日，不能冒充所选历史工作流；真实证据关联待接线 |

商品表设计包含图位、名称/精确 ID、类目、成交/件数/访客累计/转化、贡献/比较、推广/退款、映射/覆盖。图位使用明显的合成占位；没有真实商品图片、客户资料或经营事实。

## 验证与限制

运行 `verify.mjs` 需独立可用的 Playwright 与浏览器；不会安装项目或生产依赖。例如本机执行时用 `PLAYWRIGHT_MODULE` 指向 bundled Playwright，`PANORAMA_BROWSER_PATH` 指向已安装 Chrome，headless 新建临时会话，不接管登录 profile。

```powershell
$env:PLAYWRIGHT_MODULE = '<独立 playwright 模块路径>'
$env:PANORAMA_BROWSER_PATH = '<浏览器可执行文件>'
node app/netshop/panorama/demo/verify.mjs
```

[UI 结果](evidence/ui-checks.json)记录具体检查；[独立复核](evidence/independent-review.md)记录发现、修订与范围。覆盖桌面及 320/390px、八章、未选店、实际基期、跨月/完整月/跨年日历、商品/推广上下文及返回、缺日/修订/权限/失败、快切店与迟到保护、静态服务器禁写。业务范围中的负基期、ERP 规则、PG reader/consumer、真实 revision 及旧五视图/01回归仍未验收，不能据 Demo 通过声称真实功能完成。

首次自动检查遇到浏览器包缺失，改用现有独立 Chrome；首次版式/窄屏检查发现报告章计数重复与 grid min-content 溢出，修订后复跑。未删除断言或放宽覆盖标准。

正式改造阶段的来源、字段与验收门槛见[字段映射](field-mapping.md)，公共接线需求见[接线请求](integration-request.md)。总控确认依赖 SHA 均合入 main 后，本角色同步主线、按定版实施、隔离 PG/UI 联调、回归，再交 I 串行合并。
