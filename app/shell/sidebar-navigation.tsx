"use client";

import {
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { navGroups, navItems, type ModuleKey, type NavItem } from "./navigation-catalog";
import { ShellModuleIcon, SidebarCollapseIcon } from "./shell-icons";

export type SidebarNavigationProps = {
  active: ModuleKey;
  collapsed: boolean;
  hrefForModule: (moduleKey: ModuleKey) => string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, moduleKey: ModuleKey) => void;
  onToggleCollapsed: () => void;
};

const navItemsByKey: ReadonlyMap<ModuleKey, NavItem> = new Map(
  navItems.map((item) => [item.key, item]),
);

export default function SidebarNavigation({
  active,
  collapsed,
  hrefForModule,
  onNavigate,
  onToggleCollapsed,
}: SidebarNavigationProps) {
  const [tooltip, setTooltip] = useState<{
    id: string;
    label: string;
    description: string;
    top: number;
  } | null>(null);
  const showTooltip = (element: HTMLElement, item: NavItem, id: string) => {
    if (!collapsed) return;
    const navRect = element.closest("nav")?.getBoundingClientRect();
    const linkRect = element.getBoundingClientRect();
    setTooltip({
      id,
      label: item.label,
      description: item.description,
      top: linkRect.top - (navRect?.top ?? 0) + linkRect.height / 2,
    });
  };
  const hideTooltip = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setTooltip(null);
  };
  const dismissTooltip = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === "Escape") setTooltip(null);
  };

  return (
    <nav className="main-nav sidebar-navigation" aria-label="主导航">
      <div className="sidebar-navigation-scroll" onScroll={() => setTooltip(null)}>
        <ul className="sidebar-navigation-groups">
          {navGroups.map((group, groupIndex) => {
            const groupLabelId = `sidebar-navigation-group-${groupIndex}`;
            return (
              <li className="nav-group" key={group.label}>
                <p id={groupLabelId} aria-hidden={collapsed || undefined}>{group.label}</p>
                <ul
                  aria-label={collapsed ? group.label : undefined}
                  aria-labelledby={collapsed ? undefined : groupLabelId}
                >
                  {group.keys.map((moduleKey) => {
                    const item = navItemsByKey.get(moduleKey);
                    if (!item) return null;
                    const tooltipId = `sidebar-navigation-tooltip-${moduleKey}`;
                    const selected = active === moduleKey;
                    const tooltipVisible = collapsed && tooltip?.id === tooltipId;

                    return (
                      <li key={moduleKey}>
                        <a
                          href={hrefForModule(moduleKey)}
                          className={`sidebar-navigation-link${selected ? " active" : ""}`}
                          aria-current={selected ? "page" : undefined}
                          aria-label={collapsed ? item.label : undefined}
                          aria-describedby={tooltipVisible ? tooltipId : undefined}
                          title={collapsed ? `${item.label} · ${item.description}` : undefined}
                          onClick={(event) => {
                            setTooltip(null);
                            onNavigate(event, moduleKey);
                          }}
                          onMouseEnter={(event) => showTooltip(event.currentTarget, item, tooltipId)}
                          onMouseLeave={hideTooltip}
                          onFocus={(event) => showTooltip(event.currentTarget, item, tooltipId)}
                          onBlur={hideTooltip}
                          onKeyDown={dismissTooltip}
                        >
                          <span className="nav-icon" aria-hidden="true">
                            <ShellModuleIcon moduleKey={moduleKey} />
                          </span>
                          <span className="nav-copy">
                            <b>{item.label}</b>
                            <small>{item.description}</small>
                          </span>
                          {item.badge ? <em aria-label={`${item.badge} 项待处理`}>{item.badge}</em> : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
      {collapsed && tooltip ? (
        <span
          className="sidebar-navigation-tooltip"
          id={tooltip.id}
          role="tooltip"
          style={{ top: tooltip.top }}
        >
          <strong aria-hidden="true">{tooltip.label}</strong>
          <span>{tooltip.description}</span>
        </span>
      ) : null}
      <button
        type="button"
        className="collapse-button sidebar-collapse-button"
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        aria-controls="primary-navigation"
        aria-expanded={!collapsed}
        onClick={() => {
          setTooltip(null);
          onToggleCollapsed();
        }}
      >
        <SidebarCollapseIcon collapsed={collapsed} />
      </button>
    </nav>
  );
}
