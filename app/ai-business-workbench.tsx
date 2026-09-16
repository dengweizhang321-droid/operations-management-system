"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import "./ai-business-workbench.css";

type Shop = { platform: string; shop: string; datasets: string[]; salesChannels: string[] };
type Market = { platform: string; category: string; scope: string; rankingDimension: string; priceBandFilter: string };
type Request = { question: string; startDate: string; endDate: string; shops: Shop[]; windows: string[]; markets: Market[] };
type Source = { key: string; domain: string; query: Record<string, string> };
type Preview = { principalKey: string; canCollect: boolean; planDigest: string; request: Request; evidenceRequest: Record<string, unknown>; capacity: Record<string, number>; limitations: string[]; coverage: { domain: string; query: Record<string, string>; status: string; availability: string; reason: string; sourceKey?: string }[] };
type Collection = { status: string; errorCode?: string; consecutiveFailures?: number; nextAttemptAt?: string };
type Item = { id: string; clientRequestId?: string; question?: string; status: string; version: number; collection: Collection; createdAt: string; storedBytes: number; sourceCount?: number; completedSources?: number; rowCount?: number };
type Detail = Item & { plan: { schemaVersion?: string; analysisRequest?: { question: string }; sources?: Source[]; sourceCount?: number; catalogDigest?: string; collector?: { version: number; surface: string; pageSize: number } }; sources: Record<string, { pageCount: number; rowCount: number; complete: boolean }> };
type DirectoryPage = { schemaVersion: string; runId: string; evidenceVersion: number; catalogDigest: string; offset: number; total: number; returned: number; nextOffset: number | null; items: (Source & { ordinal: number })[] };
type Report = { id: string; workflowId: string; status: string; createdAt: string };
type Pending = { schemaVersion: 1; principalKey: string; kind: "evidence" | "report"; bodyJson: string; label: string; createdAt: string; outcome: "prepared" | "unknown" };
const names: Record<string, string> = { current: "本期", previous: "环比", yearAgo: "同比", promotion: "推广与关键词", master: "商品主数据", sku: "SKU 销售", spu: "SPU 销售", b2b: "B 端销售", collecting: "采集中", queued: "等待后台采集", reading: "后台读取中", paused: "已暂停", sealed: "证据已封存", cancelled: "已取消", completed: "已完成", running: "分析中", planned: "已列入计划", unsupported: "不支持", not_collected: "尚未取数" };
const initial = (): Request => ({ question: "", startDate: "", endDate: "", shops: [{ platform: "京东", shop: "", datasets: ["promotion", "master"], salesChannels: [] }], windows: ["current"], markets: [] });
const storageKey = (key: string) => "ai-business-workbench-pending-v1:"+key;
const message = (error: unknown) => error instanceof Error ? error.message : "请求失败，请刷新后核验状态。";
const summary = (query: Record<string, string>) => Object.entries(query).map(([key, value]) => `${({ platform: "平台", shop: "店铺", dataset: "数据集", channel: "ERP渠道", category: "类目", scope: "范围", rankingDimension: "榜单维度", priceBandFilter: "价格带", startDate: "开始", endDate: "结束", window: "周期" } as Record<string, string>)[key] ?? key}：${["dataset", "window"].includes(key) ? names[value] ?? value : value}`).join(" · ");
function TextInput({ label, value, onChange, type = "text", maxLength = 100 }: { label: string; value: string; onChange: (value: string) => void; type?: string; maxLength?: number }) {
  return <label>{label}<input aria-label={label} required value={value} maxLength={maxLength} type={type} onChange={event => onChange(event.target.value)} /></label>;
}
async function api<T>(url: string, signal: AbortSignal, bodyJson?: string): Promise<T> {
  const { response, data } = await fetchBoundedJson({ url, signal, timeoutMs: 30000, maxBytes: 2*1024*1024,
    init: { method: bodyJson === undefined ? "GET" : "POST", cache: "no-store", ...(bodyJson === undefined ? {} : { headers: { "content-type": "application/json" }, body: bodyJson }) } });
  if (!response.ok) throw Object.assign(new Error(data && typeof data === "object" && "error" in data ? String(data.error) : `请求失败（${response.status}）`), { status: response.status });
  if (!data || typeof data !== "object") throw new Error("服务端回执无效，请核验同一次请求。");
  return data as T;
}

function SourceDirectory({ detail }: { detail: Detail }) {
  const [offset, setOffset] = useState(0), [history, setHistory] = useState<number[]>([]), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<DirectoryPage | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const sourceKeys = JSON.stringify(Object.keys(detail.sources).sort());
  // The parent keys this component by account, run, version and immutable catalog.
  // Every page is replaced, never combined with a different evidence version.
  useEffect(() => {
    const ctl = new AbortController(); let active = true;
    const knownSources = new Set<string>(JSON.parse(sourceKeys));
    setPage(null); setError(""); setLoading(true);
    void (async () => {
      try {
        const value = await api<DirectoryPage>(`/api/ai/business-evidence/${encodeURIComponent(detail.id)}/sources?offset=${offset}&limit=10`, ctl.signal);
        if (!active || ctl.signal.aborted) return;
        if (value.evidenceVersion !== detail.version || value.catalogDigest !== detail.plan.catalogDigest) throw new Error("目录版本已变化，请刷新选中任务后重新查看。");
        if (value.schemaVersion !== "business-evidence-directory-page-v2" || value.runId !== detail.id || value.offset !== offset || value.total !== detail.plan.sourceCount || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 10 || value.returned !== value.items.length || offset+value.returned > value.total || value.nextOffset !== (offset+value.returned < value.total ? offset+value.returned : null) || new Set(value.items.map(item => item.key)).size !== value.items.length || value.items.some((item, index) => !item || item.ordinal !== offset+index+1 || typeof item.key !== "string" || !knownSources.has(item.key) || typeof item.domain !== "string" || !item.query || typeof item.query !== "object" || Array.isArray(item.query) || Object.values(item.query).some(v => typeof v !== "string"))) throw new Error("来源目录回执无效，请刷新选中任务后核验。");
        setPage(value);
      } catch (caught) { if (active && !ctl.signal.aborted) setError(message(caught)); }
      finally { if (active && !ctl.signal.aborted) setLoading(false); }
    })();
    return () => { active = false; ctl.abort(); };
  }, [detail.id, detail.version, detail.plan.catalogDigest, detail.plan.sourceCount, sourceKeys, offset, retry]);
  // Hide the preceding page immediately, before the next effect begins.
  const visible = page?.offset === offset ? page : null;
  return <section aria-label="精确来源目录"><h4>精确来源目录</h4><p>逐页显示已安排的精确查询条件；本页不代表全部来源。</p>
    {error && <p role="alert" className="bw-error">{error}<button onClick={() => setRetry(value => value+1)}>重试来源目录</button></p>}
    {(loading || (!visible && !error)) && <p role="status">正在读取来源目录…</p>}
    {visible && <><p>来源 {visible.offset+1}–{visible.offset+visible.returned} / {visible.total} · 任务版本 {visible.evidenceVersion}</p><div className="bw-scroll"><table><thead><tr><th>来源编号</th><th>领域</th><th>精确条件</th><th>已保存页数</th><th>行数</th><th>采集完整性</th></tr></thead><tbody>{visible.items.map(source => { const progress = detail.sources[source.key]; return <tr key={source.key}><td>{source.key}</td><td>{source.domain}</td><td>{summary(source.query)}</td><td>{progress.pageCount}</td><td>{progress.rowCount}</td><td>{progress.complete ? "分页采集完成" : "未完成核验"}</td></tr>; })}</tbody></table></div></>}
    <div className="bw-actions"><button disabled={loading || !history.length} onClick={() => { setOffset(history[history.length-1]); setHistory(values => values.slice(0, -1)); }}>上一页来源</button><button disabled={loading || !visible || visible.nextOffset === null} onClick={() => { if (visible?.nextOffset != null) { setHistory(values => [...values, offset]); setOffset(visible.nextOffset); } }}>下一页来源</button></div>
  </section>;
}

export default function AiBusinessWorkbench({ onReportCreated }: { onReportCreated: (id: string) => void }) {
  const [form, setForm] = useState<Request>(initial), [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false);
  const [items, setItems] = useState<Item[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [listedPage, setListedPage] = useState(0), [principalKey, setPrincipalKey] = useState("");
  const [selected, setSelected] = useState(""), [detail, setDetail] = useState<Detail | null>(null), [reports, setReports] = useState<Report[]>([]);
  const [moreReports, setMoreReports] = useState(false);
  const [listError, setListError] = useState(""), [detailError, setDetailError] = useState(""), [previewError, setPreviewError] = useState(""), [writeError, setWriteError] = useState(""), [storageError, setStorageError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [previewBusy, setPreviewBusy] = useState(false), [notice, setNotice] = useState("");
  const live = useRef(true), actor = useRef(""), pendingRef = useRef<Pending | null>(null), selectedRef = useRef("");
  const listController = useRef<AbortController | null>(null), detailController = useRef<AbortController | null>(null), previewController = useRef<AbortController | null>(null), writeController = useRef<AbortController | null>(null);
  const restore = useCallback((key: string) => {
    setReady(false); setStorageError("");
    try {
      const probe = storageKey(key)+":probe"; sessionStorage.setItem(probe, "1"); sessionStorage.removeItem(probe);
      const raw = sessionStorage.getItem(storageKey(key));
      let value: Pending | null = null;
      if (raw) {
        if (raw.length > 100000) throw new Error("待确认提交记录超出容量。");
        value = JSON.parse(raw) as Pending;
        if (!value || value.schemaVersion !== 1 || value.principalKey !== key || !["evidence", "report"].includes(value.kind) || !["prepared", "unknown"].includes(value.outcome) || typeof value.bodyJson !== "string" || typeof value.label !== "string") throw new Error("待确认提交记录损坏。");
        const body = JSON.parse(value.bodyJson);
        if (!body || typeof body.clientRequestId !== "string" || !body.clientRequestId || body.expectedPrincipalKey !== key) throw new Error("待确认请求身份无效。");
      }
      pendingRef.current = value; setPending(value); setReady(true);
    } catch (error) { setStorageError(message(error)+" 浏览器无法可靠保存提交；已阻止新建，请恢复当前标签页的会话存储后重试检查。"); }
  }, []);
  const principal = useCallback((key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("账号身份回执无效。");
    if (actor.current !== key) {
      const changed = Boolean(actor.current); actor.current = key; setPrincipalKey(key);
      if (changed) {
        writeController.current?.abort(); previewController.current?.abort(); detailController.current?.abort(); listController.current?.abort(); listController.current = null;
        setPreview(null); setConfirmed(false); setDetail(null); setReports([]); setItems([]); setForm(initial());
        selectedRef.current = ""; setSelected(""); setPage(1); setMoreReports(false); setWriteError("账号已变化，请重新核验当前账号的范围及待确认提交。");
      }
      pendingRef.current = null; setPending(null); restore(key);
    }
  }, [restore]);
  const loadList = useCallback(async (force = false) => {
    if (listController.current && !force) return;
    listController.current?.abort(); const ctl = new AbortController(); listController.current = ctl;
    const current = () => live.current && listController.current === ctl && !ctl.signal.aborted;
    try {
      const result = await api<{ items: Item[]; principalKey: string; total?: number; pagination?: { total: number } }>(`/api/ai/business-evidence?page=${page}&pageSize=10`, ctl.signal);
      if (!current()) return;
      if (!Array.isArray(result.items)) throw new Error("任务列表响应无效。");
      principal(result.principalKey); setItems(result.items); setListedPage(page); setTotal(result.pagination?.total ?? result.total ?? 0); setListError("");
    } catch (error) { if (current()) setListError(message(error)); }
    finally { if (listController.current === ctl) listController.current = null; }
  }, [page, principal]);
  const loadDetail = useCallback(async (id: string, force = false) => {
    if (!id || (detailController.current && !force)) return;
    detailController.current?.abort(); const ctl = new AbortController(); detailController.current = ctl;
    const current = () => live.current && detailController.current === ctl && selectedRef.current === id && !ctl.signal.aborted;
    try {
      const result = await api<{ item: Detail; reports: Report[]; principalKey: string; reportsPagination?: { hasMore: boolean } }>(`/api/ai/business-evidence/${encodeURIComponent(id)}`, ctl.signal);
      if (!current()) return;
      const item = result.item, v2 = item?.plan?.schemaVersion === "business-evidence-v2";
      const validPlan = v2 ? Number.isInteger(item.plan.sourceCount) && item.plan.sourceCount! >= 1 && item.plan.sourceCount! <= 48 && /^[a-f0-9]{64}$/.test(item.plan.catalogDigest ?? "") && item.sources && !Array.isArray(item.sources) && Object.keys(item.sources).length === item.plan.sourceCount && Object.values(item.sources).every(value => value && Number.isSafeInteger(value.pageCount) && value.pageCount >= 0 && Number.isSafeInteger(value.rowCount) && value.rowCount >= 0 && typeof value.complete === "boolean") : (!item?.plan?.schemaVersion || item.plan.schemaVersion === "business-evidence-v1") && Array.isArray(item?.plan?.sources);
      if (item?.id !== id || !Number.isSafeInteger(item.version) || item.version < 1 || !validPlan || !Array.isArray(result.reports)) throw new Error("任务详情回执无效。");
      principal(result.principalKey); if (!current()) return;
      setDetail(result.item); setReports(result.reports); setMoreReports(result.reportsPagination?.hasMore === true); setDetailError("");
    } catch (error) { if (current()) setDetailError(message(error)); }
    finally { if (detailController.current === ctl) detailController.current = null; }
  }, [principal]);
  const choose = useCallback((id: string) => {
    detailController.current?.abort(); selectedRef.current = id; setSelected(id); setDetail(null); setReports([]); setMoreReports(false); setDetailError("");
    void loadDetail(id, true);
  }, [loadDetail]);
  useEffect(() => { live.current = true; return () => { live.current = false; for (const ref of [listController, detailController, previewController, writeController]) ref.current?.abort(); }; }, []);
  useEffect(() => { void loadList(true); return () => { listController.current?.abort(); listController.current = null; }; }, [loadList]);
  useEffect(() => {
    if (!items.some(item => item.status === "collecting") && detail?.status !== "collecting") return;
    const timer = window.setInterval(() => { void loadList(); if (selectedRef.current) void loadDetail(selectedRef.current); }, 5000);
    return () => window.clearInterval(timer);
  }, [items, detail?.status, loadList, loadDetail]);
  function edit(next: Request) {
    previewController.current?.abort(); previewController.current = null; setPreviewBusy(false); setPreview(null); setConfirmed(false); setForm(next);
  }
  async function plan(event: React.FormEvent) {
    event.preventDefault(); previewController.current?.abort(); const ctl = new AbortController(); previewController.current = ctl;
    setPreviewBusy(true); setPreviewError(""); setPreview(null); setConfirmed(false);
    const current = () => live.current && previewController.current === ctl && !ctl.signal.aborted;
    try {
      const result = await api<Preview>("/api/ai/business-plan/preview", ctl.signal, JSON.stringify(form));
      if (!current()) return;
      if (!Array.isArray(result.coverage) || !Array.isArray(result.limitations) || typeof result.canCollect !== "boolean" || !result.capacity || !result.evidenceRequest) throw new Error("范围预览响应无效。");
      principal(result.principalKey); if (!current()) return;
      setPreview(result);
    } catch (error) { if (current()) setPreviewError(message(error)); }
    finally { if (previewController.current === ctl) { previewController.current = null; if (live.current) setPreviewBusy(false); } }
  }
  function clearPending(value: Pending) {
    sessionStorage.removeItem(storageKey(value.principalKey));
    if (sessionStorage.getItem(storageKey(value.principalKey)) !== null) throw new Error("待确认提交记录未能清除；请重试核验同一请求。");
    pendingRef.current = null; setPending(null);
  }
  async function send(value: Pending) {
    if (writeController.current || !ready || actor.current !== value.principalKey) return;
    const ctl = new AbortController(); writeController.current = ctl; setBusy(true); setWriteError(""); setNotice("");
    let submitted = false;
    const previouslyUnknown = value.outcome === "unknown";
    const current = () => live.current && writeController.current === ctl && actor.current === value.principalKey && !ctl.signal.aborted;
    try {
      // Recheck the server identity before replaying an account-bound payload.
      const identity = await api<{ principalKey: string }>("/api/ai/business-evidence?page=1&pageSize=1", ctl.signal);
      if (!current()) return;
      if (identity.principalKey !== value.principalKey) { principal(identity.principalKey); return; }
      try {
        const uncertain: Pending = { ...value, outcome: "unknown" }, serialized = JSON.stringify(uncertain);
        sessionStorage.setItem(storageKey(value.principalKey), serialized);
        if (sessionStorage.getItem(storageKey(value.principalKey)) !== serialized) throw new Error("写入前提交状态未能持久保存。");
        pendingRef.current = uncertain; setPending(uncertain);
      } catch (error) { setReady(false); setStorageError(message(error)+" 已阻止本次请求发送。"); throw error; }
      submitted = true;
      const result = await api<{ item: { id: string } }>(value.kind === "evidence" ? "/api/ai/business-evidence" : "/api/ai/business-reports", ctl.signal, value.bodyJson);
      if (!current()) return;
      if (typeof result.item?.id !== "string" || !result.item.id) throw new Error("提交回执无效。");
      clearPending(value); setNotice(value.kind === "evidence" ? "证据任务已保存，后台继续采集。" : "分析任务已创建。");
      void loadList(true);
      if (value.kind === "evidence") choose(result.item.id);
      else { if (selectedRef.current) void loadDetail(selectedRef.current, true); onReportCreated(result.item.id); }
    } catch (error) {
      if (current()) {
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        let text = message(error);
        if (submitted && !previouslyUnknown && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          try { clearPending(value); } catch (storage) { text += " "+message(storage); setReady(false); setStorageError(message(storage)); }
        }
        setWriteError(text+(pendingRef.current ? " 提交结果待确认；请重试同一次提交，完整参数和请求编号已保留。" : ""));
      }
    } finally { if (writeController.current === ctl) { writeController.current = null; if (live.current) setBusy(false); } }
  }
  function create(kind: Pending["kind"], payload: Record<string, unknown>, label: string) {
    if (pendingRef.current || !ready || busy || !actor.current) return;
    const value: Pending = { schemaVersion: 1, principalKey: actor.current, kind, bodyJson: JSON.stringify({ ...payload, expectedPrincipalKey: actor.current, clientRequestId: "workbench-"+crypto.randomUUID() }), label, createdAt: new Date().toISOString(), outcome: "prepared" };
    try {
      const serialized = JSON.stringify(value); sessionStorage.setItem(storageKey(value.principalKey), serialized);
      if (sessionStorage.getItem(storageKey(value.principalKey)) !== serialized) throw new Error("提交记录写入后校验失败。");
      pendingRef.current = value; setPending(value); void send(value);
    } catch (error) { setReady(false); setStorageError(message(error)+" 无法保存待确认请求，未发起提交。请检查会话存储。"); }
  }
  async function control(action: "pause" | "resume" | "cancel") {
    if (!detail || writeController.current || pendingRef.current) return;
    const item = detail, key = actor.current, ctl = new AbortController(); writeController.current = ctl; setBusy(true); setWriteError("");
    const current = () => live.current && writeController.current === ctl && actor.current === key && !ctl.signal.aborted;
    try {
      const identity = await api<{ principalKey: string }>("/api/ai/business-evidence?page=1&pageSize=1", ctl.signal);
      if (!current()) return;
      if (identity.principalKey !== key) { principal(identity.principalKey); return; }
      await api(`/api/ai/business-evidence/${encodeURIComponent(item.id)}/${action === "cancel" ? "finish" : "control"}`, ctl.signal, JSON.stringify({ expectedVersion: item.version, action }));
      if (current()) { void loadList(true); if (selectedRef.current === item.id) void loadDetail(item.id, true); setNotice("操作已保存。"); }
    } catch (error) { if (current()) setWriteError(message(error)+" 请刷新任务状态后再操作，控制请求不会自动重放。"); }
    finally { if (writeController.current === ctl) { writeController.current = null; if (live.current) setBusy(false); } }
  }
  const locked = busy || Boolean(pending) || !ready;
  const shopEdit = (i: number, change: Partial<Shop>) => edit({ ...form, shops: form.shops.map((shop, j) => j === i ? { ...shop, ...change } : shop) });
  const visibleItems = listedPage === page ? items : [];
  const detailV2 = detail?.plan.schemaVersion === "business-evidence-v2";
  return <section className="business-workbench" aria-label="经营分析工作台">
    <h3>经营分析工作台</h3><p>先描述问题并确认精确范围，再采集证据。这里根据你选择的范围生成来源计划，尚未自动解析问题或确认数据已存在。</p>
    {storageError && <div role="alert" className="bw-error">{storageError}<button onClick={() => actor.current && restore(actor.current)}>重新检查会话存储</button></div>}
    {writeError && <p role="alert" className="bw-error" data-testid="write-error">{writeError}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <div className="bw-pending" role="status"><strong>有一次提交等待确认</strong><p>{pending.label} · {pending.createdAt}</p><p>已冻结完整参数与请求编号。刷新后不会自动重发，请手动确认同一次提交；确认前不能另建任务。</p><details><summary>查看已保存的提交范围</summary><pre>{JSON.stringify(JSON.parse(pending.bodyJson), null, 2)}</pre></details><button disabled={busy || !ready} onClick={() => void send(pending)}>确认并重试同一次提交</button></div>}
    {busy && <button onClick={() => { writeController.current?.abort(); setWriteError("已取消等待；服务器可能已接收。新建请求会保留待确认记录，控制请求请刷新核验。"); }}>取消等待响应</button>}
    <form onSubmit={event => void plan(event)}><fieldset disabled={locked}><legend>问题与范围</legend>
      <label>分析问题<textarea aria-label="分析问题" required maxLength={1000} value={form.question} onChange={event => edit({ ...form, question: event.target.value })} placeholder="例如：推广费用上升但销售未增长，哪些商品和关键词需要调整？" /></label>
      <div className="bw-grid"><TextInput label="开始日期" value={form.startDate} onChange={startDate => edit({ ...form, startDate })} type="date" /><TextInput label="结束日期" value={form.endDate} onChange={endDate => edit({ ...form, endDate })} type="date" /></div>
      <div className="bw-checks">{["current", "previous", "yearAgo"].map(window => <label key={window}><input type="checkbox" checked={form.windows.includes(window)} disabled={window === "current"} onChange={event => edit({ ...form, windows: event.target.checked ? [...form.windows, window] : form.windows.filter(w => w !== window) })} />{names[window]}</label>)}</div>
      {form.shops.map((shop, i) => <fieldset className="bw-card" key={i}><legend>店铺 {i+1}</legend><div className="bw-grid"><TextInput label={`店铺 ${i+1} 平台`} value={shop.platform} onChange={platform => shopEdit(i, { platform })} /><TextInput label={`店铺 ${i+1} 精确名称`} value={shop.shop} onChange={value => shopEdit(i, { shop: value })} /></div>
        <div className="bw-checks">{["promotion", "master", "sku", "spu", "b2b"].map(dataset => <label key={dataset}><input type="checkbox" checked={shop.datasets.includes(dataset)} onChange={event => shopEdit(i, { datasets: event.target.checked ? [...shop.datasets, dataset] : shop.datasets.filter(d => d !== dataset) })} />{names[dataset]}</label>)}</div><p>商品主数据仅使用本期最新快照。ERP 渠道须逐项输入系统中的精确身份；不会按店铺名称猜测关联。</p>
        {shop.salesChannels.map((channel, j) => <div className="bw-inline" key={j}><TextInput label={`店铺 ${i+1} ERP 渠道 ${j+1}`} value={channel} onChange={value => shopEdit(i, { salesChannels: shop.salesChannels.map((c, k) => j === k ? value : c) })} /><button type="button" onClick={() => shopEdit(i, { salesChannels: shop.salesChannels.filter((_, k) => k !== j) })}>删除渠道 {j+1}</button></div>)}
        <div className="bw-actions"><button type="button" disabled={shop.salesChannels.length >= 10} onClick={() => shopEdit(i, { salesChannels: [...shop.salesChannels, ""] })}>添加 ERP 渠道</button><button type="button" onClick={() => edit({ ...form, shops: form.shops.filter((_, j) => j !== i) })}>删除店铺 {i+1}</button></div>
      </fieldset>)}
      <button type="button" disabled={form.shops.length >= 4} onClick={() => edit({ ...form, shops: [...form.shops, { platform: "京东", shop: "", datasets: ["promotion", "master"], salesChannels: [] }] })}>添加店铺（最多 4 家）</button>
      <h4>市场榜单条件</h4><p>仅按下列精确条件查询榜单样本，不代表全市场规模；不猜测类目、范围和价格带。</p>
      {form.markets.map((market, i) => <fieldset className="bw-card" key={i}><legend>市场条件 {i+1}</legend><div className="bw-grid">{(["platform", "category", "scope", "rankingDimension", "priceBandFilter"] as const).map(key => <TextInput key={key} label={`市场 ${i+1} ${{ platform: "平台", category: "精确类目", scope: "精确范围", rankingDimension: "榜单维度", priceBandFilter: "精确价格带" }[key]}`} value={market[key]} onChange={value => edit({ ...form, markets: form.markets.map((m, j) => i === j ? { ...m, [key]: value } : m) })} maxLength={key === "platform" ? 100 : 200} />)}</div><button type="button" onClick={() => edit({ ...form, markets: form.markets.filter((_, j) => i !== j) })}>删除市场条件 {i+1}</button></fieldset>)}
      <button type="button" disabled={form.markets.length >= 7} onClick={() => edit({ ...form, markets: [...form.markets, { platform: "", category: "", scope: "", rankingDimension: "", priceBandFilter: "" }] })}>添加市场条件（最多 7 项）</button>
      <div className="bw-actions"><button type="submit" disabled={previewBusy}>预览完整来源计划</button>{previewBusy && <button type="button" onClick={() => { previewController.current?.abort(); previewController.current = null; setPreviewBusy(false); }}>取消预览</button>}</div>
    </fieldset></form>
    {previewError && <p role="alert" className="bw-error">{previewError}</p>}
    {preview && <section className="bw-card" aria-label="来源范围预览"><h4>完整来源矩阵</h4><p>拟采集 {preview.capacity.sourceCount} / {preview.capacity.maxSources} 个来源；计划 {preview.capacity.planBytes} / {preview.capacity.maxPlanBytes} 字节；分析输入估算 {preview.capacity.workflowBytes} / {preview.capacity.maxWorkflowBytes} 字节。</p>
      <div className="bw-scroll" tabIndex={0}><table><thead><tr><th>领域</th><th>精确查询条件</th><th>支持状态</th><th>数据状态</th><th>说明</th></tr></thead><tbody>{preview.coverage.map((row, i) => <tr key={i}><td>{row.domain}</td><td>{summary(row.query)}</td><td>{names[row.status] ?? row.status}</td><td>{names[row.availability] ?? row.availability}</td><td>{row.reason}</td></tr>)}</tbody></table></div>
      <ul>{preview.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul>{!preview.canCollect && <p className="bw-error" role="alert">范围存在缺口或超过容量，不能开始采集。请明确调整范围后重新预览；系统不会截断来源。</p>}
      <label className="bw-confirm"><input type="checkbox" checked={confirmed} disabled={locked || !preview.canCollect} onChange={event => setConfirmed(event.target.checked)} />我已核对精确范围与限制，确认采集以上全部来源</label><button disabled={locked || !confirmed || !preview.canCollect || preview.principalKey !== principalKey} onClick={() => create("evidence", preview.evidenceRequest, preview.request.question)}>确认范围并开始后台采集</button>
    </section>}
    <section aria-label="已有证据任务"><div className="bw-actions"><h4>已有证据任务</h4><button onClick={() => void loadList(true)}>刷新任务列表</button></div>{listError && <p role="alert" className="bw-error">{listError}</p>}
      {visibleItems.map(item => <button className={`bw-task ${selected === item.id ? "bw-selected" : ""}`} key={item.id} onClick={() => choose(item.id)}><strong>{item.question || "未附分析问题"}</strong><span>{names[item.collection.status] ?? names[item.status] ?? item.status} · 来源 {item.completedSources ?? 0}/{item.sourceCount ?? 0} · {item.rowCount ?? 0} 行 · {(item.storedBytes/1024).toFixed(1)} KiB</span><small>{item.createdAt}</small></button>)}
      {!visibleItems.length && !listError && <p>{listedPage === page ? "当前页暂无任务。" : "正在读取任务列表…"}</p>}<div className="bw-actions"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>上一页</button><span>第 {page} 页 · 共 {total} 项</span><button disabled={page*10 >= total} onClick={() => setPage(p => p+1)}>下一页</button></div>
    </section>
    {selected && <section className="bw-card" aria-label="选中任务详情"><div className="bw-actions"><h4>任务详情</h4><button onClick={() => void loadDetail(selected, true)}>刷新选中任务</button></div>{detailError && <p role="alert" className="bw-error">{detailError}</p>}
      {!detail && !detailError && <p role="status">正在读取任务…</p>}{detail && <><p className="bw-question">{detail.plan.analysisRequest?.question || "此历史证据任务未保存分析问题。"}</p><p>{names[detail.collection.status] ?? detail.collection.status} · 版本 {detail.version} · {(detail.storedBytes/1024).toFixed(1)} KiB</p>{detail.collection.errorCode && <p role="alert">采集错误：{detail.collection.errorCode}；连续失败 {detail.collection.consecutiveFailures ?? 0} 次。请核验来源后恢复。</p>}
        <p>下列窗口是已安排的查询范围。分页采集完成不等于业务日期齐全，缺日期与缺字段仍须在分析中核验。</p>{detailV2 ? <><p>来源总数 {detail.plan.sourceCount} · 分页采集完成 {Object.values(detail.sources).filter(source => source.complete).length} · 已保存 {Object.values(detail.sources).reduce((sum, source) => sum+source.pageCount, 0)} 页 / {Object.values(detail.sources).reduce((sum, source) => sum+source.rowCount, 0)} 行</p><SourceDirectory key={`${principalKey}:${detail.id}:${detail.version}:${detail.plan.catalogDigest}`} detail={detail} /></> : <div className="bw-scroll"><table><thead><tr><th>来源</th><th>条件</th><th>已保存页数</th><th>行数</th><th>采集完整性</th></tr></thead><tbody>{detail.plan.sources!.map(source => { const progress = detail.sources[source.key]; return <tr key={source.key}><td>{source.domain}</td><td>{summary(source.query)}</td><td>{progress?.pageCount ?? 0}</td><td>{progress?.rowCount ?? 0}</td><td>{progress?.complete ? "分页采集完成" : "未完成核验"}</td></tr>; })}</tbody></table></div>}
        {detail.status === "collecting" && !detail.plan.collector && <p>此历史任务使用手动采集模式，不提供后台暂停或恢复。</p>}<div className="bw-actions">{detail.status === "collecting" && <>{detail.plan.collector && <button disabled={locked} onClick={() => void control(detail.collection.status === "paused" ? "resume" : "pause")}>{detail.collection.status === "paused" ? "恢复后台采集" : "暂停后台采集"}</button>}<button disabled={locked} onClick={() => void control("cancel")}>取消采集任务</button></>}</div>
        {detailV2 ? <p role="status">此任务的完整文件交付仍在接入，工作台暂未开放分析启动。可继续查看与管理采集任务；证据封存不代表报告已生成。</p> : <p>证据封存后才能启动分析。模拟分析不调用模型；正式多 Agent 分析会调用已配置模型，可能产生费用，需要独立复核。</p>}<div className="bw-actions">{[true, false].map(dryRun => <button key={String(dryRun)} disabled={detailV2 || locked || detail.status !== "sealed" || !detail.plan.analysisRequest?.question} onClick={() => { if (!detailV2) create("report", { evidenceRunId: detail.id, question: detail.plan.analysisRequest!.question, dryRun }, `${detail.plan.analysisRequest!.question} · ${dryRun ? "模拟分析" : "多 Agent 分析"}`); }}>{dryRun ? "模拟分析（不调用模型）" : "启动多 Agent 分析（调用模型）"}</button>)}</div>
        <h4>关联分析报告</h4>{reports.length ? reports.map(report => <button className="bw-task" key={report.id} onClick={() => onReportCreated(report.id)}><strong>打开报告 · {names[report.status] ?? report.status}</strong><small>{report.createdAt} · {report.id}</small></button>) : <p>尚无关联报告。</p>}{moreReports && <p>这里只显示最近 10 份关联报告；更多历史报告请在下方报告列表查看。</p>}
      </>}
    </section>}
  </section>;
}
