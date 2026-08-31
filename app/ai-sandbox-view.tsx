"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AppCurrentUser } from "./shell/view-contract";

type DatasetId = "sales_category" | "netshop_product_daily" | "netshop_promotion";
type Dataset = { id: DatasetId; title: string; notes: string; query: string[] };
type AnalysisRun = {
  id: string;
  dataset: DatasetId;
  operations: string[];
  dataCutoffDate: string | null;
  sourceRows: number;
  returnedRows: number;
  truncated: boolean;
  resultDigest: string;
  createdAt: string;
};
type AnalysisResult = {
  runId: string;
  resultDigest: string;
  dataset: DatasetId;
  dataCutoffDate: string | null;
  sourceRows: number;
  sourceTotal: number;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  returned: number;
  truncated: boolean;
  stepsApplied: Array<{ op: string; rowsAfter: number }>;
};
type SandboxMeta = {
  executionEnvironment: string;
  arbitraryCode: false;
  datasets: Dataset[];
  operations: string[];
  limits: { maximumSourceRows: number; maximumSteps: number; maximumOutputRows: number };
  history: { items: AnalysisRun[] };
};

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initialDates() {
  const endDate = shanghaiToday();
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || fallback);
  if (!payload) throw new Error(fallback);
  return payload;
}

export default function AiSandboxView({ currentUser }: { currentUser: AppCurrentUser | null }) {
  const [dates] = useState(initialDates);
  const [meta, setMeta] = useState<SandboxMeta | null>(null);
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const [dataset, setDataset] = useState<DatasetId>("sales_category");
  const [startDate, setStartDate] = useState(dates.startDate);
  const [endDate, setEndDate] = useState(dates.endDate);
  const [platform, setPlatform] = useState("");
  const [shop, setShop] = useState("");
  const [query, setQuery] = useState("");
  const [steps, setSteps] = useState("[]");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const canRun = currentUser?.role !== "viewer" && Boolean(currentUser);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/ai/sandbox?page=1&pageSize=12", { cache: "no-store", signal: controller.signal });
      const payload = await readJson<SandboxMeta>(response, "读取分析沙箱失败");
      if (controller.signal.aborted) return;
      setMeta(payload);
      setHistory(payload.history.items);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取分析沙箱失败");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); controllerRef.current?.abort(); };
  }, [load]);

  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true); setError(""); setResult(null);
    try {
      let parsedSteps: unknown;
      try {
        parsedSteps = JSON.parse(steps);
      } catch {
        throw new Error("分析步骤必须是有效 JSON 数组。");
      }
      if (!Array.isArray(parsedSteps)) throw new Error("分析步骤必须是 JSON 数组。");
      const queryInput = dataset === "sales_category"
        ? { startDate, endDate, limit: 50 }
        : {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          platform: platform.trim() || undefined,
          shop: shop.trim() || undefined,
          query: query.trim() || undefined,
          limit: 20,
        };
      const response = await fetch("/api/ai/sandbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset, query: queryInput, steps: parsedSteps }),
      });
      const payload = await readJson<AnalysisResult>(response, "运行分析计划失败");
      setResult(payload);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "运行分析计划失败");
    } finally {
      setRunning(false);
    }
  };

  return <section className="ai-sandbox-workspace">
    <article className="panel ai-sandbox-hero">
      <div><span className="eyebrow">BOUNDED DATA ANALYSIS</span><h2>安全分析沙箱</h2><p>通过白名单数据集和结构化 JSON 计划做筛选、派生、聚合与排序。这里不执行任意 Python、JavaScript、SQL 或网络代码。</p></div>
      <div className="ai-sandbox-badges"><span>无 eval</span><span>转换阶段无网络</span><span>最多 {meta?.limits.maximumSteps ?? 8} 步</span><span>最多 {meta?.limits.maximumSourceRows ?? 50} 源行</span></div>
    </article>

    {error && <div className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>分析沙箱操作失败</strong><p>{error}</p></div></div>}

    <div className="ai-sandbox-grid">
      <article className="panel ai-admin-card">
        <div className="section-header"><div><h3>运行分析计划</h3><p>{canRun ? "数据查询先经过当前账号的角色和 scope，再进入确定性转换器。" : "当前只读角色可以查看数据集与自己的运行摘要，不能发起新的分析计划。"}</p></div></div>
        <form className="ai-config-form" onSubmit={(event) => void run(event)}>
          <label><span>数据集</span><select value={dataset} onChange={(event) => setDataset(event.target.value as DatasetId)}>{(meta?.datasets ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}{!meta && <option value="sales_category">销售品类分析明细</option>}</select></label>
          <label><span>开始日期</span><input type="date" required={dataset === "sales_category"} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><span>结束日期</span><input type="date" required={dataset === "sales_category"} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          {dataset !== "sales_category" && <><label><span>平台</span><input maxLength={40} value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="按店铺查时必填" /></label><label><span>店铺</span><input maxLength={120} value={shop} onChange={(event) => setShop(event.target.value)} /></label><label><span>商品关键词</span><input maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /></label></>}
          <label className="ai-form-wide"><span>结构化步骤（JSON）</span><textarea rows={12} spellCheck={false} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={'[{"op":"group","groupBy":["category"],"metrics":[{"aggregate":"sum","field":"netSalesCents","as":"sales"}]},{"op":"sort","field":"sales","direction":"desc"},{"op":"limit","count":10}]'} /><small>允许操作：{meta?.operations.join("、") ?? "filter、select、derive、group、sort、limit"}。字段与数值不会拼入代码。</small></label>
          <div className="ai-form-actions"><button type="submit" className="primary-button" disabled={!canRun || running || loading}>{running ? "运行中…" : "运行安全计划"}</button></div>
        </form>
      </article>

      <article className="panel ai-admin-card">
        <div className="section-header"><div><h3>分析结果</h3><p>{result ? `运行 ${result.runId} · 截止 ${result.dataCutoffDate ?? "未提供"}` : "结果只展示本次有界输出；运行摘要会保留，原始查询值不会进入历史列表。"}</p></div>{result && <span className={`status ${result.truncated ? "status-warning" : "status-success"}`}>{result.truncated ? "已截断" : "完整返回"}</span>}</div>
        {!result && <div className="empty-state"><strong>尚未运行分析</strong><p>选择数据集并提交结构化步骤。</p></div>}
        {result && <div className="ai-sandbox-result"><div className="ai-sandbox-stats"><span><strong>{result.sourceRows}</strong> 源行</span><span><strong>{result.returned}</strong> 返回</span><span><strong>{result.stepsApplied.length}</strong> 步</span></div><div className="table-scroll"><table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={`${result.runId}-${index}`}>{result.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? "—" : String(row[column])}</td>)}</tr>)}</tbody></table></div></div>}
      </article>
    </div>

    <article className="panel ai-admin-card data-refresh-region" aria-busy={loading}>
      <div className="section-header"><div><h3>我的运行记录</h3><p>仅当前 owner 且当前 scope 仍覆盖的记录可见；保存的是摘要与哈希，不保存完整结果。</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button></div>
      <div className="ai-config-list">{history.length === 0 && <p className="soft-text">暂无分析记录。</p>}{history.map((item) => <div className="ai-config-card" key={item.id}><div><strong>{meta?.datasets.find((datasetItem) => datasetItem.id === item.dataset)?.title ?? item.dataset}</strong><small>{item.operations.length ? item.operations.join(" → ") : "仅查询"} · {item.sourceRows} 源行 / {item.returnedRows} 返回</small><small>{item.createdAt} · 结果摘要 {item.resultDigest.slice(0, 12)}…</small></div><span className={`status ${item.truncated ? "status-warning" : "status-success"}`}>{item.truncated ? "截断" : "完成"}</span></div>)}</div>
    </article>
  </section>;
}
