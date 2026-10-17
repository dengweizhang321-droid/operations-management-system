"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { AppCurrentUser } from "./shell/view-contract";
import { SearchableSelect } from "./ui/searchable-select";
import { AiMarkdown } from "./ai-chat-workbench";

type PiShopSelection = { platform: "京东" | "天猫"; shop: string };
type PiSession = { id: string; title: string; status: string; epoch: number; generation: number; scope?: PiScope; shopSelection?: PiShopSelection | null; activeOperationId?: string | null; createClientRequestId?: string; updatedAt: string };
type PiOperation = { id: string; clientRequestId?: string; status: string; kind: string; errorCode?: string; modelId?: string; modelVersion?: number; skills?: { id: string; version: string; sha256: string }[]; skillsLoaded?: boolean };
type PiFile = { id: string; clientRequestId?: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; direction: string; manifest?: unknown };
export type PiEvent = { eventSeq: number; type: string; operationId: string; data: Record<string, unknown>; createdAt: string };
type PiSkill = { id: string; name: string; description: string; status: string; reason?: string; version?: string; sha256?: string; resources?: unknown };
type PiModel = { id: string; name: string; modelName: string; isDefault?: boolean };
type PiDetail = { session: PiSession; operations: PiOperation[]; files: PiFile[]; controlRequests?: { clientRequestId: string; operationId: string; status: string }[] };
type PiScope = Record<"warehouses" | "channels" | "platforms", string[]> | null;
export type PiPending = { clientRequestId: string; sessionId: string; kind: "create" | "message" | "abort" | "file" };
const labels: Record<string, string> = { ready: "可用", available: "可用", idle: "就绪", active: "就绪", queued: "排队中", running: "执行中", completed: "已完成", succeeded: "已完成", failed: "失败", cancelled: "已停止", canceled: "已停止", aborted: "已停止", aborting: "正在停止", canceling: "正在停止", unknown: "结果待核实", frozen: "环境已冻结", revoked: "权限已变更", disabled: "未启用", enabled: "可用", unavailable: "不可用" };
const stateLabel = (value: string) => labels[value] ?? value;
export const piFailureLabel = (code?: string) => ({
  invalid_provider_response: "模型响应校验失败，执行已暂停。",
  provider_output_limit: "模型输出达到配置上限，执行已暂停。",
  provider_empty_response: "模型未返回正文或工具调用，执行已暂停。",
  provider_timeout: "等待模型响应超时，执行已暂停。",
  ai_context_budget_exceeded: "对话上下文超过模型配置预算，执行已暂停。",
} as Record<string, string>)[code ?? ""];
export function piEventDetail(data: Record<string, unknown>) {
  const code = typeof data.code === "string" ? data.code : typeof data.errorCode === "string" ? data.errorCode : "";
  if (code) {
    const diagnostics = data.responseDiagnostics as Record<string, unknown> | undefined;
    return `${piFailureLabel(code) ?? code}${typeof diagnostics?.reason === "string" ? `（${diagnostics.reason}）` : ""}`;
  }
  return typeof data.status === "string" ? stateLabel(data.status) : typeof data.toolName === "string" ? data.toolName : typeof data.name === "string" ? data.name : "";
}
export const piOperationBlocksSend = (status: string) => !["completed", "succeeded", "failed", "cancelled", "canceled", "aborted", "frozen"].includes(status);
export function mergePiEvents(previous: PiEvent[], incoming: PiEvent[]) {
  return [...new Map([...previous, ...incoming].map(event => [event.eventSeq, event])).values()].sort((a, b) => a.eventSeq - b.eventSeq);
}
export function piScopeFromDraft(draft: Record<"warehouses" | "channels" | "platforms", string>, inherited: PiScope = null) {
  if (!Object.values(draft).some(value => value.trim())) return undefined;
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() ? [...new Set(value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean))] : inherited?.[key as keyof typeof draft] ?? []]));
}
export function reconcilePiPending(pending: PiPending[], detail: PiDetail) {
  return pending.filter(item => !(
    item.kind === "create" && detail.session.createClientRequestId === item.clientRequestId
    || item.sessionId === detail.session.id && detail.operations.some(op => op.clientRequestId === item.clientRequestId)
    || item.sessionId === detail.session.id && detail.files.some(file => file.clientRequestId === item.clientRequestId)
    || item.sessionId === detail.session.id && detail.controlRequests?.some(control => control.clientRequestId === item.clientRequestId && control.status === "completed")
  ));
}
class PiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function piJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/ai/pi/${path}`, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new PiRequestError(data?.error || "Pi Agent 服务暂时不可用。", response.status);
  return data as T;
}
function eventText(event: PiEvent) {
  return typeof event.data.text === "string" ? event.data.text : "";
}
function safeManifest(value: unknown) {
  return JSON.stringify(value, null, 2)?.slice(0, 32_000) ?? "未提供来源清单";
}

export default function AiPiAgentView({ currentUser, initialContextPrompt = "" }: { currentUser: AppCurrentUser | null; initialContextPrompt?: string }) {
  const canWrite = !!currentUser && currentUser.role !== "viewer";
  const storageKey = `ai-pi-v1:${currentUser?.email ?? "anonymous"}`;
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [listLimit, setListLimit] = useState(30);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const selectedRef = useRef("");
  const [detail, setDetail] = useState<PiDetail | null>(null);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [models, setModels] = useState<PiModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [draft, setDraft] = useState(initialContextPrompt);
  const [scope, setScope] = useState({ warehouses: "", channels: "", platforms: "" });
  const [allowedScope, setAllowedScope] = useState<PiScope>(null);
  const [shopPlatform, setShopPlatform] = useState<"京东" | "天猫">("京东");
  const [shopName, setShopName] = useState("");
  const [pending, setPending] = useState<PiPending[]>([]);
  const pendingRef = useRef<PiPending[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const environmentRef = useRef("");
  const parametersRestoredRef = useRef("");

  const persistPending = useCallback((items: PiPending[]) => {
    localStorage.setItem(`${storageKey}:pending`, JSON.stringify(items));
    pendingRef.current = items;
    setPending(items);
  }, [storageKey]);
  const selectSession = useCallback((id: string) => {
    if (id === selectedRef.current) return;
    generation.current++;
    parametersRestoredRef.current = "";
    selectedRef.current = id;
    setSessionId(id); setDetail(null); setEvents([]); setFileIds([]); setScope({ warehouses: "", channels: "", platforms: "" }); setShopName(""); setForbidden(false); setError("");
    try { localStorage.setItem(`${storageKey}:session`, id); } catch { /* Reads remain available. */ }
  }, [storageKey]);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`${storageKey}:pending`) || "[]");
      if (!Array.isArray(saved) || !saved.every(item => item && typeof item.clientRequestId === "string" && typeof item.sessionId === "string" && ["create", "message", "abort", "file"].includes(item.kind))) throw Error("invalid storage");
      pendingRef.current = saved; setPending(saved); setStorageReady(true);
      const id = localStorage.getItem(`${storageKey}:session`) || "";
      if (/^[A-Za-z0-9_-]{1,160}$/.test(id)) selectSession(id);
    } catch { setError("无法读取本机请求凭据。为避免重复执行，已禁止发送；仍可只读查看服务端记录。"); }
  }, [storageKey, selectSession]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      piJson<{ items: PiSession[]; hasMore?: boolean }>(`sessions?limit=${listLimit}`, { signal: controller.signal }),
      piJson<{ items: PiSkill[]; models: PiModel[]; scope?: PiScope }>("skills", { signal: controller.signal }),
    ]).then(([list, catalog]) => {
      if (controller.signal.aborted) return;
      setSessions(list.items); setHasMoreSessions(!!list.hasMore); setSkills(catalog.items); setModels(catalog.models);
      setAllowedScope(catalog.scope ?? null);
      setModelId(current => catalog.models.some(item => item.id === current) ? current : parametersRestoredRef.current ? "" : catalog.models.find(item => item.isDefault)?.id ?? catalog.models[0]?.id ?? "");
      const createPending = pendingRef.current.find(item => item.kind === "create");
      const recovered = createPending && list.items.find(item => item.createClientRequestId === createPending.clientRequestId);
      if (recovered) { persistPending(pendingRef.current.filter(item => item !== createPending)); if (!selectedRef.current) selectSession(recovered.id); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, listLimit, persistPending, selectSession]);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const currentGeneration = generation.current;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const snapshot = await piJson<PiDetail>(`sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        const page = await piJson<{ items: PiEvent[]; after: number; hasMore: boolean; session?: PiSession }>(`sessions/${encodeURIComponent(sessionId)}/events?after=${cursor}&limit=100`, { signal: controller.signal });
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        const effective = page.session ?? snapshot.session;
        const environment = `${sessionId}:${effective.epoch}:${effective.generation}`;
        if (["frozen", "revoked"].includes(effective.status)) {
          setDetail({ session: effective, operations: [], files: [] }); setEvents([]); setFileIds([]); setDraft("");
          setScope({ warehouses: "", channels: "", platforms: "" }); setShopName("");
          environmentRef.current = environment; cursor = 0;
          timer = setTimeout(() => { void refresh(); }, 2500);
          return;
        }
        if (effective.epoch !== snapshot.session.epoch || effective.generation !== snapshot.session.generation) {
          setDetail(null); setEvents([]); setFileIds([]); cursor = 0;
          timer = setTimeout(() => { void refresh(); }, 100);
          return;
        }
        const environmentChanged = !!environmentRef.current && environmentRef.current !== environment;
        if (environmentChanged) setFileIds([]);
        environmentRef.current = environment;
        setDetail(snapshot);
        setSessions(items => items.map(item => item.id === sessionId ? snapshot.session : item));
        const remaining = reconcilePiPending(pendingRef.current, snapshot);
        if (remaining.length !== pendingRef.current.length) persistPending(remaining);
        setEvents(items => mergePiEvents(environmentChanged ? [] : items, page.items));
        cursor = Math.max(cursor, ...page.items.map(item => item.eventSeq));
        setError("");
        timer = setTimeout(() => { void refresh(); }, page.hasMore ? 100 : 2500);
      } catch (cause) {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        setError(cause instanceof Error ? cause.message : "读取环境失败。");
        if (cause instanceof PiRequestError && cause.status === 403) { setForbidden(true); setDetail(null); setEvents([]); setFileIds([]); setDraft(""); setScope({ warehouses: "", channels: "", platforms: "" }); setShopName(""); return; }
        timer = setTimeout(() => { void refresh(); }, 5000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, revision, persistPending]);

  useEffect(() => {
    if (!detail || !models.length || ["frozen", "revoked"].includes(detail.session.status)) return;
    const key = `${detail.session.id}:${detail.session.epoch}:${detail.session.generation}`;
    if (parametersRestoredRef.current === key) return;
    parametersRestoredRef.current = key;
    const previous = detail.operations[0];
    if (previous?.modelId) {
      const available = models.some(model => model.id === previous.modelId);
      setModelId(available ? previous.modelId : "");
      if (!available) setNotice("本环境上次使用的模型已不可用，请重新选择。");
    }
    if (previous?.skills) setSkillIds(previous.skills.map(skill => skill.id).filter(id => skills.some(skill => skill.id === id)));
  }, [detail, models, skills]);

  const currentPending = pending.some(item => item.sessionId === sessionId && item.kind !== "create");
  const frozen = forbidden || ["frozen", "revoked", "unknown"].includes(detail?.session.status ?? "") || !!detail?.operations.some(op => op.status === "unknown");
  const active = !!detail?.session.activeOperationId || !!detail?.operations.some(op => piOperationBlocksSend(op.status));
  const writable = canWrite && storageReady && !busy && !currentPending && !frozen;
  const currentScope = detail?.session.scope ?? allowedScope;
  const desiredScope = piScopeFromDraft(scope, currentScope);
  const scopeChanged = desiredScope !== undefined && (["warehouses", "channels", "platforms"] as const).some(key => JSON.stringify(desiredScope[key]) !== JSON.stringify(currentScope?.[key] ?? []));
  const shopSelection = shopName.trim() ? { platform: shopPlatform, shop: shopName.trim() } : undefined;
  const shopChanged = shopSelection !== undefined && (shopSelection.platform !== detail?.session.shopSelection?.platform || shopSelection.shop !== detail?.session.shopSelection?.shop);
  const attachmentEnvironmentChanged = scopeChanged || shopChanged;

  const mutate = async <T,>(kind: PiPending["kind"], path: string, payload: Record<string, unknown>): Promise<T | null> => {
    if (busyRef.current || !storageReady || !canWrite) return null;
    busyRef.current = true; setBusy(true); setError("");
    const intent: PiPending = { clientRequestId: crypto.randomUUID(), sessionId: kind === "create" ? "" : selectedRef.current, kind };
    let persisted = false;
    try {
      // Persist before POST. Reload and reconnect only perform GET; an unknown POST is never replayed.
      persistPending([...pendingRef.current, intent]); persisted = true;
      const result = await piJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, clientRequestId: intent.clientRequestId }) });
      if (kind === "create" || kind === "file") persistPending(pendingRef.current.filter(item => item.clientRequestId !== intent.clientRequestId));
      return result;
    } catch (cause) {
      if (!persisted) { setStorageReady(false); setError("无法持久化请求凭据，未发送。请恢复本机存储后再操作。"); }
      else if (cause instanceof PiRequestError && cause.status >= 400 && cause.status < 500) {
        persistPending(pendingRef.current.filter(item => item.clientRequestId !== intent.clientRequestId));
        setError(cause.message);
      }
      else setError(`${cause instanceof Error ? cause.message : "请求失败。"} 请求已保留，请只读刷新核实原结果；不要重复提交。`);
      return null;
    } finally { busyRef.current = false; setBusy(false); setRevision(value => value + 1); }
  };
  const createSession = async () => {
    if (pendingRef.current.some(item => item.kind === "create")) { setError("新建环境的结果尚未核实，请先刷新环境列表。"); return; }
    const result = await mutate<{ session: PiSession }>("create", "sessions", frozen ? {} : { scope: piScopeFromDraft(scope, allowedScope), shopSelection });
    if (result) { selectSession(result.session.id); setNotice("新环境已创建。请填写本轮任务。"); }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!writable || active || !detail || !draft.trim() || !modelId) return;
    const id = sessionId;
    const result = await mutate("message", `sessions/${encodeURIComponent(id)}/messages`, { message: draft.trim(), modelId, skillIds, scope: desiredScope, shopSelection, fileIds });
    if (result && selectedRef.current === id) { setDraft(""); setFileIds([]); setNotice("任务已接收，执行过程由服务端持续保存。"); }
  };
  const abort = async () => {
    if (!canWrite || !active || busy || frozen || pendingRef.current.some(item => item.sessionId === sessionId && item.kind === "abort")) return;
    await mutate("abort", `sessions/${encodeURIComponent(sessionId)}/abort`, {});
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !writable || active || !detail || attachmentEnvironmentChanged) return;
    if (file.size > 512 * 1024) { setError("单个附件不能超过 512 KiB。"); return; }
    const id = sessionId;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (selectedRef.current !== id || busyRef.current) return;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const result = await mutate<{ file: PiFile }>("file", `sessions/${encodeURIComponent(id)}/files`, { fileName: file.name, mimeType: file.type || "application/octet-stream", base64: btoa(binary) });
    if (result && selectedRef.current === id) setFileIds(items => [...items, result.file.id]);
  };
  const messages = events.filter(item => ["user_message", "assistant_message"].includes(item.type));
  const liveText = events.filter(item => item.type === "text_delta" && !events.some(final => final.type === "assistant_message" && final.operationId === item.operationId)).map(eventText).join("");
  const process = events.filter(item => !["user_message", "assistant_message", "text_delta"].includes(item.type));

  return <section className="ai-workbench ai-pi" aria-label="Pi Agent 工作区">
    <header className="ai-workbench-top"><div><strong>Pi Agent</strong><span className="ai-workbench-subtitle">技能 · 数据 · 持久执行环境</span></div><button type="button" className="ai-workbench-text" onClick={() => setRevision(value => value + 1)}>刷新记录</button></header>
    <div className="ai-workbench-layout">
      <aside className="ai-workbench-history" aria-label="执行环境">
        <button type="button" className="ai-workbench-new" onClick={() => { void createSession(); }} disabled={!canWrite || !storageReady || busy || pending.some(item => item.kind === "create")}>＋ 新建环境</button>
        <div className="ai-workbench-history-title">执行环境 <small>{sessions.length}</small></div>
        <div className="ai-workbench-history-list">{sessions.map(item => <div key={item.id} className={`ai-workbench-history-row ${item.id === sessionId ? "is-selected" : ""}`}><button type="button" disabled={busy} onClick={() => selectSession(item.id)}><span><strong>{item.title || "未命名环境"}</strong><small>{stateLabel(item.status)}</small></span></button></div>)}{!sessions.length && <p>{loading ? "正在加载…" : "暂无环境，请创建后开始。"}</p>}</div>
        {hasMoreSessions && (listLimit < 100 ? <button type="button" className="ai-workbench-text" onClick={() => setListLimit(value => Math.min(100, value + 30))}>加载更多环境</button> : <p>仅展示最近 100 个环境，列表已截断。</p>)}
        <p className="ai-workbench-history-foot">刷新与断线只恢复已存记录。结果待核实时保留原请求，不自动重新执行。</p>
      </aside>
      <div className="ai-workbench-conversation">
        <div className="ai-workbench-conversation-title"><h2>{detail?.session.title || "选择或新建执行环境"}</h2>{detail && <span>{stateLabel(detail.session.status)} · 环境代际 {detail.session.epoch} / {detail.session.generation} · {currentScope ? (Object.entries(currentScope).map(([key, values]) => `${({ warehouses: "仓库", channels: "渠道", platforms: "平台" } as Record<string, string>)[key]}：${values.join("、") || "未选择"}`).join("；")) : "当前账号授权范围"}</span>}</div>
        {detail && <div className="ai-pi-shop-current">{detail.session.shopSelection ? `仅该店：${detail.session.shopSelection.platform} / ${detail.session.shopSelection.shop}` : "当前环境未限定店铺，查询仍受账号数据权限约束"}</div>}
        {!!detail?.operations[0]?.skills?.length && <p className="ai-workbench-subtitle" role="status">本轮技能{detail.operations[0].skillsLoaded ? "已加载" : "等待加载"}：{detail.operations[0].skills.map(skill => `${skill.id} v${skill.version}`).join("、")}</p>}
        {error && <div className="ai-workbench-feedback is-error" role="alert">{error}</div>}
        {notice && <div className="ai-workbench-feedback" role="status">{notice}</div>}
        {frozen && <div className="ai-workbench-feedback is-error" role="alert">{piFailureLabel(detail?.operations.find(operation => operation.status === "unknown")?.errorCode) ?? "当前环境因权限变化或未知结果被冻结，不能继续执行。"}{detail?.session.status === "unknown" || detail?.operations.some(operation => operation.status === "unknown") ? "请先核实原操作，不要重发原任务。" : "请创建新环境，并重新选择当前授权范围。"}</div>}
        {currentPending && <div className="ai-workbench-feedback" role="status">原请求正在核实中。请使用刷新记录查看；同一环境暂不接收新消息。</div>}
        <div className="ai-workbench-scroll"><div className="ai-workbench-messages">
          {!messages.length && <p className="ai-workbench-subtitle">选择模型与真实技能后提交任务。技能也可以通过 /skill:技能标识 指定。经营结果与生成文件需要人工复核。</p>}
          {messages.map(item => <article key={item.eventSeq} className={`ai-workbench-message ai-workbench-${item.type === "user_message" ? "user" : "assistant"}`}><div className="ai-workbench-message-content">{item.type === "user_message" ? <p>{eventText(item)}</p> : <AiMarkdown content={eventText(item)} />}</div></article>)}
          {liveText && <article className="ai-workbench-message ai-workbench-assistant" aria-live="polite"><AiMarkdown content={liveText} partial /></article>}
          {!!process.length && <details className="ai-workbench-execution"><summary>执行过程 · {process.length} 条事件</summary><ol className="ai-pi-events">{process.map(item => <li key={item.eventSeq}><strong>#{item.eventSeq} {({ status: "状态", tool_start: "工具开始", tool_end: "工具完成", error: "执行异常", file_ready: "文件就绪" } as Record<string, string>)[item.type] || item.type}</strong><span>{piEventDetail(item.data)}</span></li>)}</ol></details>}
          {!!detail?.files.length && <section className="ai-pi-files" aria-label="附件与来源"><h3>附件与来源</h3>{detail.files.map(file => <div key={file.id}><a href={`/api/ai/pi/files/${encodeURIComponent(file.id)}/content`} download>{file.fileName}</a><small>{file.direction === "input" ? "上传" : "产物"} · {file.sizeBytes.toLocaleString()} 字节</small>{file.direction === "input" && <label><input type="checkbox" checked={fileIds.includes(file.id)} disabled={!writable || active || attachmentEnvironmentChanged} onChange={() => setFileIds(items => items.includes(file.id) ? items.filter(id => id !== file.id) : [...items, file.id])} />本轮使用</label>}<details><summary>来源清单与校验</summary><pre>{safeManifest(file.manifest)}</pre><code>SHA-256: {file.sha256}</code></details></div>)}</section>}
        </div></div>
        <form className="ai-pi-composer" onSubmit={event => { void send(event); }}>
          <div className="ai-pi-options"><SearchableSelect ariaLabel="Pi Agent 模型" value={modelId} onChange={setModelId} disabled={!writable || active} options={models.map(model => ({ value: model.id, label: model.name || model.modelName }))} placeholder="暂无可用模型" /><button type="button" className="ai-workbench-text" onClick={() => fileInput.current?.click()} disabled={!writable || active || !detail || attachmentEnvironmentChanged}>上传附件（≤512 KiB）</button><input ref={fileInput} type="file" hidden onChange={event => { void upload(event); }} /></div>
          <details className="ai-pi-settings"><summary>技能与本轮数据范围{skillIds.length ? ` · 已选 ${skillIds.length} 项` : ""}</summary><fieldset disabled={!writable || active}><legend>可用技能</legend>{skills.length ? skills.map(skill => <label key={skill.id} className="ai-pi-skill"><input type="checkbox" checked={skillIds.includes(skill.id)} disabled={!["enabled", "ready", "available"].includes(skill.status)} onChange={() => setSkillIds(items => items.includes(skill.id) ? items.filter(id => id !== skill.id) : [...items, skill.id])} /><span><strong>{skill.name}</strong> · {stateLabel(skill.status)}<small>{skill.description}{skill.reason ? ` · ${skill.reason}` : ""}</small><small>/skill:{skill.id}{skill.version ? ` · v${skill.version}` : ""}</small></span></label>) : <p>未发现已部署技能。请检查 Runner 与技能清单。</p>}</fieldset><fieldset disabled={!writable || active}><legend>本轮数据范围</legend><p>空白沿用当前环境与账号授权；填写后仅可进一步收窄。改变范围会隔离旧消息与附件；需要附件时，请先以所选范围新建环境。多个值用逗号分隔。</p>{([['warehouses', '仓库'], ['channels', '渠道'], ['platforms', '平台']] as const).map(([key, label]) => <label key={key}>{label}<input value={scope[key]} onChange={event => { setScope(values => ({ ...values, [key]: event.target.value })); setFileIds([]); }} /></label>)}</fieldset><fieldset disabled={!writable || active}><legend>本轮店铺</legend><div className="ai-pi-shop"><SearchableSelect ariaLabel="本轮店铺平台" value={shopPlatform} onChange={value => { setShopPlatform(value as "京东" | "天猫"); setFileIds([]); }} options={[{ value: "京东", label: "京东" }, { value: "天猫", label: "天猫" }]} disabled={!writable || active} /><label>精确店铺名称<input value={shopName} maxLength={200} onChange={event => { setShopName(event.target.value); setFileIds([]); }} placeholder="输入完整精确店名" /></label></div><p>{shopSelection ? `本轮仅该店：${shopSelection.platform} / ${shopSelection.shop}` : "留空沿用当前环境店铺。新建环境时留空则不额外限定店铺。"}</p><p>更换店铺会建立新环境代际，隔离旧消息与附件；需要附件时，先选择店铺并新建环境。</p></fieldset></details>
          <label className="ai-pi-draft-label" htmlFor="pi-agent-prompt">任务</label><textarea id="pi-agent-prompt" value={draft} onChange={event => setDraft(event.target.value)} placeholder="描述任务，或使用 /skill:技能标识 …" rows={3} maxLength={200000} disabled={!canWrite || frozen || busy || currentPending} />
          <div className="ai-pi-actions"><span>{!canWrite ? "当前角色仅可查看" : active ? "任务正在运行，关闭页面后仍由服务端保存进度" : fileIds.length ? `本轮附件 ${fileIds.length} 个` : "按发送开始执行"}</span><button type="button" className="secondary-button" onClick={() => { void abort(); }} disabled={!canWrite || !active || busy || frozen || pending.some(item => item.sessionId === sessionId && item.kind === "abort")}>停止</button><button type="submit" className="primary-button" disabled={!writable || active || !detail || !draft.trim() || !modelId}>发送任务</button></div>
        </form>
      </div>
    </div>
  </section>;
}
