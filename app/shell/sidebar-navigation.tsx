"use client";

import type { MouseEvent } from "react";

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
  return (
    <nav className="main-nav sidebar-navigation" aria-label="主导航">
      <ul className="sidebar-navigation-groups">
        {navGroups.map((group, groupIndex) => {
          const groupLabelId = `sidebar-navigation-group-${groupIndex}`;
          return (
            <li className="nav-group" key={group.label}>
              <p id={groupLabelId}>{group.label}</p>
              <ul aria-labelledby={groupLabelId}>
                {group.keys.map((moduleKey) => {
                  const item = navItemsByKey.get(moduleKey);
                  if (!item) return null;
                  const tooltipId = `sidebar-navigation-tooltip-${moduleKey}`;
                  const selected = active === moduleKey;

                  return (
                    <li key={moduleKey}>
                      <a
                        href={hrefForModule(moduleKey)}
                        className={`sidebar-navigation-link${selected ? " active" : ""}`}
                        aria-current={selected ? "page" : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        aria-describedby={collapsed ? tooltipId : undefined}
                        title={collapsed ? `${item.label} · ${item.description}` : undefined}
                        onClick={(event) => onNavigate(event, moduleKey)}
                      >
                        <span className="nav-icon" aria-hidden="true">
                          <ShellModuleIcon moduleKey={moduleKey} />
                        </span>
                        <span className="nav-copy">
                          <b>{item.label}</b>
                          <small>{item.description}</small>
                        </span>
                        {item.badge ? <em aria-label={`${item.badge} 项待处理`}>{item.badge}</em> : null}
                        {collapsed ? (
                          <span className="sidebar-navigation-tooltip" id={tooltipId} role="tooltip">
                            <strong aria-hidden="true">{item.label}</strong>
                            <span>{item.description}</span>
                          </span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="collapse-button sidebar-collapse-button"
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <SidebarCollapseIcon collapsed={collapsed} />
      </button>
    </nav>
  );
}
