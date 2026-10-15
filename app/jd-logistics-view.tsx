"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CurrentUser } from "./module-view-shared";
import { shanghaiIsoToday, addIsoDays } from "./module-view-shared";
import { SearchableSelect } from "./ui/searchable-select";
import Dialog from "./ui/dialog";
import { JD_LOGISTICS_PATH, jdLogisticsSources, jdLogisticsSourceLabels, readJdLogisticsLocation, writeJdLogisticsLocation,
  type JdLogisticsDepartment, type JdLogisticsOptions, type JdLogisticsItem, type JdLogisticsList,
  type JdLogisticsFilters, type JdLogisticsTab, type JdLogisticsSource } from "@/lib/inventory/jd-logistics-contract";
import "./jd-logistics.css";

const tabLabels: Record<JdLogisticsTab, string> = { flows: "库存流水", transfers: "调拨核对", mappings: "商品对照", batches: "京东物流导入记录" };
const emptyFilters: JdLogisticsFilters = { departmentId: "", warehouseCode: "", startDate: "", endDate: "", q: "", page: 1 };
const text = (value: unknown): string => value === null || value === undefined || value === "" ? "—" : Array.isArray(value) ? value.map(text).join("、") : typeof value === "object" ? "—" : String(value);
const statusLabels: Record<string, string> = { pending: "待核对", completed: "人工已调拨", ignored: "已忽略", confirmed: "已确认", unconfirmed: "待维护", in_transit: "已出库在途", partial: "部分入库", quantity_anomaly: "数量异常", review: "待检查", imported: "已导入", duplicate: "内容重复" };
const label = (value: unknown) => statusLabels[String(value)] ?? text(value);
const rowRecord = (value: unknown): JdLogisticsItem => value && typeof value === "object" && !Array.isArray(value) ? value as JdLogisticsItem : {};

export async function requestJdLogistics<T>(query: URLSearchParams, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${JD_LOGISTICS_PATH}?${query}`, { ...init, cache: "no-store" });
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.success !== true) throw new Error(value?.message || value?.error || `京东物流请求失败（${response.status}）`);
  if (!value.data || value.data.contractVersion !== "jd-logistics-v1" || value.data.mode !== "live") throw new Error("京东物流响应契约无效，请检查服务版本");
  return value.data as T;
}

type Editor = { operation: "mapping" | "manual"; row: JdLogisticsItem; draft: Record<string, string | boolean> };
export default function JdLogisticsView({ currentUser, customStartDate, customEndDate, fixedTab = "mappings", presentation = "table" }: {
  currentUser: CurrentUser | null; customStartDate?: string; customEndDate?: string; fixedTab?: JdLogisticsTab; presentation?: "table" | "import" | "records";
}) {
  const tab = fixedTab;
  const [filters, setFilters] = useState<JdLogisticsFilters>({ ...emptyFilters, startDate: customStartDate ?? "", endDate: customEndDate ?? "" });
  const [queryDraft, setQueryDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [options, setOptions] = useState<JdLogisticsOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [result, setResult] = useState<{ key: string; data: JdLogisticsList } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [editError, setEditError] = useState("");
  const canManage = currentUser?.role === "admin" || currentUser?.role === "operator";
  const canImport = currentUser?.role === "admin";
  const principalKey = JSON.stringify(currentUser);
  const generation = useRef(0);
  const currentScope = useRef("");

  useEffect(() => {
    const restore = () => {
      const location = readJdLogisticsLocation(window.location.href);
      setFilters({ ...location.filters, startDate: location.filters.startDate || customStartDate || "", endDate: location.filters.endDate || customEndDate || "" });
      setQueryDraft(location.filters.q); setEditor(null); setFeedback(""); setReady(true);
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [fixedTab, customStartDate, customEndDate]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsError("");
    requestJdLogistics<JdLogisticsOptions>(new URLSearchParams({ operation: "options" }), { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(value.departments) || !Array.isArray(value.warehouses) || !Array.isArray(value.scopeRevisions)) throw new Error("账号或导入范围响应不完整");
      setOptions(value);
    }).catch(reason => { if (!controller.signal.aborted) setOptionsError(reason instanceof Error ? reason.message : "账号读取失败"); });
    return () => controller.abort();
  }, [principalKey, refresh]);

  const department = options?.departments.find(value => value.id === filters.departmentId);
  const effectiveFilters = { ...filters, departmentId: department?.id ?? "" };
  const requestKey = JSON.stringify([principalKey, tab, presentation, effectiveFilters]);
  useLayoutEffect(() => {
    currentScope.current = requestKey;
    return () => { currentScope.current = ""; };
  }, [requestKey]);
  const list = result?.key === requestKey ? result.data : null;
  useEffect(() => {
    if (!ready || !options || !department || presentation === "import") { setLoading(false); return; }
    const id = ++generation.current;
    const controller = new AbortController();
    const query = new URLSearchParams({ operation: tab, departmentId: department.id, businessUnitCode: department.businessUnitCode, page: String(filters.page), pageSize: "50" });
    if (tab === "flows" || tab === "transfers") {
      if (filters.warehouseCode) query.set("warehouseCode", filters.warehouseCode);
      if (filters.startDate) query.set("startDate", filters.startDate);
      if (filters.endDate) query.set("endDate", addIsoDays(filters.endDate, 1));
    }
    if (tab !== "batches" && filters.q) query.set("q", filters.q);
    setLoading(true); setError("");
    requestJdLogistics<JdLogisticsList>(query, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || id !== generation.current) return;
      if (!Array.isArray(value.items) || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pageSize)) throw new Error("京东物流列表响应不完整");
      setResult({ key: requestKey, data: value });
    }).catch(reason => { if (!controller.signal.aborted && id === generation.current) setError(reason instanceof Error ? reason.message : "列表读取失败"); })
      .finally(() => { if (!controller.signal.aborted && id === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [requestKey, ready, options, refresh, tab, presentation, department, filters.page, filters.warehouseCode, filters.startDate, filters.endDate, filters.q]);

  const changeFilters = (patch: Partial<JdLogisticsFilters>) => {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    setFilters(next); setFeedback(""); setEditor(null); writeJdLogisticsLocation({ filters: next });
  };
  const startEdit = (operation: Editor["operation"], row: JdLogisticsItem) => {
    const draft: Editor["draft"] = operation === "mapping"
      ? { erpGoodsCode: String(row.erpGoodsCode ?? ""), erpGoodsName: String(row.erpGoodsName ?? ""), status: row.status === "ignored" ? "ignored" : "confirmed", note: String(row.note ?? "") }
      : { transferStatus: String(row.transferStatus ?? "pending"), erpDocumentNo: String(row.erpDocumentNo ?? ""), note: String(row.note ?? "") };
    setEditor({ operation, row, draft }); setEditError("");
  };
  const saveEditor = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || saving) return;
    const scope = requestKey;
    const body = { operation: editor.operation, departmentId: editor.row.departmentId ?? department?.id, goodsCode: editor.row.goodsCode, documentNo: editor.row.documentNo,
        ...(editor.operation === "mapping" ? { goodsCodeKind: editor.row.goodsCodeKind ?? "department_product" } : {}),
        ...editor.draft, expectedRevision: editor.row.revision ?? 0, ...(editor.operation === "manual" ? { expectedFlowRevision: editor.row.flowRevision } : {}) };
    setSaving(true); setEditError("");
    try {
      await requestJdLogistics(new URLSearchParams(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (currentScope.current !== scope) return;
      setEditor(null); setFeedback("保存成功，正在回查当前范围。"); setRefresh(value => value + 1);
    } catch (reason) { if (currentScope.current === scope) setEditError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSaving(false); }
  };
  const retry = <button type="button" className="row-action" onClick={() => setRefresh(value => value + 1)} disabled={loading || saving}>刷新</button>;
  const cell = (row: JdLogisticsItem, key: string) => <td key={key}>{text(row[key])}</td>;
  let columns: string[] = [], renderRow: (row: JdLogisticsItem) => ReactNode = () => null;
  if (tab === "flows") {
    columns = ["业务时间", "京东单据", "事业部商品 / 名称", "仓库", "业务类型", "库存状态 / 类型", "实际期初 / 变动 / 结存", "可用期初 / 变动 / 结存", "渠道 / 单位"];
    renderRow = row => <>{cell(row, "businessTime")}{cell(row, "documentNo")}<td><strong>{text(row.goodsCode)}</strong><small className="cell-note">{text(row.goodsName)}</small></td><td>{text(row.warehouseName)}<small className="cell-note">{text(row.warehouseCode)}</small></td>{cell(row, "businessType")}<td>{text(row.inventoryStatus)} / {text(row.inventoryType)}</td><td>{text(row.actualBegin)} / {text(row.actualChange)} / {text(row.actualEnd)}</td><td>{text(row.availableBegin)} / {text(row.availableChange)} / {text(row.availableEnd)}</td><td>{text(row.channel)} / {text(row.unit)}</td></>;
  } else if (tab === "transfers") {
    columns = ["京东调拨单 / 商品", "调出 / 调入仓库", "调出 / 实收", "京东状态", "ERP货品", "人工ERP调拨状态", "人工ERP单号", "最近业务", "操作"];
    renderRow = row => <><td><strong>{text(row.documentNo)}</strong><small className="cell-note">{text(row.goodsCode)} · {text(row.goodsName)}</small></td><td>{text(row.outWarehouses)}<small className="cell-note">→ {text(row.inWarehouses)}</small></td><td>{text(row.outQuantity)} / {text(row.inQuantity)}</td><td>{row.jdStatus === "completed" ? "京东已完成" : label(row.jdStatus)}</td><td>{text(row.erpGoodsCode)}<small className="cell-note">{text(row.erpGoodsName)}</small></td><td>{label(row.transferStatus)}{row.needsReview === true && <small className="cell-note">源流水已变化，需复核</small>}</td>{cell(row, "erpDocumentNo")}{cell(row, "lastBusinessTime")}<td><button className="row-action" type="button" disabled={!canManage || saving} onClick={() => startEdit("manual", row)}>维护状态</button></td></>;
  } else if (tab === "mappings") {
    columns = ["事业部商品", "商家商品标识", "ERP货品编号（C）", "ERP货品名称（D）", "映射状态", "店铺商品关系", "备注", "操作"];
    renderRow = row => <><td><strong>{row.goodsCode ? text(row.goodsCode) : "事业部商品未提供"}</strong><small className="cell-note">{text(row.goodsName)} · {row.goodsCodeKind === "jd_sku" ? "京东SKU" : "事业部商品"}</small></td>{cell(row, "merchantMark")}{cell(row, "erpGoodsCode")}{cell(row, "erpGoodsName")}<td>{label(row.status)}</td><td>{Array.isArray(row.shopLinks) && row.shopLinks.length ? row.shopLinks.map((link, i) => { const r = rowRecord(link); return <small className="cell-note" key={i}>{r.platform ? text(r.platform) : "平台来源未提供"} · {text(r.shopName)}<br />ESG {text(r.shopProductCode)} · SKU {text(r.platformSku)} · ISV {text(r.isvCode)}</small>; }) : "未导入店铺商品关系"}{row.shopLinksTruncated === true && <small className="cell-note">仅显示前100条关系，共{text(row.shopLinkCount)}条</small>}</td>{cell(row, "note")}<td><button type="button" className="row-action" disabled={!canManage || saving || !row.goodsCode || row.mappingAllowed === false} onClick={() => startEdit("mapping", row)}>维护映射</button></td></>;
  } else if (tab === "batches") {
    columns = ["导入批次", "来源", "业务范围（结束日不含）", "行数", "结果", "导入时间"];
    renderRow = row => <><td>{text(row.batchId)}<small className="cell-note">{text(row.fileName)}</small></td><td>{jdLogisticsSourceLabels[row.sourceKind as JdLogisticsSource] ?? text(row.sourceKind)}</td><td>{text(row.rangeStart)} → {text(row.rangeEnd)}</td>{cell(row, "rowCount")}<td>{label(row.status)}</td>{cell(row, "createdAt")}</>;
  }

  return <div className="jd-logistics-module">
    <section className="panel jd-logistics-heading"><div><h2>{presentation === "import" ? "京东物流文件导入" : tab === "mappings" ? "京东 POP · 商品对照" : tabLabels[tab]}</h2><p>按事业部读取权威来源；人工核对状态不代表ERP实际建单或过账。</p></div>{retry}</section>
    {optionsError && <section className="inventory-feedback inventory-feedback-error" role="alert"><div><strong>物流账号读取失败</strong><p>{optionsError}</p></div>{retry}</section>}
    {feedback && <div className="inventory-feedback" role="status">{feedback}</div>}
    <section className="panel jd-logistics-filters" aria-label="京东物流筛选"><label><span>事业部 / 来源账号</span><SearchableSelect ariaLabel="京东物流事业部" value={effectiveFilters.departmentId} disabled={saving || !options} options={[{ value: "", label: "请选择已登记事业部" }, ...(options?.departments ?? []).map(item => ({ value: item.id, label: `${item.name} · ${item.businessUnitCode}` }))]} onChange={value => changeFilters({ departmentId: value, warehouseCode: "" })} /></label>
      {(tab === "flows" || tab === "transfers") && <><label><span>京东仓库</span><SearchableSelect ariaLabel="京东物流仓库" value={filters.warehouseCode} disabled={saving || !department} options={[{ value: "", label: "全部仓库" }, ...(options?.warehouses ?? []).filter(item => item.code).map(item => ({ value: item.code, label: `${item.name} · ${item.code}` }))]} onChange={value => changeFilters({ warehouseCode: value })} /></label>
      <label><span>业务开始日</span><input type="date" value={filters.startDate} disabled={saving} max={filters.endDate || undefined} onChange={event => changeFilters({ startDate: event.target.value })} /></label><label><span>业务结束日</span><input type="date" value={filters.endDate} disabled={saving} min={filters.startDate || undefined} onChange={event => changeFilters({ endDate: event.target.value })} /></label>
      </>}{tab !== "batches" && <form onSubmit={event => { event.preventDefault(); changeFilters({ q: queryDraft.trim() }); }}><label><span>商品 / 单据，Enter 确认</span><input type="search" maxLength={100} value={queryDraft} disabled={saving} onChange={event => setQueryDraft(event.target.value)} /></label></form>}
    </section>
    {!options && !optionsError && <section className="panel data-state" role="status">正在读取物流账号…</section>}
    {options && options.departments.length === 0 && <section className="panel data-state"><strong>暂无可用物流来源</strong><p>请通过既有受控来源配置准备事业部数据。</p></section>}
    {options && options.departments.length > 0 && !department && <section className="panel data-state"><strong>请选择事业部</strong><p>按真实事业部身份读取流水、商品关系和导入批次。</p></section>}
    {tab === "batches" && presentation === "import" && department && options && (canImport ? <JdLogisticsImportPanel department={department} options={options} canImport={canImport} onCompleted={() => setRefresh(value => value + 1)} /> : <section className="panel data-state"><strong>文件导入仅管理员可操作</strong><p>当前账号可在运行记录中查看京东物流批次。</p></section>)}
    {presentation !== "import" && department && <section className="panel table-panel" aria-busy={loading}><div className="table-toolbar"><div><h2>{tabLabels[tab]}</h2><p>{tab === "transfers" ? "按事业部 + 京东单据 + 事业部商品分行维护；人工已调拨不等于ERP已过账。" : "查询结果来自当前事业部的权威导入数据。"}</p></div><span className="soft-tag">{list ? `${list.items.length} / ${list.total} 条` : "尚未读取"}</span></div>
      {error && <div className="inventory-feedback inventory-feedback-error" role="alert">{error} {retry}</div>}
      <div className="data-table-wrap"><table className="data-table jd-logistics-table"><thead><tr>{columns.map(value => <th key={value}>{value}</th>)}</tr></thead><tbody>{list?.items.map((row, index) => <tr key={String(row.id ?? row.batchId ?? row.sourceRelationKey ?? `${row.goodsCode}:${index}`)}>{renderRow(row)}</tr>)}{!list?.items.length && <tr><td colSpan={columns.length}><div className="table-state">{loading ? "正在读取当前范围…" : error ? "当前范围数据无法核实，请重试。" : "当前范围暂无已导入数据。"}</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>{list ? `第 ${list.page} 页 · 共 ${list.total} 条${list.truncated ? "（范围截断）" : ""}` : "—"}</span><div><button className="row-action" disabled={saving || loading || !list || list.page <= 1} onClick={() => changeFilters({ page: filters.page - 1 })}>上一页</button><button className="row-action" disabled={saving || loading || !list || list.page * list.pageSize >= list.total} onClick={() => changeFilters({ page: filters.page + 1 })}>下一页</button></div></footer>
    </section>}
    <Dialog open={Boolean(editor)} dialogId="jd-logistics-editor" ariaLabel={editor?.operation === "mapping" ? "维护ERP商品映射" : "维护ERP人工调拨状态"} className="panel jd-logistics-dialog" onClose={() => { if (!saving) setEditor(null); }}>
      {editor && <form onSubmit={saveEditor}><header><h2>{editor.operation === "mapping" ? "维护ERP商品映射" : "维护人工ERP调拨状态"}</h2><button type="button" className="row-action" disabled={saving} onClick={() => setEditor(null)}>关闭</button></header><p>{`稳定商品键：${text(editor.row.goodsCode)}${editor.row.documentNo ? ` · ${text(editor.row.documentNo)}` : ""}`}</p><div className="jd-logistics-fields">
          {editor.operation === "mapping" ? <><label><span>ERP货品编号（C）</span><input value={String(editor.draft.erpGoodsCode)} maxLength={160} disabled={saving} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, erpGoodsCode: event.target.value } })} /></label><label><span>ERP货品名称（D）</span><input value={String(editor.draft.erpGoodsName)} maxLength={300} disabled={saving} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, erpGoodsName: event.target.value } })} /></label><label><span>映射状态</span><select value={String(editor.draft.status)} disabled={saving} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, status: event.target.value } })}><option value="confirmed">已确认</option><option value="ignored">忽略</option></select></label></>
          : <><label><span>人工ERP调拨状态（C）</span><select value={String(editor.draft.transferStatus)} disabled={saving} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, transferStatus: event.target.value } })}><option value="pending">待核对</option><option value="completed">人工已调拨</option><option value="ignored">忽略</option></select></label><label><span>人工记录的ERP单号</span><input value={String(editor.draft.erpDocumentNo)} disabled={saving} maxLength={160} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, erpDocumentNo: event.target.value } })} /></label></>}
        <label className="jd-logistics-wide"><span>核对备注</span><textarea maxLength={1000} value={String(editor.draft.note)} disabled={saving} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, note: event.target.value } })} /></label>
      </div>{editError && <p role="alert" className="jd-logistics-error">{editError}</p>}<footer><small>保存按服务端版本核验；冲突时请关闭并刷新后重试。</small><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存并回查"}</button></footer></form>}
    </Dialog>
  </div>;
}

function JdLogisticsImportPanel({ department, options, canImport, onCompleted }: { department: JdLogisticsDepartment; options: JdLogisticsOptions; canImport: boolean; onCompleted: () => void }) {
  const [source, setSource] = useState<JdLogisticsSource>("flow");
  const [start, setStart] = useState(shanghaiIsoToday);
  const [end, setEnd] = useState(shanghaiIsoToday);
  const [file, setFile] = useState<File | null>(null);
  const [complete, setComplete] = useState(false);
  const [collectedAt, setCollectedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const scopeKey = `${department.id}:${source}`;
  const scope = useRef(scopeKey);
  useLayoutEffect(() => {
    scope.current = scopeKey;
    return () => { scope.current = ""; };
  }, [scopeKey]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setFile(null); setComplete(false); setFeedback(""); setError(""); if (input.current) input.current.value = ""; }, [scopeKey]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!file || busy || !canImport || !complete) return;
    const key = scopeKey;
    const scopeRevision = options.scopeRevisions.find(row => row.departmentId === department.id && row.sourceKind === source)?.revision ?? 0;
    const body = new FormData(); body.append("file", file);
    body.append("metadata", JSON.stringify({ operation: "import", sourceKind: source, departmentId: department.id, businessUnitCode: department.businessUnitCode,
      origin: "manual", rangeStart: start, rangeEnd: addIsoDays(end, 1), warehouseCode: "", complete: true, expectedScopeRevision: scopeRevision,
      ...(source === "realtime_inventory" ? { collectedAt: `${collectedAt.length === 16 ? `${collectedAt}:00` : collectedAt}+08:00` } : {}) }));
    setBusy(true); setError(""); setFeedback("");
    try {
      const result = await requestJdLogistics<JdLogisticsItem>(new URLSearchParams(), { method: "POST", body });
      if (scope.current !== key) return;
      const batch = rowRecord(result.batch);
      setFeedback(`服务端已接受并落库：${text(result.batchId ?? batch.batchId)}；${label(result.status ?? batch.status)}。正在回查导入记录。`);
      setFile(null); setComplete(false); if (input.current) input.current.value = ""; onCompleted();
    } catch (reason) { if (scope.current === key) setError(reason instanceof Error ? reason.message : "导入失败；请先查批次，勿重复提交未知结果"); }
    finally { setBusy(false); }
  };
  return <section className="panel jd-logistics-import"><div className="table-toolbar"><div><h2>导入京东物流报表</h2><p>支持原始XLSX（40MiB）及流水/店铺商品CSV（8MiB，严格UTF-8/GB18030），最多20,000行。CSV编码字段保持文本；文件未提供的平台/ISV/组合标志保持未知。{source === "shop_products" ? "当前接口只接收事业部启用关系全集；停用或混合状态文件不可导入。缺失的平台归属保持未知。" : ""}业务范围必须与完整文件一致，结束日包含当天。原Excel的数字型编码仅保留已存精确整数，无法恢复未存的前导零。</p></div></div><form onSubmit={submit}><fieldset disabled={!canImport || busy}><div className="jd-logistics-fields"><label><span>报表来源</span><select value={source} onChange={event => setSource(event.target.value as JdLogisticsSource)}>{jdLogisticsSources.map(key => <option key={key} value={key}>{jdLogisticsSourceLabels[key]}</option>)}</select></label><label><span>来源事业部</span><input readOnly value={`${department.name} · ${department.businessUnitCode}`} /></label><label><span>范围开始日期</span><input required type="date" value={start} max={end} onChange={event => { setStart(event.target.value); setComplete(false); }} /></label><label><span>范围结束日期（包含）</span><input required type="date" value={end} min={start} onChange={event => { setEnd(event.target.value); setComplete(false); }} /></label>{source === "realtime_inventory" && <label className="jd-logistics-wide"><span>文件实际采集时刻（上海时间，非历史快照日）</span><input required type="datetime-local" value={collectedAt} onChange={event => { setCollectedAt(event.target.value); setComplete(false); if (event.target.value) { setStart(event.target.value.slice(0, 10)); setEnd(event.target.value.slice(0, 10)); } }} /></label>}<label className="jd-logistics-wide"><span>原始导出文件</span><input ref={input} required type="file" accept={["flow", "shop_products"].includes(source) ? ".xlsx,.csv" : ".xlsx"} onChange={event => { setFile(event.target.files?.[0] ?? null); setComplete(false); setError(""); }} /></label><label className="jd-logistics-wide jd-logistics-check"><input required type="checkbox" checked={complete} onChange={event => setComplete(event.target.checked)} /><span>{source === "shop_products" ? "本人确认文件是所选事业部启用商品关系全集，非停用或混合状态。缺事业部列采用人工声明，来源身份仍未核实。" : "本人确认以上事业部归属及完整日期、全部仓库范围。原文件缺事业部列时采用此人工声明，来源身份仍标为未核实。"}</span></label></div></fieldset>{!canImport && <p>当前账号只读；正式文件导入仅管理员可操作。</p>}{error && <p role="alert" className="jd-logistics-error">{error}；若请求结果未知，请先刷新导入记录。</p>}{feedback && <p role="status">{feedback}</p>}<footer><small>保留原文件哈希与服务端批次；自动化开关不会因手工导入而开启。</small><button type="submit" className="primary-button" disabled={!canImport || busy || !file || !complete}>{busy ? "解析并导入中…" : "校验并导入"}</button></footer></form></section>;
}
