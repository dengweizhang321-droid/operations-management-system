"use client";

import type {
  ReactNode,
  RefObject,
} from "react";

type GlobalHeaderProps = {
  title: string;
  description: string;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  actions: ReactNode;
};

export default function GlobalHeader({
  title,
  description,
  menuButtonRef,
  titleRef,
  mobileOpen,
  onOpenMobile,
  actions,
}: GlobalHeaderProps) {
  return (
    <header className="topbar">
      <div className="title-area">
        <button
          ref={menuButtonRef}
          type="button"
          className="mobile-menu-button"
          onClick={onOpenMobile}
          aria-label="打开主导航"
          aria-controls="primary-navigation"
          aria-expanded={mobileOpen}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div>
          <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
          <span>{description}</span>
        </div>
      </div>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}
