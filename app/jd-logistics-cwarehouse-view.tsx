"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type FormEvent } from "react";
import Link from "next/link";
import type { CurrentUser } from "./module-view-shared";
import { InventoryKpiCard } from "./module-view-business-ui";
import { SearchableSelect } from "./ui/searchable-select";
import JdLogisticsView, { requestJdLogistics } from "./jd-logistics-view";
import Dialog from "./ui/dialog";
import JdMonitorWarehouseSettings from "./jd-monitor-warehouse-settings";
import JdMonitorInactiveProducts from "./jd-monitor-inactive-products";
import JdLogisticsProductMatrix, { decodeCwarehouseProductMonitor, displayCwarehouseValue, type CwarehouseProductMonitor } from "./jd-logistics-product-matrix";
import { readJdLogisticsLocation, writeJdLogisticsLocation, jdInventoryHealthStates, jdInventoryHealthLabels, type JdInventoryHealthFilter, type JdInboundTab, type JdLogisticsFilters, type JdLogisticsOptions } from "@/lib/inventory/jd-logistics-contract";
import "./jd-logistics.css";

function followShellLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  // The shell restores its module on a full navigation or popstate, so preserve
  // the previous native-link behavior instead of only changing the query string.
  event.preventDefault();
  window.location.assign(event.currentTarget.href);
}

export type JdInventoryFileCycleProps = {
  fileSnapshot?: boolean; fileCycleDays?: number; fileCycleOptions?: readonly number[]; onFileCycleChange?: (days: number) => void;
};
export default function JdLogisticsCwarehouseView({ currentUser, fileSnapshot = false, fileCycleDays, fileCycleOptions, onFileCycleChange }: { currentUser: CurrentUser | null } & JdInventoryFileCycleProps) {
  const [tab, setTab] = useState<JdInboundTab>(() => typeof window === "undefined" ? "monitor" : readJdLogisticsLocation(window.location.href).jdTab);
  useEffect(() => {
    const restore = () => setTab(readJdLogisticsLocation(window.location.href).jdTab);
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const select = (next: JdInboundTab) => {
    if (next === tab) return;
    writeJdLogisticsLocation({ jdTab: next }); setTab(next);
  };
  return <><div className="subnav outlet-subnav" role="tablist" aria-label="京东入仓监控工作区">{([ ["monitor", "库存监控"], ["mappings", "商品对照"], ["flows", "库存流水"], ["transfers", "调拨核对"] ] as const).map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => select(key)}>{label}</button>)}</div>
    {tab === "monitor" ? <CwarehouseMonitor currentUser={currentUser} fileSnapshot={fileSnapshot} fileCycleDays={fileCycleDays} fileCycleOptions={fileCycleOptions} onFileCycleChange={onFileCycleChange} /> : <JdLogisticsView key={`${JSON.stringify(currentUser)}:${tab}`} currentUser={currentUser} fixedTab={tab} fileSnapshot={fileSnapshot} />}</>;
}

function CwarehouseMonitor({ currentUser, fileSnapshot = false, fileCycleDays, fileCycleOptions, onFileCycleChange }: { currentUser: CurrentUser | null } & JdInventoryFileCycleProps) {
  const [filters, setFilters] = useState<JdLogisticsFilters>({ departmentId: "", warehouseCode: "", startDate: "", endDate: "", q: "", page: 1 });
  const [query, setQuery] = useState("");
  const [salesWindow, setSalesWindow] = useState<7 | 30>(30);
  const [healthState, setHealthState] = useState<JdInventoryHealthFilter>("all");
  const [options, setOptions] = useState<JdLogisticsOptions | null>(null);
  const [data, setData] = useState<{ key: string; value: CwarehouseProductMonitor } | null>(null);
  const [expanded, setExpanded] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [thresholdDraft, setThresholdDraft] = useState<{ kind: "stockout" | "replenishment"; scope: string; departmentId: string; revision: number; value: string } | null>(null);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdFeedback, setThresholdFeedback] = useState<{ scope: string; message: string; error: boolean } | null>(null);
  const [warehouseDraftScope, setWarehouseDraftScope] = useState<string | null>(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const preferenceLock = useRef(false);
  const committedScope = useRef("");
  const generation = useRef(0);
  const committedPrincipal = useRef("");
  const principalKey = JSON.stringify(currentUser);
  const department = options?.departments.find(value => value.id === filters.departmentId);
  const key = JSON.stringify([principalKey, department?.id ?? "", department?.revision ?? 0, filters.warehouseCode, filters.q, filters.page, salesWindow, healthState, fileSnapshot ? fileCycleDays : null, fileSnapshot, Boolean(onFileCycleChange)]);
  const result = data?.key === key ? data.value : null;
  const canManageThreshold = !fileSnapshot && currentUser?.role === "admin";
  const canTryFileCycle = fileSnapshot && Boolean(onFileCycleChange);
  const cycleDays = fileSnapshot ? fileCycleDays ?? 30 : department?.replenishmentCycleDays ?? 30;
  const cycleOptions = fileCycleOptions?.filter(value => Number.isSafeInteger(value) && value >= 1 && value <= 3650);
  const localCycleValue = Number(thresholdDraft?.value);
  const localCycleValid = Number.isSafeInteger(localCycleValue) && localCycleValue >= 1 && localCycleValue <= 3650 && (!cycleOptions || cycleOptions.includes(localCycleValue));
  useLayoutEffect(() => { committedPrincipal.current = principalKey; committedScope.current = key; return () => { committedScope.current = ""; }; }, [key, principalKey]);
  const saveThreshold = async (event: FormEvent) => {
    event.preventDefault(); if (fileSnapshot || !thresholdDraft || thresholdSaving || preferenceLock.current || !canManageThreshold || thresholdDraft.scope !== committedScope.current) return;
    const draft = thresholdDraft;
    setThresholdSaving(true); setThresholdFeedback(null);
    try {
      const setting = draft.kind === "replenishment" ? { replenishmentCycleDays: Number(draft.value) } : { stockoutThresholdDays: draft.value === "" ? null : Number(draft.value) };
      await requestJdLogistics(new URLSearchParams(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "settings", departmentId: draft.departmentId, expectedRevision: draft.revision, ...setting }) });
      if (committedScope.current !== draft.scope) return;
      if (draft.kind === "replenishment" && Number(draft.value) !== (department?.replenishmentCycleDays ?? 30) && filters.page !== 1) update({ page: 1 });
      setThresholdDraft(null); setThresholdFeedback({ scope: draft.scope, message: `${draft.kind === "replenishment" ? "库存周转周期" : "缺货阈值"}已保存，正在回查当前范围。`, error: false }); setRefresh(value => value + 1);
    } catch (reason) { if (committedScope.current === draft.scope) setThresholdFeedback({ scope: draft.scope, message: reason instanceof Error ? reason.message : "阈值保存失败", error: true }); }
    finally { setThresholdSaving(false); }
  };
  useEffect(() => {
    const restore = () => {
      const url = new URL(window.location.href), location = readJdLogisticsLocation(url.href), restored = location.filters;
      setFilters(restored); setQuery(restored.q); setSalesWindow(url.searchParams.get("jdSalesWindow") === "7" ? 7 : 30); setHealthState(location.healthState);
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
    const params = new URLSearchParams({ operation: "inventory_monitor", layout: "product", salesWindow: String(salesWindow), healthState, departmentId: department.id, businessUnitCode: department.businessUnitCode, page: String(filters.page), pageSize: "25" });
    if (filters.warehouseCode) params.set("warehouseKey", filters.warehouseCode);
    if (filters.q) params.set("q", filters.q);
    if (fileSnapshot && fileCycleDays) params.set("replenishmentCycleDays", String(fileCycleDays));
    setLoading(true); setError("");
    requestJdLogistics<unknown>(params, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || requestId !== generation.current) return;
      const decoded = decodeCwarehouseProductMonitor(value);
      if (decoded.salesWindow !== salesWindow || decoded.healthState !== healthState) throw new Error("京东库存响应与当前销量或健康筛选不一致");
      setData({ key, value: decoded });
    }).catch(reason => { if (!controller.signal.aborted && requestId === generation.current) setError(reason instanceof Error ? reason.message : "库存单品矩阵读取失败"); })
      .finally(() => { if (!controller.signal.aborted && requestId === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [key, department, refresh, salesWindow, healthState, filters.page, filters.warehouseCode, filters.q, fileSnapshot, fileCycleDays]);
  const update = (patch: Partial<JdLogisticsFilters>, windowDays: 7 | 30 = salesWindow, nextHealth: JdInventoryHealthFilter = healthState) => {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    setFilters(next); setSalesWindow(windowDays); setHealthState(nextHealth); writeJdLogisticsLocation({ filters: next, healthState: nextHealth });
    const url = new URL(window.location.href); url.searchParams.set("jdSalesWindow", String(windowDays));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const toggleProduct = (id: string) => setExpanded(previous => {
    const ids = new Set(previous.key === key ? previous.ids : []); if (ids.has(id)) ids.delete(id); else ids.add(id);
    return { key, ids };
  });
  const savePreferences = async (values: Record<string, unknown>) => {
    if (!department || !canManageThreshold || thresholdSaving || preferenceLock.current) return false;
    const scope = key;
    preferenceLock.current = true; setPreferenceSaving(true); setThresholdFeedback(null);
    try {
      const saved = await requestJdLogistics<JdLogisticsOptions["departments"][number]>(new URLSearchParams(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "settings", departmentId: department.id, expectedRevision: department.revision, ...values }) });
      if (committedPrincipal.current !== principalKey) return false;
      const sameScope = committedScope.current === scope;
      if (sameScope) setWarehouseDraftScope(null);
      setOptions(previous => previous ? { ...previous, departments: previous.departments.map(row => row.id === saved.id && row.revision < saved.revision ? saved : row) } : previous);
      setRefresh(value => value + 1);
      return sameScope;
    } catch (reason) {
      if (committedScope.current === scope) {
        setThresholdFeedback({ scope, message: reason instanceof Error ? reason.message : "显示设置保存失败", error: true });
        throw reason;
      }
    } finally { preferenceLock.current = false; setPreferenceSaving(false); }
  };
  const monitorWarehouses = (options?.monitorWarehouses ?? []).filter(row => row.departmentId === department?.id);
  const changeProductMonitoring = canManageThreshold ? (goodsCode: string, enabled: boolean) => {
    void savePreferences({ productMonitoring: { goodsCode, enabled } }).then(saved => { if (saved) update({ page: 1 }); }).catch(() => undefined);
  } : undefined;
  const warehousePreferences = new Map((department?.warehousePreferences ?? []).map(row => [row.warehouseKey, row]));
  const warehouseRanks = new Map((department?.warehousePreferences ?? []).map((row, index) => [row.warehouseKey, index]));
  const visibleWarehouses = [...monitorWarehouses].filter(row => warehousePreferences.get(row.key)?.enabled !== false).sort((a, b) => (warehouseRanks.get(a.key) ?? 500) - (warehouseRanks.get(b.key) ?? 500) || a.name.localeCompare(b.name));
  const retry = <button type="button" className="row-action" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新数据</button>;
  const thresholdControl = <button type="button" className="row-action" disabled={!canManageThreshold || !department || thresholdSaving || preferenceSaving} onClick={() => { if (department) { setThresholdFeedback(null); setThresholdDraft({ kind: "stockout", scope: key, departmentId: department.id, revision: department.revision, value: department.stockoutThresholdDays == null ? "" : String(department.stockoutThresholdDays) }); } }}>缺货提醒阈值</button>;
  const cycleControl = <><span className="jd-cwarehouse-cycle-current">当前 {cycleDays} 天</span><button type="button" className="secondary-button jd-cwarehouse-cycle-button" disabled={(!canManageThreshold && !canTryFileCycle) || !department || thresholdSaving || preferenceSaving} onClick={() => { if (department) { setThresholdFeedback(null); setThresholdDraft({ kind: "replenishment", scope: key, departmentId: department.id, revision: department.revision, value: String(cycleDays) }); } }}>库存周转设置</button></>;
  return <div className="jd-logistics-module">
    <section className="panel jd-logistics-heading"><div><h2>库存监控</h2><p>单品横向看库存分布，展开查看分仓销量、周转与建议补货。</p></div><div className="jd-logistics-heading-actions">{cycleControl}{thresholdControl}<button type="button" className="secondary-button" disabled={!canManageThreshold || !department || preferenceSaving || thresholdSaving || !options?.monitorWarehouses} onClick={() => setWarehouseDraftScope(key)}>仓库设置</button>{retry}</div></section>
    <section className="panel jd-logistics-filters jd-cwarehouse-product-filters" aria-label="京东库存单品筛选">
      <label><span>事业部库存池</span><SearchableSelect ariaLabel="京东库存事业部" value={department?.id ?? ""} options={[{ value: "", label: "请选择事业部" }, ...(options?.departments ?? []).map(row => ({ value: row.id, label: `${row.name} · ${row.businessUnitCode}` }))]} onChange={value => update({ departmentId: value, warehouseCode: "" })} /></label>
      <label><span>仓库范围</span><SearchableSelect ariaLabel="京东库存仓库" value={filters.warehouseCode} options={[{ value: "", label: "全部仓库" }, ...(options?.monitorWarehouses ? visibleWarehouses : options?.warehouses ?? []).map(row => ({ value: row.key ?? `code:${row.code}`, label: warehousePreferences.get(row.key ?? "")?.displayName || row.name }))]} onChange={value => update({ warehouseCode: value })} /></label>
      <div className="jd-cwarehouse-window"><span>销量窗口</span><div role="group" aria-label="京东库存销量窗口">{([7, 30] as const).map(days => <button type="button" key={days} aria-pressed={salesWindow === days} className={salesWindow === days ? "active" : ""} onClick={() => update({}, days)}>{days}日</button>)}</div></div>
      <form onSubmit={event => { event.preventDefault(); update({ q: query.trim() }); }}><label><span>商品搜索，Enter 确认</span><input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} /></label></form>
      <footer className="jd-cwarehouse-filter-footer"><span>按来源省市或仓库展示；店铺归属未确认的商品不自动分配店铺。库存健康独立于缺货消息提醒设置。</span></footer>
    </section>
    <section className="panel jd-cwarehouse-health-filter"><div className="jd-cwarehouse-health-tabs" role="tablist" aria-label="库存健康筛选">{(["all", ...jdInventoryHealthStates] as const).map(state => <button type="button" key={state} role="tab" aria-selected={healthState === state} className={healthState === state ? "active" : ""} disabled={!department} onClick={() => { if (state !== healthState) update({}, salesWindow, state); }}><span>{jdInventoryHealthLabels[state]}</span><strong>{result ? displayCwarehouseValue(result.healthFilterCounts[state]) : "—"}</strong></button>)}</div><p>按当前事业部、仓库与商品搜索的完整范围计数；缺货与补货可重叠，筛选保留商品全部分仓。</p></section>
    {optionsError && <div className="inventory-feedback inventory-feedback-error" role="alert">{optionsError} {retry}</div>}
    {!options && !optionsError && <section className="panel data-state" role="status">正在读取物流账号…</section>}
    {options && !department && <section className="panel data-state"><strong>{options.departments.length ? "请选择事业部库存池" : "尚无C仓来源数据"}</strong><p>来源准备完成后，可在数据导入模块上传实时库存及库存快照。</p></section>}
    {thresholdFeedback?.scope === key && <div className={`inventory-feedback ${thresholdFeedback.error ? "inventory-feedback-error" : ""}`} role={thresholdFeedback.error ? "alert" : "status"}>{thresholdFeedback.message}</div>}
    {department && <>
      <section className="inventory-kpi-grid jd-logistics-c-kpis"><InventoryKpiCard label="当前范围单品" value={result ? displayCwarehouseValue(result.total) : "—"} note="服务端按单品分组后分页" tone="blue" icon="货" /><InventoryKpiCard label="当前范围可用库存" value={result ? displayCwarehouseValue(result.totals.availableQuantity) : "—"} note="完整筛选范围，非当前页合计" tone="green" icon="仓" /><InventoryKpiCard label="提醒命中仓项" value={department.stockoutThresholdDays == null ? "—" : result ? displayCwarehouseValue(result.summary.stockoutRiskCount) : "—"} note={department.stockoutThresholdDays == null ? "消息提醒阈值未配置，库存健康独立判断" : "按消息提醒阈值判断，独立于库存健康"} tone="orange" icon="险" /></section>
      <section className="inventory-feedback inventory-feedback-warning"><div><strong>来源与提醒</strong><p>{result ? "实时与快照日期分别展示，缺失数据以 — 表示。" : "当前范围数据尚未核实。"} {result?.notificationAvailable ? "专用钉钉渠道已启用；实际发送以投递结果为准。" : "专用钉钉渠道未启用；页面风险提示不代表已发送。"}</p>{result?.coverageWarnings.length ? <details><summary>查看指标口径与来源限制</summary><p>{result.coverageWarnings.join("；")}</p></details> : null}</div></section>
      <section className="panel table-panel" aria-busy={loading}><div className="table-toolbar"><div><h2>单品库存分布</h2><p>主行显示可用库存及非零在途；点左侧 + 查看分仓详情。管理员可拖动商品左侧手柄调整顺序。{loading && result ? " 正在刷新当前范围…" : ""}</p></div><Link prefetch={false} onClick={followShellLink} className="secondary-button" href="/?module=import&view=files&jdImport=logistics">导入来源数据</Link></div>
        {error && <div className="inventory-feedback inventory-feedback-error" role="alert">{error} {retry}</div>}
        {result ? <JdLogisticsProductMatrix data={result} expandedIds={expanded.key === key ? expanded.ids : new Set()} onToggle={toggleProduct} canReorder={canManageThreshold && !loading && !preferenceSaving && !thresholdSaving} onMove={(goodsCode, targetGoodsCode, placement) => { void savePreferences({ productMove: { goodsCode, targetGoodsCode, placement } }).catch(() => undefined); }} onMonitoringChange={changeProductMonitoring} monitoringDisabled={loading || preferenceSaving || thresholdSaving} />
          : loading ? <div className="jd-cwarehouse-loading" role="status" aria-label="正在加载单品矩阵"><span>正在读取完整范围的单品与来源列…</span>{[0, 1, 2, 3].map(row => <i key={row} aria-hidden="true" />)}</div>
          : <div className="table-state">{error ? "当前范围无法核实，请重试。" : "当前范围尚未读取。"}</div>}
        <footer className="jd-sku-pagination"><span>{result ? `${result.total} 个单品 · 第 ${result.page} / ${Math.max(1, Math.ceil(result.total / result.pageSize))} 页 · ${result.columns.length} 个来源列` : "—"}</span><div><button type="button" className="row-action" disabled={loading || !result || result.page <= 1} onClick={() => update({ page: filters.page - 1 })}>上一页</button><button type="button" className="row-action" disabled={loading || !result || result.page * result.pageSize >= result.total} onClick={() => update({ page: filters.page + 1 })}>下一页</button></div></footer>
      </section>
      {result && <JdMonitorInactiveProducts key={JSON.stringify([principalKey, department.id, department.revision, filters.warehouseCode, filters.q, salesWindow])}
        count={result.inactiveTotal ?? 0} departmentId={department.id} businessUnitCode={department.businessUnitCode}
        warehouseKey={filters.warehouseCode} query={filters.q} salesWindow={salesWindow} refresh={refresh}
        disabled={preferenceSaving || thresholdSaving} onMonitoringChange={changeProductMonitoring} />}
    </>}
    {warehouseDraftScope === key && department && <JdMonitorWarehouseSettings key={key} department={department} warehouses={monitorWarehouses} saving={preferenceSaving} onClose={() => setWarehouseDraftScope(null)} onSave={async warehousePreferences => { if (await savePreferences({ warehousePreferences })) update({ warehouseCode: "", page: 1 }); }} />}
    <Dialog open={Boolean(thresholdDraft && thresholdDraft.scope === key)} dialogId="jd-cwarehouse-threshold" ariaLabel={thresholdDraft?.kind === "replenishment" ? "库存周转设置" : "京东入仓缺货阈值"} className="panel jd-logistics-dialog" onClose={() => { if (!thresholdSaving) setThresholdDraft(null); }}>
      {thresholdDraft && thresholdDraft.scope === key && <form onSubmit={saveThreshold}><header><h2>{thresholdDraft.kind === "replenishment" ? "库存周转设置" : "京东入仓缺货阈值"}</h2><button type="button" className="row-action" disabled={thresholdSaving} onClick={() => setThresholdDraft(null)}>关闭</button></header>
        <p>{thresholdDraft.kind === "replenishment" ? "库存周转周期指目标覆盖天数，默认30天，可手动输入1–3650之间的任意整数天数。以近30日销量计算目标备货，扣除可用库存、采购及调拨在途，逐仓缺口向上取整；不改变销量展示窗口或缺货提醒阈值。" : "只调整所选事业部的30日可用库存可售天数阈值，不改动其他来源配置。"}</p>
        <div className="jd-logistics-fields"><label><span>{thresholdDraft.kind === "replenishment" ? "库存周转周期（天）" : "30日可用库存可售天数阈值（留空关闭）"}</span>
          {canTryFileCycle && thresholdDraft.kind === "replenishment" && cycleOptions ? <select value={thresholdDraft.value} onChange={event => setThresholdDraft({ ...thresholdDraft, value: event.target.value })}>{cycleOptions.map(days => <option key={days} value={days}>{days}天</option>)}</select>
            : <input type="number" min="1" max="3650" step="1" required={thresholdDraft.kind === "replenishment"} disabled={(!canManageThreshold && !(canTryFileCycle && thresholdDraft.kind === "replenishment")) || thresholdSaving} value={thresholdDraft.value} onChange={event => setThresholdDraft({ ...thresholdDraft, value: event.target.value })} />}
        </label></div>{thresholdFeedback?.scope === key && thresholdFeedback.error && <p role="alert" className="jd-logistics-error">{thresholdFeedback.message}</p>}
        <footer><small>{fileSnapshot ? "仅试算当前HTML中的预计算数据，不保存到正式系统。" : "保存按当前版本校验，成功后回查当前范围。"}</small>
          {fileSnapshot ? <button type="button" className="primary-button" disabled={!canTryFileCycle || thresholdDraft.kind !== "replenishment" || !localCycleValid} onClick={() => { if (thresholdDraft.scope !== committedScope.current || thresholdDraft.kind !== "replenishment" || !canTryFileCycle || !localCycleValid) return; onFileCycleChange?.(localCycleValue); setThresholdDraft(null); }}>应用本地试算</button>
            : <button type="submit" className="primary-button" disabled={!canManageThreshold || thresholdSaving}>{thresholdSaving ? "保存中…" : "保存并回查"}</button>}
        </footer></form>}
    </Dialog>
  </div>;
}
