"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ConversationMode = "chat" | "agent";
export type ConversationSurface = {
  title: string; selectedId: string;
  entries: { id: string; title: string; updatedAt?: string; status?: string }[];
  canNew: boolean; canDelete?: boolean; busy?: boolean; loading?: boolean; hasMore?: boolean;
  onNew: () => void; onOpen: (id: string) => void; onDelete?: (id: string) => void;
  onMore?: () => void; onRefresh: () => void; onDetails?: () => void;
};
type Registration = { signature: string; read: () => ConversationSurface };
const SurfaceContext = createContext<{ publish: (mode: ConversationMode, signature: string, read: () => ConversationSurface) => void } | null>(null);

/** Share presentation, never merge the two execution ledgers or request identities. */
export function useConversationSurface(mode: ConversationMode, surface: ConversationSurface) {
  const host = useContext(SurfaceContext);
  const latest = useRef(surface); latest.current = surface;
  const signature = JSON.stringify([surface.title, surface.selectedId, surface.entries, surface.canNew,
    surface.canDelete, surface.busy, surface.loading, surface.hasMore, !!surface.onDetails]);
  const publish = host?.publish;
  useEffect(() => { publish?.(mode, signature, () => latest.current); }, [publish, mode, signature]);
  return !!host;
}

export function AiConversationShell({ mode, onMode, children }: { mode: ConversationMode; onMode: (mode: ConversationMode) => void; children: ReactNode }) {
  const [registered, setRegistered] = useState<Partial<Record<ConversationMode, Registration>>>({});
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const publish = useCallback((key: ConversationMode, signature: string, read: () => ConversationSurface) => {
    setRegistered(current => current[key]?.signature === signature ? current : { ...current, [key]: { signature, read } });
  }, []);
  const context = useMemo(() => ({ publish }), [publish]);
  const surface = registered[mode]?.read();
  const entries = (["chat", "agent"] as const).flatMap(key => (registered[key]?.read().entries ?? []).map(entry => ({ ...entry, mode: key })));
  entries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const filtered = entries.filter(entry => entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <SurfaceContext.Provider value={context}><article className="ai-workbench ai-unified-chat" aria-label="统一 AI 对话工作台">
    <header className="ai-workbench-top"><div><button type="button" className="ai-workbench-icon" aria-label="显示或收起会话列表" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>☰</button><span className="ai-workbench-brand" aria-hidden="true">✧</span><strong>小特</strong><span className="ai-workbench-subtitle">{surface?.title || "新对话"}</span><span className="ai-unified-mode-badge">{mode === "chat" ? "Chat" : "Agent"}</span></div><div><button type="button" className="ai-workbench-text" disabled={!surface || surface.loading} onClick={() => surface?.onRefresh()}>刷新</button>{surface?.onDetails && <button type="button" className="ai-workbench-text" onClick={() => surface.onDetails?.()}>对话详情</button>}</div></header>
    <div className={`ai-workbench-layout ai-unified-layout ${historyOpen ? "is-history-open" : ""}`}>
      <aside className="ai-workbench-history" aria-label="会话记录">
        <button type="button" className="ai-workbench-new" disabled={!surface?.canNew} onClick={() => { surface?.onNew(); setHistoryOpen(false); }}>＋ 新对话</button>
        <label className="ai-workbench-search"><span aria-hidden="true">⌕</span><input aria-label="搜索已加载会话标题" placeholder="搜索已加载会话标题" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="ai-workbench-history-title"><span>最近会话</span><small>{entries.length}</small></div>
        <div className="ai-workbench-history-list">{filtered.map(entry => {
          const owner = registered[entry.mode]?.read();
          return <div key={`${entry.mode}:${entry.id}`} className={`ai-workbench-history-row ${entry.mode === mode && entry.id === surface?.selectedId ? "is-selected" : ""}`}><button type="button" disabled={owner?.busy} onClick={() => { owner?.onOpen(entry.id); onMode(entry.mode); setHistoryOpen(false); }}><span><strong>{entry.title || "新对话"}</strong><small>{entry.mode === "chat" ? "Chat" : "Agent"}{entry.status ? ` · ${entry.status}` : entry.updatedAt ? ` · ${new Date(entry.updatedAt).toLocaleDateString("zh-CN")}` : ""}</small></span></button>{owner?.canDelete && <button type="button" className="ai-workbench-delete" aria-label={`删除对话 ${entry.title}`} disabled={owner.busy} onClick={() => owner.onDelete?.(entry.id)}>×</button>}</div>;
        })}{!filtered.length && <p>{query ? "已加载会话中没有匹配标题。" : "发送消息后，会话会保存在这里。"}</p>}</div>
        {(["chat", "agent"] as const).filter(key => registered[key]?.read().hasMore).map(key => <button key={key} type="button" className="ai-workbench-text" disabled={registered[key]?.read().loading} onClick={() => registered[key]?.read().onMore?.()}>加载更多 {key === "chat" ? "Chat" : "Agent"} 会话</button>)}
        <small className="ai-workbench-history-foot">切换模式保留各自草稿和任务；不会重发请求。</small>
      </aside><div className="ai-unified-surfaces">{children}</div>
    </div>
  </article></SurfaceContext.Provider>;
}

export function AiConversationComposer({ input, tools, actions, context, options, note }: { input: ReactNode; tools?: ReactNode; actions: ReactNode; context?: ReactNode; options?: ReactNode; note?: ReactNode }) {
  return <div className="ai-workbench-composer-area ai-conversation-composer">{context}{options}<div className="ai-workbench-composer">{input}<div className="ai-workbench-composer-toolbar"><div className="ai-conversation-tools">{tools}</div><div className="ai-conversation-send-tools">{actions}</div></div></div>{note && <div className="ai-workbench-composer-note">{note}</div>}</div>;
}
