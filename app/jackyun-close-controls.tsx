"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentUser } from "./module-view-shared";
import type { JackyunCloseIdentity, JackyunCloseTarget } from "@/lib/jackyun/operator-close-contract";
type Pending = { requestId: string; body: { action: "close"; target: JackyunCloseIdentity; closeRequestId?: string } };
const names: Record<string, string> = { products: "货品", inventory: "库存", inventory_age: "库龄", sales: "销售", combos: "组合装" };
const eventName = "jackyun-close-request-updated";

export function JackyunCloseControls({ currentUser }: { currentUser: CurrentUser | null }) {
  const allowed = currentUser?.role === "admin" && currentUser.scopeRestricted !== true;
  const storageKey = `teruisi:jackyun-close:${currentUser?.email ?? "anonymous"}`;
  const [target, setTarget] = useState<JackyunCloseTarget | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null), generation = useRef(0), submitting = useRef(false), epoch = useRef(0);
  const readPending = useCallback(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Pending | null;
      if (value && /^[a-f0-9-]{36}$/.test(value.requestId) && value.body?.action === "close") pending.current = value;
      else pending.current = null;
    } catch { /* The in-memory request still prevents duplicates in this tab. */ }
    return pending.current;
  }, [storageKey]);
  const refresh = useCallback(async () => {
    if (!allowed) return;
    const sequence = ++generation.current, saved = readPending();
    try {
      const response = await fetch(`/api/imports/recovery/close${saved ? `?requestId=${encodeURIComponent(saved.body.closeRequestId ?? saved.requestId)}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(35000) });
      const value = await response.json() as JackyunCloseTarget & { error?: string; message?: string };
      if (!response.ok || value.ok !== true) throw new Error(value.message ?? value.error ?? "闭合状态暂时无法核实。");
      if (sequence !== generation.current) return;
      setTarget(value);
      if (value.state === "closed" && saved) { pending.current = null; try { localStorage.removeItem(storageKey); } catch {} }
    } catch (error) { if (sequence === generation.current) { setTarget(null); setMessage(error instanceof Error ? error.message : "闭合状态暂时无法核实。"); } }
  }, [allowed, readPending, storageKey]);
  useEffect(() => {
    ++epoch.current;
    pending.current = null; submitting.current = false; setBusy(false); setTarget(null); setMessage(""); void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(update, 30000);
    window.addEventListener(eventName, update); window.addEventListener("storage", update);
    return () => { ++epoch.current; ++generation.current; clearInterval(timer); window.removeEventListener(eventName, update); window.removeEventListener("storage", update); };
  }, [refresh]);
  const submit = async () => {
    if (submitting.current || !allowed || !target?.closeAllowed || !target.target) return;
    const submittedEpoch = epoch.current;
    const previous = readPending();
    const expired = target.state === "closing" && !!target.authorizationExpiresAt && Date.parse(target.authorizationExpiresAt) <= Date.now();
    const sameTarget = previous && JSON.stringify(previous.body.target) === JSON.stringify(target.target);
    const operation: Pending = sameTarget && !expired ? previous : { requestId: crypto.randomUUID(), body: { action: "close", target: target.target,
      ...(target.state === "closing" && target.authorizationId ? { closeRequestId: target.authorizationId } : {}) } };
    pending.current = operation;
    try { localStorage.setItem(storageKey, JSON.stringify(operation)); } catch {}
    submitting.current = true; setBusy(true); setMessage(""); ++generation.current;
    window.dispatchEvent(new Event(eventName));
    try {
      const response = await fetch("/api/imports/recovery/close", { method: "POST", headers: { "content-type": "application/json", "x-teruisi-close-request-id": operation.requestId }, body: JSON.stringify(operation.body), signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (epoch.current !== submittedEpoch) return;
      if (!response.ok || result.ok !== true || result.state !== "closed") throw new Error(result.message ?? result.error ?? "闭合结果未确认，请刷新原请求。");
      setMessage("已闭合。已导入数据保留，可在 n8n 手动开始新的完整运行。");
      pending.current = null; try { localStorage.removeItem(storageKey); } catch {}
    } catch (error) { if (epoch.current === submittedEpoch) setMessage(`${error instanceof Error ? error.message : "闭合结果未确认。"} 请求编号：${operation.requestId}。刷新只核对原结果。`); }
    finally { if (epoch.current === submittedEpoch) { submitting.current = false; setBusy(false); await refresh(); if (epoch.current === submittedEpoch) window.dispatchEvent(new Event(eventName)); } }
  };
  if (!allowed) return null;
  const committed = target?.modules?.filter(m => m.status.startsWith("committed_")) ?? [];
  const unknown = target?.modules?.filter(m => m.status === "unknown") ?? [];
  return <section className="import-close-controls" aria-label="吉客云一键闭合">
    <strong>一键闭合{target?.logicalExecutionId ? ` · 任务 #${target.logicalExecutionId}` : ""}</strong>
    <p>保留已导入数据，结束未完成任务。闭合后可手动重新运行。</p>
    {committed.length > 0 && <p>部分导入：{committed.map(m => names[m.module] ?? m.module).join("、")}已提交，数据保留。</p>}
    {unknown.length > 0 && <p>结果未确认：{unknown.map(m => names[m.module] ?? m.module).join("、")}；原证据继续保留。</p>}
    <div className="import-chain-actions"><button type="button" className="secondary-button" disabled={busy || !target?.closeAllowed} onClick={() => void submit()}>{busy ? "正在闭合…" : target?.state === "closing" ? "继续该次闭合" : "一键闭合"}</button><button type="button" className="text-button" onClick={() => void refresh()}>刷新状态</button></div>
    <small role="status">{message || target?.reason || "正在核对原任务与已导入数据…"}</small>
  </section>;
}
