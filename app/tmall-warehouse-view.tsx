"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/http/api-client";
import { tmallWarehouseQuantityKeys, tmallWarehouseQuantityLabels, type TmallWarehouseRow, type TmallWarehouseTotals } from "@/lib/inventory/tmall-warehouse-contract";
import { InventoryKpiCard } from "./module-view-business-ui";
import { type CurrentUser, shanghaiIsoToday } from "./module-view-shared";
import "./tmall-warehouse.css";

async function tmallJson<T>(url: string, init?: Parameters<typeof requestJson>[1]): Promise<T> {
  const envelope = await requestJson<{ success: boolean; data: T }>(url, init);
  if (envelope?.success !== true || !envelope.data || typeof envelope.data !== "object") throw new Error("天猫库存响应格式不完整");
  return envelope.data;
}

type Warehouse = TmallWarehouseRow & { warehouseKey: string; turnoverDays: number | null; suggestedQuantity: number | null };
type Product = { owner: string; goodsId: string; goodsCode: string; goodsName: string; snapshotDate: string; warehouses: Warehouse[]; totals: TmallWarehouseTotals };
type Monitor = { items: Product[]; total: number; returned: number; page: number; pageSize: number; totals: TmallWarehouseTotals; asOf: { owner: string; snapshotDate: string }[] };
type Batch = { id: string; owner: string; snapshotDate: string; fileName: string; rowCount: number; status: string; createdAt: string; isCurrent?: boolean };
type Batches = { items: Batch[]; total: number; page: number; pageSize: number };
type Options = { owners: string[]; warehouses: string[]; scopeRevisions?: Record<string, number> };
type Tab = "monitor" | "import" | "batches";
function readTab(): Tab {
  const value = typeof window === "undefined" ? "" : new URL(window.location.href).searchParams.get("tmView");
  return value === "import" || value === "batches" ? value : "monitor";
}
const matrixMetrics = { availableQuantity: "现有可销库存", sales30dQuantity: "30天销量", purchaseInTransitQuantity: "采购在途", transferInTransitQuantity: "调拨在途", suggestedQuantity: "建议补货", turnoverDays: "现30天周转天数" } as const;
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
function initialFilters() {
  const url = typeof window === "undefined" ? null : new URL(window.location.href);
  const page = Number(url?.searchParams.get("tmPage") ?? 1);
  return { owner: url?.searchParams.get("tmOwner") ?? "", warehouse: url?.searchParams.get("tmWarehouse") ?? "", q: url?.searchParams.get("tmQ") ?? "", page: Number.isInteger(page) && page > 0 ? page : 1 };
}
export default function TmallWarehouseView({ currentUser, presentation }: { currentUser: CurrentUser | null; presentation?: "import" | "batches" }) {
  const [tab, setTab] = useState<Tab>(presentation ?? readTab);
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState(filters.q);
  const [options, setOptions] = useState<Options>({ owners: [], warehouses: [] });
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [result, setResult] = useState<Monitor | null>(null);
  const [batches, setBatches] = useState<Batches | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<keyof typeof matrixMetrics>("availableQuantity");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [owner, setOwner] = useState("");
  const [snapshotDate, setSnapshotDate] = useState(shanghaiIsoToday);
  const [collectedAt, setCollectedAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const generation = useRef(0), uploadGeneration = useRef(0);
  const canImport = currentUser?.role === "admin";
  const principalKey = JSON.stringify(currentUser);
  useEffect(() => { if (presentation) setTab(presentation); }, [presentation]);
  useEffect(() => {
    const restore = () => { const next = initialFilters(); setFilters(next); setSearch(next.q); setExpanded(new Set()); if (!presentation) setTab(readTab()); };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [presentation]);
  useEffect(() => {
    uploadGeneration.current++; setFile(null); setFeedback(""); setOwner(""); setOptionsLoaded(false); setOptions({ owners: [], warehouses: [] });
    // This ref is a monotonic request fence, deliberately invalidated on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { uploadGeneration.current++; };
  }, [principalKey]);
  useEffect(() => {
    const controller = new AbortController();
    tmallJson<Options>("/api/inventory/tmall-warehouse?operation=options", { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(value.owners) || !Array.isArray(value.warehouses)) throw new Error("天猫筛选选项格式不完整");
      setOptions(value);
      setOptionsLoaded(true);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "筛选选项加载失败"); });
    return () => controller.abort();
  }, [principalKey, retry]);
  useEffect(() => {
    const controller = new AbortController(), id = ++generation.current;
    setResult(null); setBatches(null); setLoading(true); setError("");
    const params = new URLSearchParams({ operation: tab === "monitor" ? "monitor" : "batches", page: String(filters.page), pageSize: "30" });
    for (const key of ["owner", "warehouse", "q"] as const) if (filters[key]) params.set(key, filters[key]);
    tmallJson<Monitor | Batches>(`/api/inventory/tmall-warehouse?${params}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || id !== generation.current) return;
      if (!Array.isArray(value.items) || !Number.isSafeInteger(value.total) || value.total < 0) throw new Error("天猫库存响应格式不完整");
      if (tab === "monitor") setResult(value as Monitor); else setBatches(value as Batches);
    }).catch(reason => { if (!controller.signal.aborted && id === generation.current) setError(reason instanceof Error ? reason.message : "天猫库存加载失败"); }).finally(() => { if (id === generation.current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [filters, tab, retry, principalKey]);
  function update(patch: Partial<typeof filters>, nextTab: Tab = tab) {
    const next = { ...filters, ...patch }; if (!("page" in patch)) next.page = 1;
    const url = new URL(window.location.href);
    if (!presentation) { if (nextTab === "monitor") url.searchParams.delete("tmView"); else url.searchParams.set("tmView", nextTab); }
    for (const [key, value] of Object.entries({ tmOwner: next.owner, tmWarehouse: next.warehouse, tmQ: next.q, tmPage: next.page === 1 ? "" : String(next.page) })) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`); setFilters(next); setExpanded(new Set());
  }
  async function importFile() {
    if (!file || !owner.trim() || !canImport || uploading || !optionsLoaded) return;
    const id = ++uploadGeneration.current;
    setUploading(true); setFeedback("");
    try {
      const form = new FormData(); form.append("file", file);
      form.append("metadata", JSON.stringify({ owner: owner.trim(), snapshotDate, expectedScopeRevision: options.scopeRevisions?.[owner.trim()] ?? 0, ...(collectedAt ? { collectedAt: `${collectedAt}:00+08:00` } : {}) }));
      const response = await tmallJson<{ batchId: string; status: string; rowCount: number }>("/api/inventory/tmall-warehouse", { method: "POST", body: form });
      const params = new URLSearchParams({ operation: "batches", owner: owner.trim(), batchId: response.batchId });
      const proof = await tmallJson<Batches>(`/api/inventory/tmall-warehouse?${params}`);
      if (proof.items.length !== 1 || proof.items[0].id !== response.batchId || proof.items[0].rowCount !== response.rowCount || proof.items[0].snapshotDate !== snapshotDate) throw new Error("导入响应已返回，但批次回查未通过；请先查看运行记录，勿重复提交");
      if (id !== uploadGeneration.current) return;
      setFeedback(`${response.status === "duplicate" ? "内容已存在" : "导入完成"}，已回查批次 ${response.batchId}，共 ${number(response.rowCount)} 条分仓明细。`); setFile(null); setRetry(value => value + 1);
    } catch (reason) { if (id === uploadGeneration.current) setFeedback(reason instanceof Error ? reason.message : "导入失败，请核对运行记录"); }
    finally { if (id === uploadGeneration.current) setUploading(false); }
  }
  const allWarehouses = [...new Map((result?.items ?? []).flatMap(product => product.warehouses.map(row => [row.warehouseKey, row] as const))).values()];
  const total = tab === "monitor" ? result?.total : batches?.total;
  return <div className="tmall-warehouse-module">
    {!presentation && <div className="subnav outlet-subnav" role="tablist" aria-label="天猫入仓工作区">{([["monitor", "库存监控"], ["import", "文件导入"], ["batches", "运行记录"]] as const).map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key} className={tab === key ? "active" : ""} disabled={uploading} onClick={() => { setTab(key); update({ page: 1 }, key); }}>{label}</button>)}</div>}
    <section className="panel tmall-warehouse-heading"><div><h2>天猫入仓监控</h2><p>实仓良品实时库存 · 单品看分仓，展开查看库存、在途与周转依据。</p></div><div><Link className="secondary-button" prefetch={false} href="/?module=n8n_workflows&view=tmall_warehouse">导入工作流</Link><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)} disabled={loading}>刷新</button></div></section>
    <section className="panel tmall-warehouse-filters" aria-label="天猫入仓筛选"><label>货主<select aria-label="货主" value={filters.owner} onChange={event => update({ owner: event.target.value })}><option value="">全部货主</option>{options.owners.map(value => <option key={value}>{value}</option>)}</select></label><label>仓库<select aria-label="仓库" value={filters.warehouse} onChange={event => update({ warehouse: event.target.value })}><option value="">全部仓库</option>{options.warehouses.map(value => <option key={value}>{value}</option>)}</select></label><form onSubmit={event => { event.preventDefault(); update({ q: search.trim() }); }}><label>货品搜索<input aria-label="货品搜索" value={search} placeholder="货品 ID、编码或名称，回车查询" onChange={event => setSearch(event.target.value)} /></label><button className="secondary-button">查询</button></form></section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><div><strong>请求失败</strong><p>{error}</p></div><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>重试</button></section>}
    {tab === "import" && <section className="panel tmall-warehouse-import"><h2>导入天猫原始库存表</h2><p>自动采集由 n8n 完成；也可上传原始导出 XLSX。货主与快照日期独立隔离，相同内容自动返回已有批次。</p>{!canImport && <p role="note">仅管理员可导入，当前账号可查看监控和运行记录。</p>}<div className="tmall-import-fields"><label>来源货主<input value={owner} onChange={event => setOwner(event.target.value)} placeholder="与后台登录企业或报表货主一致" disabled={!canImport || uploading} /></label><label>快照日期<input type="date" value={snapshotDate} max={shanghaiIsoToday()} onChange={event => setSnapshotDate(event.target.value)} disabled={!canImport || uploading} /></label><label>实际采集时刻（上海）<input type="datetime-local" value={collectedAt} onChange={event => setCollectedAt(event.target.value)} disabled={!canImport || uploading} /></label><label>原始 Excel<input type="file" accept=".xlsx" onChange={event => { setFile(event.target.files?.[0] ?? null); setFeedback(""); }} disabled={!canImport || uploading} /></label></div><p>实时表无日期列时必须填写实际采集时刻；含来源日期的历史表必须与快照日期一致。近30天销量缺失时，周转与建议补货保留为空。</p><button className="primary-button" type="button" disabled={!canImport || uploading || !file || !owner.trim() || !optionsLoaded} onClick={() => void importFile()}>{uploading ? "导入并回查中…" : "校验并导入"}</button>{feedback && <p role="status">{feedback}</p>}</section>}
    {tab === "monitor" && <>
      <section className="inventory-kpi-grid"><InventoryKpiCard label="当前范围单品" value={number(result?.total)} note="完整筛选范围" tone="blue" icon="品" /><InventoryKpiCard label="实仓可销" value={number(result?.totals.availableQuantity)} note="未知不作为零；部分覆盖保留为空" tone="green" icon="仓" /><InventoryKpiCard label="采购在途" value={number(result?.totals.purchaseInTransitQuantity)} note="原始报表数量" tone="purple" icon="途" /><InventoryKpiCard label="调拨在途" value={number(result?.totals.transferInTransitQuantity)} note="独立于采购在途" tone="orange" icon="调" /></section>
      <section className="panel"><div className="table-toolbar"><div><h2>单品分仓库存</h2><p>{result?.asOf?.map(value => `${value.owner} · ${value.snapshotDate}`).join("；") || "尚无天猫库存快照"}</p></div><label className="tmall-metric-select">分仓显示<select aria-label="分仓显示" value={metric} onChange={event => setMetric(event.target.value as keyof typeof matrixMetrics)}>{Object.entries(matrixMetrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><div className="tmall-warehouse-table-scroll"><table className="data-table tmall-warehouse-matrix"><thead><tr><th>货品</th><th>货主</th>{allWarehouses.map(row => <th key={row.warehouseKey} title={row.warehouse}>{row.region || row.warehouse}<small>{row.region ? row.warehouse : matrixMetrics[metric]}</small></th>)}<th>可销合计</th><th>30天销量</th><th>采购在途</th><th>调拨在途</th></tr></thead><tbody>{result?.items.map(product => {
        const key = JSON.stringify([product.owner, product.goodsId]), open = expanded.has(key);
        return <Fragment key={key}><tr><td><button type="button" className="row-action tmall-product-title" title={product.goodsName} aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{open ? "▾" : "▸"} {product.goodsName}</button><small>{product.goodsId}{product.goodsCode ? ` · ${product.goodsCode}` : ""}</small></td><td>{product.owner}</td>{allWarehouses.map(warehouse => <td key={warehouse.warehouseKey}>{number(product.warehouses.find(row => row.warehouseKey === warehouse.warehouseKey)?.[metric])}</td>)}<td><strong>{number(product.totals.availableQuantity)}</strong></td><td>{number(product.totals.sales30dQuantity)}</td><td>{number(product.totals.purchaseInTransitQuantity)}</td><td>{number(product.totals.transferInTransitQuantity)}</td></tr>{open && <tr className="tmall-warehouse-detail"><td colSpan={allWarehouses.length + 6}><div className="tmall-warehouse-table-scroll"><table className="data-table"><thead><tr><th>仓库</th>{tmallWarehouseQuantityKeys.map(field => <th key={field}>{tmallWarehouseQuantityLabels[field]}</th>)}<th>30天周转</th><th>建议补货</th></tr></thead><tbody>{product.warehouses.map(row => <tr key={row.warehouseKey}><td title={row.warehouse}>{row.warehouse}</td>{tmallWarehouseQuantityKeys.map(field => <td key={field}>{number(row[field])}</td>)}<td>{row.turnoverDays == null ? "暂无依据" : `${number(row.turnoverDays)} 天`}</td><td>{row.suggestedQuantity == null ? "暂无依据" : number(row.suggestedQuantity)}</td></tr>)}</tbody></table></div><p>建议补货按每仓近30天销量 × 30天覆盖目标减可销、采购在途和调拨在途，最低为0；必需数据缺失时不计算。手动补货计划沿用“备货计划”。</p></td></tr>}</Fragment>;
      })}</tbody></table></div>{!loading && !result?.items.length && !error && <div className="data-state"><strong>暂无匹配的天猫库存</strong><p>通过 n8n 导入工作流或文件导入后显示；可调整货主、仓库和搜索条件。</p></div>}</section>
    </>}
    {tab === "batches" && <section className="panel"><div className="table-toolbar"><h2>天猫入仓导入记录</h2></div><div className="tmall-warehouse-table-scroll"><table className="data-table"><thead><tr><th>批次</th><th>货主</th><th>快照日期</th><th>来源文件</th><th>明细数</th><th>状态</th></tr></thead><tbody>{batches?.items.map(batch => <tr key={batch.id}><td>{batch.id}</td><td>{batch.owner}</td><td>{batch.snapshotDate}</td><td>{batch.fileName}</td><td>{number(batch.rowCount)}</td><td>{batch.isCurrent ? "当前快照" : batch.status === "completed" ? "已导入" : batch.status}</td></tr>)}</tbody></table></div>{!loading && !batches?.items.length && !error && <div className="data-state">暂无天猫入仓导入批次</div>}</section>}
    {loading && tab !== "import" && <p role="status">正在读取天猫库存…</p>}
    {tab !== "import" && <div className="table-pagination"><span>共 {number(total)} {tab === "monitor" ? "个单品" : "个批次"} · 第 {filters.page} 页</span><button type="button" className="secondary-button" disabled={loading || filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>上一页</button><button type="button" className="secondary-button" disabled={loading || total == null || filters.page * 30 >= total} onClick={() => update({ page: filters.page + 1 })}>下一页</button></div>}
  </div>;
}
