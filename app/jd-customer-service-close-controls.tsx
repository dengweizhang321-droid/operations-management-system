"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentUser } from "./module-view-shared";

type CloseIdentity = { storeKey: string; shopName: string; shopId: string;
  originalExecutionId: string; originalPlanSha256: string;
  failureCode: string; period: { scheduledDate: string; startDate: string; endDate: string };
  kind: "pre_export_zero_effect" | "downloaded_pair" };
type CloseTarget = { ok: true; closeAllowed: boolean; reason: string; target?: CloseIdentity };
type Pending = { requestId: string; body: { action: "close"; target: CloseIdentity; closeRequestId?: string } };

const stores: { storeKey: string; shopName: string }[] = [
  { storeKey: "jd-yiyong-director", shopName: "志高商用设备旗舰店" },
  { storeKey: "jd-maidehao-operator1", shopName: "志高切肉机旗舰店" },
  { storeKey: "jd-chudian-weizhang", shopName: "志高商用厨电旗舰店" },
  { storeKey: "jd-cuizhiwang-dengweizhang", shopName: "志高商用洗碗机旗舰店" },
];
const kindLabel: Record<CloseIdentity["kind"], string> = { pre_export_zero_effect: "来源为空（未产生业务效果）", downloaded_pair: "两个来源文件已下载" };
const eventName = "jd-customer-service-close-request-updated";

export function JdCustomerServiceCloseControls({ currentUser }: { currentUser: CurrentUser | null }) {
  const allowed = currentUser?.role === "admin" && currentUser.scopeRestricted !== true;
  const storageKeyFor = (storeKey: string) => `teruisi:jd-customer-service-close:${currentUser?.email ?? "anonymous"}:${storeKey}`;
  const [storeKey, setStoreKey] = useState(stores[0].storeKey);
  const [target, setTarget] = useState<CloseTarget | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pending = useRef<Pending | null>(null), generation = useRef(0), submitting = useRef(false), epoch = useRef(0);
  const readPending = useCallback((key: string) => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKeyFor(key)) ?? "null") as Pending | null;
      if (value && /^[a-f0-9-]{36}$/.test(value.requestId) && value.body?.action === "close") pending.current = value;
      else pending.current = null;
    } catch { /* The in-memory request still prevents duplicates in this tab. */ }
    return pending.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);
  const refresh = useCallback(async () => {
    if (!allowed) return;
    const sequence = ++generation.current, key = storeKey, saved = readPending(key);
    try {
      if (saved) {
        const response = await fetch(`/api/imports/recovery/customer-service-close?authorizationId=${encodeURIComponent(saved.body.closeRequestId ?? saved.requestId)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
        const value = await response.json();
        if (sequence !== generation.current) return;
        if (response.ok && value?.ok === true) { setMessage("原闭合请求已确认，审批文件已生成。可在 n8n 触发下一轮，带上返回的摘要头。"); setDone(true); return; }
        setMessage(value?.error ?? value?.message ?? "原闭合请求尚未确认。"); setDone(false); return;
      }
      const response = await fetch(`/api/imports/recovery/customer-service-close?storeKey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const value = await response.json() as CloseTarget & { error?: string };
      if (!response.ok || value.ok !== true) throw new Error(value.error ?? "闭合目标暂时无法核实。");
      if (sequence !== generation.current) return;
      setTarget(value); setDone(false); setMessage("");
    } catch (error) { if (sequence === generation.current) { setTarget(null); setMessage(error instanceof Error ? error.message : "闭合目标暂时无法核实。"); } }
  }, [allowed, readPending, storeKey]);
  useEffect(() => {
    ++epoch.current;
    pending.current = null; submitting.current = false; setBusy(false); setTarget(null); setMessage(""); setDone(false); void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(update, 30000);
    window.addEventListener(eventName, update); window.addEventListener("storage", update);
    return () => { ++epoch.current; ++generation.current; clearInterval(timer); window.removeEventListener(eventName, update); window.removeEventListener("storage", update); };
  }, [refresh]);
  const submit = async () => {
    if (submitting.current || !allowed || !target?.closeAllowed || !target.target) return;
    const submittedEpoch = epoch.current, key = storeKey;
    const previous = readPending(key);
    const sameTarget = previous && JSON.stringify(previous.body.target) === JSON.stringify(target.target);
    const operation: Pending = sameTarget ? previous : { requestId: crypto.randomUUID(), body: { action: "close", target: target.target } };
    pending.current = operation;
    try { localStorage.setItem(storageKeyFor(key), JSON.stringify(operation)); } catch {}
    submitting.current = true; setBusy(true); setMessage(""); ++generation.current;
    window.dispatchEvent(new Event(eventName));
    try {
      const response = await fetch("/api/imports/recovery/customer-service-close", { method: "POST",
        headers: { "content-type": "application/json", "x-teruisi-jd-customer-service-close-request-id": operation.requestId },
        body: JSON.stringify(operation.body), signal: AbortSignal.timeout(40000) });
      const result = await response.json();
      if (epoch.current !== submittedEpoch) return;
      if (!response.ok || result.ok !== true) throw new Error(result.message ?? result.error ?? "闭合结果未确认，请刷新原请求。");
      setMessage(`已生成闭合审批（摘要 ${String(result.approvalSha256 ?? "").slice(0, 12)}…）。只结束该旧逻辑任务，保留原失败、文件与已导入数据；不标记成功、不自动重试。可在 n8n 触发下一轮，并带上该摘要对应的请求头。`);
      setDone(true);
    } catch (error) { if (epoch.current === submittedEpoch) setMessage(`${error instanceof Error ? error.message : "闭合结果未确认。"} 请求编号：${operation.requestId}。刷新只核对原结果。`); }
    finally { if (epoch.current === submittedEpoch) { submitting.current = false; setBusy(false); await refresh(); if (epoch.current === submittedEpoch) window.dispatchEvent(new Event(eventName)); } }
  };
  if (!allowed) return null;
  const t = target?.target;
  return <section className="import-close-controls" aria-label="京东客服人工闭合">
    <strong>京东客服人工闭合{t ? ` · 任务 #${t.originalExecutionId}` : ""}</strong>
    <p>只结束该旧逻辑任务，保留原失败、文件与已导入数据；不标记成功、不自动重试。</p>
    <div className="import-chain-actions"><label>店铺<select aria-label="京东客服店铺" value={storeKey} disabled={busy}
      onChange={(e) => { setStoreKey(e.target.value); setTarget(null); setMessage(""); setDone(false); pending.current = null; ++generation.current; }}>
      {stores.map((s) => <option key={s.storeKey} value={s.storeKey}>{s.shopName}</option>)}
    </select></label></div>
    {t && <dl className="import-run-facts">
      <div><dt>店铺</dt><dd>{t.shopName}（{t.shopId}）</dd></div>
      <div><dt>原执行编号</dt><dd>{t.originalExecutionId}</dd></div>
      <div><dt>原失败码</dt><dd>{t.failureCode || "（缺失）"}</dd></div>
      <div><dt>业务区间</dt><dd>{t.period.startDate} ~ {t.period.endDate}（计划日 {t.period.scheduledDate}）</dd></div>
      <div><dt>建议恢复种类</dt><dd>{kindLabel[t.kind]}</dd></div>
      <div><dt>原计划摘要</dt><dd>{t.originalPlanSha256}</dd></div>
    </dl>}
    {t && target?.closeAllowed && !done && <p>提交后将只闭合上述这一次失败，不影响其他执行或已导入数据。确认身份与业务区间无误后再提交。</p>}
    <div className="import-chain-actions">
      <button type="button" className="secondary-button" disabled={busy || !target?.closeAllowed || done} onClick={() => void submit()}>{busy ? "正在闭合…" : "人工闭合"}</button>
      <button type="button" className="text-button" onClick={() => void refresh()}>刷新状态</button>
    </div>
    <small role="status">{message || target?.reason || "正在核对该店当前卡住的任务…"}</small>
  </section>;
}
