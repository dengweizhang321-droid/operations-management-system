# BI 五案独立代码复核（2026-10-05）

结论：本次源码审查范围内阻断 0；最后一项 ERP 完整性误受推广缺失状态影响的 P2 已闭合。

审查人是 Demo 01 作者，未参与 shared、Demo 02—05 实现；本报告不自审 Demo 01。总控应由另一作者独立审 Demo 01，并分别保留浏览器验收资格。此报告不等于真实业务数据或生产验收。

## 可复现方法

在隔离工作树执行：

```powershell
node 'D:\.codex\worktrees\bi-cockpit-demos\运营管理系统\demos\bi-cockpit\evidence\independent-check.mjs'
```

已实际执行，exit 0，PASS：保留原 223 项断言（其中 40 次渲染，各案10情景），另加6项最终闭环、9项app交互源码执行检查及8项专业目标范围检查，共246项。脚本只读源码与合成数据，不启动服务、写实现或访问生产接口。每次 stdout 记录本次被检查源文件 SHA256，可辨认后续变化。

## 问题闭环

| 首轮问题 | 实际复现 | 当前修复及独立核验 |
|---|---|---|
| 全null平台/品类被当0 | 待接入s7，ERP total=null，平台/品类曾显示0元 | shared/ui.js统一sum保留null；现在未覆盖；s8真实0仍是0，率分母0为null |
| 推广缺失与其他区块冲突 | missing时KPI/矩阵/图表tooltip/详情仍显示正常推广数 | shared/data.js对totals、店铺、趋势统一置null，covered=0；ERP保持原值；详情通过createModel遵守情景 |
| 局部SKU详情逃出选择范围 | s1＋9月首周证据应61,596.56元，原详情用全公司整月725,123.11元 | shared/scope.js明确global/local/explore；localScope=9月1—7日＋s1，独立重算61,596.56元；app.js依据证据容器绑定local |
| 平台矩阵扩张全局店铺范围 | 全局s1的700,866.24元，平台行扩大到1,159,288.98元并占165.4% | Demo03保持全局shop；渲染不再含扩大值；目标路由修为shop/platforms |
| 硬编码商品和店铺变化结论 | 无比较/零店仍声称蒸箱增长；新店任何日期都说无基期 | 商品结构文案改成按完整跨期事实判断；单店说明改成按选期核验，不硬编码变化结论 |
| 推广效率趋势不可见 | 只有花费线，ROAS藏tooltip | 共享推广区补花费/归因/ROAS期间表；金额、倍数和各域口径分别标注 |
| ERP完整性错误受广告missing影响 | s1 ERP全覆盖，却KPI脚注声明缺来源小计 | 回读const complete=t.coverage.complete；missing＋s1独立重测ERP“全量”且无公司小计警告 |
| 空情景覆盖计数与金额矛盾 | 空ERP结果曾仍有覆盖计数 | ERP和推广covered均0，complete=false；局部证据和详情保留未覆盖 |

## 口径与场景资格

已确认综合大毛利=ERP净销售−成本、毛利率按同一分子；退货/正向金额比例；ROAS按归因成交/花费，不当利润率。s2同比出现销售正增长但毛利下降及负毛利，s6无基期、s8实际零值、s7未接入、关闭比较均保持正确状态。金额负值保留零线以下，完整比较资格不足不推“新增”。

库存按最新公司快照及独立销量需求窗口，跨店筛选对象保持同一事实；唯一SKU与商品仓位分别计数，未匹配销量不当零销量；过期快照暂停采纳补货建议。财报固定最近完整8月与缺失9月，费用/利润不同于ERP选期，无虚构日利润。

Demo02章节叙述＋页内导航；03对象矩阵＋选店趋势；04全局图表与局部证据分屏；05平台→店→品类→ERP SKU贡献路径。结构与主要交互存在实质差异，核心内容由共同UI完整复用。05广告止于店铺、库存保留公司仓位、财报保留公司完整月，无身份则停止关联，不表达因果。

## 最后追加的 app.js 交互修复复核

仅追加审查 app.js 的折叠状态、重置及粒度逻辑，未修改实现。最新被测app摘要见下表，最终完整stdout保存在 `independent-result.json`。

- render前从旧DOM采集details状态，键为旧renderedDemo＋id或summary；render后按新demo恢复。真实source-fragment在隔离Node vm中实际执行，验证手动打开后重渲染仍打开、明确关闭仍保持关闭、相同summary不会跨Demo继承。
- set在grain变化时清evidenceDate，保留店铺范围，防止旧周起点被误当自然月证据。
- reset实际dispatch恢复exploreMetric=sales、matrixMode=shops、linkedView=trend、linkedProduct为空，防止局部残余状态与重置后的全局筛选冲突。
- 上述9项断言与原229项全部通过，当前审查范围阻断0。vm使用实际app函数和采集/恢复源码片段，DOM仅用独立stand-in；此资格是源码执行，不冒充真实浏览器验证。

总控另报告实际04/05展开、排序、搜索、详情返回及五案共用详情已实操通过；该浏览器资格由总控保留，我未重新浏览器执行。
## 最终 moduleDetail 目标范围复核

最后实现只增加专业目标的范围归一化，已对实际moduleDetail函数做隔离VM执行（8项新增断言）。输入故意携带s1、K01及9月1—7日局部范围：

- inventory目标实际文案为公司库存快照10月1日及需求窗口9月5—10月4日，不含“精确店铺”或旧9月局部范围。可继续携带已知ERP商品上下文，未把公司货值归属到单店。
- finance目标实际文案为公司完整2026-08月，不含精确店铺、K01商品身份或旧日范围。财报保持月度资格，不冒选店／选日利润。
- 最终脚本exit0，PASS共246项、40次渲染。app SHA77613425完整值见下表；source摘要与independent-result.json同步。当前审查范围阻断0。

03/04仅CSS字面颜色换同义design tokens，不属于本次JS审查变更；既有JS摘要保持。此轮无实现、Git、服务或生产操作。
## 最后执行的来源摘要

| 文件 | SHA256 |
|---|---|
| shared/data.js | 808e74d94fa9e789698e6eceb83f2f0ab912d58dc270e79a3a410cdde2863447 |
| shared/ui.js | 083835c064e4493c7e58e4d6bd4d68a5994a00ba8836834c42a63fc24247cacd |
| shared/scope.js | 3a01e584fd790e1aefd0eea004a5890bf1c380191fb164d55cac4312b5ba535a |
| app.js | 366f9fc0edf3de04dbe31213d00ea5ab73721ea4e0bac7e9b123f39a9a18cc26 |
| demo02/layout.js | f28521163498f5cf37f0d286e90c34c09b5ff975dc1d8f86b24329441a6919bf |
| demo03/layout.js | 3e8342dca0054d8b0af400e024c634427a3c65cb59ca564e9342e0f8f9678a50 |
| demo04/layout.js | 39e49ed223158314ade050c08880e0d1af22359bd3c648bf1f33223374a19fbe |
| demo05/layout.js | b9caf365ae018b1e448f8bb29a40dbfcd095187704c4954cb2951d0d1478afbe |

## 验证限制

本脚本验证共享计算、状态、范围和HTML渲染；DOM事件绑定、专业模拟详情反馈和返回保留状态做源码审查。未执行浏览器、真实点击、焦点测试或截图，因此不宣称1440/1280/390字体、溢出、遮挡及控制台已通过。实际浏览器证据由总控另记。图轴文字已从SVG text改HTML标签，在此仅确认源码采用12px语义字号，实际计算样式仍由浏览器验收。

交付前只统一本 Demo 文本文件为 LF 并去除 EOF 多余空行；未改实现逻辑。总控重跑相同独立脚本仍246断言/40渲染通过，上表与 independent-result.json 更新为交付文件摘要。
