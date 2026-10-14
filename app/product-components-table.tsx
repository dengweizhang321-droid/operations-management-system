"use client";

import type { ProductSummaryItem } from "@/lib/products/summary";
import { formatCount, formatExactCurrencyFromCents, formatRate } from "./module-view-shared";

export function ProductComponentsTable({ item }: { item: ProductSummaryItem }) {
  return <div className="product-components"><p>以下数据仅为分配到该组合装的子件数据，已包含在整套金额中；未凑成套的销量单独列在单品行。</p>
    <div className="data-table-wrap"><table className="data-table" aria-label={`${item.productCode}组合装构成及数据`}>
      <thead><tr><th>子件编号</th><th>子件名称</th><th>每套数量（件）</th><th>净销量（件）</th><th>销售净额</th><th>货品成本</th><th>分摊费用</th><th>订单毛利</th><th>实际大毛利率</th></tr></thead>
      <tbody>{item.components?.map(child => <tr key={child.productCode}><td>{child.productCode}</td><td>{child.productName || child.productCode}</td><td>{formatCount(child.quantity)}</td>
        <td>{child.sales ? formatCount(child.sales.netQuantity) : "—"}</td>
        {(["netSalesCents", "costCents", "feeCents", "grossProfitCents"] as const).map(field => <td key={field}>{child.sales ? formatExactCurrencyFromCents(child.sales[field]) : "—"}</td>)}
        <td>{child.sales?.grossMarginRate != null ? formatRate(child.sales.grossMarginRate) : "—"}</td></tr>)}</tbody>
    </table></div>{item.components?.some(child => child.sales === null) && <p>包含直接按组合装代码开单的记录，源数据未提供子件金额分配，子件经营数据暂不可用。</p>}
  </div>;
}
