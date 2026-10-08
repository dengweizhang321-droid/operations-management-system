"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// A presentation snapshot, never a result for the pending query. It is bound
// to the full owner/period and authentication packet, read-only while retained,
// and removed synchronously on errors or owning-scope changes.
export function StableReadContent({ owner, identity, pending, complete, error = false, notice = true, preserveViewport = true, preserveBlockHeight = false, children }: {
  owner: string; identity?: unknown; pending: boolean; complete: boolean;
  error?: boolean; notice?: boolean | string; preserveViewport?: boolean; preserveBlockHeight?: boolean; children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<{ owner: string; identity: unknown; view: ReactNode } | null>(null);
  const [floor, setFloor] = useState({ owner, identity, height: 0 });
  const ownsSnapshot = snapshot?.owner === owner && snapshot.identity === identity;
  const retaining = !error && ownsSnapshot && (pending || !complete);
  const ownsFloor = floor.owner === owner && floor.identity === identity;
  useLayoutEffect(() => {
    if (!ownsFloor) setFloor({ owner, identity, height: 0 });
    if (!ownsSnapshot || error) setSnapshot(null);
    if (retaining && (preserveViewport || preserveBlockHeight) && body.current) {
      const rect = body.current.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // Reserve only the viewport needed to keep the user's scroll position,
      // not the height of an arbitrarily long preceding table.
      const height = Math.max(ownsFloor ? floor.height : 0,
        preserveViewport ? window.scrollY + window.innerHeight - top : 0,
        preserveBlockHeight ? rect.height : 0);
      if (!ownsFloor || height !== floor.height) setFloor({ owner, identity, height });
    }
    if (complete && !pending && !error && (!ownsSnapshot || snapshot.view !== children)) setSnapshot({ owner, identity, view: children });
  }, [owner, identity, children, pending, complete, error, retaining, preserveViewport, preserveBlockHeight, ownsFloor, floor.height, ownsSnapshot, snapshot]);
  return <div className="stable-read-content" data-retained-read={retaining ? "true" : undefined}
    aria-busy={!error && (pending || !complete)} style={ownsFloor && floor.height > 0 ? { minHeight: floor.height } : undefined}>
    {retaining && notice && <div className="stable-read-notice" role="status">{typeof notice === "string" ? notice : "正在更新筛选，下方暂时显示上次成功结果，仅供参考。"}</div>}
    <div ref={body} className="stable-read-body" inert={retaining || undefined} aria-hidden={retaining || undefined}>
      {retaining ? snapshot!.view : children}
    </div>
  </div>;
}
