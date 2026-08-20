"use client";

import { useEffect, useRef, useState } from "react";

const formatSearchableCount = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
};

export function SearchableSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  searchPlaceholder = "输入关键词搜索",
  emptyLabel = "没有匹配项",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  className?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedOption = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return <div className={`searchable-select ${className} ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="searchable-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { if (!disabled) { setOpen((current) => !current); setQuery(""); } }}>
      <span title={selectedOption?.label ?? "请选择"}>{selectedOption?.label ?? "请选择"}</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div className="searchable-select-menu" role="listbox" aria-label={`${ariaLabel}选项`}>
      <label className="searchable-select-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visibleOptions.length === 1 && !visibleOptions[0].disabled) { event.preventDefault(); choose(visibleOptions[0].value); } }} placeholder={searchPlaceholder} aria-label={`搜索${ariaLabel}`} /></label>
      <div className="searchable-select-options">
        {visibleOptions.map((option) => <button type="button" key={`${option.value}-${option.label}`} className={option.value === value ? "selected" : ""} role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => choose(option.value)}><span title={option.label}>{option.label}</span>{option.value === value && <i aria-hidden="true">✓</i>}</button>)}
        {visibleOptions.length === 0 && <p>{emptyLabel}</p>}
      </div>
    </div>}
  </div>;
}
export function SearchableMultiSelect({
  values,
  onChange,
  options,
  ariaLabel,
  allLabel,
  className = "",
  searchPlaceholder = "输入关键词搜索",
  emptyLabel = "没有匹配项",
  disabled = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  allLabel: string;
  className?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedValues = new Set(values);
  const availableOptions = options.filter((option) => !option.disabled);
  const selectedOptions = options.filter((option) => selectedValues.has(option.value));
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  const summary = selectedOptions.length === 0
    ? allLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `已选 ${formatSearchableCount(selectedOptions.length)} 项`;

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = (nextValue: string) => {
    onChange(selectedValues.has(nextValue)
      ? values.filter((value) => value !== nextValue)
      : [...values, nextValue]);
  };
  const selectAll = () => onChange(availableOptions.map((option) => option.value));

  return <div className={`searchable-select searchable-multi-select ${className} ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="searchable-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { if (!disabled) { setOpen((current) => !current); setQuery(""); } }}>
      <span title={summary}>{summary}</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div className="searchable-select-menu" role="listbox" aria-label={`${ariaLabel}选项`} aria-multiselectable="true">
      <div className="searchable-select-menu-head"><strong>{ariaLabel}</strong><span><button type="button" onClick={selectAll} disabled={availableOptions.length === 0 || selectedOptions.length === availableOptions.length}>全选</button><button type="button" onClick={() => onChange([])} disabled={selectedOptions.length === 0}>清空</button></span></div>
      <label className="searchable-select-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`搜索${ariaLabel}`} /></label>
      <div className="searchable-select-options searchable-multi-select-options">
        <button type="button" className={selectedOptions.length === 0 ? "selected" : ""} role="option" aria-selected={selectedOptions.length === 0} onClick={() => onChange([])}><span className="searchable-multi-check" aria-hidden="true">{selectedOptions.length === 0 ? "✓" : ""}</span><span title={allLabel}>{allLabel}</span></button>
        {visibleOptions.map((option) => { const selected = selectedValues.has(option.value); return <button type="button" key={`${option.value}-${option.label}`} className={selected ? "selected" : ""} role="option" aria-selected={selected} disabled={option.disabled} onClick={() => toggle(option.value)}><span className="searchable-multi-check" aria-hidden="true">{selected ? "✓" : ""}</span><span title={option.label}>{option.label}</span></button>; })}
        {visibleOptions.length === 0 && <p>{emptyLabel}</p>}
      </div>
    </div>}
  </div>;
}
