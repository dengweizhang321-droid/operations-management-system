"use client";

import { useEffect, useRef, useState } from "react";

import { requestJson } from "@/lib/http/api-client";
import { SUBDIVISION_MATCH_LABELS, validProductSubdivisions, type ProductSubdivisionStatus } from "@/lib/sales/product-subdivision-contract";

type MappingRow = {
  specCode: string;
  productName: string;
  specification: string;
  supplier: string;
  erpCategory: string;
  productStatus: string;
  majorCategory: string | null;
  subdivision: string | null;
  defaultSubdivision: string | null;
  matchedBy: string;
  status: ProductSubdivisionStatus;
  overridden: boolean;
  sourceName: string;
};

type MappingResponse = {
  mapping: {
    sources: Array<{ fileName: string; sha256: string; rowCount: number }>;
    coveredCategories: string[];
    unclassifiedLabel: string;
    majorCategories: Array<{ name: string; coveredCategories: string[]; labels: Array<{ name: string; source: string; sortOrder: number }> }>;
  };
  totals: { mapped: number; unclassified: number; missing: number; entries: number; subdivisions: number };
  subdivisions: Array<{ label: string; majorCategory: string; productCount: number }>;
  items: MappingRow[];
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
};

type StatusFilter = "all" | ProductSubdivisionStatus;

const PAGE_SIZE = 20;
const apiPath = "/api/settings/product-subdivisions";
const statusLabels: Record<ProductSubdivisionStatus, string> = { mapped: "已归类", unclassified: "未归类", missing: "吉客云未找到" };
const statusClasses: Record<ProductSubdivisionStatus, string> = { mapped: "status-success", unclassified: "status-warning", missing: "status-danger" };
const rowKey = (row: MappingRow) => `${row.status}|${row.specCode}|${row.productName}`;

function matchedByText(row: MappingRow) {
  if (row.status === "missing") return row.matchedBy === "code" ? "仍计入：按代码" : "仍计入：按名称兜底";
  return SUBDIVISION_MATCH_LABELS[row.matchedBy] ?? "—";
}

function SummaryCard({ label, value, note }: { label: string; value: number; note: string }) {
  return <article><span>{label}</span><strong>{value.toLocaleString("zh-CN")}</strong><small>{note}</small></article>;
}

export default function ProductSubdivisionSettings({ canEdit }: { canEdit: boolean }) {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [major, setMajor] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [data, setData] = useState<MappingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
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
        if (major) params.set("majorCategory", major);
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
  }, [major, page, query, retryKey, status, subdivision]);

  const updateMajor = (value: string) => { setMajor(value); setSubdivision(""); setPage(1); setEditingKey(""); };
  const updateSubdivision = (value: string) => { setSubdivision(value); setPage(1); };
  const updateStatus = (value: StatusFilter) => { setStatus(value); setPage(1); };
  const majors = data?.mapping.majorCategories ?? [];
  const labelsOf = (row: MappingRow) => (majors.find((item) => item.name === (row.majorCategory ?? majors[0]?.name))?.labels ?? []).map((item) => item.name);
  const needsCode = (row: MappingRow) => row.status === "missing" && !row.specCode;

  const beginEdit = (row: MappingRow) => {
    setEditingKey(rowKey(row));
    setDraftLabel(row.subdivision ?? "");
    setDraftCode("");
    setFeedback(null);
  };

  const submit = async (payload: Record<string, string>, success: string) => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await requestJson(apiPath, { method: "POST", body: payload });
      setEditingKey("");
      setFeedback({ type: "success", message: success });
      setRetryKey((value) => value + 1);
    } catch (reason) {
      setFeedback({ type: "error", message: reason instanceof Error ? reason.message : "保存货品细分映射失败" });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = (row: MappingRow) => {
    const code = (row.specCode || draftCode).trim();
    if (!code) { setFeedback({ type: "error", message: "请填写吉客云规格代码后再保存" }); return; }
    const payload: Record<string, string> = {
      action: "assign", productCode: code, majorCategory: row.majorCategory ?? majors[0]?.name ?? "", label: draftLabel,
    };
    // A missing name-only entry given a code is replaced by that code instead of being counted twice.
    if (needsCode(row)) payload.sourceName = row.productName;
    else if (row.overridden && row.sourceName) payload.sourceName = row.sourceName;
    void submit(payload, "已保存手动归类");
  };

  const resetAssignment = (row: MappingRow) => {
    if (!row.specCode) return;
    void submit({ action: "reset_assignment", productCode: row.specCode }, "已恢复默认归类");
  };

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
          {source ? `映射默认来自《${source.fileName}》（SHA-256 前 8 位 ${source.sha256.slice(0, 8)}，${source.rowCount.toLocaleString("zh-CN")} 条），` : ""}
          可在此手动调整，手动归类优先；规格代码即吉客云货品编号。只有名称的条目先在吉客云货品档案中找规格代码，找不到再到吉客云历史销售明细中按名称精确查找；名称不完全一致的不会自动归类，可手动补规格代码。供应链名称优先取货品档案的供应商，为空时取销售明细中最近一次的“货品默认供应商”。
        </p>
      </div>
      <div className="warehouse-mapping-summary" aria-label="货品细分映射汇总">
        <SummaryCard label="映射条数" value={data?.totals.entries ?? 0} note="映射表中的条目" />
        <SummaryCard label="细分数" value={data?.totals.subdivisions ?? 0} note="当前大类目下的细分名称" />
        <SummaryCard label="已归类货品" value={data?.totals.mapped ?? 0} note="吉客云货品档案中命中映射" />
        <SummaryCard label="未归类货品" value={data?.totals.unclassified ?? 0} note={covered ? `${covered}分类中未进映射` : "覆盖分类中未进映射"} />
        <SummaryCard label="吉客云未找到" value={data?.totals.missing ?? 0} note="档案中无对应货品，仍按代码或名称计入" />
      </div>
    </section>

    {error && <section className="inventory-feedback inventory-feedback-error" role="alert">
      <span>!</span><div><strong>读取货品细分映射失败</strong><p>{error}{data ? "；当前仍显示上一次成功结果。" : ""}</p></div>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>重试</button>
    </section>}
    {feedback && <section className={`inventory-feedback ${feedback.type === "error" ? "inventory-feedback-error" : "inventory-feedback-success"}`} role={feedback.type === "error" ? "alert" : "status"}>
      <span>{feedback.type === "error" ? "!" : "✓"}</span><div><strong>{feedback.type === "error" ? "保存失败" : "已保存"}</strong><p>{feedback.message}</p></div>
    </section>}

    <section className="panel table-panel warehouse-mapping-panel" aria-busy={loading || saving}>
      <div className="table-toolbar warehouse-mapping-toolbar">
        <div><h2>货品归类明细</h2><p>{pagination ? `共 ${pagination.total.toLocaleString("zh-CN")} 条符合条件` : "正在读取吉客云货品档案…"}</p></div>
        <div className="warehouse-mapping-filters">
          <label><span>大类目</span><select aria-label="大类目" value={major} onChange={(event) => updateMajor(event.target.value)}>
            <option value="">全部大类目</option>
            {majors.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select></label>
          <label><span>细分名称</span><select aria-label="细分名称" value={subdivision} onChange={(event) => updateSubdivision(event.target.value)}>
            <option value="">全部细分</option>
            {(data?.subdivisions ?? []).map((item) => <option key={`${item.majorCategory}|${item.label}`} value={item.label}>{item.label}（{item.productCount}）</option>)}
          </select></label>
          <label><span>状态</span><select aria-label="归类状态" value={status} onChange={(event) => updateStatus(event.target.value as StatusFilter)}>
            <option value="all">全部状态</option>
            <option value="mapped">已归类</option>
            <option value="unclassified">未归类</option>
            <option value="missing">吉客云未找到</option>
          </select></label>
          <label className="warehouse-mapping-search"><span>搜索</span><input aria-label="搜索货品细分映射" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="规格代码、名称、供应链、分类或细分" maxLength={100} /></label>
        </div>
      </div>
      {!canEdit && <p className="warehouse-mapping-readonly">当前账号可查看映射；只有管理员可以手动归类。</p>}
      <div className="data-table-wrap">
        <table className="data-table warehouse-mapping-table">
          <thead><tr><th>吉客云规格代码</th><th>货品名称</th><th>规格</th><th>供应链名称</th><th>吉客云分类</th><th>大类目</th><th>细分名称</th><th>匹配方式</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((row) => {
              const key = rowKey(row);
              const editing = editingKey === key;
              return <tr key={key}>
                <td>{editing && needsCode(row)
                  ? <input aria-label="吉客云规格代码" value={draftCode} maxLength={100} placeholder="必填，规格代码" disabled={saving} onChange={(event) => setDraftCode(event.target.value)} />
                  : row.specCode || "—"}</td>
                <td><strong>{row.productName || "—"}</strong></td><td>{row.specification || "—"}</td><td>{row.supplier || "—"}</td>
                <td>{row.erpCategory || "—"}</td>
                <td>{row.majorCategory || "—"}</td>
                <td>{editing
                  ? <select aria-label={`${row.productName || row.specCode}细分`} value={draftLabel} disabled={saving} onChange={(event) => setDraftLabel(event.target.value)}>
                    <option value="">{data?.mapping.unclassifiedLabel ?? "未归类"}</option>
                    {labelsOf(row).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  : <>{row.subdivision ? <span className="warehouse-category-tag">{row.subdivision}</span> : "—"}{row.overridden && <small className="cell-note">默认：{row.defaultSubdivision ?? "未归类"}</small>}</>}</td>
                <td>{matchedByText(row)}</td>
                <td><span className={`status ${statusClasses[row.status]}`}>{statusLabels[row.status]}</span></td>
                <td><div className="warehouse-mapping-row-actions">{editing
                  ? <><button type="button" className="primary-button" disabled={saving} onClick={() => saveEdit(row)}>{saving ? "保存中…" : "保存"}</button><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditingKey("")}>取消</button></>
                  : <><button type="button" className="row-action" disabled={!canEdit || saving} onClick={() => beginEdit(row)}>编辑</button>{row.overridden && row.specCode && <button type="button" className="secondary-button" disabled={!canEdit || saving} onClick={() => resetAssignment(row)}>恢复默认</button>}</>}</div></td>
              </tr>;
            })}
            {data && data.items.length === 0 && <tr><td colSpan={10}><div className="table-state">没有符合当前条件的货品。</div></td></tr>}
            {!data && !error && <tr><td colSpan={10}><div className="table-state" role="status">正在读取货品细分映射…</div></td></tr>}
            {!data && error && <tr><td colSpan={10}><div className="table-state" role="alert">货品细分映射暂不可用，请重试。</div></td></tr>}
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
