"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http/api-error";
import { requestJson } from "@/lib/http/api-client";
import { decodeStoreOverview, formatOverviewMetric, overviewReasons, type StoreOverviewResponse, type OverviewMetric, type OverviewMetricKey, type OverviewComparisons, type OverviewRow } from "@/lib/netshop/store-overview-contract";
import { useAiPageDetails } from "../ai-page-context-provider";
import StatisticalPeriodPicker from "../statistical-period-picker";
import { shanghaiIsoToday, type CurrentUser } from "../module-view-shared";
import type { StoreOverviewLocation } from "../shell/navigation-contract";
import "./balanced-overview.css";

const labels: Record<OverviewMetricKey, string> = { payment: "成交金额", visitors: "访客累计", customers: "成交客户累计", spend: "推广花费", promotionPayment: "推广成交", spendRate: "推广费率", conversion: "转化率", roas: "推广 ROI", averageOrder: "客单价", uvValue: "UV 价值", paidVisitors: "付费访客", freeVisitors: "免费访客", b2bRate: "企业购占比" };
const sourceLabels: Record<string, string> = { tmall_product_daily: "生意参谋 SPU 日", jd_sku_daily: "京东商智 SKU 日", tmall_promotion: "天猫推广商品日报", jd_promotion: "京准通推广日报" };
const mainKeys: OverviewMetricKey[] = ["payment", "visitors", "spend", "spendRate", "conversion"];

function reason(m: OverviewMetric) { return overviewReasons[m.reasonCode ?? ""] ?? m.reasonCode ?? ""; }
function unit(m: OverviewMetric, yuan = false) { return m.unit === "CNY_CENT" ? yuan ? "元" : "万元" : m.unit === "COUNT" ? "人次" : ""; }
function Comparison({ value, label }: { value: OverviewComparisons[OverviewMetricKey]["previous"]; label: string }) {
  const text = value.value === null ? "—" : `${value.value > 0 ? "↑ " : value.value < 0 ? "↓ " : ""}${Math.abs(value.value * (value.method === "relative_change" ? 100 : 1)).toFixed(2)}${value.method === "relative_change" ? "%" : " 个百分点"}`;
  return <span className={value.value === null || value.value === 0 ? "" : value.value > 0 ? "ov-up" : "ov-down"} title={value.reasonCode ? overviewReasons[value.reasonCode] ?? value.reasonCode : undefined}>{label} {text}</span>;
}
function MetricValue({ metric, yuan = false }: { metric: OverviewMetric; yuan?: boolean }) {
  return <span title={reason(metric)}>{formatOverviewMetric(metric, yuan ? "yuan" : "wan")}{metric.value !== null && unit(metric, yuan) && <small> {unit(metric, yuan)}</small>}{metric.status === "partial" && <small className="ov-partial"> · 部分数据{metric.coverage && ` ${metric.coverage.coveredShopDatePairs}/${metric.coverage.expectedShopDatePairs} 店铺日`}</small>}</span>;
}
function Delta({ comparisons, metricKey, options }: { comparisons: OverviewComparisons; metricKey: OverviewMetricKey; options: StoreOverviewLocation }) {
  return <div className="ov-delta">{options.previous && <Comparison value={comparisons[metricKey].previous} label="环比" />}{options.yearAgo && <Comparison value={comparisons[metricKey].yearAgo} label="同比" />}</div>;
}
function path(values: Array<number | null>, max: number, width: number, height: number) {
  let connected = false;
  return values.map((v, i) => {
    if (v === null) { connected = false; return ""; }
    const p = `${36 + (values.length < 2 ? 0 : i / (values.length - 1) * (width - 72))},${height - 30 - v / max * (height - 55)}`;
    const command = connected ? "L" : "M"; connected = true; return command + p;
  }).join(" ");
}
function Trend({ title, rows, keys, options }: { title: string; rows: OverviewRow[]; keys: [OverviewMetricKey, OverviewMetricKey]; options: StoreOverviewLocation }) {
  const [selected, setSelected] = useState<number | null>(null), [fixed, setFixed] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(240, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const baselineKey = keys[0] === "spend" ? "spend" : "payment";
  const maxes = keys.map((k, i) => Math.max(1, ...rows.map(r => r.metrics[k].value ?? 0), ...(i === 0 && options.previous ? rows.map(r => r.comparisonValues.previous[baselineKey] ?? 0) : [])));
  const row = selected === null ? null : rows[selected];
  const hasValues = keys.map(k => rows.some(r => r.metrics[k].value !== null));
  if (!hasValues.some(Boolean)) return <section className="ov-panel ov-trend"><div className="ov-panel-head"><h2>{title}</h2></div><div className="ov-empty">所选范围暂无可信日序列。缺失数据保留空态。</div></section>;
  const axes = [keys[0] === "spend" ? "花费（元）" : "成交额（万元）", keys[1] === "visitors" ? "访客（人次）" : "推广成交（万元）"];
  return <section className="ov-panel ov-trend"><div className="ov-panel-head"><h2>{title}</h2><small>按{options.trend === "day" ? "日" : options.trend === "week" ? "自然周" : "自然月"}汇总</small></div>
    <div className="ov-legend"><span><i />{labels[keys[0]]}</span><span><i className="ov-purple" />{labels[keys[1]]}</span>{options.previous && <span><i className="ov-baseline" />环比{labels[keys[0]]}</span>}</div>
    <div className="ov-chart-wrap" ref={chartRef}><svg viewBox={`0 0 ${width} 220`} role="img" aria-label={title} onPointerLeave={() => !fixed && setSelected(null)}>
      {[0, 1, 2, 3].map(i => <g key={i}><line x1="36" x2={width - 36} y1={25 + i * 55} y2={25 + i * 55} className="ov-gridline" /><text x="32" y={29 + i * 55} textAnchor="end">{hasValues[0] ? (maxes[0] * (3 - i) / 3 / (keys[0] === "spend" ? 100 : 1_000_000)).toFixed(1) : "—"}</text><text x={width - 3} y={29 + i * 55} textAnchor="end">{hasValues[1] ? (maxes[1] * (3 - i) / 3 / (keys[1] === "visitors" ? 1 : 1_000_000)).toFixed(1) : "—"}</text></g>)}
      {keys.map((k, i) => <path key={k} d={path(rows.map(r => r.metrics[k].value), maxes[i], width, 220)} className={i ? "ov-line ov-purple" : "ov-line"} />)}
      {options.previous && <path d={path(rows.map(r => r.comparisonValues.previous[baselineKey]), maxes[0], width, 220)} className="ov-line ov-average" />}
      {rows.map((r, i) => <rect key={r.startDate} x={36 + i / Math.max(1, rows.length) * (width - 72)} y="20" width={(width - 72) / Math.max(1, rows.length)} height="180" fill="transparent" onPointerEnter={() => !fixed && setSelected(i)} onClick={() => { setSelected(i); setFixed(true); }} />)}
      {rows.filter((_, i) => i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2)).map(r => <text key={r.startDate} x={36 + rows.indexOf(r) / Math.max(1, rows.length - 1) * (width - 72)} y="218" textAnchor="middle">{r.startDate.slice(5)}</text>)}
    </svg>{row && <div className="ov-hover" role="status"><strong>{row.startDate}{row.endDate !== row.startDate && ` 至 ${row.endDate}`} · {row.days} 天</strong>{keys.map(k => <div key={k}>{labels[k]} <b><MetricValue metric={row.metrics[k]} yuan={k === "spend"} /></b></div>)}{options.previous && <div>环比{labels[baselineKey]} <b>{row.comparisonValues.previous[baselineKey] === null ? "—" : formatOverviewMetric({ ...row.metrics[baselineKey], value: row.comparisonValues.previous[baselineKey] }, baselineKey === "spend" ? "yuan" : "wan")} {baselineKey === "spend" ? "元" : "万元"}</b></div>}<small>{row.comparisonDates.previous && `环比 ${row.comparisonDates.previous.startDate} 至 ${row.comparisonDates.previous.endDate}`}</small><small>{row.comparisonDates.yearAgo && `同比 ${row.comparisonDates.yearAgo.startDate} 至 ${row.comparisonDates.yearAgo.endDate}`}</small></div>}</div>
    <div className="ov-chart-controls"><label>查看日期 <input type="range" aria-label={`${title}查看日期`} min="0" max={Math.max(0, rows.length - 1)} value={selected ?? 0} onChange={e => { setSelected(Number(e.target.value)); setFixed(true); }} /></label><button type="button" onClick={() => { setFixed(false); setSelected(null); }}>取消固定</button></div><small>{axes[0]} · {axes[1]}；缺日断开，悬停查看、点击固定</small>
  </section>;
}
function ShopBody({ data, options }: { data: StoreOverviewResponse; options: StoreOverviewLocation }) {
  const groups: Array<{ title: string; keys: OverviewMetricKey[] }> = [{ title: "流量与转化", keys: ["visitors", "customers", "conversion", "averageOrder", "uvValue"] }, { title: "推广与结构", keys: ["spend", "spendRate", "roas", "paidVisitors", "b2bRate"] }];
  const max = Math.max(1, ...data.daily.map(r => r.metrics.payment.value ?? 0));
  return <div className="ov-shop-body"><div className="ov-shop-sales"><div>商品日报成交额 · 所选 {data.periods.current.days} 天</div><strong><MetricValue metric={data.summary.payment} /></strong><Delta comparisons={data.comparisons} metricKey="payment" options={options} /><svg viewBox="0 0 240 110" role="img" aria-label="店铺日成交额与7日均线"><path className="ov-line" d={path(data.daily.map(r => r.metrics.payment.value), max, 240, 110)} /><path className="ov-line ov-average" d={path(data.movingAverage.map(r => r.paymentCents), max, 240, 110)} /></svg><small>实线：日成交额 · 虚线：7日均线<br />均线不足完整7日时保留缺失</small></div><div className="ov-shop-groups">{groups.map(group => <div className="ov-shop-row" key={group.title}><h3>{group.title}</h3><div className="ov-shop-grid">{group.keys.map(k => <div key={k}><div>{k === "paidVisitors" ? "付费 / 免费访客" : k === "spendRate" ? "推广占比" : labels[k]}</div><strong><MetricValue metric={data.summary[k]} yuan={k === "averageOrder" || k === "uvValue"} /></strong><small>{data.summary[k].value === null ? reason(data.summary[k]) : k === "roas" ? "平台归因 ROAS，非利润率" : k === "conversion" ? "商品累计口径" : ""}</small><Delta comparisons={data.comparisons} metricKey={k} options={options} /></div>)}</div></div>)}</div></div>;
}
function ShopDetail({ query, token, scopeKey, shopKey, options, onVersionChange }: { query: string; token: string; scopeKey: string; shopKey: string; options: StoreOverviewLocation; onVersionChange: () => void }) {
  const binding = `${query}|${token}|${scopeKey}|${shopKey}`;
  const [loaded, setLoaded] = useState<{ binding: string; data: StoreOverviewResponse } | null>(null);
  const [failed, setFailed] = useState<{ binding: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const data = loaded?.binding === binding ? loaded.data : null;
  const error = failed?.binding === binding ? failed.message : "";
  useEffect(() => {
    const controller = new AbortController(); setFailed(null);
    const params = new URLSearchParams(query); params.set("view", "shop"); params.set("shopKey", shopKey); params.set("overviewToken", token);
    void requestJson<unknown>(`/api/netshop/store-overview?${params}`, { signal: controller.signal }).then(v => {
      if (controller.signal.aborted) return;
      const decoded = decodeStoreOverview(v);
      if (decoded.overviewToken !== token || decoded.scopeKey !== scopeKey) { setFailed({ binding, message: "数据版本已变化，请刷新总览" }); onVersionChange(); return; }
      if (decoded.filters.shopKeys.length !== 1 || decoded.filters.shopKeys[0] !== shopKey || decoded.periods.current.startDate !== params.get("startDate") || decoded.periods.current.endDate !== params.get("endDate")) throw new Error("店铺详情范围不一致");
      setLoaded({ binding, data: decoded });
    }).catch(e => { if (!controller.signal.aborted) { setFailed({ binding, message: e instanceof Error ? e.message : "店铺详情读取失败" }); if (e instanceof ApiError && e.status === 409) onVersionChange(); } });
    return () => controller.abort();
  }, [query, token, scopeKey, shopKey, binding, retry, onVersionChange]);
  if (error) return <div className="ov-detail-state" role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>重试详情</button></div>;
  return data ? <ShopBody data={data} options={options} /> : <div className="ov-detail-state" role="status">正在读取同版本店铺详情…</div>;
}
export default function BalancedOverview({ options, onChange, startDate, endDate, periodKind, onApplyPeriod, currentUser, onClassic }: {
  options: StoreOverviewLocation; onChange: (next: StoreOverviewLocation) => void; startDate: string; endDate: string; periodKind: string;
  onApplyPeriod?: (start: string, end: string, intent?: "rolling" | "quarter") => void; currentUser: CurrentUser | null; onClassic: () => void;
}) {
  const filterScope = JSON.stringify({ options, startDate, endDate, periodKind, user: currentUser });
  const [paging, setPaging] = useState({ scope: "", page: 1, shopPage: 1 });
  const page = paging.scope === filterScope ? paging.page : 1;
  const shopPage = paging.scope === filterScope ? paging.shopPage : 1;
  const setPage = (value: number | ((current: number) => number)) => setPaging(p => ({ scope: filterScope, page: typeof value === "function" ? value(p.scope === filterScope ? p.page : 1) : value, shopPage: p.scope === filterScope ? p.shopPage : 1 }));
  const setShopPage = (value: number | ((current: number) => number)) => setPaging(p => ({ scope: filterScope, page: p.scope === filterScope ? p.page : 1, shopPage: typeof value === "function" ? value(p.scope === filterScope ? p.shopPage : 1) : value }));
  const [retry, setRetry] = useState(0), [picker, setPicker] = useState(false), [openShop, setOpenShop] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; data: StoreOverviewResponse } | null>(null), [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const versionRecovery = useRef({ query: "", attempts: 0 });
  const generation = useRef(0), pickerRef = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams({ platform: options.platform, startDate, endDate, periodKind, trendGrain: options.trend, detailGrain: options.detail, detailPage: String(page), shopPage: String(shopPage), previous: options.previous ? "1" : "0", yearAgo: options.yearAgo ? "1" : "0" });
  options.outlets.forEach(k => params.append("outlet", k));
  const query = params.toString(), requestKey = `${query}|${retry}|${JSON.stringify(currentUser)}`;
  const refreshOverview = useCallback(() => {
    if (versionRecovery.current.query !== query) versionRecovery.current = { query, attempts: 0 };
    if (versionRecovery.current.attempts >= 1) {
      setLoaded(null); setFailure({ key: requestKey, message: "网店来源版本持续变化，请稍后重试总览" }); return;
    }
    versionRecovery.current.attempts++; setRetry(v => v + 1);
  }, [query, requestKey]);
  const data = loaded?.key === requestKey ? loaded.data : null, error = failure?.key === requestKey ? failure.message : "";
  useEffect(() => {
    const id = ++generation.current, controller = new AbortController();
    void requestJson<unknown>(`/api/netshop/store-overview?${query}`, { signal: controller.signal }).then(v => {
      if (controller.signal.aborted || id !== generation.current) return;
      const decoded = decodeStoreOverview(v);
      if (decoded.filters.platform !== options.platform || decoded.periods.current.startDate !== startDate || decoded.periods.current.endDate !== endDate || decoded.filters.trendGrain !== options.trend || decoded.filters.detailGrain !== options.detail || options.outlets.length > 0 && JSON.stringify([...decoded.filters.shopKeys].sort()) !== JSON.stringify([...options.outlets].sort())) throw new Error("网店总览响应范围不一致");
      setLoaded({ key: requestKey, data: decoded }); setFailure(null);
      setOpenShop(v => v && decoded.shops.some(s => s.shopKey === v) ? v : decoded.shops[0]?.shopKey ?? null);
    }).catch(e => { if (!controller.signal.aborted && id === generation.current) setFailure({ key: requestKey, message: e instanceof Error ? e.message : "读取失败" }); });
    return () => { controller.abort(); };
  }, [query, requestKey, options.platform, options.trend, options.detail, options.outlets, startDate, endDate]);
  useEffect(() => {
    if (!picker) return;
    const close = (e: PointerEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setPicker(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPicker(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [picker]);
  useAiPageDetails("shop", { period: { startDate, endDate }, filters: { platforms: [options.platform], shops: options.outlets.map(k => k.split("\u001f")[1]), dataset: [options.platform === "京东" ? "jd_sku_daily/sku_daily" : "tmall_product_daily/spu_daily", options.platform === "京东" ? "jd_promotion/ad" : "tmall_promotion/promotion_daily"], scope: ["01均衡总览：商品×日累计，非ERP销售净额；费率同店同日对齐；ROI为ROAS", ...(data ? [`环比 ${data.periods.previous.startDate}至${data.periods.previous.endDate}；同比 ${data.periods.yearAgo.startDate}至${data.periods.yearAgo.endDate}`] : [])], status: data ? Object.entries(data.summary).filter(([, m]) => m.status !== "available").map(([k, m]) => `${k}: ${m.status}, ${m.reasonCode}`) : ["尚未读取新版总览"] }, blockedReason: error || (!data ? "新版总览尚未完成读取，请勿使用旧净销售语义回答" : undefined) });
  const change = (next: Partial<StoreOverviewLocation>) => { setPage(1); setShopPage(1); setOpenShop(null); onChange({ ...options, ...next }); };
  const shops = data?.shopOptions ?? [];
  const platformOptions = ["天猫", "京东"] as const;
  const shopSelect = (label: string) => <select aria-label={label} value={options.outlets.length > 1 ? "__multiple" : options.outlets[0] ?? ""} onChange={e => { if (e.target.value !== "__multiple") change({ outlets: e.target.value ? [e.target.value] : [] }); }}><option value="">全部店铺</option>{options.outlets.length > 1 && <option value="__multiple">已选 {options.outlets.length} 家店铺</option>}{options.outlets.filter(k => !shops.some(s => s.shopKey === k)).map(k => <option key={k} value={k}>{k.split("\u001f")[1]}（待核验）</option>)}{shops.map(s => <option key={s.shopKey} value={s.shopKey}>{s.shopName}</option>)}</select>;
  const columns: OverviewMetricKey[] = ["visitors", "payment", "customers", "conversion", "averageOrder", "uvValue", "spend", "spendRate", "roas", "b2bRate"];
  return <div className="balanced-overview" aria-label="均衡网店总览">
    <section className="ov-filter"><label>平台<select aria-label="平台筛选" value={options.platform} onChange={e => change({ platform: e.target.value as "天猫" | "京东", outlets: [] })}>{platformOptions.map(p => <option key={p}>{p}</option>)}</select></label><label>店铺{shopSelect("店铺筛选")}</label>
      <div className="ov-date" ref={pickerRef}><span>自定义时间</span><button type="button" aria-label="选择总览日期" aria-expanded={picker} onClick={() => setPicker(v => !v)}>{startDate} — {endDate} ▾</button>{picker && <StatisticalPeriodPicker onCancel={() => setPicker(false)} periodIntent={periodKind === "quarter" ? "quarter" : ["rolling", "last7", "last15", "last30"].includes(periodKind) ? "rolling" : undefined} minDate={`${Number(shanghaiIsoToday().slice(0, 4)) - 1}-01-01`} maxDate={shanghaiIsoToday()} startDate={startDate} endDate={endDate} onApply={(s, e, intent) => { setPicker(false); setPage(1); setShopPage(1); setOpenShop(null); onApplyPeriod?.(s, e, intent); }} />}</div>
      <div><span>趋势粒度</span><div className="ov-seg">{(["day", "week", "month"] as const).map((g, i) => <button type="button" key={g} aria-pressed={g === options.trend} onClick={() => change({ trend: g })}>{["日", "周", "月"][i]}</button>)}</div></div><div><span>对比数据</span><div className="ov-checks"><label><input type="checkbox" checked={options.previous} onChange={e => change({ previous: e.target.checked })} />环比</label><label><input type="checkbox" checked={options.yearAgo} onChange={e => change({ yearAgo: e.target.checked })} />同比</label></div></div>
    </section>
    <div className="ov-tabs" role="tablist" aria-label="平台数据切换">{platformOptions.map(p => <button type="button" role="tab" aria-selected={p === options.platform} key={p} onClick={() => change({ platform: p, outlets: [] })}>{p}</button>)}<small>商品日报汇总 · 精确店铺范围</small></div>
    <section className="ov-platform"><div className="ov-scope"><h2>{options.platform}经营概览</h2><span>统计范围：{options.outlets.length > 1 ? `已选 ${options.outlets.length} 家店铺` : options.outlets.length ? shops.find(s => s.shopKey === options.outlets[0])?.shopName ?? "指定店铺" : "全部店铺"}</span><small>{startDate} 至 {endDate}</small></div>
      <div className="ov-metrics">{mainKeys.map(k => <article className="ov-metric" key={k}><div>{labels[k]}</div><strong>{data ? <MetricValue metric={data.summary[k]} /> : error ? "—" : "…"}</strong>{data && <Delta comparisons={data.comparisons} metricKey={k} options={options} />}<small>{k === "payment" ? "商品日报汇总" : k === "visitors" ? "商品×日累计，非店铺去重UV" : k === "conversion" ? "商品累计口径：客户 / 访客" : k === "spendRate" ? "同店同日花费 / 成交金额" : "平台推广来源"}</small>{data && data.summary[k].status !== "available" && <small className="ov-quality">{reason(data.summary[k])}</small>}</article>)}</div>
    </section>
    {error ? <section className="panel data-state data-state-error" role="alert"><strong>新视图读取失败</strong><p>{error}</p><button type="button" onClick={() => { versionRecovery.current = { query, attempts: 0 }; setRetry(v => v + 1); }}>重试新视图</button><button type="button" onClick={onClassic}>返回旧视图</button></section> : !data ? <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取网店总览</strong><p>核验来源、逐店逐日覆盖及同一修订版本…</p></section> : <>
      <div className="ov-evidence"><span>数据截止：{data.freshness.map(f => `${sourceLabels[f.sourceId] ?? f.sourceId} ${f.dataThrough ?? "未导入"}`).join("；")}</span><span>{options.previous && `环比 ${data.periods.previous.startDate} 至 ${data.periods.previous.endDate}`} {options.yearAgo && ` · 同比 ${data.periods.yearAgo.startDate} 至 ${data.periods.yearAgo.endDate}`}</span><small>{data.periods.rule}</small></div>
      <div className="ov-shop-filter"><label>店铺选择 {shopSelect("平台内店铺")}</label><small>只展开当前店铺读取详情</small></div>
      {(data.shopPagination.total === 0 || mainKeys.every(k => data.summary[k].value === null)) && <section className="ov-empty" role="status">{data.shopPagination.total === 0 ? "当前授权范围暂无已导入的商品或推广数据。" : "所选范围暂无可信指标，日期或字段不足，详见来源说明。"}缺失指标保留“—”。</section>}
      <section className="ov-shops"><div className="ov-panel-head"><h2>店铺经营详情</h2><small>{data.shopPagination.total} 家店铺 · {data.periods.current.days} 天 · 可展开查看</small></div>{data.shops.map(shop => <article className="ov-shop" key={shop.shopKey}><button className="ov-shop-heading" type="button" aria-expanded={openShop === shop.shopKey} onClick={() => setOpenShop(v => v === shop.shopKey ? null : shop.shopKey)}><strong>{options.platform} · {shop.shopName}</strong><span>成交额 <MetricValue metric={shop.metrics.payment} /></span><span>转化率 <MetricValue metric={shop.metrics.conversion} /></span><small>{openShop === shop.shopKey ? "收起详情 −" : "展开详情 ＋"}</small></button>{openShop === shop.shopKey && <ShopDetail query={query} token={data.overviewToken} scopeKey={data.scopeKey} shopKey={shop.shopKey} options={options} onVersionChange={refreshOverview} />}</article>)}{data.shopPagination.total > data.shopPagination.pageSize && <div className="ov-pagination"><button type="button" disabled={shopPage === 1} onClick={() => { setOpenShop(null); setShopPage(v => v - 1); }}>上一页店铺</button><span>第 {shopPage} 页</span><button type="button" disabled={!data.shopPagination.hasMore} onClick={() => { setOpenShop(null); setShopPage(v => v + 1); }}>下一页店铺</button></div>}</section>
      <div className="ov-charts"><Trend title="成交额 × 访客" rows={data.trend} keys={["payment", "visitors"]} options={options} /><Trend title="推广花费 vs 推广成交" rows={data.trend} keys={["spend", "promotionPayment"]} options={options} /></div>
      <section className="ov-panel ov-table-panel"><div className="ov-panel-head"><div><div className="ov-table-title"><h2>成交明细 · {options.platform}</h2><div className="ov-seg">{(["day", "seven_days"] as const).map((g, i) => <button type="button" key={g} aria-pressed={g === options.detail} onClick={() => change({ detail: g })}>{i ? "每 7 天" : "按日"}</button>)}</div></div><small>商品累计口径 · 成交额：万元 · 推广花费：元 · 转化率/ROAS低于完整本期汇总值标橙</small></div></div><div className="ov-table-scroll"><table><thead><tr><th>期间</th>{columns.map(k => <th key={k}>{labels[k]}{k === "payment" ? "（万元）" : k === "spend" ? "（元）" : ""}</th>)}{options.previous && <th>成交环比</th>}{options.yearAgo && <th>成交同比</th>}</tr></thead><tbody><tr className="ov-total"><td>周期汇总</td>{columns.map(k => <td key={k}><MetricValue metric={data.summary[k]} yuan={k === "spend" || k === "averageOrder" || k === "uvValue"} /></td>)}{options.previous && <td><Comparison value={data.comparisons.payment.previous} label="" /></td>}{options.yearAgo && <td><Comparison value={data.comparisons.payment.yearAgo} label="" /></td>}</tr>{data.details.map(row => <tr key={row.startDate}><td>{row.startDate}{row.startDate !== row.endDate && <><br />至 {row.endDate} · {row.days} 天</>}</td>{columns.map(k => <td key={k} className={(["conversion", "roas"].includes(k) && row.metrics[k].status === "available" && data.summary[k].status === "available" && row.metrics[k].value! < data.summary[k].value!) ? "ov-low" : ""}><MetricValue metric={row.metrics[k]} yuan={k === "spend" || k === "averageOrder" || k === "uvValue"} /></td>)}{options.previous && <td title={row.comparisonDates.previous ? `${row.comparisonDates.previous.startDate} 至 ${row.comparisonDates.previous.endDate}` : "无法一一对齐"}><Comparison value={row.comparisons.payment.previous} label="" /></td>}{options.yearAgo && <td title={row.comparisonDates.yearAgo ? `${row.comparisonDates.yearAgo.startDate} 至 ${row.comparisonDates.yearAgo.endDate}` : "无法一一对齐"}><Comparison value={row.comparisons.payment.yearAgo} label="" /></td>}</tr>)}</tbody></table></div><div className="ov-pagination"><span>共 {data.periods.current.days} 天 / {data.detailPagination.total} 行 · 每页 {data.detailPagination.pageSize} 行</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(data.detailPagination.total / data.detailPagination.pageSize))}</span><button type="button" disabled={!data.detailPagination.hasMore} onClick={() => setPage(v => v + 1)}>下一页</button></div></div></section>
      <details className="ov-source-notes"><summary>指标、来源与覆盖说明</summary><p>成交金额来自京东 SKU 日或天猫 SPU 日；商品×日访客和成交客户均为累计。转化率按汇总客户 / 汇总访客计算。推广 ROI 为平台归因成交 / 花费的 ROAS，天猫为源净成交口径，京东为平台总订单归因金额，均非 ERP 销售净额；归因窗口未单独核实时保持未知。</p><p>店铺去重 UV、客单价、付费/免费访客与企业购占比暂无可信同口径来源。无验证事件，不标记推广加码。</p>{Object.entries(data.coverageBySource).map(([source, c]) => <p key={source}>{source}：{c.coveredShopDatePairs} / {c.expectedShopDatePairs} 个店铺日{c.complete ? "，覆盖完整" : "，覆盖不足"}；{c.missingByShop.map(s => `${s.shopKey.split("\u001f")[1]} 缺 ${s.dates.join("、")}`).join("；")}</p>)}<small>修订 {JSON.stringify(data.sourceRevisions)} · 总览版本 {data.overviewToken}</small></details>
    </>}
  </div>;
}
