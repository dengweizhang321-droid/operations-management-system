"use client";

import { useEffect, useState } from "react";

// URLs and requests consume applied values. Scope/caller reconciliation resets
// the draft; metadata refreshes don't erase an in-progress selection.
export function useFilterDraft<T>(applied: T, scope: string) {
  const key = JSON.stringify([scope, applied]);
  const [state, setState] = useState({ key, value: applied });
  const draft = state.key === key ? state.value : applied;
  useEffect(() => {
    setState(current => current.key === key ? current : { key, value: applied });
  }, [key, applied]);
  return {
    draft,
    pending: JSON.stringify(draft) !== JSON.stringify(applied),
    setDraft: (value: T) => setState({ key, value }),
    discard: () => setState({ key, value: applied }),
  };
}

export function FilterDraftActions({ pending, invalid = false, onApply, onDiscard }: {
  pending: boolean; invalid?: boolean; onApply: () => void; onDiscard: () => void;
}) {
  return <div className="filter-draft-actions">
    <button type="button" className="primary-button" disabled={!pending || invalid} onClick={onApply}>应用筛选</button>
    <button type="button" className="secondary-button" disabled={!pending} onClick={onDiscard}>撤销修改</button>
    <small role="status" aria-live="polite">{pending ? "有待应用条件；下方数据仍对应已应用范围。" : "条件已应用；空选择表示该维度全部授权范围。"}</small>
  </div>;
}
