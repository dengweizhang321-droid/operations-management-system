"use client";

import { useEffect, useRef, useState } from "react";

type Evidence = { text: string; truncated: boolean; sha256: string };
type UserRecord = { controlId: string; controlSeq: number; command: string; status: string; evidence: Evidence };
type SourceControl = { controlId: string; controlSeq: number; text: string; offset: number; nextOffset: number | null; totalCharacters: number; sha256: string };
export type PiRecovery = {
  available: boolean;
  binding?: { epoch: number; generation: number; throughEventSeq: number; throughControlSeq: number };
  goal?: Evidence & { operationId: string };
  plan?: { revision: number; evidence: Evidence };
  userDecisionsAndCorrections?: { items: UserRecord[]; hasMore: boolean; nextBeforeControlSeq: number | null };
  contextBudget?: { inputBudgetTokens?: number; contextWindowTokens?: number; reservedOutputTokens?: number; toolReserveTokens?: number };
  compaction?: { blockers: string[] };
  sourceControl?: SourceControl;
};

export default function AiPiRecovery({ sessionId, value }: { sessionId: string; value?: PiRecovery }) {
  const [page, setPage] = useState<PiRecovery | null>(null);
  const [source, setSource] = useState<SourceControl | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  if (!value?.available) return null;
  const records = page?.userDecisionsAndCorrections ?? value.userDecisionsAndCorrections;
  const budget = value.contextBudget;
  const read = async (params: Record<string, string>, original = false) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/ai/pi/sessions/${encodeURIComponent(sessionId)}/workspace?${new URLSearchParams(params)}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(result.error || "原记录读取失败");
      const recovered = result.recovery as PiRecovery;
      if (recovered.binding?.epoch !== value.binding?.epoch || recovered.binding?.generation !== value.binding?.generation) throw Error("环境已变化，请重新读取当前清单");
      if (original) setSource(recovered.sourceControl ?? null); else setPage(recovered);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "原记录读取失败");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <details className="ai-pi-control-history"><summary>上下文恢复清单</summary>
    <p>按原记录保留目标、用户决定与修正、计划版本、授权来源和文件摘要。未记录或省略的内容保持待核实；查看清单不会继续执行任务。</p>
    {value.goal && <p><strong>本轮目标：</strong>{value.goal.text}{value.goal.truncated ? "（片段；完整内容见原对话）" : ""}</p>}
    <p>计划版本：{value.plan?.revision ?? "尚无已保存计划"} · 用户控制记录截至 #{value.binding?.throughControlSeq ?? 0}</p>
    {budget?.contextWindowTokens != null && <p>上下文窗 {budget.contextWindowTokens.toLocaleString()} tokens；当前配置保留输出 {budget.reservedOutputTokens?.toLocaleString()}、工具余量 {budget.toolReserveTokens?.toLocaleString()}，输入预算 {budget.inputBudgetTokens?.toLocaleString()}。当前完整上下文用量未知；超出预算时提示手动压缩，不自动调整参数。</p>}
    {!!value.compaction?.blockers.length && <p>当前仍有未决状态，压缩前需核实原回执。</p>}
    <p>以下为用户原始控制记录，是否已应用以各自回执为准，问卷答案不构成业务授权。</p>
    <ol>{records?.items.map(item => <li key={item.controlId}>#{item.controlSeq} · {item.command} · {item.status}<pre>{item.evidence.text}{item.evidence.truncated ? "\n（片段）" : ""}</pre><button type="button" disabled={loading} onClick={() => { void read({ recoveryControlSeq: String(item.controlSeq) }, true); }}>读取原记录</button></li>)}</ol>
    {records?.hasMore && records.nextBeforeControlSeq != null && <button type="button" disabled={loading} onClick={() => { void read({ recoveryBeforeControlSeq: String(records.nextBeforeControlSeq) }); }}>读取更早用户记录</button>}
    {page && <button type="button" disabled={loading} onClick={() => setPage(null)}>返回最新记录</button>}
    {source && <section aria-label="原用户记录"><p>原控制 #{source.controlSeq} · 字符 {source.offset + 1}—{source.offset + source.text.length} / {source.totalCharacters}</p><pre>{source.text}</pre>{source.offset > 0 && <button type="button" disabled={loading} onClick={() => { void read({ recoveryControlSeq: String(source.controlSeq), recoveryTextOffset: String(Math.max(0, source.offset - 1200)) }, true); }}>上一段</button>}{source.nextOffset != null && <button type="button" disabled={loading} onClick={() => { void read({ recoveryControlSeq: String(source.controlSeq), recoveryTextOffset: String(source.nextOffset) }, true); }}>下一段</button>}<small>原文摘要：{source.sha256}</small></section>}
    {error && <p role="alert">{error}</p>}
    <details><summary>来源、文件与待办证据</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </details>;
}
