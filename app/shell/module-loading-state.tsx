import type { ReactNode } from "react";

/** Region-local fallback; reserves a small stable footprint and exposes one status. */
export default function ModuleLoadingState({ title, children }: { title: string; children?: ReactNode }) {
  return <section className="panel data-state" role="status" aria-live="polite" aria-atomic="true" aria-busy="true" style={{ minHeight: 160 }}>
    <span className="state-spinner" aria-hidden="true" />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </section>;
}
