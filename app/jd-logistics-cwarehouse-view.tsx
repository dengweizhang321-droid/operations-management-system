"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import type { CurrentUser } from "./module-view-shared";
import { InventoryKpiCard } from "./module-view-business-ui";
import { SearchableSelect } from "./ui/searchable-select";
import { requestJdLogistics } from "./jd-logistics-view";
import JdLogisticsProductMatrix, { decodeCwarehouseProductMonitor, displayCwarehouseValue, type CwarehouseProductMonitor } from "./jd-logistics-product-matrix";
import { readJdLogisticsLocation, writeJdLogisticsLocation, type JdLogisticsFilters, type JdLogisticsOptions } from "@/lib/inventory/jd-logistics-contract";
import "./jd-logistics.css";

function followShellLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  // The shell restores its module on a full navigation or popstate, so preserve
  // the previous native-link behavior instead of only changing the query string.
  event.preventDefault();
  window.location.assign(event.currentTarget.href);
}

export default function JdLogisticsCwarehouseView({ currentUser }: { currentUser: CurrentUser | null }) {
  const [filters, setFilters] = useState<JdLogisticsFilters>({ departmentId: "", warehouseCode: "", startDate: "", endDate: "", q: "", page: 1 });
  const [query, setQuery] = useState("");
  const [salesWindow, setSalesWindow] = useState<7 | 30>(30);
  const [options, setOptions] = useState<JdLogisticsOptions | null>(null);
  const [data, setData] = useState<{ key: string; value: CwarehouseProductMonitor } | null>(null);
  const [expanded, setExpanded] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const principalKey = JSON.stringify(currentUser);
  const department = options?.departments.find(value => value.id === filters.departmentId);
  const key = JSON.stringify([principalKey, department?.id ?? "", filters.warehouseCode, filters.q, filters.page, salesWindow]);
  const result = data?.key === key ? data.value : null;
  useEffect(() => {
    const restore = () => {
      const url = new URL(window.location.href), restored = readJdLogisticsLocation(url.href).filters;
      setFilters(restored); setQuery(restored.q); setSalesWindow(url.searchParams.get("jdSalesWindow") === "7" ? 7 : 30);
    };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setOptionsError("");
    requestJdLogistics<JdLogisticsOptions>(new URLSearchParams({ operation: "options" }), { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(value.departments) || !Array.isArray(value.warehouses)) throw new Error("物流账号响应不完整");
      setOptions(value);
    }).catch(reason => { if (!controller.signal.aborted) setOptionsError(reason instanceof Error ? reason.message : "物流账号读取失败"); });
    return () => controller.abort();
  }, [principalKey, refresh]);
  useEffect(() => {
    if (!department) { setLoading(false); return; }
    const controller = new AbortController(), requestId = ++generation.current;
    const params = new URLSearchParams({ operation: "inventory_monitor", layout: "product", salesWindow: String(salesWindow), departmentId: department.id, businessUnitCode: department.businessUnitCode, page: String(filters.page), pageSize: "25" });
    if (filters.warehouseCode) params.set("warehouseKey", filters.warehouseCode);
    if (filters.q) params.set("q", filters.q);
    setLoading(true); setError("");
    requestJdLogistics<unknown>(params, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || requestId !== generation.current) return;
      const decoded = decodeCwarehouseProductMonitor(value);
      if (decoded.salesWindow !== salesWindow) throw new Error("C仓销量窗口响应与当前筛选不一致");
      setData({ key, value: decoded });
    }).catch(reason => { if (!controller.signal.aborted && requestId === generation.current) setError(reason instanceof Error ? reason.message : "C仓单品矩阵读取失败"); })
      .finally(() => { if (!controller.signal.aborted && requestId === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [key, department, refresh, salesWindow, filters.page, filters.warehouseCode, filters.q]);
  const update = (patch: Partial<JdLogisticsFilters>, windowDays: 7 | 30 = salesWindow) => {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    setFilters(next); setSalesWindow(windowDays); writeJdLogisticsLocation({ filters: next });
    const url = new URL(window.location.href); url.searchParams.set("jdSalesWindow", String(windowDays));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const toggleProduct = (id: string) => setExpanded(previous => {
    const ids = new Set(previous.key === key ? previous.ids : []); if (ids.has(id)) ids.delete(id); else ids.add(id);
    return { key, ids };
  });
  const retry = <button type="button" className="row-action" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新数据</button>;
  return <div className="jd-logistics-module">
    <section className="panel jd-logistics-heading"><div><h2>京东 C仓监控</h2><p>单品横向看分布，展开查看分仓依据；实时与快照分别标注日期。</p></div>{retry}</section>
    <section className="panel jd-logistics-filters jd-cwarehouse-product-filters" aria-label="C仓单品筛选">
      <label><span>事业部库存池</span><SearchableSelect ariaLabel="C仓事业部" value={department?.id ?? ""} options={[{ value: "", label: "请选择事业部" }, ...(options?.departments ?? []).map(row => ({ value: row.id, label: `${row.name} · ${row.businessUnitCode}` }))]} onChange={value => update({ departmentId: value, warehouseCode: "" })} /></label>
      <label><span>仓库范围</span><SearchableSelect ariaLabel="C仓仓库" value={filters.warehouseCode} options={[{ value: "", label: "全部仓库" }, ...(options?.warehouses ?? []).map(row => ({ value: row.key ?? `code:${row.code}`, label: row.code ? `${row.name} · ${row.code}` : `${row.name}（来源仓名）` }))]} onChange={value => update({ warehouseCode: value })} /></label>
      <div className="jd-cwarehouse-window"><span>销量窗口</span><div role="group" aria-label="C仓销量窗口">{([7, 30] as const).map(days => <button type="button" key={days} aria-pressed={salesWindow === days} className={salesWindow === days ? "active" : ""} onClick={() => update({}, days)}>{days}日</button>)}</div></div>
      <form onSubmit={event => { event.preventDefault(); update({ q: query.trim() }); }}><label><span>商品搜索，Enter 确认</span><input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} /></label></form>
      <footer className="jd-cwarehouse-filter-footer"><span>按来源省市或仓库展示；店铺归属未确认的商品不自动分配店铺。</span><div aria-label="健康标记说明"><span className="status status-danger">缺货风险</span><span className="status status-warning">待补充依据</span><span className="status status-success">未触发阈值</span></div></footer>
    </section>
    {optionsError && <div className="inventory-feedback inventory-feedback-error" role="alert">{optionsError} {retry}</div>}
    {!options && !optionsError && <section className="panel data-state" role="status">正在读取物流账号…</section>}
    {options && !department && <section className="panel data-state"><strong>{options.departments.length ? "请选择事业部库存池" : "尚未配置C仓来源账号"}</strong><p>先登记来源账号并导入实时库存及库存快照，才能形成单品矩阵。</p><Link prefetch={false} onClick={followShellLink} className="secondary-button" href="/?module=inventory&view=inbound&jdInbound=pop&jdPopTab=settings">账号与阈值设置</Link></section>}
    {department && <>
      <section className="inventory-kpi-grid jd-logistics-c-kpis"><InventoryKpiCard label="当前范围单品" value={result ? displayCwarehouseValue(result.total) : "—"} note="服务端按单品分组后分页" tone="blue" icon="货" /><InventoryKpiCard label="当前范围可用库存" value={result ? displayCwarehouseValue(result.totals.availableQuantity) : "—"} note="完整筛选范围，非当前页合计" tone="green" icon="仓" /><InventoryKpiCard label="缺货风险仓项" value={result ? displayCwarehouseValue(result.summary.stockoutRiskCount) : "—"} note="按30日可用库存可售天数阈值判断" tone="orange" icon="险" /></section>
      <section className="inventory-feedback inventory-feedback-warning"><div><strong>来源与提醒</strong><p>{result ? "实时与快照日期分别展示，缺失数据以 — 表示。" : "当前范围数据尚未核实。"} {result?.notificationAvailable ? "专用钉钉渠道已启用；实际发送以投递结果为准。" : "专用钉钉渠道未启用；页面风险提示不代表已发送。"}</p>{result?.coverageWarnings.length ? <details><summary>查看指标口径与来源限制</summary><p>{result.coverageWarnings.join("；")}</p></details> : null}</div><Link prefetch={false} onClick={followShellLink} className="row-action" href="/?module=inventory&view=inbound&jdInbound=pop&jdPopTab=settings">阈值设置</Link></section>
      <section className="panel table-panel" aria-busy={loading}><div className="table-toolbar"><div><h2>单品库存分布</h2><p>每行一个京东 SKU，点左侧 + 展开分仓；可用、采购在途和调拨在途分开展示。{loading && result ? " 正在刷新当前范围…" : ""}</p></div><Link prefetch={false} onClick={followShellLink} className="secondary-button" href="/?module=inventory&view=inbound&jdInbound=pop&jdPopTab=batches">导入来源数据</Link></div>
        {error && <div className="inventory-feedback inventory-feedback-error" role="alert">{error} {retry}</div>}
        {result ? <JdLogisticsProductMatrix data={result} expandedIds={expanded.key === key ? expanded.ids : new Set()} onToggle={toggleProduct} />
          : loading ? <div className="jd-cwarehouse-loading" role="status" aria-label="正在加载单品矩阵"><span>正在读取完整范围的单品与来源列…</span>{[0, 1, 2, 3].map(row => <i key={row} aria-hidden="true" />)}</div>
          : <div className="table-state">{error ? "当前范围无法核实，请重试。" : "当前范围尚未读取。"}</div>}
        <footer className="jd-sku-pagination"><span>{result ? `${result.total} 个单品 · 第 ${result.page} / ${Math.max(1, Math.ceil(result.total / result.pageSize))} 页 · ${result.columns.length} 个来源列` : "—"}</span><div><button type="button" className="row-action" disabled={loading || !result || result.page <= 1} onClick={() => update({ page: filters.page - 1 })}>上一页</button><button type="button" className="row-action" disabled={loading || !result || result.page * result.pageSize >= result.total} onClick={() => update({ page: filters.page + 1 })}>下一页</button></div></footer>
      </section>
    </>}
  </div>;
}
