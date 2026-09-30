"use client";

import type { ModuleViewKey } from "../../shell/navigation-catalog";

export const netshopViews = ["analysis", "outlets", "platforms", "products", "promotion"] as const;
export type NetshopView = ModuleViewKey<"shop">;
const labels = ["店铺分析", "网店总览", "平台对比", "商品数据", "推广分析"];

/** Shared shell slot. Columns supply their own component; only active is called.
 * I owns the final map, so no column needs to edit the legacy module file.
 */
export function NetshopModuleSlot({ active, renderers }: {
  active: NetshopView;
  renderers: Partial<Record<NetshopView, () => React.ReactNode>>;
}) {
  return renderers[active]?.() ?? null;
}

export function NetshopNavigation({ active, onChange }: { active: NetshopView; onChange: (view: NetshopView) => void }) {
  return <div className="subnav outlet-subnav" role="tablist" aria-label="网店分析子版块">
    {netshopViews.map((view, i) => <button type="button" key={view} role="tab" aria-selected={active === view} className={active === view ? "active" : ""} onClick={() => onChange(view)}>{labels[i]}</button>)}
    <button type="button" disabled title="待接入企业购明细">企业购分析</button>
    <button type="button" disabled title="待接入客服报表">客服分析</button>
  </div>;
}
