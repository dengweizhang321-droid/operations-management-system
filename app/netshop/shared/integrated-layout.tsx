"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type LayoutView = "analysis" | "products" | "promotion";
type LayoutPreferences = Record<LayoutView, boolean>;
const defaults: LayoutPreferences = { analysis: true, products: true, promotion: true };
const storageKey = "teruisi.netshop.integrated-layout.v1";
const LayoutContext = createContext({ integrated: false, select: (_value: boolean) => undefined as void });
function isLayoutView(view: string): view is LayoutView { return view === "analysis" || view === "products" || view === "promotion"; }

/** Presentation only. Filters, reads, exact identities and drill/return stay in the existing shell. */
export function NetshopLayoutBoundary({ view, classicOnly = false, onIntegrated, children }: {
  view: string; classicOnly?: boolean; onIntegrated?: () => void; children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<LayoutPreferences>(defaults);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const value = saved as Partial<LayoutPreferences>;
        setPreferences({ analysis: typeof value.analysis === "boolean" ? value.analysis : true, products: typeof value.products === "boolean" ? value.products : true, promotion: typeof value.promotion === "boolean" ? value.promotion : true });
      }
    } catch { /* Storage is optional; no business data is saved here. */ }
  }, []);
  const integrated = isLayoutView(view) && preferences[view] && !classicOnly;
  const select = (value: boolean) => {
    if (!isLayoutView(view)) return;
    const next = { ...preferences, [view]: value };
    setPreferences(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the current session usable. */ }
    if (value) onIntegrated?.();
  };
  return <LayoutContext.Provider value={{ integrated, select }}>{children}</LayoutContext.Provider>;
}

export function useNetshopIntegratedLayout() { return useContext(LayoutContext).integrated; }

export function NetshopLayoutSwitcher({ label }: { label: string }) {
  const { integrated, select } = useContext(LayoutContext);
  return <div className="netshop-layout-toolbar"><div><strong>{label}</strong><span>同一数据范围 · 保留原有指标与明细</span></div><div className="netshop-layout-switch" role="group" aria-label={`${label}页面版本`}><button type="button" aria-pressed={integrated} onClick={() => select(true)}>新版</button><button type="button" aria-pressed={!integrated} onClick={() => select(false)}>旧版</button></div></div>;
}

export function IntegratedEvidence({ title = "数据范围与口径", children }: { title?: string; children: ReactNode }) {
  return <details className="ni-evidence"><summary>{title}<span>展开来源、覆盖与限制</span></summary><div className="ni-evidence-body">{children}</div></details>;
}
