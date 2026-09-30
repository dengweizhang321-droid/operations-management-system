"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type InsightsContext } from "@/lib/netshop/insights-contract";
import { resolveNetshopPeriods } from "@/lib/netshop/periods";
import { SearchableMultiSelect } from "../../ui/searchable-select";
import StatisticalPeriodPicker from "../../statistical-period-picker";
import { shanghaiIsoToday } from "../../module-view-shared";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightFilterBar } from "../shared/components";
import { ProductDetail } from "./ProductDetail";
import { ProductsCatalog } from "./ProductsCatalog";
import { ProductsPerformance } from "./ProductsPerformance";
import { PeriodContext } from "./ProductsPrimitives";
import { productPrincipalKey } from "./ProductsRead";
import { decodeProductsUiState, defaultProductsUiState, productsUiStorageKey, type ProductsUiState } from "./ui-state";
import "./products.css";

function usePresentation(key: string) {
  const [stored, setStored] = useState<{ key: string; value: ProductsUiState }>({ key: "", value: defaultProductsUiState });
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(key); } catch { /* Blocked browser storage only affects presentation restoration. */ }
    setStored({ key, value: decodeProductsUiState(raw) });
  }, [key]);
  const save = (value: ProductsUiState) => {
    const normalized = decodeProductsUiState(JSON.stringify(value));
    setStored({ key, value: normalized });
    try { sessionStorage.setItem(key, JSON.stringify(normalized)); } catch { /* No business results are stored. */ }
  };
  return [stored.key === key ? stored.value : defaultProductsUiState, save] as const;
}

/** Registered by I as the active products slot. The shared shell owns the
 * system/navigation header, dates/history and the exact drill/return route. */
export function ProductsColumn(props: NetshopColumnProps) {
  const principal = productPrincipalKey(props);
  const localKey = productsUiStorageKey(props.context, props.startDate, props.endDate, principal, props.periodKind);
  const [ui, onUi] = usePresentation(localKey);
  const [dateOpen, setDateOpen] = useState(false);
  const [options, setOptions] = useState<{ principal: string; shops: string[]; categories: string[] }>({ principal: "", shops: [], categories: [] });
  const [readContext, setReadContext] = useState<{ key: string; value: InsightsContext } | null>(null);
  const onContextAvailable = useCallback((value: InsightsContext, categories: string[]) => {
    setReadContext({ key: localKey, value });
    setOptions(before => ({ principal, shops: [...new Set([...(before.principal === principal ? before.shops : []), ...value.effectiveScope.shopKeys])], categories: [...new Set([...(before.principal === principal ? before.categories : []), ...categories])] }));
  }, [localKey, principal]);
  const onShops = useCallback((shops: string[]) => setOptions(before => ({ principal, shops: [...new Set([...(before.principal === principal ? before.shops : []), ...shops])], categories: before.principal === principal ? before.categories : [] })), [principal]);
  const availableShops = [...new Set([...(options.principal === principal ? options.shops : []), ...props.context.outlets])];
  const view = props.context.product ? "detail" : props.context.section === "catalog" ? "catalog" : "performance";
  const currentPeriods = useMemo(() => {
    if (readContext?.key === localKey) return readContext.value.periods;
    try { return resolveNetshopPeriods(props.startDate, props.endDate, props.periodKind); } catch { return null; }
  }, [localKey, props.endDate, props.periodKind, props.startDate, readContext]);
  const today = shanghaiIsoToday(), maxDate = props.endDate > today ? props.endDate : today;
  return <div className="netshop-products" data-column="products">
    <div className="np-title-row"><div><div className="np-eyebrow">均衡经营台</div><h1>商品表现</h1><p className="np-subtitle">经营表现、单品详情与货品档案</p></div><div className="np-toolbar"><button type="button" onClick={() => props.onNavigate("import", props.context.dimension === "sku" ? "jd_sku_daily" : props.context.platforms.length === 1 && props.context.platforms[0] === "京东" ? "jd_spu_daily" : "tmall_product_daily")}>数据导入</button></div></div>
    <nav className="np-tabs" aria-label="商品二级页"><button type="button" className={view === "performance" ? "np-active" : ""} aria-pressed={view === "performance"} onClick={() => { if (props.context.product && props.context.returnTo) props.onReturn(); else props.onContextChange({ product: null, section: "", page: 1 }); }}>经营表现</button><button type="button" className={view === "detail" ? "np-active" : ""} aria-pressed={view === "detail"} disabled={!props.context.product} title={!props.context.product ? "从商品明细选择精确商品后进入" : undefined}>单品详情</button><button type="button" className={view === "catalog" ? "np-active" : ""} aria-pressed={view === "catalog"} onClick={() => props.onContextChange({ product: null, section: "catalog", page: 1 })}>货品档案</button></nav>
    <InsightFilterBar sticky={false} label="商品经营范围"><div className="np-filters">
      <label>平台<SearchableMultiSelect values={props.context.platforms} options={[{ value: "京东", label: "京东" }, { value: "天猫", label: "天猫" }]} ariaLabel="商品平台" allLabel="全部授权平台" onChange={values => props.onContextChange({ platforms: values as typeof props.context.platforms, outlets: props.context.outlets.filter(outlet => !values.length || values.includes(outlet.split("\u001f")[0])), dimension: values.includes("天猫") || values.length === 0 ? "spu" : props.context.dimension, product: null, page: 1 })} /></label>
      <label>店铺<SearchableMultiSelect values={props.context.outlets} options={availableShops.filter(key => !props.context.platforms.length || props.context.platforms.includes(key.split("\u001f")[0] as "京东" | "天猫")).map(key => ({ value: key, label: key.replace("\u001f", " · ") }))} ariaLabel="商品店铺" allLabel="全部授权店铺" maxSelections={50} onChange={outlets => props.onContextChange({ outlets, product: null, page: 1 })} /></label>
      <label className="np-date-label date-selector">本期<button type="button" aria-label="选择商品统计期间" aria-expanded={dateOpen} disabled={!props.onApplyPeriod} onClick={() => setDateOpen(value => !value)}>{props.startDate} — {props.endDate}</button>{dateOpen && props.onApplyPeriod && <StatisticalPeriodPicker minDate="0002-01-01" maxDate={maxDate} startDate={props.startDate} endDate={props.endDate} periodIntent={props.periodKind === "rolling" || props.periodKind === "quarter" ? props.periodKind : undefined} onCancel={() => setDateOpen(false)} onApply={(start, end, intent) => { setDateOpen(false); props.onApplyPeriod?.(start, end, intent); }} />}</label>
      {view !== "catalog" && <label>商品维度<select aria-label="商品经营维度" value={props.context.dimension} onChange={event => props.onContextChange({ dimension: event.target.value as "sku" | "spu", product: null, page: 1 })}><option value="spu">SPU</option><option value="sku" disabled={props.context.platforms.length === 0 || props.context.platforms.includes("天猫")}>京东SKU</option></select></label>}
      {view === "performance" && <label>经营类目标签<input list="products-category-labels" aria-label="经营类目标签" value={props.context.category} maxLength={120} placeholder="全部类目标签" onChange={event => props.onContextChange({ category: event.target.value, page: 1 })} /><datalist id="products-category-labels">{(options.principal === principal ? options.categories : []).map(category => <option key={category} value={category} />)}</datalist></label>}
      {view !== "catalog" && <fieldset><legend>两期比较</legend><label><input type="checkbox" checked={props.context.previous} onChange={event => props.onContextChange({ previous: event.target.checked })} />环比</label><label><input type="checkbox" checked={props.context.yearAgo} onChange={event => props.onContextChange({ yearAgo: event.target.checked })} />同比</label></fieldset>}
      <label>状态<select aria-label="完整状态筛选尚未具备" disabled><option>完整状态筛选待启用</option></select></label>
      <label>ERP映射<select aria-label="完整ERP映射筛选尚未具备" disabled><option>完整映射筛选待启用</option></select></label>
      <label>资料质量<select aria-label="完整资料质量筛选尚未具备" disabled><option>完整质量筛选待启用</option></select></label>
    </div></InsightFilterBar>
    {view !== "catalog" && (currentPeriods ? <PeriodContext periods={currentPeriods} previous={props.context.previous} yearAgo={props.context.yearAgo} dimension={props.context.dimension} /> : <p className="np-notice" role="status">所选本期 {props.startDate} — {props.endDate} 超出新商品经营的日期范围或期间规则；来源读取会明确报告错误。</p>)}
    {view === "performance" ? <ProductsPerformance props={props} ui={ui} onUi={onUi} onContextAvailable={onContextAvailable} /> : view === "detail" ? <ProductDetail key={JSON.stringify(props.context.product)} props={props} ui={ui} onUi={onUi} onContextAvailable={onContextAvailable} /> : <ProductsCatalog props={props} ui={ui} onUi={onUi} onShops={onShops} />}
  </div>;
}

export default ProductsColumn;
