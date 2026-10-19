"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const piBusinessChoices = [
  { value: "create_work_plan", label: "创建工作计划" },
  { value: "save_replenishment_draft", label: "保存补货草稿" },
  { value: "execute_registered_gap", label: "准备补缺执行" },
  { value: "deliver_report", label: "准备报告投递" },
] as const;
type Action = { actionId: string; actionType: string; status: string; version: number; previewDigest: string; preview: Record<string, unknown>; result: Record<string, unknown>; confirmationExpiresAt?: string; cancelRequested?: boolean; errorCode?: string; parentOperationId: string; invocationId: string; controls?: { clientRequestId: string; command: string; status: string }[] };
type Pending = { clientRequestId: string; actionId: string; command: string };
type Snapshot = { items: Action[]; hasMore?: boolean; acknowledgedClientRequestIds?: string[] };
const states: Record<string, string> = { prepared: "待确认", queued: "排队", claimed: "执行中", dispatched: "执行中", succeeded: "成功", failed: "失败", canceled: "已取消", unknown: "结果未知" };
const titles = Object.fromEntries(piBusinessChoices.map(item => [item.value, item.label]));
const fields: Record<string, string> = { title: "标题", goal: "目标", workContent: "事项", owner: "负责人", shopName: "店铺", startDate: "开始日期", endDate: "结束日期", due: "截止日期", priority: "紧急程度", warehouse: "仓库", productCode: "货品代码", plannedQuantity: "草稿数量", suggestedQuantity: "建议数量", availableQuantity: "可用库存", inTransitQuantity: "在途", outbound30dQuantity: "近30日销量", dataDate: "数据日期", missingInformation: "缺失信息", disclosures: "说明", caption: "正文", recipientName: "接收对象", recipientType: "接收类型", robotName: "机器人", channel: "渠道", fileName: "附件", sizeBytes: "附件字节数", sha256: "附件摘要", targetVersion: "来源版本", workflowId: "工作流", workflowVersion: "工作流版本", dataset: "数据集", status: "状态", executionId: "本次执行", objectId: "业务对象", objectType: "业务类型", receipt: "回执", url: "打开对象", objectUrl: "打开对象", reason: "原因", notes: "备注", source: "数据来源", scope: "范围", coverage: "目标覆盖", download: "文件下载", imports: "导入批次", workflow: "工作流结果", accepted: "工作流受理" };
function safeLink(value: string) { return value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value); }
function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return <span>暂无</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (depth > 5) return <span>详见来源回执</span>;
  if (Array.isArray(value)) return value.length ? <ul>{value.slice(0, 40).map((item, index) => <li key={index}><Value value={item} depth={depth + 1} /></li>)}</ul> : <span>无</span>;
  return <dl className="ai-pi-business-values">{Object.entries(value).slice(0, 60).map(([key, item]) => <div key={key}><dt>{fields[key] ?? key}</dt><dd>{["url", "objectUrl"].includes(key) && typeof item === "string" && safeLink(item) ? <a href={item}>打开对象</a> : <Value value={item} depth={depth + 1} />}</dd></div>)}</dl>;
}

export default function AiPiBusinessActions({ sessionId, epoch, generation, ownerKey, writable }: { sessionId: string; epoch: number; generation: number; ownerKey: string; writable: boolean }) {
  const identity = `${ownerKey}:business:${sessionId}:${epoch}:${generation}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ items: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [revision, setRevision] = useState(0);
  const alive = useRef("");
  const pendingRef = useRef<Pending[]>([]);
  const busyRef = useRef(false);
  const persist = useCallback((items: Pending[]) => { localStorage.setItem(identity, JSON.stringify(items)); pendingRef.current = items; setPending(items); }, [identity]);
  useEffect(() => {
    alive.current = identity; setSnapshot({ items: [] }); setError(""); setReady(false);
    try { const items: unknown = JSON.parse(localStorage.getItem(identity) || "[]"); if (!Array.isArray(items) || !items.every(item => item && typeof item.clientRequestId === "string" && typeof item.actionId === "string" && typeof item.command === "string")) throw Error(); pendingRef.current = items; setPending(items); setReady(true); }
    catch { setError("无法保存业务请求凭据，已暂停新增操作。仍可只读查看原记录。"); }
    return () => { alive.current = ""; };
  }, [identity]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/ai/pi/sessions/${encodeURIComponent(sessionId)}/business-actions`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "读取业务记录失败");
        if (controller.signal.aborted || alive.current !== identity) return;
        setSnapshot(data); setError("");
        const acknowledged = new Set<string>(data.acknowledgedClientRequestIds ?? (data.items ?? []).flatMap((item: Action) => (item.controls ?? []).map(control => control.clientRequestId)));
        const remaining = pendingRef.current.filter(item => !acknowledged.has(item.clientRequestId));
        if (remaining.length !== pendingRef.current.length) persist(remaining);
      } catch (cause) { if (!controller.signal.aborted && alive.current === identity) setError(cause instanceof Error ? cause.message : "连接中断，请读取原回执。"); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void read(); }, 2500); }
    }
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, identity, revision, persist]);
  async function command(action: Action, name: string) {
    if (!ready || !writable || busyRef.current || pendingRef.current.length) return;
    const request: Pending = { clientRequestId: crypto.randomUUID(), actionId: action.actionId, command: name };
    busyRef.current = true; setBusy(true); setError(""); let recorded = false;
    try {
      persist([...pendingRef.current, request]); recorded = true;
      const response = await fetch(`/api/ai/pi/sessions/${encodeURIComponent(sessionId)}/business-actions`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, ...(name === "confirm" ? { expectedVersion: action.version, previewDigest: action.previewDigest } : {}) }) });
      const value = await response.json();
      if (alive.current !== identity) return;
      if (!response.ok) { if (response.status < 500) persist(pendingRef.current.filter(item => item !== request)); throw Error(value.error || "业务请求未确认"); }
      persist(pendingRef.current.filter(item => item !== request));
    } catch (cause) { if (alive.current === identity) { if (!recorded) setReady(false); setError(`${cause instanceof Error ? cause.message : "请求中断"}${recorded && pendingRef.current.some(item => item === request) ? "。保留原请求，只读核实回执，不会重新提交。" : ""}`); } }
    finally { busyRef.current = false; if (alive.current === identity) { setBusy(false); setRevision(value => value + 1); } }
  }
  if (!snapshot.items.length && !error && !pending.length) return null;
  return <section className="ai-pi-business" aria-label="业务执行与授权"><div className="ai-pi-business-heading"><h3>业务执行</h3><button type="button" className="ai-workbench-text" onClick={() => setRevision(value => value + 1)}>核实原回执</button></div>
    {error && <p role="alert" className="ai-workbench-feedback is-error">{error}</p>}
    {!!pending.length && <p role="status">原业务请求正在核实。刷新只读取状态，不重新提交。</p>}
    {snapshot.items.map(action => <article key={action.actionId} className="ai-pi-business-card"><header><strong>{titles[action.actionType] ?? "业务动作"}</strong><span>{action.cancelRequested && !["succeeded", "failed", "canceled"].includes(action.status) ? "取消请求 · " : ""}{states[action.status] ?? action.status}</span></header>
      <Value value={action.preview} />
      {action.status === "prepared" && <p>确认仅适用于以上对象、版本、店铺、日期、数量、正文、渠道和附件。有效期至 {action.confirmationExpiresAt ? new Date(action.confirmationExpiresAt).toLocaleString("zh-CN") : "服务端登记期限"}。</p>}
      {Object.keys(action.result ?? {}).length > 0 && <details open><summary>真实对象与执行回执</summary><Value value={action.result} /></details>}
      {action.errorCode && <p>未完成原因：{action.errorCode}</p>}
      {action.status === "unknown" && <p>效果尚未核实，保留原动作并阻止依赖写入。请协调原回执；不要新建同一动作或重发。</p>}
      <div className="ai-pi-actions">{action.status === "prepared" && <button type="button" className="primary-button" disabled={!writable || !ready || busy || !!pending.length} onClick={() => { void command(action, "confirm"); }}>确认以上范围并执行</button>}{["prepared", "queued", "claimed", "dispatched", "unknown"].includes(action.status) && !action.cancelRequested && <button type="button" className="secondary-button" disabled={!writable || !ready || busy || !!pending.length} onClick={() => { void command(action, "cancel"); }}>请求取消</button>}{["dispatched", "unknown"].includes(action.status) && <button type="button" className="ai-workbench-text" disabled={!writable || !ready || busy || !!pending.length} onClick={() => { void command(action, "reconcile"); }}>查询并协调原回执</button>}</div>
      <small>取消阻止后续派发；在途或已生效动作按真实回执展示。</small><details><summary>追溯标识</summary><p>动作 {action.actionId}<br />父操作 {action.parentOperationId}<br />调用 {action.invocationId}</p></details>
    </article>)}{snapshot.hasMore && <p>仅展示最近业务动作，记录未被删除。</p>}
  </section>;
}
