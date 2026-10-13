"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Target = { state: "empty" | "failed" | "waiting" | "completed" | "blocked"; newCollectionAllowed: boolean;
  logicalExecutionId?: string; failedExecutionId?: string; snapshotDate?: string; salesStartDate?: string; salesEndDate?: string };
export function JackyunRecoveryControls() {
  const [target, setTarget] = useState<Target | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/imports/recovery/run", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || value.ok !== true) throw new Error(value.message ?? value.error ?? "原运行身份无法确认，请核查辅助服务。");
      setTarget(value);
    } catch (error) { setTarget(null); setMessage(error instanceof Error ? error.message : "原运行状态无法确认。"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const submit = async (kind: "retry" | "new") => {
    if (busy || !target || kind === "retry" && (!target.logicalExecutionId || !target.failedExecutionId)) return;
    const key = `${kind}:${target.logicalExecutionId ?? "empty"}:${target.failedExecutionId ?? "empty"}`;
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/imports/recovery/run", { method: "POST", headers: { "content-type": "application/json", "x-teruisi-recovery-request-id": pending.current.id },
        body: JSON.stringify(kind === "new" ? { kind } : { kind, logicalExecutionId: target.logicalExecutionId, failedExecutionId: target.failedExecutionId }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.message ?? result.error ?? "派发结果未确认，请保留同一请求编号并核查原执行。");
      setMessage(result.status === "error" ? "原完整执行已停止。请查看具体障碍，处理后完整重试。" : "完整执行请求已受理。系统会核验原进度，并等待、接续或说明所需人工动作；以五类批次验收为准。");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "原派发结果无法确认，请核查原执行。"); }
    finally { setBusy(false); }
  };
  return <section className="n8n-workflow-card" aria-label="吉客云完整恢复">
    <h3>完整恢复与新采集</h3>
    {target?.logicalExecutionId && <p>重试运行 {target.logicalExecutionId}（执行尝试 {target.failedExecutionId}）。库存采集日 {target.snapshotDate}；销售 {target.salesStartDate} 至 {target.salesEndDate}。</p>}
    <p>完整重试会先核验原任务、文件及已导入批次。新采集使用新的实际采集日和销售范围。</p>
    <div className="report-actions">
      <button type="button" onClick={() => void submit("retry")} disabled={busy || !target || !["failed", "completed"].includes(target.state)}>{busy ? "正在协调" : target?.state === "waiting" ? "等待原运行" : target?.state === "completed" ? "完整复验已完成运行" : "完整重试原运行"}</button>
      <button type="button" onClick={() => void submit("new")} disabled={busy || !target?.newCollectionAllowed}>新采集</button>
      <button type="button" onClick={() => void refresh()} disabled={busy}>刷新状态</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
