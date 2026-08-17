"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
} from "react";

type AppShellProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function AppShell({
  collapsed,
  mobileOpen,
  onCloseMobile,
  sidebar,
  header,
  children,
}: AppShellProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const sidebarElement = sidebarRef.current;
    const currentItem = sidebarElement?.querySelector<HTMLElement>("[aria-current='page']");
    const firstFocusable = sidebarElement?.querySelector<HTMLElement>(focusableSelector);
    window.requestAnimationFrame(() => (currentItem ?? firstFocusable)?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
        return;
      }
      if (event.key !== "Tab" || !sidebarElement) return;
      const focusable = Array.from(sidebarElement.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    };
  }, [mobileOpen, onCloseMobile]);

  return (
    <main className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}
        aria-label="应用导航"
      >
        {sidebar}
        <button
          type="button"
          className="mobile-navigation-close"
          onClick={onCloseMobile}
          aria-label="关闭主导航"
        >
          <span aria-hidden="true">×</span>
        </button>
      </aside>
      {mobileOpen && (
        <button
          type="button"
          className="mobile-overlay"
          onClick={onCloseMobile}
          aria-label="关闭导航"
          tabIndex={-1}
        />
      )}
      <section className="workspace" inert={mobileOpen || undefined}>
        {header}
        {children}
      </section>
    </main>
  );
}
