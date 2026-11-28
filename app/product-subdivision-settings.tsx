"use client";

import { useEffect, useRef, useState } from "react";

import { requestJson } from "@/lib/http/api-client";
import { SearchableSelect, type SearchableSelectOption } from "@/app/ui/searchable-select";
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
  parentSubdivision?: string | null;
  defaultSubdivision: string | null;
  matchedBy: string;
  status: ProductSubdivisionStatus;
  overridden: boolean;
  sourceName: string;
};

type MappingResponse = {
  mapping: {
    sources: Array<{ fileName: string; sha256: string; rowCount: number; majorCategory?: string }>;
    coveredCategories: string[];
    unclassifiedLabel: string;
    majorCategories: Array<{ name: string; coveredCategories: string[]; hasLevels?: boolean; labels: Array<{ name: string; source: string; sortOrder: number; parent?: string }> }>;
  };
  totals: { mapped: number; unclassified: number; missing: number; entries: number; subdivisions: number };
  subdivisions: Array<{ label: string; majorCategory: string; parent?: string; productCount: number }>;
  items: MappingRow[];
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
};

type StatusFilter = "all" | ProductSubdivisionStatus;

const PAGE_SIZE = 20;
const apiPath = "/api/settings/product-subdivisions";
const statusLabels: Record<ProductSubdivisionStatus, string> = { mapped: "已归类", unclassified: "未归类", missing: "吉客云未找到" };
const statusClasses: Record<ProductSubdivisionStatus, string> = { mapped: "status-success", unclassified: "status-warning", missing: "status-danger" };
const rowKey = (row: MappingRow) => `${row.status}|${row.specCode}|${row.productName}`;
type LabelInfo = { name: string; parent?: string };
type MajorInfo = MappingResponse["mapping"]["majorCategories"][number];

/** 二级 › 三级 for a leaf under another 二级类目, else the name alone. */
const labelPath = (name: string, parent?: string | null) => (parent && parent !== name ? `${parent} › ${name}` : name);
const parentName = (label: LabelInfo) => label.parent ?? label.name;

/** Distinct 二级类目 of a major, in label order. */
function parentsOf(major: MajorInfo | undefined): string[] {
  return [...new Set((major?.labels ?? []).map(parentName))];
}

/** Choices under one 二级类目: the 二级 itself when it is also a label (no 三级), then its 三级 labels. */
function leavesOf(major: MajorInfo | undefined, parent: string): LabelInfo[] {
  return (major?.labels ?? []).filter((label) => parentName(label) === parent);
}

function filterOptions(items: MappingResponse["subdivisions"], showMajor: boolean, parent: string) {
  const prefix = (major: string) => (showMajor ? `${major} · ` : "");
  const parentCounts = new Map<string, { major: string; count: number }>();
  for (const item of items) {
    const key = item.parent ?? item.label;
    const current = parentCounts.get(key) ?? { major: item.majorCategory, count: 0 };
    current.count += item.productCount;
    parentCounts.set(key, current);
  }
  const level2: SearchableSelectOption[] = [{ value: "", label: "全部二级类目" },
    ...[...parentCounts].map(([name, info]) => ({ value: name, label: `${prefix(info.major)}${name}（${info.count}）`, searchText: info.major }))];
  const level3: SearchableSelectOption[] = [{ value: "", label: "全部三级类目" },
    ...items.filter((item) => (item.parent ?? item.label) !== item.label && (!parent || item.parent === parent))
      .map((item) => ({ value: item.label, label: `${prefix(item.majorCategory)}${parent ? item.label : labelPath(item.label, item.parent)}（${item.productCount}）`, searchText: `${item.majorCategory} ${item.parent ?? ""}` }))];
  return { level2, level3 };
}

function matchedByText(row: MappingRow) {
  if (row.status === "missing") return row.matchedBy === "code" ? "仍计入：按代码" : "仍计入：按名称兜底";
  return SUBDIVISION_MATCH_LABELS[row.matchedBy] ?? "—";
}

function SummaryCard({ label, value, note }: { label: string; value: number; note: string }) {
  return <article><span>{label}</span><strong>{value.toLocaleString("zh-CN")}</strong><small>{note}</small></article>;
}

const withCurrent = (options: SearchableSelectOption[], value: string) =>
  !value || options.some((item) => item.value === value) ? options : [...options, { value, label: value }];

export default function ProductSubdivisionSettings({ canEdit }: { canEdit: boolean }) {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [major, setMajor] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [leafFilter, setLeafFilter] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [data, setData] = useState<MappingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Only rows without a spec code (missing name-only entries) need the explicit edit form.
  const [editingKey, setEditingKey] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [openMenu, setOpenMenu] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const generationRef = useRef(0);
  const saving = savingKey !== "";

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
        if (parentFilter) params.set("parent", parentFilter);
        if (leafFilter) params.set("subdivision", leafFilter);
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
  }, [major, page, query, retryKey, status, parentFilter, leafFilter]);

  const updateMajor = (value: string) => { setMajor(value); setParentFilter(""); setLeafFilter(""); setPage(1); setEditingKey(""); };
  const updateParentFilter = (value: string) => { setParentFilter(value); setLeafFilter(""); setPage(1); };
  const updateLeafFilter = (value: string) => { setLeafFilter(value); setPage(1); };
  const updateStatus = (value: StatusFilter) => { setStatus(value); setPage(1); };
  const majors = data?.mapping.majorCategories ?? [];
  const majorInfo = (name: string | null) => majors.find((item) => item.name === (name ?? majors[0]?.name));
  const unclassifiedLabel = data?.mapping.unclassifiedLabel ?? "未归类";
  const options = filterOptions(data?.subdivisions ?? [], !major, parentFilter);
  const needsCode = (row: MappingRow) => row.status === "missing" && !row.specCode;
  const menuHandler = (id: string) => (open: boolean) => setOpenMenu((current) => (open ? id : current === id ? "" : current));

  const submit = async (key: string, payload: Record<string, string>, success: string) => {
    if (saving) return;
    setSavingKey(key);
    setFeedback(null);
    try {
      await requestJson(apiPath, { method: "POST", body: payload });
      setEditingKey("");
      setFeedback({ type: "success", message: success });
      setRetryKey((value) => value + 1);
    } catch (reason) {
      setFeedback({ type: "error", message: reason instanceof Error ? reason.message : "保存货品细分映射失败" });
    } finally {
      setSavingKey("");
    }
  };

  const assign = (row: MappingRow, majorName: string, label: string, code = row.specCode) => {
    const payload: Record<string, string> = { action: "assign", productCode: code, majorCategory: majorName, label };
    // A missing name-only entry given a code is replaced by that code instead of being counted twice.
    if (needsCode(row)) payload.sourceName = row.productName;
    else if (row.overridden && row.sourceName) payload.sourceName = row.sourceName;
    const where = label ? `${majorName} › ${labelPath(label, parentName(majorInfo(majorName)?.labels.find((item) => item.name === label) ?? { name: label }))}` : `${majorName} › ${unclassifiedLabel}`;
    void submit(rowKey(row), payload, `${row.specCode || code}：已改为 ${where}`);
  };

  // Direct edits: every change saves at once as a manual assignment.
  const changeMajor = (row: MappingRow, value: string) => { if (value && value !== row.majorCategory) assign(row, value, ""); };
  const changeParent = (row: MappingRow, value: string) => {
    const majorName = row.majorCategory ?? majors[0]?.name ?? "";
    if (!value) { if (row.subdivision) assign(row, majorName, ""); return; }
    if (value === row.parentSubdivision) return;
    const leaves = leavesOf(majorInfo(majorName), value);
    // Prefer the 二级 itself (no 三级); otherwise the first 三级, which the user can then change.
    const next = leaves.find((item) => item.name === value) ?? leaves[0];
    if (next) assign(row, majorName, next.name);
  };
  const changeLeaf = (row: MappingRow, value: string) => { if (value && value !== row.subdivision) assign(row, row.majorCategory ?? majors[0]?.name ?? "", value); };

  const saveCodeEdit = (row: MappingRow) => {
    const code = draftCode.trim();
    if (!code) { setFeedback({ type: "error", message: "请填写吉客云规格代码后再保存" }); return; }
    assign(row, row.majorCategory ?? majors[0]?.name ?? "", draftLabel, code);
  };

  const resetAssignment = (row: MappingRow) => {
    if (!row.specCode) return;
    void submit(rowKey(row), { action: "reset_assignment", productCode: row.specCode }, `${row.specCode}：已恢复默认归类`);
  };

  const levelCells = (row: MappingRow, key: string) => {
    const info = majorInfo(row.majorCategory);
    const parent = row.parentSubdivision ?? row.subdivision ?? "";
    const leaves = parent ? leavesOf(info, parent) : [];
    const hasLeaf = leaves.some((item) => item.name !== parent);
    const leafValue = row.subdivision && row.subdivision !== parent ? row.subdivision : row.subdivision ? parent : "";
    const defaultNote = row.overridden && <small className="cell-note">默认：{row.defaultSubdivision ?? unclassifiedLabel}</small>;
    if (!canEdit || needsCode(row)) {
      return <>
        <td>{row.majorCategory ? <span className="warehouse-category-tag warehouse-level-one">{row.majorCategory}</span> : "—"}</td>
        <td>{row.subdivision ? <span className="warehouse-category-tag">{parent}</span> : "—"}</td>
        <td>{row.subdivision && parent !== row.subdivision ? <span className="warehouse-category-tag">{row.subdivision}</span> : "—"}{defaultNote}</td>
      </>;
    }
    const busy = saving;
    const name = row.productName || row.specCode;
    return <>
      <td><SearchableSelect ariaLabel={`${name}一级类目`} className="warehouse-mapping-cell-select" value={row.majorCategory ?? ""} disabled={busy}
        options={withCurrent(majors.map((item) => ({ value: item.name, label: item.name })), row.majorCategory ?? "")}
        searchPlaceholder="搜索一级类目" onChange={(value) => changeMajor(row, value)} onOpenChange={menuHandler(`${key}|1`)} /></td>
      <td><SearchableSelect ariaLabel={`${name}二级类目`} className="warehouse-mapping-cell-select" value={row.subdivision ? parent : ""} disabled={busy}
        options={[{ value: "", label: unclassifiedLabel }, ...parentsOf(info).map((item) => ({ value: item, label: item }))]}
        searchPlaceholder="搜索二级类目" onChange={(value) => changeParent(row, value)} onOpenChange={menuHandler(`${key}|2`)} /></td>
      <td>{hasLeaf
        ? <SearchableSelect ariaLabel={`${name}三级类目`} className="warehouse-mapping-cell-select" value={leafValue} disabled={busy}
          options={leaves.map((item) => ({ value: item.name, label: item.name === parent ? "（只到二级）" : item.name }))}
          searchPlaceholder="搜索三级类目" onChange={(value) => changeLeaf(row, value)} onOpenChange={menuHandler(`${key}|3`)} />
        : "—"}{defaultNote}</td>
    </>;
  };

  const sources = data?.mapping.sources ?? [];
  const covered = data?.mapping.coveredCategories.join("、") ?? "";
  const pagination = data?.pagination;
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return <div className="warehouse-mapping-workspace">
    <section className="panel warehouse-mapping-overview">
      <div>
        <span className="warehouse-mapping-eyebrow">品类分析 · 品类细分</span>
        <h2>货品细分映射</h2>
        <p>
          {sources.length > 0 ? `映射默认来自${sources.map((item) => `《${item.fileName}》${item.majorCategory ? `${item.majorCategory}部分` : ""}（SHA-256 前 8 位 ${item.sha256.slice(0, 8)}，${item.rowCount.toLocaleString("zh-CN")} 条）`).join("、")}；` : ""}
          一级类目即大类目，二级、三级类目来自映射表（只有一层细分的大类目不显示三级）；管理员可在表格中直接改一级、二级、三级类目，改动即保存为手动归类，手动归类优先，可“恢复默认”；
          规格代码即吉客云货品编号。只有名称的条目先在吉客云货品档案中找规格代码，找不到再到吉客云历史销售明细中按名称精确查找；名称不完全一致的不会自动归类，可手动补规格代码。供应链名称优先取货品档案的供应商，为空时取销售明细中最近一次的“货品默认供应商”。
        </p>
      </div>
      <div className="warehouse-mapping-summary" aria-label="货品细分映射汇总">
        <SummaryCard label="映射条数" value={data?.totals.entries ?? 0} note="映射表中的条目" />
        <SummaryCard label="细分数" value={data?.totals.subdivisions ?? 0} note="当前一级类目下可选的细分名称" />
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
          <div className="warehouse-mapping-select-field"><span>一级类目</span><SearchableSelect ariaLabel="一级类目" value={major}
            options={[{ value: "", label: "全部一级类目" }, ...majors.map((item) => ({ value: item.name, label: item.name }))]}
            searchPlaceholder="搜索一级类目" onChange={updateMajor} /></div>
          <div className="warehouse-mapping-select-field"><span>二级类目</span><SearchableSelect ariaLabel="二级类目" value={parentFilter}
            options={withCurrent(options.level2, parentFilter)} searchPlaceholder="搜索二级类目" onChange={updateParentFilter} /></div>
          <div className="warehouse-mapping-select-field"><span>三级类目</span><SearchableSelect ariaLabel="三级类目" value={leafFilter}
            options={withCurrent(options.level3, leafFilter)} searchPlaceholder="搜索三级类目" emptyLabel="该二级类目下没有三级"
            onChange={updateLeafFilter} /></div>
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
      <div className={`data-table-wrap${editingKey || openMenu ? " warehouse-mapping-editing" : ""}`}>
        <table className="data-table warehouse-mapping-table">
          <thead><tr><th>吉客云规格代码</th><th>货品名称</th><th>规格</th><th>供应链名称</th><th>吉客云分类</th><th>一级类目</th><th>二级类目</th><th>三级类目</th><th>匹配方式</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((row) => {
              const key = rowKey(row);
              const editing = editingKey === key;
              const rowSaving = savingKey === key;
              return <tr key={key} className={rowSaving ? "warehouse-mapping-row-saving" : undefined}>
                <td>{editing
                  ? <input aria-label="吉客云规格代码" value={draftCode} maxLength={100} placeholder="必填，规格代码" disabled={saving} onChange={(event) => setDraftCode(event.target.value)} />
                  : row.specCode || "—"}</td>
                <td><strong>{row.productName || "—"}</strong></td><td>{row.specification || "—"}</td><td>{row.supplier || "—"}</td>
                <td>{row.erpCategory || "—"}</td>
                {editing
                  ? <>
                    <td>{row.majorCategory || "—"}</td>
                    <td colSpan={2}><SearchableSelect ariaLabel={`${row.productName}细分`} className="warehouse-mapping-edit-select" value={draftLabel} disabled={saving}
                      options={[{ value: "", label: unclassifiedLabel }, ...(majorInfo(row.majorCategory)?.labels ?? []).map((item) => ({ value: item.name, label: labelPath(item.name, item.parent), searchText: item.parent ?? "" }))]}
                      searchPlaceholder="搜索二级或三级类目" onChange={setDraftLabel} /></td>
                  </>
                  : levelCells(row, key)}
                <td>{matchedByText(row)}</td>
                <td><span className={`status ${statusClasses[row.status]}`}>{rowSaving ? "保存中…" : statusLabels[row.status]}</span></td>
                <td><div className="warehouse-mapping-row-actions">{editing
                  ? <><button type="button" className="primary-button" disabled={saving} onClick={() => saveCodeEdit(row)}>{rowSaving ? "保存中…" : "保存"}</button><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditingKey("")}>取消</button></>
                  : <>
                    {needsCode(row) && <button type="button" className="row-action" disabled={!canEdit || saving} onClick={() => { setEditingKey(key); setDraftLabel(row.subdivision ?? ""); setDraftCode(""); setFeedback(null); }}>补代码并归类</button>}
                    {row.overridden && row.specCode && <button type="button" className="secondary-button" disabled={!canEdit || saving} onClick={() => resetAssignment(row)}>恢复默认</button>}
                    {!needsCode(row) && !(row.overridden && row.specCode) && <span className="muted-text">—</span>}
                  </>}</div></td>
              </tr>;
            })}
            {data && data.items.length === 0 && <tr><td colSpan={11}><div className="table-state">没有符合当前条件的货品。</div></td></tr>}
            {!data && !error && <tr><td colSpan={11}><div className="table-state" role="status">正在读取货品细分映射…</div></td></tr>}
            {!data && error && <tr><td colSpan={11}><div className="table-state" role="alert">货品细分映射暂不可用，请重试。</div></td></tr>}
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
