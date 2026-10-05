"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { requestJson } from "@/lib/http/api-client";
import { decodeBiCockpit, decodeBiFlowReply, flowData, inventoryData, operationsData, type BiCockpit, type BiMetric, type BiSource, type BiFlowMetric } from "@/lib/bi/cockpit-contract";
import { salesRangeMap, type SalesRangeLabel, type CurrentUser } from "./module-view-shared";
import styles from "./bi-cockpit-view.module.css";
import type { ModuleViewKey } from "./shell/navigation-catalog";

const count = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(n);
const money = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
const compactMoney = (n: number | null | undefined) => n == null ? "—" : Math.abs(n) >= 1_000_000 ? `${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 1_000_000)}万` : money(n);
const rate = (n: number | null | undefined) => n == null ? "不可比" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const percent = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
function Card({ title, hint, actions, children, wide = false, full = false }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode; wide?: boolean; full?: boolean }) {
  return <section className={`${styles.card} ${wide ? styles.wide : ""} ${full ? styles.full : ""}`}><header className={styles.heading}><div><h2>{title}</h2>{hint && <small>{hint}</small>}</div>{actions}</header>{children}</section>;
}
function Missing({ source, text }: { source?: BiSource; text?: string }) {
  const reason: Record<string, string> = { source_not_configured: "数据连接尚未完成", revision_changed: "数据更新中，请稍后刷新", sales_revision_changed: "销售数据正在更新，请刷新后核对", source_timeout: "读取超时，请稍后刷新", deferred: "正在加载", capacity_exceeded: "当前范围超过读取上限，请缩小范围" };
  return <div className={styles.empty} role="status">{text ?? "暂时无法读取来源数据"}{source?.reasonCode && <small>{reason[source.reasonCode] ?? "请核对数据同步情况后重试"}</small>}</div>;
}
function Trend({ value }: { value: number | null }) { return <span className={value === null ? styles.muted : value < 0 ? styles.down : styles.up}>{rate(value)}</span>; }
function relative(a: BiMetric, b: BiMetric, key: "netSalesCents" | "grossProfitCents" | "averageOrderValueCents") {
  const x = a[key], y = b[key];
  return x !== null && y !== null && y > 0 && a.coverage.dateComplete && b.coverage.dateComplete ? (x - y) / y : null;
}
function FlowValue({ metric, ratio = false }: { metric?: BiFlowMetric; ratio?: boolean }) {
  if (!metric || !["available", "partial"].includes(metric.status) || metric.value === null) return <span className={styles.muted} title={metric?.reasonCode ?? "来源未覆盖"}>—</span>;
  return <>{ratio ? percent(metric.value) : metric.unit === "CNY_CENT" ? compactMoney(metric.value) : metric.unit === "MULTIPLE" ? metric.value.toFixed(2) : count(metric.value)}{metric.status === "partial" && <small title="仅显示已覆盖的记录，不能当完整经营总量"> 部分覆盖</small>}</>;
}

export default function BiCockpitView({ range, customStartDate, customEndDate, currentUser, onNavigate }: {
  range: SalesRangeLabel; customStartDate: string; customEndDate: string; currentUser?: CurrentUser | null; onNavigate?: (module: "workflow" | "sales" | "inventory" | "shop", importSource?: undefined, view?: ModuleViewKey) => void;
}) {
  const [platform, setPlatform] = useState(""), [shop, setShop] = useState(""), [mine, setMine] = useState(false);
  const [flowPlatform, setFlowPlatform] = useState(""), [flowShop, setFlowShop] = useState(""), [dimension, setDimension] = useState<"platform" | "shop">("shop");
  const [refresh, setRefresh] = useState(0), [result, setResult] = useState<{ key: string; data: BiCockpit } | null>(null);
  const [optionCache, setOptionCache] = useState<{ identity: string; items: BiCockpit["erp"]["options"] }>({ identity: "", items: [] }), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [group, setGroup] = useState("");
  const [flowResult, setFlowResult] = useState<{ key: string; source: BiSource } | null>(null), [flowLoading, setFlowLoading] = useState(false), [flowError, setFlowError] = useState("");
  const generation = useRef(0), apiRange = salesRangeMap[range];
  const query = useMemo(() => {
    const params = new URLSearchParams({ range: apiRange, mine: mine ? "1" : "0", deferFlow: "1" });
    if (apiRange === "custom") { params.set("startDate", customStartDate); params.set("endDate", customEndDate); }
    if (platform) params.set("platform", platform); if (shop) params.set("shop", shop);
    return params.toString();
  }, [apiRange, customStartDate, customEndDate, platform, shop, mine]);
  const identity = JSON.stringify([currentUser?.email, currentUser?.role, currentUser?.scopeRestricted, currentUser?.displayName]);
  const requestKey = `${identity}:${query}`;
  const options = optionCache.identity === identity ? optionCache.items : [];
  useEffect(() => {
    const attempt = ++generation.current, controller = new AbortController(); setLoading(true); setError("");
    void requestJson<unknown>(`/api/bi/cockpit?${query}`, { signal: controller.signal }).then(raw => {
      const data = decodeBiCockpit(raw); if (controller.signal.aborted || attempt !== generation.current) return;
      setResult({ key: requestKey, data }); setOptionCache({ identity, items: data.erp.options });
    }).catch(reason => { if (!controller.signal.aborted && attempt === generation.current) setError(reason instanceof Error ? reason.message : "BI读取失败"); })
      .finally(() => { if (attempt === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [query, requestKey, identity, refresh]);
  const data = result?.key === requestKey ? result.data : null;
  const flowKey = `${requestKey}:${flowPlatform}:${flowShop}`;
  const needsFlow = Boolean(flowPlatform || flowShop || data?.sources.flow.reasonCode === "deferred");
  useEffect(() => {
    if (!data || !needsFlow) { setFlowLoading(false); return; }
    const controller = new AbortController(), params = new URLSearchParams(query);
    params.delete("mine"); if (flowPlatform) params.set("flowPlatform", flowPlatform); if (flowShop) params.set("flowShop", flowShop);
    setFlowLoading(true); setFlowError("");
    void requestJson<unknown>(`/api/bi/flow?${params}`, { signal: controller.signal }).then(raw => {
      const reply = decodeBiFlowReply(raw);
      if (reply.window.startDate !== data.erp.periods.current.startDate || reply.window.endDate !== data.erp.periods.current.endDate) throw new Error("经营日期已变化，请刷新驾驶舱");
      if (!controller.signal.aborted) setFlowResult({ key: flowKey, source: reply.source });
    }).catch(reason => { if (!controller.signal.aborted) setFlowError(reason instanceof Error ? reason.message : "流量读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setFlowLoading(false); });
    return () => controller.abort();
  }, [data, flowPlatform, flowShop, flowKey, query, refresh, needsFlow]);
  const controls = <div className={styles.controls}><label>平台<select value={platform} onChange={event => { setPlatform(event.target.value); setShop(""); setFlowPlatform(""); setFlowShop(""); }}><option value="">全部平台</option>{[...new Set(options.map(row => row.platform))].map(value => <option key={value}>{value}</option>)}</select></label><label>店铺<select value={shop} onChange={event => { setShop(event.target.value); setFlowPlatform(""); setFlowShop(""); }} disabled={!platform}><option value="">全部店铺</option>{options.filter(row => row.platform === platform).map(row => <option key={row.shop}>{row.shop}</option>)}</select></label><button onClick={() => setRefresh(n => n + 1)} disabled={loading}>{loading ? "读取中…" : "刷新"}</button></div>;
  if (!data) return <div className={styles.root}><div className={styles.toolbar}>{controls}</div><section className={styles.empty} role={error ? "alert" : "status"}><strong>{error ? "BI经营驾驶舱暂不可用" : "正在读取经营驾驶舱"}</strong><p>{error || "读取ERP销售、运营事务、库存及网店经营来源"}</p>{error && <button onClick={() => setRefresh(n => n + 1)}>重新读取</button>}</section></div>;
  const erp = data.erp, current = erp.sales.current;
  const localFlowSource: BiSource = needsFlow ? flowResult?.key === flowKey ? flowResult.source : { source: "flow", status: "unavailable", revision: null, data: null } : data.sources.flow;
  const ops = operationsData(data.sources.operations), inventory = inventoryData(data.sources.inventory), flow = flowData(localFlowSource);
  const declines = erp.shops.filter(row => row.yoy !== null && row.yoy < 0), unknownShops = erp.shops.filter(row => row.yoy === null).length;
  const activeGroup = ops?.groups.find(row => row.key === group);
  const flowRows = dimension === "shop" ? flow?.shops.map(row => ({ name: row.shopName, platform: row.platform, metrics: row.metrics })) : flow?.platforms.map(row => ({ name: row.platform, platform: row.platform, metrics: row.metrics }));
  const change = (key: "netSalesCents" | "grossProfitCents" | "averageOrderValueCents") => <small>环比 <Trend value={relative(current, erp.sales.previous, key)} /> · 同比 <Trend value={relative(current, erp.sales.yearAgo, key)} /></small>;
  const action = (module: "workflow" | "sales" | "inventory" | "shop", text: string, view?: ModuleViewKey) => onNavigate && <button className={styles.link} onClick={() => onNavigate(module, undefined, view)}>{text} ›</button>;
  const dailyMax = Math.max(0, ...erp.sales.daily.map(row => row.netSalesCents ?? 0));
  const dailyMin = Math.min(0, ...erp.sales.daily.map(row => row.netSalesCents ?? 0));
  const dailySpan = dailyMax - dailyMin || 1, zeroLevel = -dailyMin / dailySpan * 100;
  return <div className={styles.root} aria-busy={loading}>
    <div className={styles.toolbar}><div><strong>综合经营驾驶舱</strong><small>经营周期 {erp.periods.current.startDate} — {erp.periods.current.endDate} · ERP日销售口径</small></div>{controls}</div>
    {error && <p className={styles.notice} role="alert">{error}；当前仍显示本范围上一次成功结果。</p>}
    <div className={styles.grid}>
      <Card title="目标进度" hint={`ERP净销售 · 截至 ${erp.periods.asOfDate}`} wide actions={currentUser?.role === "admin" && <button className={styles.link} disabled={data.sources.targets.status !== "ready"} onClick={() => setEditing(true)}>设置ERP目标 ›</button>}>
        <div className={styles.goals}>{data.goals.periods.map(goal => <article key={goal.kind}><div className={styles.goalTitle}><span>{goal.kind === "year" ? `${goal.period} 年目标` : `${goal.period} 月目标`}</span><strong>{goal.completion === null ? goal.targetStatus === "not_set" ? "未设目标" : goal.targetStatus === "source_unavailable" ? "目标未读取" : goal.targetStatus === "zero_target" ? "目标为0" : "进度待核对" : percent(goal.completion)}</strong></div><p className={styles.actual}>{compactMoney(goal.actualCents)}<small>元 / 目标 {compactMoney(goal.targetCents)} 元</small></p><div className={styles.progress}><i style={{ width: `${Math.max(0, Math.min(100, (goal.completion ?? 0) * 100))}%` }} /><b style={{ left: `${Math.min(100, goal.pace * 100)}%` }} title={`时间进度 ${percent(goal.pace)}`} /></div><div className={styles.goalFooter}><span>{goal.kind === "year" ? <>较上月末进度 {goal.progressChangePp === null ? "不可比" : `${goal.progressChangePp >= 0 ? "+" : ""}${goal.progressChangePp.toFixed(1)} 个百分点`}</> : <>环比 <Trend value={goal.mom} /></>}</span><span>同比 <Trend value={goal.yoy} /></span></div>{!goal.actualCoverageComplete && <small className={styles.muted}>已导入日期覆盖不足，暂不计算完成率</small>}{goal.targetedShops > 0 && !goal.companyTarget && <small className={styles.muted}>仅 {goal.targetedShops} 个已配置目标店铺进入目标进度</small>}</article>)}</div>
        <details className={styles.explain}><summary>目标口径说明</summary>{data.goals.disclosure}。时间进度竖线仅供对照。</details>
      </Card>
      <Card title="待处理" hint="公司工作计划 · 新品上架" actions={<button className={styles.link} aria-pressed={mine} onClick={() => { setMine(!mine); setGroup(""); }}>{mine ? "我的事项" : "全部事项"} ⇄</button>}>
        {!ops ? <Missing source={data.sources.operations} /> : <><div className={styles.pending}>{ops.groups.map(row => <button key={row.key} onClick={() => setGroup(row.key === group ? "" : row.key)} aria-pressed={row.key === group}><span>{row.label}</span><strong className={row.total ? styles.risk : ""}>{count(row.total)}</strong></button>)}</div><small className={styles.muted}>关注事项去重 {count(ops.uniqueAttentionCount)} 项 · 7天无业务进展</small>{activeGroup && <div className={styles.taskList}><strong>{activeGroup.label}</strong>{activeGroup.items.length ? activeGroup.items.map(item => <p key={item.id}>{item.title}<small>{item.owner || "待分配"} · {item.dueDate ?? "待排期"}</small></p>) : <p>暂无事项</p>}{activeGroup.truncated && <small>这里只显示20项；更多请进入运营事务</small>}</div>}{action("workflow", "进入运营事务")}</>}
      </Card>
      <Card title={apiRange === "month" && erp.periods.current.startDate.slice(0, 7) === data.goals.periods.find(row => row.kind === "month")?.period ? "本月经营" : "本期经营"} hint="ERP日销售 · 金额单位：元" wide actions={action("sales", "查看销售明细")}>
        <div className={styles.metrics}><article><span>净销售额</span><strong>{compactMoney(current.netSalesCents)}</strong>{change("netSalesCents")}</article><article><span>大毛利</span><strong>{compactMoney(current.grossProfitCents)}</strong>{change("grossProfitCents")}</article><article><span>大毛利率</span><strong>{percent(current.grossMarginRate)}</strong><small>净销售额 − 销售成本</small></article><article><span>ERP订单均值（客单价）</span><strong>{money(current.averageOrderValueCents)}</strong>{change("averageOrderValueCents")}</article><article><span>退款金额 / 比例</span><strong>{compactMoney(current.refundCents)}</strong><small>{percent(current.refundRate)} · 正向销售额为基数</small></article></div>
        {current.missingOrderNoRows !== null && current.missingOrderNoRows > 0 && <p className={styles.notice}>有 {count(current.missingOrderNoRows)} 行缺少可信原订单号，客单价暂不可用。</p>}
        {erp.sales.daily.length > 0 && <div className={styles.chart} aria-label="ERP每日净销售趋势"><b className={styles.axis} style={{ bottom: `${zeroLevel}%` }} />{erp.sales.daily.map(day => <div key={day.date} title={`${day.date} 净销售 ${money(day.netSalesCents)} 元`}><i className={(day.netSalesCents ?? 0) < 0 ? styles.negative : ""} style={{ height: `${Math.abs(day.netSalesCents ?? 0) / dailySpan * 100}%`, bottom: `${zeroLevel - ((day.netSalesCents ?? 0) < 0 ? Math.abs(day.netSalesCents ?? 0) / dailySpan * 100 : 0)}%` }} /><small>{day.date.slice(5)}</small></div>)}</div>}
        <small className={styles.muted}>环比：{erp.periods.previous.startDate} — {erp.periods.previous.endDate}；同比：{erp.periods.yearAgo.startDate} — {erp.periods.yearAgo.endDate}。已导入 {current.coverage.observedDays}/{current.coverage.expectedDays} 个经营日期。</small>
      </Card>
      <Card title="店铺净销售同比下滑" hint="严重 ≤−20% · 预警 ≤−10%" actions={action("sales", "查看店铺经营")}><div className={styles.table}><table><thead><tr><th>店铺</th><th>本期净销售</th><th>同比</th></tr></thead><tbody>{declines.slice(0, 20).map(row => <tr key={row.key}><td>{row.name}<small>{row.platform}</small></td><td>{money(row.current.netSalesCents)}</td><td><Trend value={row.yoy} /></td></tr>)}</tbody></table></div>{!declines.length && <Missing text={unknownShops ? "当前可比较店铺暂无下滑；仍有店铺待核对" : "当前可比较店铺暂无同比下滑"} />}<small className={styles.muted}>下滑 {declines.length} 家 · 不可比 {unknownShops} 家{declines.length > 20 ? "；这里显示下滑最明显的20家" : ""}</small></Card>
      <Card title="类目经营表现" hint="吉客云货品分类 · 净销售额单位：元" wide><div className={styles.table}><table><thead><tr><th>类目</th><th>本期净销售</th><th>环比</th><th>同比</th></tr></thead><tbody>{erp.categories.map(row => <tr key={row.name}><td>{row.name}</td><td>{money(row.current.netSalesCents)}</td><td><Trend value={row.mom} /></td><td><Trend value={row.yoy} /></td></tr>)}</tbody></table></div>{!erp.categories.length && <Missing text="当前范围暂无已导入类目销售记录" />}<small className={styles.muted}>优先吉客云货品主数据类目，未匹配时保留销售源类目；“未分类”单独展示。</small></Card>
      <Card title="库存健康" hint={`公司库存最新快照 ${inventory?.snapshotDate ?? "暂无"}`} actions={action("inventory", "查看库存预警")}>
        {!inventory || !inventory.hasInventory ? <Missing source={data.sources.inventory} text={inventory ? "尚无库存快照" : undefined} /> : <><div className={styles.stockStats}><article><span>已知成本库存货值</span><strong>{compactMoney(typeof inventory.metrics.knownStockValueCents === "number" ? inventory.metrics.knownStockValueCents : null)}<small>元</small></strong></article><article><span>已识别&gt;90天 / 无销量货值占比</span><strong>{percent(inventory.riskShareKnown)}</strong></article></div><div className={styles.stockBuckets}>{inventory.buckets.map(row => <p key={row.label}><span>{row.label}</span><strong>{money(row.knownStockValueCents)} 元</strong><small>{row.positions} 个货仓位</small></p>)}</div>{inventory.stale && <p className={styles.notice}>库存快照超过3天，请先核对同步状态。</p>}<small className={styles.muted}>成本覆盖 {percent(typeof inventory.metrics.costCoverageRate === "number" ? inventory.metrics.costCoverageRate : null)} · 销量匹配 {percent(typeof inventory.metrics.salesDemandMatchRate === "number" ? inventory.metrics.salesDemandMatchRate : null)}；原30日正向出库口径。</small></>}
      </Card>
      <Card title="广东仓异常" hint="复用生产周期、安全天数及人工设置" full actions={action("inventory", "进入广东仓监控", "guangdong")}>
        {!inventory ? <Missing source={data.sources.inventory} /> : <><div className={styles.gdMetrics}>{[["断货", "no_stock"], ["紧急", "urgent"], ["预警", "warning"], ["滞销", "stale"], ["待核对", "unknown"]].map(([label, key]) => <article key={key}><span>{label}</span><strong>{count(inventory.guangdong.counts[key] ?? 0)}</strong></article>)}</div><div className={styles.table}><table><thead><tr><th>货品</th><th>可用库存</th><th>覆盖天数</th><th>生产周期</th><th>异常</th></tr></thead><tbody>{inventory.guangdong.items.map(row => <tr key={row.productCode}><td>{row.productName}<small>{row.productCode}</small></td><td>{count(row.availableQuantity)}</td><td>{row.turnoverDays === null ? "—" : row.turnoverDays.toFixed(1)}</td><td>{count(row.leadDays)}</td><td>{row.riskLabel}</td></tr>)}</tbody></table></div>{inventory.guangdong.watchCount === 0 && <Missing text="尚未配置广东仓监控货品" />}<small className={styles.muted}>监控 {inventory.guangdong.watchCount} 项 · 参数待核对 {inventory.guangdong.pendingCount} 项{inventory.guangdong.truncated ? "；这里显示风险优先的20项" : ""}</small></>}
      </Card>
      <Card title="网店流量与转化" hint="SPU商品日 · 平台成交口径 · 与经营选期一致" full actions={action("shop", "查看店铺明细", "outlets")}>
        <div className={styles.flowControls}><label>平台<select value={flowPlatform} onChange={event => { setFlowPlatform(event.target.value); setFlowShop(""); }}><option value="">全部适用平台</option>{["京东", "天猫"].filter(value => !platform || platform === value).map(value => <option key={value}>{value}</option>)}</select></label><label>店铺<select value={flowShop} onChange={event => setFlowShop(event.target.value)} disabled={!flow || flow.status !== "ready"}><option value="">全部适用店铺</option>{flow?.options.map(row => <option key={`${row.platform}:${row.shopName}`} value={JSON.stringify([row.platform, row.shopName])}>{row.platform} · {row.shopName}</option>)}</select></label><div className={styles.segment}>{(["platform", "shop"] as const).map(value => <button key={value} aria-pressed={dimension === value} onClick={() => setDimension(value)}>按{value === "platform" ? "平台" : "店铺"}</button>)}</div></div>
        {!flow || flow.status !== "ready" ? <Missing source={localFlowSource} text={flowLoading ? "正在读取网店流量…" : flowError || (flow?.reasonCode === "erp_store_mapping_unverified" ? "ERP店铺与平台店铺映射尚未确认，请先核对映射" : flow?.reasonCode === "parent_platform_unmapped" ? "当前ERP平台尚未接入网店流量来源" : undefined)} /> : <div className={styles.flowLayout}><div className={styles.flowStats}>{[["访客累计", "visitors", false], ["累计成交转化率", "conversion", true], ["平台成交额（元）", "payment", false], ["推广占比", "spendRate", true]].map(([label, key, ratio]) => <article key={String(key)}><span>{label}</span><strong><FlowValue metric={flow.summary[String(key)]} ratio={Boolean(ratio)} /></strong><small>环比 {flow.comparisons?.[String(key)]?.status === "available" ? flow.comparisons[String(key)].method === "percentage_points" ? `${flow.comparisons[String(key)].value?.toFixed(1)} 个百分点` : rate(flow.comparisons[String(key)].value) : "不可比"}</small></article>)}</div><div className={styles.table}><table><thead><tr><th>{dimension === "platform" ? "平台" : "店铺"}</th><th>访客累计</th><th>转化率</th><th>推广 ROI</th></tr></thead><tbody>{flowRows?.map(row => <tr key={`${row.platform}:${row.name}`}><td>{row.name}</td><td><FlowValue metric={row.metrics.visitors} /></td><td><FlowValue metric={row.metrics.conversion} ratio /></td><td><FlowValue metric={row.metrics.roas} /></td></tr>)}</tbody></table></div></div>}
        <details className={styles.explain}><summary>流量指标口径</summary>京东、天猫各取SPU单一数据集，不叠加SKU。访客累计是商品×日累计，不是店铺去重UV；跨平台推广归因不同，不合并ROI。未覆盖的指标显示“—”。平台、店铺局部选择继承上方ERP范围。</details>
      </Card>
    </div>
    <p className={styles.sources}>各模块保留自己的更新时间与统计口径。缺少来源时不补零。</p>
    {editing && <ErpTargetEditor data={data} close={() => setEditing(false)} saved={() => { setEditing(false); setRefresh(n => n + 1); }} />}
  </div>;
}

function ErpTargetEditor({ data, close, saved }: { data: BiCockpit; close: () => void; saved: () => void }) {
  const [kind, setKind] = useState<"year" | "month">("month"), [scope, setScope] = useState(""), [amount, setAmount] = useState(""), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const period = data.goals.periods.find(row => row.kind === kind)!.period, pair = scope ? JSON.parse(scope) as [string, string] : ["", ""];
  const existing = data.goals.items.find(row => row.periodType === kind && row.periodKey === period && row.platform === pair[0] && row.shopName === pair[1]);
  useEffect(() => { setAmount(existing ? (existing.salesTargetCents / 100).toFixed(2) : ""); setError(""); }, [existing, kind, scope]);
  async function save() {
    if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(amount)) { setError("请明确输入非负金额，最多两位小数（元）"); return; }
    const [whole, fraction = ""] = amount.split("."), cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents > 10_000_000_000_000) { setError("目标金额超出允许范围"); return; }
    setSaving(true); setError("");
    try { await requestJson("/api/bi/erp-targets", { method: "POST", body: { periodType: kind, periodKey: period, platform: pair[0], shopName: pair[1], salesTargetCents: cents, ...(existing ? { id: existing.id, expectedVersion: existing.version } : {}) } }); saved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "目标保存失败"); } finally { setSaving(false); }
  }
  return <div className={styles.overlay}><section className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="erp-target-title"><h2 id="erp-target-title">设置ERP经营目标</h2><p>目标与ERP净销售口径一致；原财报目标另行保留。</p><label>周期<select value={kind} onChange={event => setKind(event.target.value as "year" | "month")} disabled={saving}><option value="month">{data.goals.periods.find(row => row.kind === "month")!.period} 月目标</option><option value="year">{data.goals.periods.find(row => row.kind === "year")!.period} 年目标</option></select></label><label>项目 / 店铺<select value={scope} onChange={event => setScope(event.target.value)} disabled={saving}><option value="">公司整体</option>{data.erp.options.map(row => <option key={`${row.platform}:${row.shop}`} value={JSON.stringify([row.platform, row.shop])}>{row.platform} · {row.shop}</option>)}</select></label><label>ERP净销售目标（元）<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" disabled={saving} autoFocus /></label>{error && <p role="alert" className={styles.risk}>{error}</p>}<footer><button onClick={close} disabled={saving}>取消</button><button onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : existing ? "保存调整" : "创建目标"}</button></footer></section></div>;
}
