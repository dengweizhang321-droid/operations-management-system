"use client";

import { useMemo, useState } from "react";

import warehouseMappingData from "@/config/inventory-warehouse-mapping.json";
import type { InventoryWarehouseCategory } from "@/lib/inventory/warehouse-classification";

type WarehouseMappingEntry = {
  category: Exclude<InventoryWarehouseCategory, "selfOperated">;
  label: string;
  includeInInventory: boolean;
};

export type WarehouseMappingRow = WarehouseMappingEntry & {
  warehouse: string;
};

export type WarehouseMappingFilters = {
  query: string;
  category: "all" | WarehouseMappingEntry["category"];
  inventory: "all" | "included" | "excluded";
};

const categoryLabels: Record<WarehouseMappingEntry["category"], string> = {
  jd: "京东仓",
  dropship: "代发仓",
  afterSales: "售后仓",
  guangdong: "广东仓",
  sample: "样品仓",
  cainiao: "菜鸟仓",
  overseas: "海外仓",
  virtual: "虚拟仓",
  exception: "异常仓",
};

const PAGE_SIZE = 20;

export const warehouseMappingRows: readonly WarehouseMappingRow[] = Object.entries(
  warehouseMappingData.warehouses as Record<string, WarehouseMappingEntry>,
).map(([warehouse, entry]) => ({ warehouse, ...entry }));

export function filterWarehouseMappings(
  rows: readonly WarehouseMappingRow[],
  filters: WarehouseMappingFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return rows.filter((row) => {
    if (filters.category !== "all" && row.category !== filters.category) return false;
    if (filters.inventory === "included" && !row.includeInInventory) return false;
    if (filters.inventory === "excluded" && row.includeInInventory) return false;
    if (!query) return true;
    return [row.warehouse, row.label, categoryLabels[row.category], row.category]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
  });
}

function SummaryCard({ label, value, note }: { label: string; value: number; note: string }) {
  return <article><span>{label}</span><strong>{value.toLocaleString("zh-CN")}</strong><small>{note}</small></article>;
}

export default function WarehouseMappingSettings() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WarehouseMappingFilters["category"]>("all");
  const [inventory, setInventory] = useState<WarehouseMappingFilters["inventory"]>("all");
  const [page, setPage] = useState(1);

  const categoryOptions = useMemo(() => Array.from(new Set(warehouseMappingRows.map((row) => row.category))), []);
  const categoryCount = categoryOptions.length;
  const includedCount = warehouseMappingRows.filter((row) => row.includeInInventory).length;
  const excludedCount = warehouseMappingRows.length - includedCount;
  const filteredRows = useMemo(
    () => filterWarehouseMappings(warehouseMappingRows, { query, category, inventory }),
    [category, inventory, query],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const updateQuery = (value: string) => { setQuery(value); setPage(1); };
  const updateCategory = (value: WarehouseMappingFilters["category"]) => { setCategory(value); setPage(1); };
  const updateInventory = (value: WarehouseMappingFilters["inventory"]) => { setInventory(value); setPage(1); };

  return <div className="warehouse-mapping-workspace">
    <section className="panel warehouse-mapping-overview">
      <div>
        <span className="warehouse-mapping-eyebrow">库存统一口径</span>
        <h2>仓库映射</h2>
        <p>展示系统当前使用的仓库归类。库存总览、备货计划和库存导入统一读取同一份映射配置。</p>
      </div>
      <div className="warehouse-mapping-summary" aria-label="仓库映射汇总">
        <SummaryCard label="仓库总数" value={warehouseMappingRows.length} note={`映射版本 ${warehouseMappingData.version}`} />
        <SummaryCard label="仓库类型" value={categoryCount} note="按现有自定义类型统计" />
        <SummaryCard label="计入库存" value={includedCount} note="进入库存分析与备货口径" />
        <SummaryCard label="排除库存" value={excludedCount} note="保留明细但不计入总览" />
      </div>
    </section>

    <section className="panel table-panel warehouse-mapping-panel">
      <div className="table-toolbar warehouse-mapping-toolbar">
        <div><h2>仓库归类明细</h2><p>来源：{warehouseMappingData.sourceFile} · 共 {filteredRows.length.toLocaleString("zh-CN")} 条符合条件</p></div>
        <div className="warehouse-mapping-filters">
          <label><span>仓库类型</span><select aria-label="仓库类型" value={category} onChange={(event) => updateCategory(event.target.value as WarehouseMappingFilters["category"])}>
            <option value="all">全部类型</option>
            {categoryOptions.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
          </select></label>
          <label><span>库存口径</span><select aria-label="库存口径" value={inventory} onChange={(event) => updateInventory(event.target.value as WarehouseMappingFilters["inventory"])}>
            <option value="all">全部</option>
            <option value="included">计入库存</option>
            <option value="excluded">排除库存</option>
          </select></label>
          <label className="warehouse-mapping-search"><span>搜索</span><input aria-label="搜索仓库映射" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="仓库名或类型" /></label>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table warehouse-mapping-table">
          <thead><tr><th>仓库</th><th>自定义仓库类型</th><th>系统归类</th><th>计入库存</th><th>映射来源</th></tr></thead>
          <tbody>
            {visibleRows.map((row) => <tr key={row.warehouse}>
              <td><strong>{row.warehouse}</strong></td>
              <td><span className="warehouse-category-tag">{row.label}</span></td>
              <td><span>{categoryLabels[row.category]}</span><small className="cell-note">{row.category}</small></td>
              <td><span className={`status ${row.includeInInventory ? "status-success" : "status-danger"}`}>{row.includeInInventory ? "计入" : "排除"}</span></td>
              <td><span className="soft-tag">配置映射</span></td>
            </tr>)}
            {visibleRows.length === 0 && <tr><td colSpan={5}><div className="table-state">没有符合当前条件的仓库映射。</div></td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="warehouse-mapping-pagination">
        <span>第 {currentPage} / {pageCount} 页 · 每页 {PAGE_SIZE} 条</span>
        <div>
          <button type="button" className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <button type="button" className="secondary-button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
        </div>
      </footer>
    </section>
  </div>;
}
