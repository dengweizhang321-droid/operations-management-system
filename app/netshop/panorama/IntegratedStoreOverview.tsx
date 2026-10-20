"use client";

import { useState } from "react";
import { formatMetric, type MetricValue, type MetricComparison } from "@/lib/netshop/insights-contract";
import type { ProductSeriesColumnKey } from "@/lib/netshop/product-scope-series-contract";
import type { ProductRow } from "../products/contract";
import { ProductPicture } from "../products/ProductsPrimitives";
import { InsightComparison, InsightMetric } from "../shared/components";
import type { NetshopColumnProps } from "../shared/module-slots";
import MetricTrend from "../promotion/MetricTrend";
import { panoramaSeriesChartPoints, panoramaSeriesColumnLabels } from "./ui-state";
import type { StorePanoramaResponse, PanoramaSectionKey } from "./contract";
import "./integrated-panorama.css";

function Field({ value }: { value?: MetricValue }) {
  if (!value) return <span className="si-muted">— · 来源当前不可用</span>;
  return <span className="si-field" data-status={value.status}>{formatMetric(value)}{value.status !== "available" && <small>{value.status === "partial" ? "已覆盖部分" : "暂不可用"}</small>}</span>;
}

/** Uses the exact existing response; no second reader, summary calculation or generated insight. */
export default function IntegratedStoreOverview({ data, props, onSelect, onPromotion, onProducts, onChapter, onRetry }: {
  data: StorePanoramaResponse; props: NetshopColumnProps; onSelect: (row: Pick<ProductRow, "identity">) => void;
  onPromotion: () => void; onProducts: () => void; onChapter: (id: PanoramaSectionKey) => void; onRetry: () => void;
}) {
  const [metric, setMetric] = useState<ProductSeriesColumnKey>("payment");
  const product = data.sources.products.state === "ready" ? data.sources.products.data : null;
  const series = data.sources.productSeries.state === "ready" ? data.sources.productSeries.data : null;
  const promotion = data.sources.promotion.state === "ready" ? data.sources.promotion.data : null;
  const baseline = product?.sections.baselineReads.previous.state === "ready" ? product.sections.baselineReads.previous.data : null;
  const cards: Array<{ label: string; metric?: MetricValue; previous?: MetricComparison; yearAgo?: MetricComparison }> = [
    ...(["payment", "quantity", "visitors", "conversion"] as const).map((key, index) => ({ label: ["平台成交额", "成交件数", "商品访客累计", "商品累计转化率"][index], metric: product?.sections.summary[key], previous: product?.sections.comparisons[key].previous, yearAgo: product?.sections.comparisons[key].yearAgo })),
    ...(["spend", "roas"] as const).map((key, index) => ({ label: ["推广花费", "推广 ROI"][index], metric: promotion?.sections.summary[key], previous: promotion?.sections.comparisons[key].previous, yearAgo: promotion?.sections.comparisons[key].yearAgo })),
  ];
  const points = series ? panoramaSeriesChartPoints(series, "current", metric) : [];
  const changes = product?.sections.structure?.changes;
  const watch = product?.sections.efficiency;
  const rows = product?.sections.items.slice(0, 6) ?? [];
  const openDate = (start: string) => {
    onChapter(metric === "payment" || metric === "quantity" || metric === "refundPayment" ? "performance" : "traffic");
    requestAnimationFrame(() => document.getElementById(`panorama-${metric === "payment" || metric === "quantity" || metric === "refundPayment" ? "performance" : "traffic"}-series-current-${start}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  return <div className="si-overview">
    <div className="ni-scope-summary"><strong>{data.context.effectiveScope.shopKeys.map(key => key.replace("\u001f", " · ")).join("、")}</strong> · 平台经营、广告归因和ERP各自保留来源。商品搜索与翻页不改变整店指标。</div>
    <div className="si-kpis">{cards.map(card => <article className="si-kpi" key={card.label}>{card.metric ? <InsightMetric label={card.label} metric={card.metric}/> : <><span>{card.label}</span><strong>—</strong><small>来源当前不可用</small></>}<div className="si-comparisons">{props.context.previous && card.previous && <span>环比 <InsightComparison value={card.previous}/></span>}{props.context.yearAgo && card.yearAgo && <span>同比 <InsightComparison value={card.yearAgo}/></span>}</div></article>)}</div>
    {(["products", "productSeries", "promotion"] as const).map(key => data.sources[key].state === "error" ? <div className="si-source-error" role="alert" key={key}>{data.sources[key].message}<button type="button" onClick={onRetry}>重新读取</button></div> : null)}
    <div className="ni-overview-grid">
      <section className="si-panel promotion-insights"><header className="si-panel-head"><div><h2>经营趋势</h2><p>本期完整日期序列 · 各来源字段独立判断可用性</p></div><select aria-label="新版店铺趋势指标" value={metric} onChange={event => setMetric(event.target.value as ProductSeriesColumnKey)}>{(["payment", "quantity", "visitors", "conversion", "refundPayment"] as const).map(key => <option key={key} value={key}>{panoramaSeriesColumnLabels[key]}</option>)}</select></header>{points.length && points.some(point => point.values.some(value => value.status === "available")) ? <MetricTrend points={points} labels={[panoramaSeriesColumnLabels[metric]]} onSelect={start => openDate(start)}/> : <p className="si-empty">当前范围没有可绘制的完整指标点；保留缺口，不将未知显示成零。</p>}<button type="button" className="si-text-button" onClick={() => onChapter(metric === "visitors" || metric === "conversion" ? "traffic" : "performance")}>查看本期、环比及同比原始趋势与日期明细 →</button></section>
      <section className="si-panel"><header className="si-panel-head"><div><h2>变化与查看线索</h2><p>依据完整来源结果，不从当前页推算全店结论</p></div></header><div className="ni-observations">
        <article className="ni-observation"><h3>可比商品成交变化</h3><p>可比净变化 <Field value={changes?.netChange}/></p><p>本期 <Field value={changes?.pairedCurrentPayment}/> · 基期 <Field value={changes?.pairedPreviousPayment ?? baseline?.payment}/></p><button type="button" className="si-text-button" onClick={() => onChapter("products")}>查看商品贡献与比较范围 →</button></article>
        <article className="ni-observation"><h3>流量与转化关注</h3>{watch ? <><p>完整扫描 {watch.scanned} 项，符合来源关注规则 {watch.qualified} 项。</p><p>访客累计门槛 {watch.rules.minimumVisitors}，转化低于 {(watch.rules.maximumConversion * 100).toFixed(2)}%；{watch.rules.requireComplete ? "只纳入覆盖完整记录。" : "覆盖条件见来源规则。"}</p></> : <p>当前来源未返回可用关注清单，不据此断言没有问题。</p>}<button type="button" className="si-text-button" onClick={() => onChapter("traffic")}>查看来源规则与关注商品 →</button></article>
        <article className="ni-observation"><h3>投入与归因产出</h3><p>花费 <Field value={promotion?.sections.summary.spend}/> · 广告归因成交 <Field value={promotion?.sections.summary.attributedPayment}/></p><button type="button" className="si-text-button" onClick={onPromotion}>进入同店、同周期推广专题 →</button></article>
      </div></section>
    </div>
    <section className="si-panel si-preview-panel"><header className="si-panel-head"><div><h2>商品经营明细</h2><p>{product ? `当前第${product.sections.pagination.page}页返回${product.sections.pagination.returned}项，完整列表${product.sections.pagination.total}项；此处预览前${rows.length}项。` : "平台商品来源当前不可用。"}访客和客户为商品×日累计。</p></div><button type="button" className="si-text-button" onClick={onProducts}>进入商品表现 ↗</button></header><div className="si-table-wrap"><table className="si-table"><thead><tr><th>商品 / 身份</th><th>平台成交额</th><th>成交件数</th><th>商品访客累计</th><th>累计转化率</th><th>环比</th><th>明细</th></tr></thead><tbody>{rows.map(row => <tr key={JSON.stringify(row.identity)}><td><div className="si-product"><ProductPicture title={row.title} url={row.imageUrl} imageStatus="unverified"/><div><button type="button" className="si-text-button si-product-title" title={row.title} onClick={() => onSelect(row)}>{row.title}</button><small>{row.identity.dimension.toUpperCase()} · {row.identity.id}</small></div></div></td><td><Field value={row.metrics.payment}/></td><td><Field value={row.metrics.quantity}/></td><td><Field value={row.metrics.visitors}/></td><td><Field value={row.metrics.conversion}/></td><td>{props.context.previous ? <InsightComparison value={row.comparisons.payment.previous}/> : "—"}</td><td><button type="button" className="si-text-button" onClick={() => onSelect(row)}>商品详情 →</button></td></tr>)}{!rows.length && <tr><td colSpan={7}><p className="si-empty">当前明细没有可展示商品；范围和来源状态保留。</p></td></tr>}</tbody></table></div><footer className="si-panel-footer"><span>预览不是全量排行，合计与比较沿用来源定义。</span><button type="button" className="si-text-button" onClick={() => onChapter("products")}>展开店铺完整商品明细与分页 ↓</button></footer></section>
  </div>;
}
