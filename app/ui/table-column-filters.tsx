"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeTableCellValue, tableRowMatchesColumnFilters } from "@/lib/ui/table-column-filter";

type ColumnFilterTarget = {
  table: HTMLTableElement;
  header: HTMLTableCellElement;
  columnIndex: number;
  label: string;
  options: string[];
  selected: string[];
  left: number;
  top: number;
  width: number;
  visibleRows: number;
  totalRows: number;
};

const interactiveSelector = "button,input,select,textarea,a,label";
const filterValueSeparator = "\u001f";

function tableRows(table: HTMLTableElement) {
  return Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
}

function tableCellValue(cell: HTMLTableCellElement | undefined) {
  if (!cell) return "";
  const selectedValues = Array.from(cell.querySelectorAll("select")).map((select) => (
    normalizeTableCellValue(select.selectedOptions[0]?.textContent ?? select.value)
  )).filter(Boolean);
  if (selectedValues.length) return normalizeTableCellValue(selectedValues.join(" / "));
  const enteredValues = Array.from(cell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='checkbox']):not([type='radio']),textarea"))
    .map((control) => normalizeTableCellValue(control.value)).filter(Boolean);
  if (enteredValues.length) return normalizeTableCellValue(enteredValues.join(" / "));
  const checks = Array.from(cell.querySelectorAll<HTMLInputElement>("input[type='checkbox'],input[type='radio']"));
  if (checks.length && !normalizeTableCellValue(cell.innerText)) return checks.some((control) => control.checked) ? "已选择" : "未选择";
  return normalizeTableCellValue(cell.innerText);
}

function tableCellFilterValues(cell: HTMLTableCellElement | undefined) {
  if (!cell) return [""];
  const explicitValues = cell.dataset.columnFilterValues;
  if (explicitValues === undefined) return [tableCellValue(cell)];
  return [...new Set(explicitValues.split(filterValueSeparator).map(normalizeTableCellValue).filter(Boolean))];
}

function headerLabel(header: HTMLTableCellElement) {
  return normalizeTableCellValue(header.dataset.columnFilterLabel ?? header.getAttribute("aria-label") ?? header.innerText) || `第 ${header.cellIndex + 1} 列`;
}

function columnOptions(table: HTMLTableElement, columnIndex: number) {
  return [...new Set(tableRows(table)
    .filter((row) => !Array.from(row.cells).some((cell) => cell.colSpan > 1))
    .flatMap((row) => tableCellFilterValues(row.cells[columnIndex])))]
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
}

function targetPosition(header: HTMLTableCellElement) {
  const bounds = header.getBoundingClientRect();
  const width = Math.min(320, Math.max(240, window.innerWidth - 24));
  const left = Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12));
  const preferredTop = bounds.bottom + 7;
  return {
    left,
    top: Math.min(preferredTop, Math.max(12, window.innerHeight - 410)),
    width,
  };
}

export default function TableColumnFilters() {
  const filtersRef = useRef(new WeakMap<HTMLTableElement, Map<number, Set<string>>>());
  const popoverRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<ColumnFilterTarget | null>(null);
  const [query, setQuery] = useState("");

  const filtersFor = useCallback((table: HTMLTableElement) => {
    const existing = filtersRef.current.get(table);
    if (existing) return existing;
    const created = new Map<number, Set<string>>();
    filtersRef.current.set(table, created);
    return created;
  }, []);

  const applyFilters = useCallback((table: HTMLTableElement) => {
    const filters = filtersFor(table);
    const rows = tableRows(table);
    let visibleRows = 0;
    for (const row of rows) {
      if (Array.from(row.cells).some((cell) => cell.colSpan > 1)) {
        row.classList.remove("column-filter-row-hidden");
        continue;
      }
      const values = Array.from(row.cells).map((cell) => tableCellFilterValues(cell));
      const visible = tableRowMatchesColumnFilters(values, filters);
      row.classList.toggle("column-filter-row-hidden", !visible);
      if (visible) visibleRows += 1;
    }
    for (const header of Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"))) {
      header.dataset.columnFilterActive = filters.get(header.cellIndex)?.size ? "true" : "false";
    }
    table.dataset.columnFilterVisibleRows = String(visibleRows);
    table.dataset.columnFilterTotalRows = String(rows.filter((row) => !Array.from(row.cells).some((cell) => cell.colSpan > 1)).length);
    return { visibleRows, totalRows: Number(table.dataset.columnFilterTotalRows) };
  }, [filtersFor]);

  const prepareTables = useCallback(() => {
    for (const table of Array.from(document.querySelectorAll<HTMLTableElement>("table"))) {
      table.dataset.columnFilterTable = "true";
      for (const header of Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"))) {
        header.dataset.columnFilterHeader = "true";
        header.dataset.columnFilterLabel = headerLabel(header);
        if (!header.hasAttribute("tabindex")) header.tabIndex = 0;
        header.setAttribute("aria-haspopup", "dialog");
        header.setAttribute("aria-label", `${header.dataset.columnFilterLabel}，打开列筛选`);
        header.dataset.columnFilterActive = filtersFor(table).get(header.cellIndex)?.size ? "true" : "false";
      }
      applyFilters(table);
    }
  }, [applyFilters, filtersFor]);

  const openForHeader = useCallback((header: HTMLTableCellElement) => {
    const table = header.closest("table");
    if (!(table instanceof HTMLTableElement)) return;
    const columnIndex = header.cellIndex;
    const options = columnOptions(table, columnIndex);
    const selected = [...(filtersFor(table).get(columnIndex) ?? new Set<string>())];
    const counts = applyFilters(table);
    setQuery("");
    setTarget({
      table,
      header,
      columnIndex,
      label: header.dataset.columnFilterLabel || headerLabel(header),
      options,
      selected,
      ...targetPosition(header),
      ...counts,
    });
  }, [applyFilters, filtersFor]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(prepareTables);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const header = element?.closest<HTMLTableCellElement>("th[data-column-filter-header='true']");
      if (!header || element?.closest(interactiveSelector)) return;
      event.preventDefault();
      openForHeader(header);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && target) { setTarget(null); return; }
      const header = event.target instanceof HTMLTableCellElement && event.target.matches("th[data-column-filter-header='true']") ? event.target : null;
      if (!header || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      openForHeader(header);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!target) return;
      const node = event.target as Node;
      if (popoverRef.current?.contains(node) || target.header.contains(node)) return;
      setTarget(null);
    };
    const close = () => setTarget(null);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [openForHeader, prepareTables, target]);

  const updateSelection = (nextValues: string[]) => {
    if (!target) return;
    const filters = filtersFor(target.table);
    const normalized = [...new Set(nextValues)];
    if (normalized.length) filters.set(target.columnIndex, new Set(normalized));
    else filters.delete(target.columnIndex);
    const counts = applyFilters(target.table);
    setTarget((current) => current ? { ...current, selected: normalized, ...counts } : current);
  };

  if (!target) return null;
  const normalizedQuery = normalizeTableCellValue(query).toLocaleLowerCase("zh-CN");
  const visibleOptions = target.options.filter((value) => (value || "（空白）").toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const selectedValues = new Set(target.selected);

  return <div
    ref={popoverRef}
    className="column-filter-popover"
    role="dialog"
    aria-label={`${target.label}列筛选`}
    style={{ left: target.left, top: target.top, width: target.width }}
  >
    <header><div><strong>{target.label}</strong><small>多选当前表格中的值</small></div><button type="button" onClick={() => setTarget(null)} aria-label="关闭列筛选">×</button></header>
    <div className="column-filter-actions"><button type="button" onClick={() => updateSelection(target.options)}>全选</button><button type="button" onClick={() => updateSelection([])} disabled={target.selected.length === 0}>清除筛选</button></div>
    <label className="column-filter-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索本列值" aria-label={`搜索${target.label}列值`} /></label>
    <div className="column-filter-options" role="listbox" aria-multiselectable="true">
      {visibleOptions.map((value) => <label key={value || "__empty__"} role="option" aria-selected={selectedValues.has(value)}><input type="checkbox" checked={selectedValues.has(value)} onChange={() => updateSelection(selectedValues.has(value) ? target.selected.filter((item) => item !== value) : [...target.selected, value])} /><span title={value || "（空白）"}>{value || "（空白）"}</span></label>)}
      {visibleOptions.length === 0 && <p>没有匹配项</p>}
    </div>
    <footer aria-live="polite">显示 {target.visibleRows} / {target.totalRows} 行{target.selected.length ? ` · 已选 ${target.selected.length} 项` : " · 未筛选"}</footer>
  </div>;
}
