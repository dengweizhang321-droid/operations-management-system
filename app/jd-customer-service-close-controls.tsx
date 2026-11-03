"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentUser } from "./module-view-shared";

type CloseIdentity = import("@/lib/jd/customer-service-close-contract").CustomerServiceCloseIdentity;
type CloseTarget = import("@/lib/jd/customer-service-close-contract").CustomerServiceCloseTarget;
type AuthorityTarget = Omit<CloseIdentity, "shopName" | "shopId">;
const pendingProtocol = "jd-customer-service-operator-request-v2";
type Pending = { version?: typeof pendingProtocol; requestId: string; body: { action: "close" | "verify"; target: AuthorityTarget } };

const stores: { storeKey: string; shopName: string }[] = [
  { storeKey: "jd-yiyong-director", shopName: "志高商用设备旗舰店" },
  { storeKey: "jd-maidehao-operator1", shopName: "志高切肉机旗舰店" },
  { storeKey: "jd-chudian-weizhang", shopName: "志高商用厨电旗舰店" },
  { storeKey: "jd-cuizhiwang-dengweizhang", shopName: "志高商用洗碗机旗舰店" },
];
const kindLabel: Record<CloseIdentity["kind"], string> = { pre_export_zero_effect: "来源为空（未产生业务效果）", downloaded_pair: "两个来源文件已下载", downloaded_list_only: "仅列表文件下载，消息导出前失败", executed_verify: "已执行，续接原 C 验证" };
const eventName = "jd-customer-service-close-request-updated";

export function JdCustomerServiceCloseControls({ currentUser }: { currentUser: CurrentUser | null }) {
  const allowed = currentUser?.role === "admin" && currentUser.scopeRestricted !== true;
  const storageKeyFor = (storeKey: string) => `teruisi:jd-customer-service-close:${currentUser?.email ?? "anonymous"}:${storeKey}`;
  const [storeKey, setStoreKey] = useState(stores[0].storeKey);
  const [target, setTarget] = useState<CloseTarget | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [legacyPending, setLegacyPending] = useState(false);
  const storedRecordBlocked = useRef(false);
  const pending = useRef<Pending | null>(null), generation = useRef(0), submitting = useRef(false), epoch = useRef(0);
  const readPending = useCallback((key: string) => {
    try {
      const raw = localStorage.getItem(storageKeyFor(key));
      const value = JSON.parse(raw ?? "null") as Pending | null;
      const recognized = value && /^[a-f0-9-]{36}$/.test(value.requestId) && ["close", "verify"].includes(value.body?.action);
      const legacy = recognized && value.version === undefined;
      storedRecordBlocked.current = raw !== null && !(recognized && value.version === pendingProtocol);
      setLegacyPending(!!legacy);
      pending.current = recognized ? value : null;
    } catch { storedRecordBlocked.current = true; setLegacyPending(false); /* Keep any in-memory request and the stored record. */ }
    return pending.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);
  const refresh = useCallback(async () => {
    if (!allowed) return;
    const sequence = ++generation.current, key = storeKey, saved = readPending(key);
    if (storedRecordBlocked.current) {
      setTarget(null); setDone(false);
      setMessage(saved?.version === undefined && saved ? "这是旧版来源恢复许可的本机记录，不代表旧任务已闭合。原记录保留；仅可显式归档本机旧记录后重新核对目标并另行授权。" : "本机请求记录无法确认，已保留；不能更换编号覆盖未知结果。");
      return;
    }
    try {
      if (saved) {
        const response = await fetch(`/api/imports/recovery/customer-service-close?authorizationId=${encodeURIComponent(saved.requestId)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
        const value = await response.json();
        if (sequence !== generation.current) return;
        if (response.ok && value?.ok === true) { setMessage(value.outcome === "completed" ? "原任务已完成独立验证并收尾。" : "原失败任务已闭合，原件保留；后续正常 A 按新窗口重新采集，不需恢复摘要头。"); setDone(true); return; }
        setMessage(value?.error ?? value?.message ?? "原闭合请求尚未确认。"); setDone(false);
      }
      const response = await fetch(`/api/imports/recovery/customer-service-close?storeKey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const value = await response.json() as CloseTarget & { error?: string };
      if (!response.ok || value.ok !== true) throw new Error(value.error ?? "闭合目标暂时无法核实。");
      if (sequence !== generation.current) return;
      setTarget(value); setDone(false); if (!saved) setMessage("");
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
    if (storedRecordBlocked.current || previous && previous.version !== pendingProtocol) { setMessage("原本机记录尚未处理，不能换号提交。"); return; }
    const sameTarget = previous && previous.body.target.originalPlanSha256 === target.target.originalPlanSha256 && previous.body.target.originalExecutionId === target.target.originalExecutionId && previous.body.target.storeKey === target.target.storeKey;
    if (previous && !sameTarget) { setMessage("已有未确认请求，请先刷新原结果，不能更换编号覆盖未知状态。"); return; }
    const { shopName: _shopName, shopId: _shopId, ...authorityTarget } = target.target;
    const operation: Pending = previous ?? { version: pendingProtocol, requestId: crypto.randomUUID(), body: { action: target.target.kind === "executed_verify" ? "verify" : "close", target: authorityTarget } };
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
      setMessage(result.outcome === "completed" ? "已复用原 C 判据完成验证并收尾；未重跑导出或导入。" : "旧失败任务已闭合，原失败与来源原件保留。后续定时任务将按新日期范围重新采集；本次闭合不代表新数据已导入。");
      setDone(true);
    } catch (error) { if (epoch.current === submittedEpoch) setMessage(`${error instanceof Error ? error.message : "闭合结果未确认。"} 请求编号：${operation.requestId}。刷新只核对原结果。`); }
    finally { if (epoch.current === submittedEpoch) { submitting.current = false; setBusy(false); await refresh(); if (epoch.current === submittedEpoch) window.dispatchEvent(new Event(eventName)); } }
  };
  const archiveLegacy = () => {
    if (busy || !allowed || !legacyPending) return;
    try {
      const key = storageKeyFor(storeKey), raw = localStorage.getItem(key);
      if (!raw) return;
      const value = JSON.parse(raw) as Pending;
      if (value.version !== undefined || value.requestId !== pending.current?.requestId || !/^[a-f0-9-]{36}$/.test(value.requestId)) return;
      const archiveKey = `${key}:legacy-archive:${value.requestId}`;
      const archived = localStorage.getItem(archiveKey);
      if (archived !== null && archived !== raw) throw new Error();
      localStorage.setItem(archiveKey, raw);
      if (localStorage.getItem(archiveKey) !== raw || localStorage.getItem(key) !== raw) throw new Error();
      localStorage.removeItem(key);
      pending.current = null; storedRecordBlocked.current = false; setLegacyPending(false); setDone(false);
      void refresh(); window.dispatchEvent(new Event(eventName));
    } catch { setMessage("旧本机记录未完成归档，原记录保持；请保留原请求编号。"); }
  };
  if (!allowed) return null;
  const t = target?.target;
  return <section className="import-close-controls" aria-label="京东客服人工闭合">
    <strong>京东客服人工闭合{t ? ` · 任务 #${t.originalExecutionId}` : ""}</strong>
    <p>失败任务保留原件并闭合；已执行任务可续接原 C 验证收尾。操作均不重跑导出或导入。</p>
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
    {t && target?.closeAllowed && !done && <p>提交只处理上述精确任务；失败闭合后由后续正常 A 开新窗口，已执行任务则续接原 C 验证。</p>}
    <div className="import-chain-actions">
      <button type="button" className="secondary-button" disabled={busy || !target?.closeAllowed || done} onClick={() => void submit()}>{busy ? "正在处理…" : t?.kind === "executed_verify" ? "续接验证收尾" : "人工闭合"}</button>
      <button type="button" className="text-button" onClick={() => void refresh()}>刷新状态</button>
      {legacyPending && <button type="button" className="text-button" disabled={busy} onClick={archiveLegacy}>归档旧版本机记录并重新核对</button>}
      {done && <button type="button" className="text-button" onClick={() => { localStorage.removeItem(storageKeyFor(storeKey)); pending.current = null; setDone(false); void refresh(); }}>查看当前任务</button>}
    </div>
    <small role="status">{message || target?.reason || "正在核对该店当前卡住的任务…"}</small>
  </section>;
}
