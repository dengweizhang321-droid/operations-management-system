"use client";

import { useEffect, useRef, useState } from "react";

import { requestJson } from "@/lib/http/api-client";
import { validProductSubdivisions, type ProductSubdivisionStatus } from "@/lib/sales/product-subdivision-contract";

type MappingRow = {
  specCode: string;
  goodsCode: string;
  productName: string;
  specification: string;
  erpCategory: string;
  productStatus: string;
  subdivision: string | null;
  matchedBy: "code" | "name" | "none";
  status: ProductSubdivisionStatus;
};

type MappingResponse = {
  mapping: {
    sources: Array<{ fileName: string; sha256: string; rowCount: number }>;
    coveredCategories: string[];
    unclassifiedLabel: string;
  };
  totals: { mapped: number; unclassified: number; missing: number; entries: number; subdivisions: number };
  subdivisions: Array<{ label: string; productCount: number }>;
  items: MappingRow[];
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
};

type StatusFilter = "all" | ProductSubdivisionStatus;

const PAGE_SIZE = 20;
const apiPath = "/api/settings/product-subdivisions";
const statusLabels: Record<ProductSubdivisionStatus, string> = { mapped: "已归类", unclassified: "未归类", missing: "吉客云未找到" };
const statusClasses: Record<ProductSubdivisionStatus, string> = { mapped: "status-success", unclassified: "status-warning", missing: "status-danger" };
const matchedByLabels: Record<MappingRow["matchedBy"], string> = { code: "货品编号", name: "货品名称", none: "—" };

function SummaryCard({ label, value, note }: { label: string; value: number; note: string }) {
  return <article><span>{label}</span><strong>{value.toLocaleString("zh-CN")}</strong><small>{note}</small></article>;
}

export default function ProductSubdivisionSettings() {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [data, setData] = useState<MappingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generationRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = queryInput.trim();
      if (next === query) return;
      setQuery(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput, query]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++generationRef.current;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setError("货品细分映射读取超时，请重试。"); setLoading(false); controller.abort();
    }, 30_000);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
        if (query) params.set("q", query);
        if (subdivision) params.set("subdivision", subdivision);
        const payload = await requestJson<MappingResponse>(`${apiPath}?${params}`, { signal: controller.signal });
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (!validProductSubdivisions(payload, { page, pageSize: PAGE_SIZE })) throw new Error("货品细分映射响应不完整，请重试。");
        setData(payload);
      } catch (reason) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setError(reason instanceof Error ? reason.message : "读取货品细分映射失败");
      } finally {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted && generation === generationRef.current) setLoading(false);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [page, query, retryKey, status, subdivision]);

  const updateSubdivision = (value: string) => { setSubdivision(value); setPage(1); };
  const updateStatus = (value: StatusFilter) => { setStatus(value); setPage(1); };
  const source = data?.mapping.sources[0];
  const covered = data?.mapping.coveredCategories.join("、") ?? "";
  const pagination = data?.pagination;
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return <div className="warehouse-mapping-workspace">
    <section className="panel warehouse-mapping-overview">
      <div>
        <span className="warehouse-mapping-eyebrow">品类分析 · 品类细分</span>
        <h2>货品细分映射</h2>
        <p>
          {source ? `映射来源《${source.fileName}》（SHA-256 前 8 位 ${source.sha256.slice(0, 8)}，${source.rowCount.toLocaleString("zh-CN")} 条），随系统发布；` : ""}
          调整归类请更新 Excel 后重新生成并发布，本页只读。规格代码与货品代码均取吉客云货品编号；货品编号优先、货品名称次之，命中映射即计入对应细分，不限吉客云分类。
        </p>
      </div>
      <div className="warehouse-mapping-summary" aria-label="货品细分映射汇总">
        <SummaryCard label="映射条数" value={data?.totals.entries ?? 0} note="映射表中的条目" />
        <SummaryCard label="细分数" value={data?.totals.subdivisions ?? 0} note="去重后的细分名称" />
        <SummaryCard label="已归类货品" value={data?.totals.mapped ?? 0} note="吉客云货品档案中命中映射" />
        <SummaryCard label="未归类货品" value={data?.totals.unclassified ?? 0} note={covered ? `${covered}分类中未进映射` : "覆盖分类中未进映射"} />
        <SummaryCard label="吉客云未找到" value={data?.totals.missing ?? 0} note="映射条目在货品档案中无对应货品" />
      </div>
    </section>

    {error && <section className="inventory-feedback inventory-feedback-error" role="alert">
      <span>!</span><div><strong>读取货品细分映射失败</strong><p>{error}{data ? "；当前仍显示上一次成功结果。" : ""}</p></div>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>重试</button>
    </section>}

    <section className="panel table-panel warehouse-mapping-panel" aria-busy={loading}>
      <div className="table-toolbar warehouse-mapping-toolbar">
        <div><h2>货品归类明细</h2><p>{pagination ? `共 ${pagination.total.toLocaleString("zh-CN")} 条符合条件` : "正在读取吉客云货品档案…"}</p></div>
        <div className="warehouse-mapping-filters">
          <label><span>细分名称</span><select aria-label="细分名称" value={subdivision} onChange={(event) => updateSubdivision(event.target.value)}>
            <option value="">全部细分</option>
            {(data?.subdivisions ?? []).map((item) => <option key={item.label} value={item.label}>{item.label}（{item.productCount}）</option>)}
          </select></label>
          <label><span>状态</span><select aria-label="归类状态" value={status} onChange={(event) => updateStatus(event.target.value as StatusFilter)}>
            <option value="all">全部状态</option>
            <option value="mapped">已归类</option>
            <option value="unclassified">未归类</option>
            <option value="missing">吉客云未找到</option>
          </select></label>
          <label className="warehouse-mapping-search"><span>搜索</span><input aria-label="搜索货品细分映射" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="货品编号、名称、规格、分类或细分" maxLength={100} /></label>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table warehouse-mapping-table">
          <thead><tr><th>吉客云规格代码</th><th>吉客云货品代码</th><th>货品名称</th><th>规格</th><th>吉客云分类</th><th>细分名称</th><th>匹配方式</th><th>状态</th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((row) => <tr key={`${row.status}|${row.specCode}|${row.productName}`}>
              <td>{row.specCode || "—"}</td><td>{row.goodsCode || "—"}</td><td><strong>{row.productName || "—"}</strong></td><td>{row.specification || "—"}</td>
              <td>{row.erpCategory || "—"}</td>
              <td>{row.subdivision ? <span className="warehouse-category-tag">{row.subdivision}</span> : "—"}</td>
              <td>{matchedByLabels[row.matchedBy]}</td>
              <td><span className={`status ${statusClasses[row.status]}`}>{statusLabels[row.status]}</span></td>
            </tr>)}
            {data && data.items.length === 0 && <tr><td colSpan={8}><div className="table-state">没有符合当前条件的货品。</div></td></tr>}
            {!data && !error && <tr><td colSpan={8}><div className="table-state" role="status">正在读取货品细分映射…</div></td></tr>}
            {!data && error && <tr><td colSpan={8}><div className="table-state" role="alert">货品细分映射暂不可用，请重试。</div></td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="warehouse-mapping-pagination">
        <span>第 {pagination?.page ?? page} / {pageCount} 页 · 每页 {PAGE_SIZE} 条</span>
        <div>
          <button type="button" className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <button type="button" className="secondary-button" disabled={!pagination?.truncated || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </div>
      </footer>
    </section>
  </div>;
}
