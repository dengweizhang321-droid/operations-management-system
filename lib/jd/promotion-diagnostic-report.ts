import { createXlsxWorkbookBytes, type XlsxOutputSheet } from "../imports/xlsx-write";

export const PROMOTION_DIAGNOSTIC_SCHEMA = "jd-promotion-diagnostic-v1";
type MetricKey = "spendCents" | "impressions" | "clicks" | "reportedOrderLines" | "reportedGmvCents";
const METRICS: MetricKey[] = ["spendCents", "impressions", "clicks", "reportedOrderLines", "reportedGmvCents"];

export type DiagnosticMetrics = Record<MetricKey, number | null>;
export type DiagnosticGroup = {
  key: string;
  rowCount: number;
  metrics: DiagnosticMetrics;
  id?: string | null;
  name?: string;
  planId?: string | null;
  skuId?: string | null;
  keyword?: string | null;
  searchTerm?: string | null;
};
export type DiagnosticPeriod = {
  schemaVersion: string;
  identity: { platform: string; shopName: string };
  period: { startDate: string; endDate: string };
  sourceRevision: string;
  coverage: {
    requestedDates: string[];
    presentDates: string[];
    missingDates: string[];
    complete: boolean;
    rowCount: number;
    aggregateReconciled: boolean;
  };
  metricAvailability: Record<MetricKey, { presentRows: number; totalRows: number; complete: boolean }>;
  sourceBatches: Array<{ date: string; batchIds: string[]; accountNicknames: string[]; rowCount: number; aggregateBatchId: string }>;
  summary: DiagnosticMetrics;
  daily: Array<{ date: string; rowCount: number; metrics: DiagnosticMetrics }>;
  groups: Record<"plans" | "products" | "keywords" | "searchTerms" | "keywordSku", DiagnosticGroup[]>;
  limitations: string[];
};

type Cell = string | number | null;
export type ReportColumn = { key: string; label: string; kind: "text" | "number" | "money" | "percent" | "ratio" };
export type ReportTable = { key: string; title: string; note: string; columns: ReportColumn[]; rows: Cell[][] };
export type ReportAction = { priority: string; object: string; evidence: string; change: string; metric: string; observation: string; rollback: string; tableKey: string };
export type PromotionDiagnosticReport = {
  schemaVersion: "jd-promotion-report-v1";
  analysisType: "deterministic_review_draft";
  shopName: string;
  period: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string } | null;
  complete: boolean;
  comparisonAvailable: boolean;
  sourceRevision: string;
  metrics: DiagnosticMetrics;
  previousMetrics: DiagnosticMetrics | null;
  coverage: DiagnosticPeriod["coverage"];
  findings: Array<{ title: string; text: string; tableKey: string }>;
  actions: ReportAction[];
  tables: ReportTable[];
  limitations: string[];
};

function validDate(value: string) {
  return /^20\d\d-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function dates(start: string, end: string) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("推广诊断日期无效");
  const result: string[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
    if (result.length > 31) throw new Error("推广诊断超过31天");
  }
  return result;
}

function safeMetric(value: number | null, name: string) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`推广诊断${name}不是非负整数`);
}

export function validateDiagnosticPeriod(period: DiagnosticPeriod) {
  if (period?.schemaVersion !== PROMOTION_DIAGNOSTIC_SCHEMA || period.identity?.platform !== "京东"
    || !period.identity?.shopName || !period.sourceRevision || period.coverage?.aggregateReconciled !== true) {
    throw new Error("推广诊断来源身份、修订或逐日对账无效");
  }
  const expected = dates(period.period.startDate, period.period.endDate);
  if (JSON.stringify(period.coverage.requestedDates) !== JSON.stringify(expected)
    || !Array.isArray(period.daily) || period.daily.length !== expected.length
    || period.daily.some((item, index) => item.date !== expected[index])
    || period.coverage.complete !== (period.coverage.missingDates.length === 0)
    || !Number.isSafeInteger(period.coverage.rowCount) || period.coverage.rowCount < 0) {
    throw new Error("推广诊断日期覆盖或行数无效");
  }
  if (period.sourceBatches.some((item) => !Array.isArray(item.accountNicknames) || item.accountNicknames.length > 10)) {
    throw new Error("推广来源账户昵称证据无效");
  }
  for (const key of METRICS) {
    safeMetric(period.summary[key], key);
    for (const day of period.daily) safeMetric(day.metrics?.[key], key);
    const availability = period.metricAvailability?.[key];
    if (!availability || availability.totalRows !== period.coverage.rowCount
      || !Number.isSafeInteger(availability.presentRows) || availability.presentRows < 0
      || availability.presentRows > availability.totalRows
      || availability.complete !== (availability.totalRows > 0 && availability.presentRows === availability.totalRows)
      || (availability.complete && period.summary[key] === null)) {
      throw new Error("推广诊断指标可用性与来源行数不一致");
    }
  }
  for (const name of ["plans", "products", "keywords", "searchTerms", "keywordSku"] as const) {
    const groups = period.groups?.[name];
    if (!Array.isArray(groups) || groups.reduce((total, group) => total + group.rowCount, 0) !== period.coverage.rowCount
      || new Set(groups.map((group) => group.key)).size !== groups.length) {
      throw new Error(`推广诊断${name}分组未与来源行数对平`);
    }
    for (const group of groups) {
      if (!group.key || !Number.isSafeInteger(group.rowCount) || group.rowCount < 1) throw new Error("推广诊断分组身份无效");
      for (const key of METRICS) safeMetric(group.metrics?.[key], key);
    }
  }
  return expected;
}

function value(metrics: DiagnosticMetrics, key: MetricKey) { return metrics[key]; }
function money(cents: number | null) { return cents === null ? null : cents / 100; }
function ratio(numerator: number | null, denominator: number | null) {
  return numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator;
}
function percent(numerator: number | null, denominator: number | null) {
  const raw = ratio(numerator, denominator);
  return raw === null ? null : Math.round(raw * 10_000) / 100;
}
function rounded(raw: number | null, places = 2) { return raw === null ? null : Math.round(raw * 10 ** places) / 10 ** places; }
function change(current: number | null, previous: number | null) {
  return current === null || previous === null || previous <= 0 ? null : rounded((current / previous - 1) * 100);
}
function metricRow(label: string, current: number | null, previous: number | null, unit: string, comparable: boolean): Cell[] {
  return [label, current, comparable ? previous : null, comparable ? change(current, previous) : null, unit];
}
function metricGroup(group: DiagnosticGroup): Cell[] {
  const m = group.metrics;
  return [group.name ?? group.id ?? group.key, group.rowCount, money(m.spendCents), m.impressions,
    m.clicks, percent(m.clicks, m.impressions), m.reportedOrderLines,
    percent(m.reportedOrderLines, m.clicks), money(m.reportedGmvCents), rounded(ratio(m.reportedGmvCents, m.spendCents)), group.key];
}

const GROUP_COLUMNS: ReportColumn[] = [
  { key: "name", label: "对象", kind: "text" }, { key: "rows", label: "来源行", kind: "number" },
  { key: "spend", label: "花费（元）", kind: "money" }, { key: "impressions", label: "展现", kind: "number" },
  { key: "clicks", label: "点击", kind: "number" }, { key: "ctr", label: "CTR（%）", kind: "percent" },
  { key: "orders", label: "归因订单行", kind: "number" }, { key: "orderRate", label: "点击→归因订单行（%）", kind: "percent" },
  { key: "gmv", label: "归因总订单金额（元）", kind: "money" }, { key: "roas", label: "归因ROAS", kind: "ratio" },
  { key: "groupKey", label: "分组身份（来源键）", kind: "text" },
];

export function buildPromotionDiagnosticReport(current: DiagnosticPeriod, previous?: DiagnosticPeriod | null): PromotionDiagnosticReport {
  const currentDates = validateDiagnosticPeriod(current);
  if (previous) validateDiagnosticPeriod(previous);
  if (previous && (previous.identity.shopName !== current.identity.shopName || previous.identity.platform !== current.identity.platform)) {
    throw new Error("推广诊断对照期店铺身份不一致");
  }
  const comparable = Boolean(previous && previous.coverage.complete && current.coverage.complete
    && previous.sourceRevision === current.sourceRevision && previous.coverage.requestedDates.length === currentDates.length);
  const m = current.summary, p = comparable ? previous!.summary : null;
  const currentOrderRate = percent(m.reportedOrderLines, m.clicks);
  const previousOrderRate = p ? percent(p.reportedOrderLines, p.clicks) : null;
  const currentCtr = percent(m.clicks, m.impressions);
  const previousCtr = p ? percent(p.clicks, p.impressions) : null;
  const currentRoas = rounded(ratio(m.reportedGmvCents, m.spendCents));
  const previousRoas = p ? rounded(ratio(p.reportedGmvCents, p.spendCents)) : null;
  const identifiablePlans = current.groups.plans.filter((item) => item.planId || (item.name && item.name !== "未提供计划名称"));
  const anonymousPlanSpend = current.groups.plans.filter((item) => !identifiablePlans.includes(item))
    .reduce((sum, item) => sum + (item.metrics.spendCents ?? 0), 0);
  const topPlans = [...identifiablePlans].filter((item) => item.metrics.spendCents !== null)
    .sort((a, b) => (b.metrics.spendCents ?? 0) - (a.metrics.spendCents ?? 0)).slice(0, 3);
  const topSpend = topPlans.reduce((sum, item) => sum + (item.metrics.spendCents ?? 0), 0);
  const concentration = topPlans.length ? percent(topSpend, m.spendCents) : null;
  const anonymousShare = percent(anonymousPlanSpend, m.spendCents);
  const unlabelledSpendShare = (groups: DiagnosticGroup[], key: "keyword" | "searchTerm") =>
    percent(groups.filter((group) => !group[key]).reduce((sum, group) => sum + (group.metrics.spendCents ?? 0), 0), m.spendCents);
  const noKeywordShare = unlabelledSpendShare(current.groups.keywords, "keyword");
  const noSearchTermShare = unlabelledSpendShare(current.groups.searchTerms, "searchTerm");
  const findings: PromotionDiagnosticReport["findings"] = [];
  const limitations = [...new Set([
    ...current.limitations,
    ...(previous?.limitations ?? []),
    "推广总订单金额和订单行是平台归因口径，不是ERP净销售、利润或增量效果。",
    "各维度是同一推广来源行的不同分组，不可跨表相加。归因窗口未独立核实。",
    "关键词或搜索词为空可能对应非搜索类定向；空值单列，不把它当成关键词或搜索词效果。",
    "品类、SPU、市场、店铺净销售、B端销售和同比尚未接入同店同日期的可核对来源，本报告不推断这些结论。",
    "规则诊断仅列人工复核候选；未调用模型，也未自动修改投放。",
  ])];
  if (!current.coverage.complete) findings.push({ title: "本期数据未齐", text: `缺少 ${current.coverage.missingDates.join("、")}，暂不形成完整周期结论。`, tableKey: "coverage" });
  if (!comparable) {
    limitations.push(previous ? "前期缺日、周期长度或来源修订不同，环比数值留空。" : "未提供前等长周期来源，环比数值留空。");
  } else if (currentOrderRate !== null && previousOrderRate !== null) {
    const direction = currentOrderRate < previousOrderRate ? "下降" : currentOrderRate > previousOrderRate ? "上升" : "持平";
    findings.push({ title: "展现→点击→归因转化", text: `CTR ${previousCtr ?? "—"}%→${currentCtr ?? "—"}%，点击到归因订单行率 ${previousOrderRate}%→${currentOrderRate}%（${direction}）。这是平台归因表的变化，不证明原因或利润变化。`, tableKey: "summary" });
  }
  if (current.coverage.complete) {
    if (concentration !== null) findings.push({ title: "可识别计划花费", text: `可识别计划中花费前三合计占全店 ${concentration}%；计划身份缺失的花费占 ${anonymousShare ?? "—"}%。优先核搜索词、跟单SKU和归因成熟度，不能仅凭集中度判断低效。`, tableKey: "plans" });
    else if (anonymousShare !== null && anonymousShare > 0) findings.push({ title: "计划身份缺失", text: `计划身份缺失的花费占 ${anonymousShare}%；不能给出计划排名或计划级预算建议。`, tableKey: "plans" });
    if (noKeywordShare !== null && noKeywordShare > 0) findings.push({ title: "关键词适用范围", text: `无关键词来源行占全店花费 ${noKeywordShare}%；搜索词空值花费占 ${noSearchTermShare ?? "—"}%。应先区分搜索与非搜索定向，不能把关键词子集结论推广到全部投放。`, tableKey: "keywords" });
  }
  const actions: ReportAction[] = [];
  if (!current.coverage.complete) actions.push({ priority: "先补源", object: current.identity.shopName, evidence: `缺日：${current.coverage.missingDates.join("、")}`, change: "核对原自然计划的来源和导入结果，数据齐全前不作效果排名", metric: "日期覆盖/批次与五项源指标", observation: "下一次原自然同步后", rollback: "新批次口径变化时撤回旧结论", tableKey: "coverage" });
  if (current.coverage.complete && anonymousShare !== null && anonymousShare > 0) actions.push({ priority: "先核身份", object: "未识别计划来源行", evidence: `计划身份缺失花费占 ${anonymousShare}%`, change: "核对原始计划字段和导入映射；不按匿名桶做计划级预算调整", metric: "计划ID/名称覆盖与来源批次", observation: "下一次生成前", rollback: "身份未补齐则继续隐藏计划级结论", tableKey: "plans" });
  if (current.coverage.complete && noKeywordShare !== null && noKeywordShare > 20) actions.push({ priority: "先分定向", object: "无关键词来源行", evidence: `无关键词行花费占 ${noKeywordShare}%`, change: "按营销场景和定向类型核对搜索与非搜索花费；仅对有词子集作关键词复核", metric: "有词/无词花费占比与词货归因", observation: "本周期复核后", rollback: "来源场景无法区分时不生成全店关键词效率结论", tableKey: "keywords" });
  if (comparable && currentOrderRate !== null && previousOrderRate !== null && currentOrderRate < previousOrderRate) {
    actions.push({ priority: "高：人工复核", object: "点击到归因订单行环节", evidence: `${previousOrderRate}%→${currentOrderRate}%`, change: "按花费前列计划核归因窗口、词匹配、商品与落地页变化；仅在可比且归因成熟后做人工小步试验", metric: "点击/归因订单行率/ROAS", observation: "至少7天并等待归因成熟", rollback: "样本不足或归因未成熟则停止判优；试验后可比效率继续下降时人工回退", tableKey: "plans" });
  }
  for (const plan of current.coverage.complete ? topPlans : []) {
    const clicks = plan.metrics.clicks, orders = plan.metrics.reportedOrderLines;
    if (clicks === null || orders === null || clicks < 30 || orders < 3) {
      actions.push({ priority: "观察", object: plan.name ?? plan.planId ?? "未提供计划", evidence: `点击 ${clicks ?? "缺字段"}、归因订单行 ${orders ?? "缺字段"}`, change: "样本量或归因成熟度不足；先核来源与继续观察，不据此停投或转移预算", metric: "点击/归因订单行/花费", observation: "至少7天或达到人工复核样本门槛", rollback: "字段或归因口径变化时撤回比较", tableKey: "plans" });
      continue;
    }
    const planRoas = ratio(plan.metrics.reportedGmvCents, plan.metrics.spendCents);
    const shopRoas = ratio(m.reportedGmvCents, m.spendCents);
    const spendShare = percent(plan.metrics.spendCents, m.spendCents);
    if (planRoas !== null && shopRoas !== null && shopRoas > 0 && spendShare !== null && spendShare >= 10 && planRoas < shopRoas * 0.8) {
      actions.push({ priority: "高：人工复核", object: plan.name ?? plan.planId ?? "未提供计划", evidence: `花费占 ${spendShare}%，归因ROAS ${rounded(planRoas)}，全店 ${rounded(shopRoas)}；点击 ${clicks}、订单行 ${orders}`, change: "核查词/搜索词、跟单SKU及落地页，再设计小比例人工试验；不据此直接停投", metric: "计划归因ROAS/点击到订单行率/花费占比", observation: "至少7天并等待归因成熟", rollback: "归因窗口或分组身份变化时撤回判断；试验劣于对照时人工回退", tableKey: "plans" });
    }
  }
  if (!actions.length) actions.push({ priority: "例行复查", object: current.identity.shopName, evidence: "当前周期来源已对账", change: "复核花费前列对象及归因成熟度，保留现有策略待人工判断", metric: "CTR/点击到订单行率/ROAS", observation: "下一完整周期", rollback: "源版本变化时重新生成报告", tableKey: "plans" });
  const tables: ReportTable[] = [
    { key: "summary", title: "经营总览", note: "同一京准通推广口径；环比只在同店、等天数、两期完整且来源修订一致时展示。", columns: [
      { key: "metric", label: "指标", kind: "text" }, { key: "current", label: "本期", kind: "number" },
      { key: "previous", label: "前等长周期", kind: "number" }, { key: "change", label: "环比变化（%）", kind: "percent" },
      { key: "unit", label: "单位", kind: "text" },
    ], rows: [
      metricRow("推广花费", money(m.spendCents), p ? money(p.spendCents) : null, "元", comparable),
      metricRow("展现", m.impressions, p?.impressions ?? null, "次", comparable),
      metricRow("点击", m.clicks, p?.clicks ?? null, "次", comparable),
      metricRow("CTR", currentCtr, previousCtr, "%", comparable),
      metricRow("平均点击花费", rounded(ratio(m.spendCents, m.clicks) === null ? null : ratio(m.spendCents, m.clicks)! / 100), p ? rounded(ratio(p.spendCents, p.clicks) === null ? null : ratio(p.spendCents, p.clicks)! / 100) : null, "元", comparable),
      metricRow("归因订单行", m.reportedOrderLines, p?.reportedOrderLines ?? null, "行", comparable),
      metricRow("点击→归因订单行率", currentOrderRate, previousOrderRate, "%", comparable),
      metricRow("归因总订单金额", money(m.reportedGmvCents), p ? money(p.reportedGmvCents) : null, "元", comparable),
      metricRow("归因ROAS", currentRoas, previousRoas, "倍", comparable),
    ] },
    { key: "daily", title: "每日趋势", note: "前期按自然日序号对齐；不是同一自然日。缺日与缺字段留空。", columns: [
      { key: "date", label: "本期日期", kind: "text" }, { key: "spend", label: "花费（元）", kind: "money" },
      { key: "impressions", label: "展现", kind: "number" }, { key: "clicks", label: "点击", kind: "number" },
      { key: "orders", label: "归因订单行", kind: "number" }, { key: "gmv", label: "归因金额（元）", kind: "money" },
      { key: "previousDate", label: "前期日期", kind: "text" }, { key: "previousSpend", label: "前期花费（元）", kind: "money" },
      { key: "previousClicks", label: "前期点击", kind: "number" }, { key: "previousOrders", label: "前期订单行", kind: "number" },
    ], rows: current.daily.map((day, index) => [day.date, money(value(day.metrics, "spendCents")), day.metrics.impressions,
      day.metrics.clicks, day.metrics.reportedOrderLines, money(day.metrics.reportedGmvCents),
      comparable ? previous!.daily[index]!.date : null,
      comparable ? money(previous!.daily[index]!.metrics.spendCents) : null,
      comparable ? previous!.daily[index]!.metrics.clicks : null,
      comparable ? previous!.daily[index]!.metrics.reportedOrderLines : null]) },
    ...(["plans", "products", "keywords", "searchTerms", "keywordSku"] as const).map((key) => ({
      key, title: ({ plans: "计划诊断", products: "商品诊断", keywords: "关键词诊断", searchTerms: "搜索词诊断", keywordSku: "词货证据" })[key],
      note: "同一来源事实的独立分组；未提供身份保留单独桶。比率先合计分子分母，再计算。",
      columns: GROUP_COLUMNS, rows: current.groups[key].map(metricGroup),
    })),
    { key: "actions", title: "调整建议", note: "规则候选，待运营人员复核；无自动调价/投放。", columns: [
      { key: "priority", label: "优先级", kind: "text" }, { key: "object", label: "对象", kind: "text" },
      { key: "evidence", label: "依据", kind: "text" }, { key: "change", label: "建议核查或试验", kind: "text" },
      { key: "metric", label: "复查指标", kind: "text" }, { key: "observation", label: "观察期", kind: "text" },
      { key: "rollback", label: "停止/回退条件", kind: "text" },
    ], rows: actions.map((item) => [item.priority, item.object, item.evidence, item.change, item.metric, item.observation, item.rollback]) },
    { key: "coverage", title: "来源与口径", note: "日期/批次只证明所列来源；推广归因不是ERP净销售或利润。", columns: [
      { key: "date", label: "业务日", kind: "text" }, { key: "status", label: "本期覆盖", kind: "text" },
      { key: "rows", label: "来源行", kind: "number" }, { key: "batch", label: "来源批次", kind: "text" },
      { key: "account", label: "来源账户昵称", kind: "text" },
    ], rows: currentDates.map((date) => {
      const source = current.sourceBatches.find((item) => item.date === date);
      return [date, source ? "已观察且与聚合对账" : "缺源", source?.rowCount ?? null, source?.batchIds.join("、") ?? null, source?.accountNicknames.join("、") ?? null];
    }) },
  ];
  return {
    schemaVersion: "jd-promotion-report-v1", analysisType: "deterministic_review_draft",
    shopName: current.identity.shopName, period: current.period, previousPeriod: comparable ? previous!.period : null,
    complete: current.coverage.complete, comparisonAvailable: comparable, sourceRevision: current.sourceRevision,
    metrics: m, previousMetrics: p, coverage: current.coverage, findings, actions, tables, limitations,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Self-contained, offline HTML. Every visible number comes from the same table cells as XLSX. */
export function promotionDiagnosticHtml(report: PromotionDiagnosticReport) {
  const title = `${report.shopName} · ${report.period.startDate} 至 ${report.period.endDate} 推广深度诊断`;
  const encoded = JSON.stringify(report).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>
  :root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#173129;background:#f4f7f5}body{margin:0}header{background:#12382f;color:white;padding:32px max(20px,5vw)}h1{font-size:clamp(24px,4vw,38px);margin:8px 0}main{max-width:1380px;margin:auto;padding:24px}p{line-height:1.55}.muted{color:#65746e}.warning{background:#fff3d7;border:1px solid #e0ba62;padding:14px;border-radius:10px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card,section{background:white;border:1px solid #d8e3dd;border-radius:12px;padding:16px;margin:12px 0}.card b{font-size:23px;display:block}.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button,input,select{font:inherit;padding:9px;border:1px solid #b7cac0;border-radius:7px;background:white}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #187f5a}nav{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.active{background:#17684e;color:white}.tablewrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #dce6e0;padding:9px;text-align:left;white-space:nowrap}th{background:#eef4f0;position:sticky;top:0}td.num{text-align:right;font-variant-numeric:tabular-nums}.pager{display:flex;justify-content:space-between;gap:8px;align-items:center}.chart{width:100%;max-height:220px}.badge{display:inline-block;border-radius:100px;background:#e9f5ec;padding:3px 9px;margin-right:6px}@media(max-width:600px){main{padding:12px}header{padding:22px 14px}}
  </style></head><body><header><small>BUSINESS REVIEW · 京东推广</small><h1>${escapeHtml(title)}</h1><p>规则诊断草稿 · 来源与口径可核对 · 无自动投放操作</p></header><main><div id="status"></div><div id="kpis" class="grid"></div><section><h2>经营判断与复查方向</h2><div id="findings"></div></section><section><h2>逐日推广花费（元）</h2><div id="chart"></div></section><section><h2>明细与行动</h2><nav id="tabs"></nav><p id="note" class="muted"></p><div class="toolbar"><input id="search" placeholder="搜索当前表" aria-label="搜索当前表"><select id="sort" aria-label="排序列"></select><button id="direction">降序</button><button id="csv">导出当前表CSV</button></div><div class="tablewrap"><table><thead id="head"></thead><tbody id="body"></tbody></table></div><div class="pager"><span id="count"></span><span><button id="prev">上一页</button> <button id="next">下一页</button></span></div></section><section><h2>口径与限制</h2><ul id="limits"></ul></section></main><script type="application/json" id="report">${encoded}</script><script>
  (()=>{const R=JSON.parse(document.getElementById('report').textContent),$=id=>document.getElementById(id),N=(tag,text)=>{const n=['svg','circle','polyline','text'].includes(tag)?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n},fmt=(v,k)=>v===null?'—':k==='money'?'¥'+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):k==='percent'?Number(v).toFixed(2)+'%':k==='ratio'?Number(v).toFixed(2):k==='number'?Number(v).toLocaleString('zh-CN'):String(v);let selected=R.tables[0],page=0,descending=true;const PAGE=50;const status=N('div',R.complete?'已覆盖完整 '+R.coverage.requestedDates.length+' 天 · 来源修订 '+R.sourceRevision:'数据待补：'+R.coverage.missingDates.join('、')+'；不可视为完整周期');status.className=R.complete?'card':'warning';$('status').append(status);for(const [label,value] of [['推广花费',R.metrics.spendCents===null?'—':fmt(R.metrics.spendCents/100,'money')],['展现',fmt(R.metrics.impressions,'number')],['点击',fmt(R.metrics.clicks,'number')],['归因订单行',fmt(R.metrics.reportedOrderLines,'number')],['归因总订单金额',R.metrics.reportedGmvCents===null?'—':fmt(R.metrics.reportedGmvCents/100,'money')]]){const card=N('div');card.className='card';card.append(N('span',label),N('b',value));$('kpis').append(card)}for(const finding of R.findings){const article=N('article');article.className='card';article.append(N('h3',finding.title),N('p',finding.text));const btn=N('button','查看对应明细');btn.onclick=()=>show(R.tables.find(x=>x.key===finding.tableKey)||R.tables[0]);article.append(btn);$('findings').append(article)}for(const line of R.limitations)$('limits').append(N('li',line));function chart(){const rows=R.tables.find(t=>t.key==='daily').rows,values=rows.map(r=>r[1]),max=Math.max(1,...values.filter(v=>typeof v==='number')),svg=N('svg');svg.setAttribute('viewBox','0 0 680 220');svg.setAttribute('class','chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','逐日推广花费');const pts=[];rows.forEach((r,i)=>{const x=45+(rows.length===1?0:i*590/(rows.length-1)),v=r[1];if(typeof v==='number'){const y=175-v/max*135;pts.push(x+','+y);const circle=N('circle');circle.setAttribute('cx',String(x));circle.setAttribute('cy',String(y));circle.setAttribute('r','4');circle.setAttribute('fill','#17684e');svg.append(circle)}const text=N('text',String(r[0]).slice(5));text.setAttribute('x',String(x-17));text.setAttribute('y','205');text.setAttribute('font-size','11');svg.append(text)});if(pts.length){const line=N('polyline');line.setAttribute('points',pts.join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#17684e');line.setAttribute('stroke-width','3');svg.prepend(line)}$('chart').append(svg)}function show(t){selected=t;page=0;$('search').value='';$('tabs').replaceChildren(...R.tables.map(item=>{const b=N('button',item.title);b.className=item.key===t.key?'active':'';b.onclick=()=>show(item);return b}));$('note').textContent=t.note;$('sort').replaceChildren(N('option','原始顺序'),...t.columns.map((c,i)=>{const o=N('option',c.label);o.value=String(i);return o}));refresh()}function selectedRows(){const q=$('search').value.trim().toLocaleLowerCase(),sort=$('sort').value;const rows=selected.rows.filter(row=>!q||row.some(v=>v!==null&&String(v).toLocaleLowerCase().includes(q)));if(sort!==''){const i=Number(sort);rows.sort((a,b)=>{const x=a[i],y=b[i];if(x===null||y===null)return x===y?0:x===null?1:-1;const d=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'zh-CN');return descending?-d:d})}return rows}function refresh(){const rows=selectedRows(),pageCount=Math.max(1,Math.ceil(rows.length/PAGE));page=Math.min(page,pageCount-1);const tr=N('tr');selected.columns.forEach(c=>tr.append(N('th',c.label)));$('head').replaceChildren(tr);const body=document.createDocumentFragment();for(const row of rows.slice(page*PAGE,(page+1)*PAGE)){const tr=N('tr');row.forEach((v,i)=>{const td=N('td',fmt(v,selected.columns[i].kind));if(selected.columns[i].kind!=='text')td.className='num';tr.append(td)});body.append(tr)}$('body').replaceChildren(body);$('count').textContent=rows.length.toLocaleString()+' / '+selected.rows.length.toLocaleString()+' 行 · 第 '+(page+1)+' / '+pageCount+' 页';$('prev').disabled=page===0;$('next').disabled=page+1>=pageCount}$('search').oninput=()=>{page=0;refresh()};$('sort').onchange=()=>{page=0;refresh()};$('direction').onclick=()=>{descending=!descending;$('direction').textContent=descending?'降序':'升序';refresh()};$('prev').onclick=()=>{page--;refresh()};$('next').onclick=()=>{page++;refresh()};$('csv').onclick=()=>{const lines=[selected.columns.map(c=>c.label),...selectedRows().map(row=>row.map(v=>typeof v==='string'&&['=','+','-','@'].includes(v.trimStart()[0])?"'"+v:v===null?'':v))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(','));const blob=new Blob(['\ufeff'+lines.join('\\r\\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=N('a');a.href=url;a.download=selected.title+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};chart();show(selected);window.reportReady=true})();
  </script></body></html>`;
}

export function promotionDiagnosticXlsx(report: PromotionDiagnosticReport) {
  const sheets: XlsxOutputSheet[] = report.tables.map((table) => ({
    name: table.title.slice(0, 25),
    rows: [[...table.columns.map((column) => column.label)], ...table.rows],
    headerStyle: true,
    freezeHeader: true,
    autoFilter: true,
    columnWidths: table.columns.map((column) => column.kind === "text" ? 28 : 18),
  }));
  return createXlsxWorkbookBytes(sheets);
}
