"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

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
    key,
    draft,
    pending: JSON.stringify(draft) !== JSON.stringify(applied),
    setDraft: (value: T) => setState({ key, value }),
    discard: () => setState({ key, value: applied }),
  };
}

export const AUTO_FILTER_DELAY_MS = 500;

export function useAutomaticFilter<T>({ draft, pending, scope, onApply, invalid = false }: {
  draft: T; pending: boolean; scope: string; onApply: () => void; invalid?: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const key = JSON.stringify([scope, draft]);
  const committed = useRef({ key, pending, invalid, onApply });
  // Metadata/response renders can change callbacks without changing the edit.
  // Only committed state may be submitted by an already scheduled timer.
  useLayoutEffect(() => { committed.current = { key, pending, invalid, onApply }; });
  useEffect(() => {
    if (!pending || invalid || composing) return;
    const location = window.location.href;
    const timer = window.setTimeout(() => {
      const latest = committed.current;
      if (latest.key !== key || !latest.pending || latest.invalid || composingRef.current
        || window.location.href !== location) return;
      latest.onApply();
    }, AUTO_FILTER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, pending, invalid, composing]);
  return {
    composing,
    isComposing: () => composingRef.current,
    compositionHandlers: {
      onCompositionStartCapture: () => { composingRef.current = true; setComposing(true); },
      onCompositionEndCapture: () => { composingRef.current = false; setComposing(false); },
    },
  };
}

export function confirmFilterText(event: KeyboardEvent, options: {
  composing: boolean; invalid?: boolean; onConfirm: () => void;
}) {
  if (event.key !== "Enter" || event.shiftKey || options.composing
    || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (!options.invalid && !event.repeat) options.onConfirm();
}

export function AutomaticFilterFeedback({ pending, textPending = false, composing = false, invalid = false }: {
  pending: boolean; textPending?: boolean; composing?: boolean; invalid?: boolean;
}) {
  return <div className="filter-draft-actions">
    <small role="status" aria-live="polite">{invalid ? "货品输入无效，请修正后按 Enter 确认；下拉条件仍自动生效。" : composing ? "正在选词，选词完成后按 Enter 确认货品筛选。" : textPending ? "货品输入尚未确认，请按 Enter；下拉条件自动更新。" : pending ? "正在自动更新下拉条件；下方仍对应上次条件。" : "下拉条件自动生效；货品文本按 Enter 确认。空选择表示全部授权范围。"}</small>
  </div>;
}
