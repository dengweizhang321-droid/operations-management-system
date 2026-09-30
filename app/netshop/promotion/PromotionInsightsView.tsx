"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StatisticalPeriodPicker from "../../statistical-period-picker";
import PromotionDiagnosticPanel from "../../promotion-diagnostic-panel";
import { addIsoDays, shanghaiIsoToday } from "../../module-view-shared";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightDerivedMoneyMetric, InsightFilterBar, InsightListPagination, InsightMetric, InsightReadState, InsightSourceCoverage } from "../shared/components";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { encodeProductIdentity } from "@/lib/netshop/insights-contract";
import {
  decodePromotionInsightsForQuery, decodePromotionDetailForQuery, PROMOTION_OBJECT_KINDS, PROMOTION_SORTS,
  type PromotionDetailResponse, type PromotionInsightsResponse,
  type PromotionObjectKind, type PromotionObjectRow, type PromotionSort,
} from "@/lib/netshop/promotion-insights-contract";
import MetricTrend from "./MetricTrend";
import PromotionContributions from "./PromotionContributions";
import { validatePromotionQuery } from "@/lib/netshop/promotion-insights-query";
import { CapabilityGap, ComparisonCell, MetricCard, MetricCell, PromotionSection } from "./presentation";
import { readPromotion } from "./read";
import "./promotion.css";

const chapters = [
  ["overview", "效率概览"], ["trend", "趋势与变化"], ["shops", "店铺对比"], ["products", "推广商品"],
  ["plans", "计划与单元"], ["terms", "关键词搜索词"], ["diagnostic", "诊断与复盘"], ["sources", "数据与归因"],
] as const;
const objectLabels: Record<PromotionObjectKind, string> = { product: "商品", plan: "计划", unit: "单元", keyword: "关键词", search_term: "搜索词" };
const identityLabels: Record<PromotionObjectRow["identityKind"], string> = {
  follow_order_sku: "跟单 SKU（分摊视角）", promotion_product: "推广商品 ID", plan: "计划 ID", unit: "单元 ID", keyword: "关键词原文", search_term: "搜索词原文",
};
const mappingLabels = { matched: "精确关联", unmapped: "尚未关联", ambiguous: "关联多义", not_applicable: "不适用" };
type ObjectSelection = Pick<PromotionObjectRow, "rowKey" | "id" | "shopKey" | "objectKind" | "title">;

function isObjectKind(value: string): value is PromotionObjectKind { return PROMOTION_OBJECT_KINDS.includes(value as PromotionObjectKind); }
function coverageForRef(data: PromotionInsightsResponse, ref: string) { return data.sections.coverage[ref] ?? data.context.coverageBySource[ref]; }

function ObjectTable({ data, props, onChoose, sort, onSort }: { data: PromotionInsightsResponse; props: NetshopColumnProps; onChoose: (item: ObjectSelection) => void; sort: PromotionSort; onSort: (sort: PromotionSort) => void }) {
  const s = data.sections, capability = s.objectCapabilities[s.listScope.objectKind];
  return <>
    <div className="promotion-object-toolbar">
      <label className="promotion-filter">搜索当前对象列表<input aria-label="搜索推广对象" value={props.context.q} placeholder="名称 / ID / 店铺" maxLength={120} onChange={event => props.onContextChange({ q: event.target.value, page: 1 })}/></label>
      <label className="promotion-filter">每页条数<select aria-label="推广每页条数" value={props.context.pageSize} onChange={event => props.onContextChange({ pageSize: Number(event.target.value), page: 1 })}>{![20, 50, 100].includes(props.context.pageSize) && <option value={props.context.pageSize}>{props.context.pageSize} 条</option>}{[20, 50, 100].map(n => <option key={n} value={n}>{n} 条</option>)}</select></label>
      <label className="promotion-filter">排序<select aria-label="推广对象排序" value={sort} onChange={event => onSort(event.target.value as PromotionSort)}>{PROMOTION_SORTS.map((key, index) => <option key={key} value={key}>{["花费从高到低", "归因成交从高到低", "ROI 从高到低", "花费增幅从高到低", "花费增幅从低到高"][index]}</option>)}</select></label>
    </div>
    <p className="promotion-caption">搜索与对象日期只过滤当前列表，上方整期概览、趋势与店铺对比保持原范围。当前对象期：{s.listScope.objectStartDate}—{s.listScope.objectEndDate}。</p>
    <p className="promotion-caption">花费占比分母为原所选店铺、对象日期与当前视角的完整集合，不受商品焦点、搜索或分页改变。</p>
    {s.listScope.productFocus?.status === "unavailable" ? <CapabilityGap reason={s.listScope.productFocus.message}/> : capability.status !== "available" ? <CapabilityGap reason={capability.message}/> : <>
      {capability.unidentifiedCount !== null && capability.unidentifiedCount > 0 && <p className="promotion-note">有 {capability.unidentifiedCount} 个对象缺少可靠来源身份，保留核查桶并禁用详情和商品联动。</p>}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>对象 / 来源身份</th><th>店铺</th><th>{s.listScope.objectKind === "product" && s.attribution.amountDefinition === "jd_total_order_amount" ? "跟单分摊花费" : "花费"} / 占比</th><th>归因成交</th><th>ROI</th><th>点击 / 订单指标</th><th>CTR / CPC</th><th>花费变化 / 差额</th><th>来源与关联</th></tr></thead><tbody>
        {s.items.map(item => <tr key={item.rowKey}>
          <td>{item.id !== null && item.drillable ? <button type="button" className="row-action" onClick={() => onChoose(item)}>{item.title || item.id}</button> : <strong>{item.title || "未提供对象名称"}</strong>}<small>{identityLabels[item.identityKind]} · {item.id ?? (item.objectKind === "keyword" || item.objectKind === "search_term" ? "来源未提供原词文本" : "来源未提供 ID")}</small>{item.planId && <small>计划 {item.planId}</small>}{item.unitId && <small>单元 {item.unitId}</small>}{item.matchType && <small>匹配方式 {item.matchType}</small>}</td>
          <td>{item.platform} · {item.shopName}</td><td><MetricCell metric={item.metrics.spend}/><small>对象全集花费占比</small><MetricCell metric={item.spendShare}/></td><td><MetricCell metric={item.metrics.attributedPayment}/></td><td><MetricCell metric={item.metrics.roas}/></td>
          <td><MetricCell metric={item.metrics.clicks}/><small>{s.attribution.orderDefinition === "jd_order_lines" ? "归因订单行" : "归因净成交笔数"}</small><MetricCell metric={item.metrics.orders}/></td>
          <td><MetricCell metric={item.metrics.ctr}/><br/><MetricCell metric={item.metrics.cpc}/></td>
          <td>{props.context.previous ? <><ComparisonCell value={item.comparisons.spend.previous}/><small>环比差额 <MetricCell metric={item.changes.spend.previous}/></small></> : "环比已关闭"}{props.context.yearAgo && <><small>同比 <ComparisonCell value={item.comparisons.spend.yearAgo}/></small><small>同比差额 <MetricCell metric={item.changes.spend.yearAgo}/></small></>}</td>
          <td>{mappingLabels[item.mapping.status]}<small>{coverageForRef(data, item.coverageRef)?.complete ? "完整覆盖" : "覆盖不足"}</small>{item.observation && <details><summary>来源观测</summary>{(["current", "previous", "yearAgo"] as const).map((period, index) => <p key={period}>{["本期", "基期", "去年同期"][index]}：{item.observation![period].observedDates.length} 天有来源记录；{item.observation![period].verifiedAbsentDates.length} 天完整导入来源未报告本对象。</p>)}<p>来源内已核验的缺席，不等于平台真实零花费。</p></details>}</td>
        </tr>)}
      </tbody></table></div>
      {s.items.length === 0 && <div className="promotion-gap" role="status"><strong>{s.pagination.total > 0 ? "当前页没有对象" : s.listScope.q ? "没有匹配当前搜索的对象" : "当前对象范围没有记录"}</strong><p>{s.pagination.total > 0 ? `当前列表范围共有 ${s.pagination.total} 条，请调整页码。` : "不将空列表或缺失字段当作经营值为零。"}</p></div>}
      <InsightListPagination pagination={s.pagination} onPage={page => props.onContextChange({ page })}/>
    </>}
  </>;
}

function ObjectDetail({ selected, data, query, onClose, onChoose, onDrill, onInvalidate }: {
  selected: ObjectSelection; data: PromotionInsightsResponse; query: string;
  onClose: () => void; onChoose: (next: ObjectSelection) => void; onDrill: NetshopColumnProps["onDrill"];
  onInvalidate: (code: string, message: string) => void;
}) {
  const params = new URLSearchParams(query); ["objectStartDate", "objectEndDate", "focusDate", "q", "page", "pageSize", "sort"].forEach(key => params.delete(key)); params.set("objectKind", selected.objectKind); params.set("objectId", selected.rowKey); params.set("shopKey", selected.shopKey); params.set("sectionToken", data.sectionToken); params.set("snapshotToken", data.context.snapshotToken);
  const encoded = params.toString();
  const load = useCallback(async (signal: AbortSignal) => {
    try { const request = new URLSearchParams(encoded); validatePromotionQuery(request, true); return await readPromotion("/api/netshop/promotion-insights/detail", request, signal, decodePromotionDetailForQuery); }
    catch (error) {
      if (!signal.aborted && error instanceof InsightReadError && (error.code === "access_denied" || error.code.endsWith("revision_changed"))) onInvalidate(error.code, error.message);
      throw error;
    }
  }, [encoded, onInvalidate]);
  const read = useScopedRead<PromotionDetailResponse>(encoded, load);
  const detail = read.data?.sections;
  return <section className="promotion-detail-panel" aria-label="推广对象详情">
    <div className="promotion-section-header"><div><h2>{objectLabels[selected.objectKind]}详情</h2><p className="promotion-identity">{selected.title} · {selected.id} · {selected.shopKey.replace("\u001f", " · ")}</p></div><button type="button" className="secondary-button" onClick={onClose}>关闭详情</button></div>
    <InsightReadState status={read.status} error={read.error} onRetry={read.refresh}/>
    {detail && <>
      <div className="promotion-kpis">{(["spend", "attributedPayment", "roas", "orders"] as const).map((key, index) => <MetricCard key={key} label={[detail.item.identityKind === "follow_order_sku" ? "跟单分摊花费" : "推广花费", "平台归因成交", "ROI", data.sections.attribution.orderDefinition === "jd_order_lines" ? "归因订单行" : "归因净成交笔数"][index]} metric={detail.item.metrics[key]}/>)}</div>
      <p className="promotion-note">{identityLabels[detail.item.identityKind]}。{mappingLabels[detail.item.mapping.status]}；同批事实的商品、计划、单元与词视角不能重复相加。</p>
      <div className="promotion-fact-list"><div className="promotion-fact-row"><span>推广 SKU</span><strong>{detail.item.mapping.advertisedSkuId ?? "来源未提供"}</strong></div><div className="promotion-fact-row"><span>触发 SKU</span><strong>{detail.item.mapping.triggerSkuId ?? "来源未提供"}</strong></div><div className="promotion-fact-row"><span>跟单 SKU</span><strong>{detail.item.mapping.followSkuId ?? "来源未提供"}</strong></div></div>
      {detail.item.id !== null && detail.item.drillable && detail.item.mapping.status === "matched" && detail.item.mapping.evidence === "exact_source_identity" && detail.item.mapping.linkIdentity
        ? <button type="button" className="row-action" onClick={() => onDrill("products", detail.item.mapping.linkIdentity, "daily")}>查看精确关联商品整期详情</button>
        : <p className="promotion-caption">商品详情联动需要经核验的唯一商品身份；当前条件不足，未猜测关联。</p>}
      <h3>真实来源关系</h3>{detail.relations.length ? <ul className="promotion-relation-list">{detail.relations.map((relation, index) => <li key={index}><p>{relation.description}</p><small>原始字段：{relation.sourceFields.join("、")}</small><div>{relation.targets.map((target, targetIndex) => target.id !== null && target.rowKey !== null ? <button type="button" className="row-action" key={`${target.objectKind}:${target.rowKey}`} onClick={() => onChoose({ ...target, id: target.id, rowKey: target.rowKey!, shopKey: detail.item.shopKey, title: `${objectLabels[target.objectKind]} ${target.id}` })}>{objectLabels[target.objectKind]} · {target.id}</button> : <p key={targetIndex}>{objectLabels[target.objectKind]} · 来源未提供可联动的精确 ID</p>)}</div></li>)}</ul> : <p className="promotion-caption">当前来源没有可验证的对象关系。</p>}
      <p className="promotion-caption">对象详情展示顶部完整期间，与明细中的日期过滤分开标注。</p>
      {detail.item.observation && detail.item.observation.current.verifiedAbsentDates.length > 0 && <p className="promotion-note">{detail.item.observation.current.verifiedAbsentDates.join("、")} 的完整导入来源未报告该对象；已核验的是来源内无记录，不代表平台真实零花费。</p>}
      <h3>对象整期趋势</h3><MetricTrend points={detail.trend.items.map(point => ({ ...point, values: [point.metrics.spend, point.metrics.attributedPayment] }))} labels={["花费 / 元", "归因成交 / 元"]}/>
      <details><summary>详情来源与限制</summary><p>范围 {read.data!.context.periods.current.startDate}—{read.data!.context.periods.current.endDate} · 版本 {read.data!.sectionToken.slice(0, 16)}</p><ul>{detail.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul></details>
    </>}
  </section>;
}

export default function PromotionInsightsView(props: NetshopColumnProps) {
  const { context, startDate, endDate, periodKind, onContextChange } = props;
  const platform = context.platforms.length === 1 ? context.platforms[0] : "京东";
  const objectKind = isObjectKind(context.section) ? context.section : "product";
  const productIdentity = objectKind === "product" && context.product ? encodeProductIdentity(context.product) : null;
  const authority = `${JSON.stringify(props.currentUser)}`;
  const outletScope = `${context.outlets.filter(outlet => outlet.startsWith(`${platform}\u001f`)).join("\u001e")}`;
  const selectedShopKeys = Object.freeze(context.outlets.filter(outlet => outlet.startsWith(`${platform}\u001f`)));
  const baseScope = `${JSON.stringify([platform, outletScope, startDate, endDate, periodKind, context.grain, authority, productIdentity])}`;
  const [chosen, setChosen] = useState<{ response: PromotionInsightsResponse; item: ObjectSelection } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState<"amount" | "roas" | "clicks" | "cpc">("amount");
  const [readGeneration, setReadGeneration] = useState(0);
  const [blocked, setBlocked] = useState<{ baseScope: string; code: string; message: string } | null>(null);
  const binding = useRef<{ baseScope: string; sectionToken: string; snapshotToken: string } | null>(null);
  const focus = context.promotionPrefs?.objectDateFocus ?? null;
  const sort = context.promotionPrefs?.sort ?? "spend_desc";
  const params = new URLSearchParams({ platform, dimension: platform === "京东" ? "sku" : "spu", startDate, endDate, periodKind, trendGrain: context.grain, objectKind, q: context.q, page: String(context.page), pageSize: String(context.pageSize), sort });
  if (outletScope) outletScope.split("\u001e").forEach(outlet => params.append("outlet", outlet));
  if (focus) { params.set("objectStartDate", focus.startDate); params.set("objectEndDate", focus.endDate); }
  if (productIdentity) params.set("productIdentity", productIdentity);
  const encoded = `${params.toString()}`;
  const requestScope = `${encoded}|${authority}|${readGeneration}`;
  const load = useCallback((signal: AbortSignal) => {
    const request = new URLSearchParams(encoded);
    if (binding.current?.baseScope === baseScope) { request.set("sectionToken", binding.current.sectionToken); request.set("snapshotToken", binding.current.snapshotToken); }
    validatePromotionQuery(request);
    return readPromotion("/api/netshop/promotion-insights", request, signal, decodePromotionInsightsForQuery);
  }, [encoded, baseScope]);
  const read = useScopedRead<PromotionInsightsResponse>(requestScope, load);
  const isBlocked = blocked?.baseScope === baseScope;
  const data = isBlocked ? null : read.data, s = data?.sections;
  useEffect(() => { if (data) binding.current = { baseScope, sectionToken: data.sectionToken, snapshotToken: data.context.snapshotToken }; }, [data, baseScope]);
  function retry() { binding.current = null; setBlocked(null); setChosen(null); setReadGeneration(value => value + 1); }
  const invalidate = useCallback((code: string, message: string) => { binding.current = null; setBlocked({ baseScope, code, message }); setChosen(null); }, [baseScope, setBlocked, setChosen]);
  const invalidateReport = useCallback((code: string, message: string) => invalidate(code === "promotion_diagnostic_binding_changed" ? "promotion_revision_changed" : code, message), [invalidate]);
  function choose(item: ObjectSelection) {
    if (item.id === null || !data) return;
    if (productIdentity && item.objectKind !== "product") { setChosen(null); onContextChange({ section: item.objectKind, product: null, q: item.id.length <= 120 ? item.id : "", page: 1 }); return; }
    setChosen({ response: data, item });
  }
  function changeObjectKind(kind: PromotionObjectKind) { setChosen(null); onContextChange({ section: kind, q: "", page: 1, product: kind === "product" && objectKind === "product" ? context.product : null }); }
  function scrollChapter(key: string) { document.getElementById(`promotion-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  function selectTrend(from: string, to: string) { setChosen(null); onContextChange({ promotionPrefs: { schemaVersion: "promotion-ui-v1", sort, objectDateFocus: { startDate: from, endDate: to } }, page: 1 }); scrollChapter(objectKind === "product" ? "products" : objectKind === "plan" || objectKind === "unit" ? "plans" : "terms"); }
  const amountLabel = s?.attribution.amountDefinition === "tmall_net_amount" ? "推广净成交（归因）" : "总订单金额（归因）";
  const orderLabel = s?.attribution.orderDefinition === "tmall_net_transactions" ? "归因净成交笔数" : "归因订单行";
  const today = shanghaiIsoToday();
  const rateCoverage = data && coverageForRef(data, data.sections.summary.spendRate.coverageRef);
  const owningRevision = data?.context.sourceRevisions.find(source => source.kind === "owning_revision")?.revision;
  const reportEligible = Boolean(data && s?.diagnostic.status === "available" && s.diagnostic.shopName === "志高商用设备旗舰店" && platform === "京东" && props.currentUser?.role === "admin" && data.context.effectiveScope.shopKeys.length === 1 && data.context.effectiveScope.shopKeys[0] === `京东\u001f${s.diagnostic.shopName}` && data.context.periods.current.days <= 7 && owningRevision);
  const selectedObject = chosen?.response === data && data ? chosen.item : null;
  const sectionTable = data ? <ObjectTable data={data} props={props} onChoose={choose} sort={sort} onSort={next => { setChosen(null); onContextChange({ promotionPrefs: { schemaVersion: "promotion-ui-v1", sort: next, objectDateFocus: focus }, page: 1 }); }}/> : null;
  return <div className="promotion-insights">
    <div className="promotion-heading"><h1>推广分析</h1>{context.returnTo && <button type="button" className="secondary-button" onClick={props.onReturn}>返回原列表</button>}<div className="promotion-platform-tabs" role="tablist" aria-label="推广分析平台">{(["京东", "天猫"] as const).map(name => <button type="button" key={name} role="tab" aria-selected={platform === name} onClick={() => { setChosen(null); onContextChange({ platforms: [name], outlets: [], dimension: name === "京东" ? "sku" : "spu", section: "product", q: "", page: 1, product: null }); }}>{name}推广</button>)}</div></div>
    <nav className="promotion-chapters" aria-label="推广分析分区">{chapters.map(([key, label]) => <button type="button" key={key} onClick={() => scrollChapter(key)}>{label}</button>)}</nav>
    <InsightFilterBar sticky={false} label="推广经营范围筛选">
      <div className="promotion-filter"><span>店铺范围</span><details className="promotion-shop-picker"><summary>{selectedShopKeys.length ? `已选 ${selectedShopKeys.length} 家店铺` : "全部有效店铺"}</summary><div className="promotion-shop-options"><button type="button" className="row-action" onClick={() => { setChosen(null); onContextChange({ outlets: [], page: 1, product: null }); }}>查看全部有效店铺</button>{s?.shops.items.map(shop => <label key={shop.shopKey}><input type="checkbox" aria-label={`选择推广店铺 ${shop.shopName}`} checked={!selectedShopKeys.length || selectedShopKeys.includes(shop.shopKey)} onChange={event => { const current = selectedShopKeys.length ? selectedShopKeys : s.shops.items.map(item => item.shopKey); setChosen(null); onContextChange({ outlets: event.target.checked ? [...current, shop.shopKey].filter((key, index, list) => list.indexOf(key) === index) : current.filter(key => key !== shop.shopKey), page: 1, product: null }); }}/>{shop.platform} · {shop.shopName}</label>)}{!s && selectedShopKeys.map(key => <p key={key}>{key.replace("\u001f", " · ")}</p>)}<p className="promotion-caption">当前列出已读取范围的店铺；查看全部可重新选择多店集合。</p></div></details></div>
      <div className="promotion-filter date-selector promotion-date-selector"><span>统计期间</span><button type="button" className="promotion-date-trigger" aria-label="选择推广统计日期" aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}>{startDate}—{endDate} ▦</button>{pickerOpen && <StatisticalPeriodPicker minDate={`${Number(today.slice(0, 4)) - 1}-01-01`} maxDate={today} startDate={startDate} endDate={endDate} periodIntent={periodKind === "quarter" ? "quarter" : ["rolling", "last7", "last15", "last30"].includes(periodKind) ? "rolling" : undefined} onCancel={() => setPickerOpen(false)} onApply={(from, to, intent) => { setPickerOpen(false); setChosen(null); props.onApplyPeriod?.(from, to, intent); }}/>}</div>
      <label className="promotion-filter">趋势粒度<select aria-label="推广趋势粒度" value={context.grain} onChange={event => onContextChange({ grain: event.target.value as "day" | "week" | "month", page: 1 })}><option value="day">日</option><option value="week">自然周（首尾截段）</option><option value="month">自然月（首尾截段）</option></select></label>
      <div className="promotion-checks"><label><input type="checkbox" checked={context.previous} onChange={event => onContextChange({ previous: event.target.checked })}/> 环比</label><label><input type="checkbox" checked={context.yearAgo} onChange={event => onContextChange({ yearAgo: event.target.checked })}/> 同比</label></div>
    </InsightFilterBar>
    {productIdentity && context.product && <section className="promotion-focus-banner" aria-label="精确商品焦点"><div><strong>精确商品焦点</strong><p>{context.product.platform} · {context.product.shopName} · {context.product.dimension.toUpperCase()} · {context.product.id}</p><p className="promotion-caption">{s?.listScope.productFocus ? s.listScope.productFocus.message : read.status === "loading" && !isBlocked ? "正在按来源核验精确商品关联。" : "当前焦点尚未取得可信匹配结果，可清除焦点后查看原范围。"} 只过滤推广对象与贡献集合，整期汇总、趋势和店铺对比保持原范围。</p></div><button type="button" className="secondary-button" onClick={() => { setChosen(null); onContextChange({ product: null, page: 1 }); }}>清除商品焦点</button></section>}
    <InsightReadState status={isBlocked ? blocked!.code.endsWith("revision_changed") ? "version_changed" : "error" : read.status} error={isBlocked ? blocked!.message : read.error} onRetry={retry}/>
    {!data && <div className="promotion-unread-sections">{chapters.map(([key, title]) => <PromotionSection key={key} id={`promotion-${key}`} title={title}><p className="promotion-caption">{read.status === "loading" && !isBlocked ? "正在读取当前范围的可信来源…" : "尚未取得本分区的可信结果；保留当前筛选，重新读取后查看。"}</p></PromotionSection>)}</div>}
    {data && s && <>
      <div className="promotion-context-line"><span>{platform} · {data.context.effectiveScope.shopKeys.length} 家店铺 · {data.context.periods.current.days} 个自然日</span><span title={data.sectionToken}>来源版本 {data.sectionToken.slice(0, 16)} · {data.columnVersion}</span></div>
      <div className="promotion-context-line"><span>{context.previous && `环比 ${data.context.periods.previous.startDate}—${data.context.periods.previous.endDate}`}</span><span>{context.yearAgo && `同比 ${data.context.periods.yearAgo.startDate}—${data.context.periods.yearAgo.endDate}`} · {data.context.periods.rule}</span></div>
      <div className="promotion-columns" id="promotion-overview"><div className="promotion-main"><div className="promotion-column-label"><span>投入与产出</span><small>本期 {startDate}—{endDate}</small></div>
        <div className="promotion-kpis">{(["spend", "attributedPayment", "roas", "spendRate"] as const).map((key, index) => <MetricCard key={key} label={["推广花费", amountLabel, "ROI", "推广费率"][index]} metric={s.summary[key]} previous={s.comparisons[key].previous} yearAgo={s.comparisons[key].yearAgo} showPrevious={context.previous} showYearAgo={context.yearAgo} previousChange={key === "spend" || key === "attributedPayment" ? s.changes[key].previous : undefined} yearAgoChange={key === "spend" || key === "attributedPayment" ? s.changes[key].yearAgo : undefined} note={key === "roas" ? "平台归因成交 ÷ 花费，单位倍数" : key === "spendRate" ? "同平台 × 店铺 × 日期完整配对" : undefined}/>)}</div>
        <PromotionSection id="promotion-trend" title="投入产出趋势" note="点击日期联动对象列表；顶部仍为整期汇总。缺日或缺字段处断开。" tools={<div className="promotion-trend-tabs">{([["amount", "花费 / 产出"], ["roas", "ROI"], ["clicks", "点击"], ["cpc", "CPC"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={trendMetric === key} onClick={() => setTrendMetric(key)}>{label}</button>)}</div>}>
          <MetricTrend key={`${requestScope}:${trendMetric}`} points={s.trend.items.map(point => ({ ...point, values: trendMetric === "amount" ? [point.metrics.spend, point.metrics.attributedPayment] : [point.metrics[trendMetric]] }))} labels={trendMetric === "amount" ? ["推广花费 / 元", `${amountLabel} / 元`] : [trendMetric === "roas" ? "ROI / 倍" : trendMetric === "cpc" ? "CPC / 元/次" : "点击 / 次"]} onSelect={selectTrend}/>
          <div className="promotion-context-line"><span>{focus ? `已定位对象期间 ${focus.startDate}—${focus.endDate}` : "选择趋势日期查看同范围对象"}</span>{focus && <button type="button" className="row-action" onClick={() => { setChosen(null); onContextChange({ promotionPrefs: { schemaVersion: "promotion-ui-v1", sort, objectDateFocus: null }, page: 1 }); }}>返回整期对象</button>}</div>
          <PromotionContributions data={data} showPrevious={context.previous} onChoose={choose}/>
        </PromotionSection>
        <PromotionSection id="promotion-shops" title="店铺投入与效率" note="同一平台下按每家店铺的独立店日覆盖核验；占比不代表交易渠道份额。">
          {!s.shops.visible ? <p className="promotion-caption">{data.context.effectiveScope.shopKeys.length === 1 ? "当前为单店范围，已收起重复的多店对比。" : "当前范围没有可核验店铺，店铺对比暂无数据。"}</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>店铺</th><th>花费 / 占比</th><th>{amountLabel}</th><th>ROI / 费率</th><th>花费变化</th><th>覆盖</th></tr></thead><tbody>{s.shops.items.map(shop => <tr key={shop.shopKey}><td><button type="button" className="row-action" onClick={() => onContextChange({ outlets: [shop.shopKey], page: 1, product: null })}>{shop.platform} · {shop.shopName}</button></td><td><MetricCell metric={shop.metrics.spend}/><br/><MetricCell metric={shop.spendShare}/></td><td><MetricCell metric={shop.metrics.attributedPayment}/></td><td><MetricCell metric={shop.metrics.roas}/><br/><MetricCell metric={shop.metrics.spendRate}/></td><td>{context.previous ? <ComparisonCell value={shop.comparisons.spend.previous}/> : "—"}{context.yearAgo && <small>同比 <ComparisonCell value={shop.comparisons.spend.yearAgo}/></small>}</td><td>{coverageForRef(data, shop.coverageRef) && <InsightSourceCoverage coverage={coverageForRef(data, shop.coverageRef)!} label="推广"/>}</td></tr>)}</tbody></table></div>}
        </PromotionSection>
      </div><aside className="promotion-aside"><div className="promotion-column-label"><span>效率与核查</span><small>同口径 / 同覆盖</small></div>
        <PromotionSection className="promotion-efficiency-section" title="流量与归因效率" note="点击不是访客；订单行、订单笔数和客户数分别保留。"><div className="promotion-efficiency"><div className="promotion-efficiency-metric"><InsightMetric label="CTR" metric={s.summary.ctr}/><div className="promotion-comparisons">{context.previous && <span>环比 <ComparisonCell value={s.comparisons.ctr.previous}/></span>}{context.yearAgo && <span>同比 <ComparisonCell value={s.comparisons.ctr.yearAgo}/></span>}</div></div><div className="promotion-efficiency-metric"><InsightDerivedMoneyMetric label="CPC" metric={s.summary.cpc}/><div className="promotion-comparisons">{context.previous && <span>环比 <ComparisonCell value={s.comparisons.cpc.previous}/></span>}{context.yearAgo && <span>同比 <ComparisonCell value={s.comparisons.cpc.yearAgo}/></span>}</div></div></div><div className="promotion-fact-list">{(["impressions", "clicks", "orders"] as const).map((key, index) => <div className="promotion-fact-row" key={key}><span>{["展现", "点击", orderLabel][index]}</span><MetricCell metric={s.summary[key]}/></div>)}</div><p className="promotion-caption">ROI 采用平台归因成交 ÷ 推广花费，不表示利润回报率或广告增量。归因窗口：{s.attribution.window ?? "尚未核验"}。</p></PromotionSection>
        <PromotionSection title="覆盖与比较条件" note="先核对每个精确店日，再比较整期比率。">{rateCoverage && <><div className="promotion-source-count">{rateCoverage.coveredShopDatePairs}<small> / {rateCoverage.expectedShopDatePairs} 店日</small></div><div className="promotion-progress"><span style={{ width: `${rateCoverage.expectedShopDatePairs ? rateCoverage.coveredShopDatePairs / rateCoverage.expectedShopDatePairs * 100 : 0}%` }}/></div><InsightSourceCoverage coverage={rateCoverage} label="推广与商品配对"/></>}<p className="promotion-caption">整期配对不足时，主推广费率保持空值；部分匹配值单列范围。</p>{s.matchedRange && <details><summary>辅助匹配范围 · {s.matchedRange.scopeLabel}</summary><div className="promotion-fact-list">{(["spend", "payment", "spendRate"] as const).map((key, index) => <div className="promotion-fact-row" key={key}><span>{["匹配花费", "匹配平台成交", "仅匹配范围费率"][index]}</span><MetricCell metric={s.matchedRange!.metrics[key]}/></div>)}</div><ul>{s.matchedRange.shopDates.map(shop => <li key={shop.shopKey}>{shop.shopKey.replace("\u001f", " · ")}：{shop.dates.join("、")}</li>)}</ul></details>}</PromotionSection>
        <PromotionSection title="店铺投入分布" note="已覆盖花费结构，不是交易渠道份额。"><div className="promotion-structure">{s.shops.items.map(shop => <article key={shop.shopKey}><header><button type="button" className="row-action" onClick={() => onContextChange({ outlets: [shop.shopKey], page: 1 })}>{shop.shopName}</button><MetricCell metric={shop.spendShare}/></header><div className="promotion-progress"><span style={{ width: `${shop.spendShare.status === "available" && shop.spendShare.value !== null ? Math.min(100, Math.max(0, shop.spendShare.value * 100)) : 0}%` }}/></div><span className="promotion-caption">花费 <MetricCell metric={shop.metrics.spend}/> · ROI <MetricCell metric={shop.metrics.roas}/></span></article>)}</div></PromotionSection>
        <PromotionSection title="值得核查的变化" note="公开观察规则；变化为核查线索，不是原因结论。"><h3>投入与产出</h3><p>先确认本期与基期覆盖、归因口径，再核对花费和归因成交是否同步变化。</p><h3>流量成本与成交效率</h3><p>结合 CPC、CTR 和{orderLabel}查看对象证据。保持同身份与同日期，等待归因成熟后再复盘。</p><p className="promotion-caption">来源版本、范围或归因定义变化时停止比较并重新读取；本页不自动停投或调整预算。</p><button type="button" className="row-action" onClick={() => scrollChapter("diagnostic")}>查看诊断范围与证据</button></PromotionSection>
      </aside></div>
      <PromotionSection id="promotion-products" title={s.listScope.productFocus ? `推广商品 · 精确 ${s.listScope.productFocus.identity.dimension.toUpperCase()} ${s.listScope.productFocus.identity.id}` : "推广商品"} note={platform === "京东" ? "跟单 SKU 分摊视角，不能等同独立投放效果。商品关联按平台、店铺、维度和 ID核验。" : "推广商品 ID 视角，身份映射须有唯一来源证据。"} tools={<button type="button" className="row-action" onClick={() => changeObjectKind("product")}>查看商品列表</button>}>
        {objectKind === "product" ? sectionTable : <p className="promotion-caption">当前明细视角为{objectLabels[objectKind]}，点击“查看商品列表”切换；上方经营汇总不变。</p>}
      </PromotionSection>
      <PromotionSection id="promotion-plans" title="计划与单元" note="同名计划按真实 ID 区分，跨店同 ID 分别展示；关联只来自原始明细。" tools={<div className="promotion-trend-tabs">{(["plan", "unit"] as const).map(kind => <button type="button" key={kind} disabled={!s.objectCapabilities[kind].canQuery} aria-pressed={objectKind === kind} onClick={() => changeObjectKind(kind)}>{objectLabels[kind]}</button>)}</div>}>
        {objectKind === "plan" || objectKind === "unit" ? sectionTable : s.objectCapabilities.plan.status !== "available" ? <CapabilityGap reason={s.objectCapabilities.plan.message}/> : <p className="promotion-caption">当前范围有可靠计划来源。选择“计划”或“单元”读取其精确 ID、贡献与关系；不同视角不可相加。</p>}
      </PromotionSection>
      <PromotionSection id="promotion-terms" title="关键词与搜索词" note="关键词与实际搜索词分别保留，缺词关系不推造；匹配方式只使用原始字段。" tools={<div className="promotion-trend-tabs">{(["keyword", "search_term"] as const).map(kind => <button type="button" key={kind} disabled={!s.objectCapabilities[kind].canQuery} aria-pressed={objectKind === kind} onClick={() => changeObjectKind(kind)}>{objectLabels[kind]}</button>)}</div>}>
        {objectKind === "keyword" || objectKind === "search_term" ? sectionTable : s.objectCapabilities.keyword.status !== "available" ? <CapabilityGap reason={s.objectCapabilities.keyword.message}/> : <p className="promotion-caption">选择词视角查看花费、点击、归因金额与订单、ROI、变化及明确来源关系。来源无词记录留在缺身份核查桶。</p>}
      </PromotionSection>
      {selectedObject && <ObjectDetail key={`${requestScope}:${selectedObject.rowKey}`} selected={selectedObject} data={data} query={encoded} onClose={() => setChosen(null)} onChoose={choose} onDrill={props.onDrill} onInvalidate={invalidate}/>}
      <PromotionSection id="promotion-diagnostic" title="诊断与复盘" note="观察事实 → 公开规则 → 证据 → 核查建议 → 观察指标与停止条件。">
        {reportEligible ? <>
          <p className="promotion-note">原报告本期 {startDate}—{endDate}；基期 {addIsoDays(startDate, -data.context.periods.current.days)}—{addIsoDays(startDate, -1)}，采用紧邻前等长规则。本页环比采用“{data.context.periods.rule}”，另有去年同期；原报告与页面比较规则分别披露。</p>
          <p className="promotion-caption">HTML / XLSX 导出保留原报告的完整本期与基期、精确店铺及同一网店来源修订，不导出当前搜索页、本页同比或新贡献榜。</p>
          <PromotionDiagnosticPanel key={`${platform}:${s.diagnostic.shopName}:${startDate}:${endDate}:${owningRevision}:${authority}:${data.sectionToken}`} shopName={s.diagnostic.shopName!} startDate={startDate} endDate={endDate} allowPaidModel={false} ratioLabel="ROI" expectedOwningRevision={owningRevision} onReadInvalidated={invalidateReport} includeExportProvenance={true}/>
        </> : <CapabilityGap reason={s.diagnostic.status === "available" ? "原报告须为已核验管理员、指定京东单店、1—7 个完整自然日及可信来源修订；当前条件不足。" : s.diagnostic.message}/>}<p className="promotion-caption">列表搜索和对象日期不裁剪原报告。规则草稿需运营复核；本栏目未启用付费模型解释。</p>
      </PromotionSection>
      <PromotionSection id="promotion-sources" title="数据与归因" note="来源、范围、版本、字段存在与映射共同决定可用性。">
        <div className="promotion-source-grid"><article><h3>金额与订单定义</h3><p>{amountLabel}：{s.attribution.amountDefinition === "jd_total_order_amount" ? "京准通归因总订单金额，不能表达退款后销售净额。" : "天猫推广来源净成交金额，保留原来源退款与归因规则。"}</p><p>{orderLabel}保持来源定义，不替换为客户数。ROI 为归因成交 ÷ 花费、单位倍数，不是利润或广告增量。</p></article><article><h3>归因与可比性</h3><p>归因窗口：{s.attribution.window ?? "来源尚未提供可信窗口"}。归因成交与平台成交的包含关系未核验，不标自然/付费渠道份额，不用相减推算自然成交。</p><p>推广 SKU、触发 SKU、跟单 SKU独立建模。商品映射未关联或多义时停止钻取。</p></article></div>
        <div className="data-table-wrap"><table className="data-table promotion-capability-table"><thead><tr><th>来源</th><th>字段能力</th><th>范围覆盖</th><th>说明</th></tr></thead><tbody>{s.sourceMatrix.map(source => <tr key={source.sourceId}><td>{source.label}<small>{source.sourceId}</small></td><td>{source.fields.map(field => <p key={field.field}>{field.field}：{field.status === "available" ? "已提供" : `缺口（${field.reasonCode ?? "未核验"}）`}</p>)}</td><td>{coverageForRef(data, source.coverageRef) && <InsightSourceCoverage coverage={coverageForRef(data, source.coverageRef)!} label="当前来源"/>}</td><td>{source.notes.map((note, index) => <p key={index}>{note}</p>)}</td></tr>)}</tbody></table></div>
        <details><summary>完整修订向量、截止日期与限制</summary><ul>{data.context.freshness.map(source => <li key={source.sourceId}>{source.sourceId} · 截止 {source.dataThrough ?? "无可信截止日期"}</li>)}</ul><ul>{data.context.sourceRevisions.map(source => <li key={`${source.kind}:${source.scopeKey}`}>{source.kind} · {source.scopeKey.replace("\u001f", " · ")} · {source.revision}</li>)}</ul><ul>{[...data.context.limitations, ...s.limitations].map((text, index) => <li key={index}>{text}</li>)}</ul></details>
      </PromotionSection>
    </>}
  </div>;
}
