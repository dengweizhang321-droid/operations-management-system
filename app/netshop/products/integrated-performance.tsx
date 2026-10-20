"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightListPagination } from "../shared/components";
import { IntegratedEvidence } from "../shared/integrated-layout";
import type { ProductInsightsResponse, ProductRow } from "./contract";
import { MetricCell, MissingSource, ProductsDerivedMetric, ProductsMetric, ProductsPanel } from "./ProductsPrimitives";
import { ProductsBars, ProductsScatter } from "./ProductsCharts";
import { ProductsCoverage } from "./ProductsCoverage";
import { productSortOptions, type ProductsUiChange, type ProductsUiState } from "./ui-state";
import "./integrated-performance.css";

const mainMetrics = [
  ["payment", "平台销售额"], ["quantity", "销量（件）"], ["visitors", "访客累计"],
  ["conversion", "商品累计转化率"], ["addCartRate", "加购客户率"], ["refundPayment", "平台退款金额"],
] as const;
const extraMetrics = [
  ["pageViews", "商品浏览"], ["favorites", "收藏累计"], ["addCartCustomers", "加购客户累计"],
  ["addCartQuantity", "加购件数"], ["orderCustomers", "下单客户累计"], ["orderQuantity", "下单件数"],
  ["orderPayment", "下单金额"], ["transactionOrders", "成交订单数"], ["searchImpressions", "搜索曝光"],
  ["searchClicks", "搜索点击"], ["searchClickRate", "搜索点击率"], ["searchVisitors", "搜索访客"], ["searchCustomers", "搜索成交客户"],
] as const;
const changeLabels = {
  pairedCurrentPayment: "可比本期销售额", pairedPreviousPayment: "可比环比基期销售额",
  growthPayment: "正向增长贡献", declinePayment: "负向下降贡献", netChange: "可比净变化",
} as const;

function ProductSearch({ query, onApply }: { query: string; onApply: (query: string) => void }) {
  const [draft, setDraft] = useState(query);
  const composing = useRef(false);
  useEffect(() => setDraft(query), [query]);
  return <form className="np-integrated-search" onSubmit={event => {
    event.preventDefault();
    if (!composing.current) onApply(draft);
  }}><input aria-label="表内搜索商品名称、ID或商家码" maxLength={120} value={draft} placeholder="名称、ID、商家码 · Enter 搜索"
    onChange={event => setDraft(event.target.value)}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
    <button type="submit">搜索</button>{query && <button type="button" onClick={() => { setDraft(""); onApply(""); }}>清空</button>}
  </form>;
}

export function IntegratedProductsPerformance({ data, props, ui, onUi, onRefresh, warnings, renderRows, onSelect }: {
  data: ProductInsightsResponse; props: NetshopColumnProps; ui: ProductsUiState; onUi: ProductsUiChange;
  onRefresh: () => void; warnings: ReactNode; renderRows: (rows: ProductRow[], showDelta?: boolean) => ReactNode;
  onSelect: (row: ProductRow) => void;
}) {
  const { sections } = data;
  const structureDetails = useRef<HTMLDetailsElement>(null);
  const showDelta = ui.sort === "growth_desc" || ui.sort === "decline_desc";
  const searchScope = JSON.stringify([props.startDate, props.endDate, props.context.platforms, props.context.outlets, props.context.dimension, props.context.category]);
  const setColumnGroup = (group: "sales" | "traffic" | "comparison") => onUi({ ...ui, columns: {
    ...ui.columns, traffic: group === "traffic", comparison: group === "comparison",
  } });
  return <div className="np-integrated-performance np-stack">
    {warnings}
    <div className="np-integrated-summary"><p>概况来自完整经营范围；表内搜索只影响明细。访客与客户沿用商品×日累计口径。</p><div className="np-integrated-counts">
      <span>有数据商品 <MetricCell metric={sections.counts.dataProducts} /></span><span>成交商品 <MetricCell metric={sections.counts.tradedProducts} /></span>
    </div></div>
    <div className="np-integrated-kpis">{mainMetrics.map(([key, label]) => <ProductsMetric key={key} label={label} metric={sections.summary[key]}
      previous={sections.comparisons[key].previous} yearAgo={sections.comparisons[key].yearAgo} showPrevious={props.context.previous} showYearAgo={props.context.yearAgo} />)}</div>
    <div className="np-integrated-analysis">
      <ProductsPanel title="流量与成交效率" note="横轴访客累计 · 纵轴累计转化率 · 点击商品进入精确详情">
        {sections.efficiency ? <><ProductsScatter rows={sections.items} page={sections.pagination.page} total={sections.pagination.total} rules={sections.efficiency.rules} onSelect={onSelect} />
          <div className="np-integrated-chart-foot"><span>当前页样本，随明细搜索与翻页变化。</span><a href="#np-integrated-watchlist" onClick={() => onUi({ ...ui, topic: "traffic" })}>查看完整扫描的关注清单 ↓</a></div></> : <MissingSource title="流量分布" reason="unverified_source" />}
      </ProductsPanel>
      <aside className="np-integrated-side np-stack" aria-label="商品变化与结构">
        <ProductsPanel title="可比集合的变化" note="先按完整候选集合配对，再合计变化金额">
          {sections.structure?.changes ? <dl className="np-integrated-facts">{(["netChange", "growthPayment", "declinePayment"] as const).map(key => <div key={key}><dt>{changeLabels[key]}</dt><dd><MetricCell metric={sections.structure.changes[key]} /></dd></div>)}</dl> : <MissingSource title="变化金额" reason="unverified_source" />}
          <a href="#np-integrated-growth" onClick={() => onUi({ ...ui, topic: "growth" })}>增长 / 下降贡献明细 →</a>
        </ProductsPanel>
        <ProductsPanel title="成交集中度" note="完整经营筛选集合，独立于当前列表页">
          {sections.structure ? <ProductsBars minimumScale={1} rows={[{ label: "TOP5占比", metric: sections.structure.top5Share }, { label: "TOP10占比", metric: sections.structure.top10Share }]} /> : <MissingSource title="成交结构" reason="unverified_source" />}
          <a href="#np-integrated-structure" onClick={() => { if (structureDetails.current) structureDetails.current.open = true; }}>查看类目与价格带 ↓</a>
        </ProductsPanel>
      </aside>
    </div>
    <div id="np-integrated-list" className="np-integrated-list">
      <ProductsPanel title="商品经营明细" note="搜索不改变整期概况；商品身份与销售基础列固定保留" action={<button type="button" onClick={onRefresh}>刷新本范围</button>}>
        <div className="np-integrated-table-tools"><ProductSearch key={searchScope} query={props.context.q} onApply={q => props.onContextChange({ q, page: 1 })} />
          <select aria-label="商品明细排序" value={ui.sort} onChange={event => onUi({ ...ui, sort: event.target.value as ProductsUiState["sort"] }, { page: 1 })}>{productSortOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="商品明细每页条数" value={props.context.pageSize} onChange={event => props.onContextChange({ pageSize: Number(event.target.value), page: 1 })}>{[5, 10, 20, 50, 100].map(size => <option key={size} value={size}>{size}条/页</option>)}</select>
        </div>
        <div className="np-integrated-column-tools"><div className="np-integrated-column-groups" role="group" aria-label="商品明细指标列组">
          <button type="button" aria-pressed={!ui.columns.traffic && !ui.columns.comparison} onClick={() => setColumnGroup("sales")}>销售</button>
          <button type="button" aria-pressed={ui.columns.traffic && !ui.columns.comparison} onClick={() => setColumnGroup("traffic")}>流量</button>
          <button type="button" aria-pressed={ui.columns.comparison && !ui.columns.traffic} onClick={() => setColumnGroup("comparison")}>比较</button>
          {ui.columns.traffic && ui.columns.comparison && <span className="np-caption">组合列</span>}
        </div><details className="np-integrated-column-options"><summary>列设置</summary><div className="np-column-picker">{([["traffic", "访客 / 转化 / 加购"], ["comparison", "同比 / 环比"], ["association", "推广 / ERP关联"], ["coverage", "覆盖状态"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={ui.columns[key]} onChange={event => onUi({ ...ui, columns: { ...ui.columns, [key]: event.target.checked } })} />{label}</label>)}</div></details></div>
        {renderRows(sections.items, showDelta)}
        <InsightListPagination pagination={sections.pagination} onPage={page => props.onContextChange({ page })} />
        <p className="np-caption">排序：{productSortOptions.find(([key]) => key === data.tableScope.sort)?.[1]} · 返回 {sections.pagination.returned}/{sections.pagination.total} 条 · 比较按相同平台、店铺、维度与ID配对。</p>
      </ProductsPanel>
    </div>
    <details id="np-integrated-growth" className="np-integrated-fold" open={ui.topic === "growth"}>
      <summary><span>增长与下降贡献</span><small>完整配对集合与两期变化</small></summary><div className="np-stack np-integrated-fold-body">
        {sections.structure?.changes && <div className="np-metrics">{Object.entries(sections.structure.changes).map(([key, metric]) => <ProductsMetric key={key} label={changeLabels[key as keyof typeof changeLabels]} metric={metric} />)}</div>}
        {sections.growth.state === "ready" ? <>{renderRows(sections.growth.data.items, true)}<p className="np-caption">完整配对集合，共 {sections.growth.data.pagination.total} 条；使用商品明细的增长 / 下降排序与分页查看。百分比增幅保留零、负及缺失基期说明。</p></> : <p className="np-notice" role="status">{sections.growth.message}</p>}
      </div>
    </details>
    <details id="np-integrated-watchlist" className="np-integrated-fold" open={ui.topic === "traffic"}>
      <summary><span>流量指标与关注清单</span><small>累计指标、公开筛查规则与商品证据</small></summary><div className="np-stack np-integrated-fold-body">
        <nav className="np-integrated-topic-links" aria-label="流量专题入口"><button type="button" onClick={() => onUi({ ...ui, topic: "traffic" })}>保持展开流量专题</button><button type="button" onClick={() => onUi({ ...ui, topic: "home" })}>返回经营概览</button></nav>
        {sections.efficiency ? <><div className="np-metrics"><ProductsMetric label="成交客户累计" metric={sections.summary.customers} previous={sections.comparisons.customers.previous} yearAgo={sections.comparisons.customers.yearAgo} showPrevious={props.context.previous} showYearAgo={props.context.yearAgo} />{extraMetrics.map(([key, label]) => <ProductsMetric key={key} label={label} metric={sections.efficiency.metrics[key]} />)}
          {sections.efficiency.visitorValue && <ProductsDerivedMetric label="商品访客累计价值" metric={sections.efficiency.visitorValue} previous={sections.efficiency.visitorValueComparisons.previous} yearAgo={sections.efficiency.visitorValueComparisons.yearAgo} showPrevious={props.context.previous} showYearAgo={props.context.yearAgo} />}</div>
          <p className="np-note">同源商品×日累计，不是同一批用户的旅程漏斗。加购率使用加购客户累计 ÷ 访客累计。关注规则 {sections.efficiency.rules.id}：访客累计至少 {sections.efficiency.rules.minimumVisitors}，转化率低于 {(sections.efficiency.rules.maximumConversion * 100).toFixed(2)}%；{sections.efficiency.rules.requireComplete ? "仅纳入覆盖完整记录" : "覆盖要求见规则"}。完整扫描 {sections.efficiency.scanned} 个，命中 {sections.efficiency.qualified} 个。</p>
          {renderRows(sections.efficiency.watchlist)}<p className="np-caption">关注清单返回 {sections.efficiency.pagination.returned}/{sections.efficiency.pagination.total} 条；不是综合评分或因果诊断。</p>
        </> : <MissingSource title="流量与关注清单" reason="unverified_source" />}
      </div>
    </details>
    <details ref={structureDetails} id="np-integrated-structure" className="np-integrated-fold">
      <summary><span>商品结构与成交分类</span><small>完整集合的来源类目、价格带与两期结构</small></summary><div className="np-integrated-fold-body">
        {sections.structure ? <div className="np-integrated-structure-grid"><ProductsPanel title="类目贡献" note={sections.structure.categoryBasis === "verified_historical" ? "有版本的历史类目归属" : "来源标签分组；不作为官方或跨平台类目字典"}><ProductsBars rows={sections.structure.categories.map(row => ({ label: row.label, metric: row.payment, share: row.share }))} /></ProductsPanel>
          <ProductsPanel title="价格带" note={sections.structure.priceBasis === "transaction_mean" ? "按本期成交均价划分" : "按当前目录标价划分；不是历史价格"}><ProductsBars rows={sections.structure.priceBands.map(row => ({ label: row.label, metric: row.payment, share: row.share }))} /></ProductsPanel>
          <ProductsPanel title="两期成交分类" note="新增成交只描述两期可靠记录，不代表新品"><dl className="np-integrated-facts">{([["continuous", "持续成交商品"], ["newlyTraded", "新增成交商品"], ["noLongerTraded", "不再成交商品"], ["unknownBaseline", "基期未知商品"]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd><MetricCell metric={sections.structure.classification[key]} /></dd></div>)}</dl><p className="np-caption">已配对 {sections.structure.qualification.paired} 个；覆盖不足 {sections.structure.qualification.incomplete} 个。</p></ProductsPanel>
        </div> : <MissingSource title="贡献与结构" reason="unverified_source" />}
      </div>
    </details>
    <IntegratedEvidence title="资料质量、来源与统计口径">
      {sections.dataQuality && <ProductsPanel title="资料质量" note={`本期经营记录对应的当前目录；陈旧规则 ${sections.dataQuality.staleAfterDays} 天；只读展示`}><div className="np-metrics">{([["missingImage", "缺少图片"], ["missingCode", "缺少编码"], ["missingCategory", "缺少类目"], ["conflict", "身份冲突"], ["stale", "陈旧资料"], ["unmapped", "未关联"]] as const).map(([key, label]) => <ProductsMetric key={key} label={key === "unmapped" && sections.dataQuality.counts[key].reasonCode === "unverified_source" ? "ERP映射状态未核验" : label} metric={sections.dataQuality.counts[key]} />)}</div><p className="np-caption">质量项可能重叠，不相加当作异常商品总数；不会自动修改映射、改码、合并或删除商品。</p></ProductsPanel>}
      <p className="np-note">平台销售额、ERP净销售与广告归因成交分口径。访客和客户为商品×日累计，SKU与SPU分开统计。表内名称、ID、商家码搜索不改变概况；来源缺口、无效分母与不可比基期按原状态显示。</p>
      <ProductsCoverage context={data.context} revisions={data.joinedSourceRevisions} />
    </IntegratedEvidence>
  </div>;
}
