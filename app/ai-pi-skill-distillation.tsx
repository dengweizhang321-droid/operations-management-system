"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Operation = { id: string; status: string; modelId?: string; modelVersion?: number };
type Receipt = { clientRequestId: string; status: string; errorCode: string | null };
export type DistillationIntent = { clientRequestId: string; reportVersionDigest: string };
type CandidateContent = {
  goal: string; body: string; parameters: { name: string; kind: string; required: boolean; meaning: string; defaultRule: string }[];
  steps: { order: number; action: string; toolName?: string; missingDataBranch: string }[];
  requiredTools: string[]; templateRefs: string[]; sourceEvidenceRefs: string[]; unverifiedRecommendations: string[]; openQuestions: string[];
};
type Candidate = { id: string; status: string; version: number; contentDigest: string; reportVersionDigest: string; unverifiedRecommendations: number; reviewNote?: string; content: unknown;
  publication?: { state: "enabled" | "disabled" | "unavailable" | "unpublished"; skillId: string; libraryVersion: number; publishedLibraryVersion: number | null } };
type Basis = { reportVersionDigest: string; reportVersion: { operationId: string; modelId: string; modelVersion: number }; confirmedFeedbackIds: string[]; citableExportIds: string[]; citableFileIds: string[]; coverage: { sourcesComplete: boolean; truncated: Record<string, boolean> }; distillation: { blocked: boolean; latest: Receipt | null; requested: Receipt | null; candidate: Candidate | null } };
const statusLabels: Record<string, string> = { draft: "草稿", in_review: "审核中", approved: "已批准", rejected: "已退回", superseded: "已替代" };

function candidateContent(value: unknown): value is CandidateContent {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  // JSON Schema maxLength and Python len() count Unicode code points, while
  // JavaScript string.length counts UTF-16 units (emoji usually occupy two).
  const string = (item: unknown, maximum: number): item is string => typeof item === "string" && Array.from(item).length <= maximum;
  const strings = (item: unknown, maximum: number, length: number) => Array.isArray(item) && item.length <= maximum && item.every(entry => string(entry, length));
  const exact = (item: Record<string, unknown>, keys: string[]) => Object.keys(item).sort().join(",") === keys.sort().join(",");
  return object(value) && exact(value, ["goal", "body", "parameters", "steps", "requiredTools", "templateRefs", "sourceEvidenceRefs", "unverifiedRecommendations", "openQuestions"])
    && string(value.goal, 240) && !!value.goal.trim() && string(value.body, 2000) && !!value.body.trim()
    && Array.isArray(value.parameters) && value.parameters.length <= 12 && value.parameters.every(item => object(item) && exact(item, ["name", "kind", "required", "meaning", "defaultRule"]) && string(item.name, 40) && string(item.meaning, 200) && string(item.defaultRule, 200) && typeof item.required === "boolean" && typeof item.kind === "string" && ["shop", "platform", "businessDate", "compareWindow", "threshold", "warehouse", "replenishmentDays", "other"].includes(item.kind))
    && Array.isArray(value.steps) && value.steps.length <= 20 && value.steps.every(item => object(item) && exact(item, ["order", "action", "missingDataBranch", ...(Object.hasOwn(item, "toolName") ? ["toolName"] : [])]) && Number.isInteger(item.order) && Number(item.order) >= 1 && Number(item.order) <= 20 && string(item.action, 300) && string(item.missingDataBranch, 200) && (item.toolName === undefined || string(item.toolName, 80)))
    && strings(value.requiredTools, 16, 80) && strings(value.templateRefs, 4, 64) && strings(value.sourceEvidenceRefs, 20, 120) && strings(value.unverifiedRecommendations, 10, 300) && strings(value.openQuestions, 10, 200);
}

export function parseDistillationIntent(value: string | null): DistillationIntent | null {
  if (!value) return null;
  const item: unknown = JSON.parse(value);
  if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("请求凭据无效");
  const record = item as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "clientRequestId,reportVersionDigest" || typeof record.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(record.clientRequestId) || typeof record.reportVersionDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.reportVersionDigest)) throw Error("请求凭据无效");
  return record as DistillationIntent;
}

class RequestError extends Error {}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/ai/pi/${path}`, { ...init, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new RequestError(value.error || "读取提炼记录失败");
  return value as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export default function AiPiSkillDistillation({ operations, ownerKey, writable, models }: { operations: Operation[]; ownerKey: string; writable: boolean; models: { id: string; name: string; modelName: string }[] }) {
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState("");
  const completed = operations.filter(operation => operation.status === "succeeded");
  const operation = completed.find(item => item.id === selected) ?? completed[0];
  if (!operation) return null;
  return <section className="ai-pi-distillation" aria-label="任务方法提炼">
    <button type="button" className="ai-workbench-text" aria-expanded={opened} onClick={() => setOpened(value => !value)}>{opened ? "收起方法提炼" : "提炼为 Skill 草稿 / 查看候选"}</button>
    {opened && <><label className="ai-pi-distillation-target">已完成任务<select aria-label="提炼来源任务" value={operation.id} onChange={event => setSelected(event.target.value)}>{completed.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? "最近完成 · " : "历史任务 · "}{item.id}</option>)}</select></label>
      <DistillationPanel key={`${ownerKey}:${operation.id}`} operation={operation} storageKey={`${ownerKey}:distill:${operation.id}`} writable={writable} modelName={models.find(item => item.id === operation.modelId)?.name || operation.modelId || "原任务模型"} />
    </>}
  </section>;
}

function DistillationPanel({ operation, storageKey, writable, modelName }: { operation: Operation; storageKey: string; writable: boolean; modelName: string }) {
  const [basis, setBasis] = useState<Basis | null>(null);
  const [pending, setPending] = useState<DistillationIntent | null>(null);
  const pendingRef = useRef<DistillationIntent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageOk, setStorageOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState("");
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState(0);
  const [stale, setStale] = useState(true);
  const persist = useCallback((item: DistillationIntent | null) => {
    if (item) localStorage.setItem(storageKey, JSON.stringify(item)); else localStorage.removeItem(storageKey);
    pendingRef.current = item; setPending(item);
  }, [storageKey]);
  useEffect(() => {
    alive.current = true;
    try { const saved = parseDistillationIntent(localStorage.getItem(storageKey)); pendingRef.current = saved; setPending(saved); setStorageOk(true); }
    catch { setError("无法读取本机提炼请求凭据，已暂停新增提炼。仍可刷新查看服务端记录。"); }
    setLoaded(true);
    return () => { alive.current = false; };
  }, [storageKey]);
  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ includeDistillations: "1", ...(pendingRef.current ? { distillationRequestId: pendingRef.current.clientRequestId } : {}) });
        const value = await request<Basis>(`operations/${encodeURIComponent(operation.id)}/skill-candidates?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setBasis(value); setStale(false);
        // Only the exact server receipt can retire a disconnected request.
        if (pendingRef.current && value.distillation.requested?.clientRequestId === pendingRef.current.clientRequestId && value.distillation.requested.status === "completed") {
          try { persist(null); } catch { setStorageOk(false); setError("无法更新本机请求凭据，请保留原请求并刷新核实。"); }
        }
        if (value.distillation.blocked || pendingRef.current) timer = setTimeout(() => { void read(); }, 3000);
      } catch (cause) { if (!controller.signal.aborted) { setStale(true); setError(cause instanceof Error ? cause.message : "连接中断，请刷新原记录。"); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [loaded, operation.id, revision, persist]);

  async function distill(recover = false) {
    if (!writable || !storageOk || busyRef.current || !basis || stale || loading) return;
    if (recover ? !pendingRef.current : !!pendingRef.current || basis.distillation.blocked || ["draft", "in_review", "approved"].includes(basis.distillation.candidate?.status ?? "") || consent !== basis.reportVersionDigest) return;
    const intent = recover ? pendingRef.current! : { clientRequestId: crypto.randomUUID(), reportVersionDigest: basis.reportVersionDigest };
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    let recorded = false;
    try {
      persist(intent); // Save the authorization and report binding before any paid call.
      recorded = true;
      setConsent("");
      const result = await request<{ item: Candidate }>(`operations/${encodeURIComponent(operation.id)}/skill-candidates/distill`, post(intent));
      if (!alive.current) return;
      setBasis(value => value ? { ...value, distillation: { ...value.distillation, candidate: result.item } } : value);
      persist(null); setNotice("Skill 草稿已生成，请审阅候选正文。");
    } catch (cause) { if (alive.current) { if (!recorded) setStorageOk(false); setError(`${cause instanceof Error ? cause.message : "连接中断"}。保留原请求，刷新只读核实；不会自动重新调用模型。`); } }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setStale(true); setRevision(value => value + 1); } }
  }
  async function review(status: string) {
    const candidate = basis?.distillation.candidate;
    if (!candidate || !writable || busyRef.current || stale || loading || !["draft", "in_review"].includes(candidate.status) || new TextEncoder().encode(note).length > 2000) return;
    if (status !== "rejected" && !candidateContent(candidate.content)) return;
    if (status === "approved" && candidate.reportVersionDigest !== basis?.reportVersionDigest) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await request(`skill-candidates/${encodeURIComponent(candidate.id)}/review`, post({ status, expectedVersion: candidate.version, contentDigest: candidate.contentDigest, note }));
      if (alive.current) { setNotice("审核状态已保存。"); setNote(""); }
    } catch (cause) { if (alive.current) setError(`${cause instanceof Error ? cause.message : "审核连接中断"}。请刷新核实当前候选后再操作。`); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setStale(true); setRevision(value => value + 1); } }
  }
  async function withdraw() {
    const intent = pendingRef.current;
    if (!intent || !writable || !storageOk || busyRef.current || loading || stale || basis?.distillation.blocked) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ withdrawn: boolean }>(`operations/${encodeURIComponent(operation.id)}/skill-candidates/distill`, post({ ...intent, withdrawAuthorization: true }));
      if (!alive.current) return;
      if (typeof result.withdrawn !== "boolean") throw Error("撤回回执无效，请刷新核实原请求");
      persist(null); setConsent(""); setNotice(result.withdrawn ? "原未派发授权已撤回。请重新核对当前报告并勾选授权后发起新尝试。" : "原请求已结束。请核对当前候选与报告后再操作。");
    } catch (cause) { if (alive.current) setError(`${cause instanceof Error ? cause.message : "撤回响应中断"}。保留原请求，刷新核实撤回结果。`); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setStale(true); setRevision(value => value + 1); } }
  }
  const candidate = basis?.distillation.candidate;
  const content = candidate && candidateContent(candidate.content) ? candidate.content : null;
  const publication = candidate?.publication;
  const blocked = basis?.distillation.blocked;
  const latest = basis?.distillation.latest;
  const canStart = writable && storageOk && !busy && !loading && !stale && !pending && !blocked && !["draft", "in_review", "approved"].includes(candidate?.status ?? "");
  return <div className="ai-pi-business-card">
    <header><strong>任务方法 → Skill 候选</strong><button type="button" className="ai-workbench-text" disabled={busy} onClick={() => { setError(""); setStale(true); setRevision(value => value + 1); }}>刷新提炼记录</button></header>
    {error && <p role="alert" className="ai-workbench-feedback is-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && !basis && <p role="status">正在读取报告依据与提炼记录…</p>}
    {basis && <><p>来源：{operation.id} · 模型：{modelName}（配置版本 {basis.reportVersion.modelVersion}）</p>
      <p>依据含 {basis.citableExportIds.length} 项取数来源、{basis.citableFileIds.length} 项附件、{basis.confirmedFeedbackIds.length} 条已确认修正。{!basis.coverage.sourcesComplete && "来源覆盖不完整，缺数仍须保留。"}{Object.values(basis.coverage.truncated).some(Boolean) && "依据列表存在截断，请审核覆盖范围。"}</p>
      <details><summary>报告版本与请求标识</summary><p>报告版本：<code>{basis.reportVersionDigest}</code></p><p>模型标识：<code>{basis.reportVersion.modelId}</code></p>{pending && <p>原请求：<code>{pending.clientRequestId}</code><br />绑定报告：<code>{pending.reportVersionDigest}</code></p>}</details>
      {(pending || blocked) && <p role="status">{latest?.status === "unknown" ? "提炼结果未知，已阻止新请求，请核实原派发。" : "原提炼请求正在核实，不能新建重复提炼。"}刷新只读取记录。</p>}
      {pending && pending.reportVersionDigest !== basis.reportVersionDigest && <p role="alert">报告版本已变化，原授权仍绑定旧版本。请先撤回原未派发授权，再重新确认当前报告。</p>}
      {pending && !blocked && <div className="ai-pi-actions">{pending.reportVersionDigest === basis.reportVersionDigest && <button type="button" className="secondary-button" disabled={!writable || !storageOk || busy || loading || stale} onClick={() => { void distill(true); }}>继续原请求 / 取回结果</button>}<button type="button" className="secondary-button" disabled={!writable || !storageOk || busy || loading || stale} onClick={() => { void withdraw(); }}>撤回未派发授权，重新确认</button></div>}
      {latest?.status === "completed" && latest.errorCode && <p role="status">上次提炼已明确结束，未生成草稿（{latest.errorCode}）。修复原因后，可重新确认当前依据发起新尝试。</p>}
      {!candidate || ["rejected", "superseded"].includes(candidate.status) ? <><label className="ai-pi-distillation-consent"><input type="checkbox" checked={consent === basis.reportVersionDigest} disabled={!canStart} onChange={event => setConsent(event.target.checked ? basis.reportVersionDigest : "")} />允许按以上报告版本，使用原任务模型调用一次，提炼为待审核草稿（可能产生模型费用）。</label><button type="button" className="primary-button" disabled={!canStart || consent !== basis.reportVersionDigest} onClick={() => { void distill(); }}>{busy ? "正在处理…" : latest?.errorCode ? "重新提炼草稿" : "提炼 Skill 草稿"}</button></> : null}
      {candidate && <details className="ai-pi-candidate" open><summary>候选正文与审核 · {statusLabels[candidate.status] ?? candidate.status}</summary>
        {content ? <><h4>{content.goal}</h4><p className="ai-pi-candidate-body">{content.body}</p>
        <h4>参数与口径</h4>{content.parameters.length ? <ul>{content.parameters.map((item, index) => <li key={index}><strong>{item.name} · {item.required ? "必填" : "可选"} · {item.kind}</strong><p>{item.meaning}<br />默认规则：{item.defaultRule || "待确认"}</p></li>)}</ul> : <p>无登记参数</p>}
        <h4>执行步骤</h4><ol>{content.steps.map((item, index) => <li key={index}>{item.action}<p>工具：{item.toolName || "无"}<br />缺数分支：{item.missingDataBranch || "待确认"}</p></li>)}</ol>
        {([["所需工具", content.requiredTools], ["模板引用", content.templateRefs], ["来源引用", content.sourceEvidenceRefs], ["未验证建议", content.unverifiedRecommendations], ["待确认问题", content.openQuestions]] as [string, string[]][]).map(([title, items]) => <div key={title}><h4>{title}</h4>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>无</p>}</div>)}</> : <><p role="alert">候选正文格式异常，无法完整审阅。已禁止批准或标记审核中；可以查看原始正文并退回候选。</p><details open><summary>原始候选正文</summary><pre>{JSON.stringify(candidate.content, null, 2)}</pre></details></>}
        <p>保留 {candidate.unverifiedRecommendations} 条未验证建议。管理员在 AI 助理 → Skill 管理发布已批准的文字方法。</p>
        {candidate.status === "approved" && <p role="status">
          {publication?.state === "enabled" ? "文字方法已发布并启用。" : publication?.state === "disabled" ? "文字方法已发布，当前已停用。" : publication?.state === "unpublished" ? "已批准，待管理员发布文字方法。" : "文字方法发布状态待核实。"}
          {publication?.publishedLibraryVersion != null && <> 发布版本 v{publication.publishedLibraryVersion} · 当前资源库 v{publication.libraryVersion} · <code>{publication.skillId}</code></>}
        </p>}
        {candidate.reportVersionDigest !== basis.reportVersionDigest && <p role="alert">{candidate.status === "approved" ? "此批准绑定原报告版本。当前报告依据已有更新。" : "报告依据已有更新。请退回该候选，再按当前版本提炼。"}</p>}
        <details><summary>候选版本</summary><p>{candidate.id} · 版本 {candidate.version}</p><p>内容：{candidate.contentDigest}<br />来源报告：{candidate.reportVersionDigest}</p>{candidate.reviewNote && <p>审核备注：{candidate.reviewNote}</p>}</details>
        {["draft", "in_review"].includes(candidate.status) && <><label className="ai-pi-distillation-note">审核备注<textarea aria-label="Skill 候选审核备注" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} disabled={!writable || busy} /></label><small>{new TextEncoder().encode(note).length} / 2000 字节</small><div className="ai-pi-actions">{candidate.status === "draft" && <button type="button" className="secondary-button" disabled={!content || !writable || busy || loading || stale} onClick={() => { void review("in_review"); }}>标记审核中</button>}<button type="button" className="secondary-button" disabled={!writable || busy || loading || stale || new TextEncoder().encode(note).length > 2000} onClick={() => { void review("rejected"); }}>退回候选</button><button type="button" className="primary-button" disabled={!content || !writable || busy || loading || stale || candidate.reportVersionDigest !== basis.reportVersionDigest || new TextEncoder().encode(note).length > 2000} onClick={() => { void review("approved"); }}>批准此版本</button></div></>}
      </details>}
    </>}
  </div>;
}
