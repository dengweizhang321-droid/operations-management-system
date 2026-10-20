"use client";

import { Component, lazy, Suspense, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { AiConversationShell } from "./ai-conversation-shell";

const Chat = lazy(() => import("./ai-assistant-view"));
const Agent = lazy(() => import("./ai-pi-agent-view"));
type Mode = "chat" | "agent";
class ModeBoundary extends Component<{ children: ReactNode; control: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert"><p>此模式暂时无法打开，已保存的任务与记录仍保留。</p>{this.props.control}<button type="button" onClick={() => this.setState({ failed: false })}>重新打开此模式</button></div> : this.props.children;
  }
}

/** Each mode keeps its own controller, drafts and server request identities. */
export default function AiConversationWorkspace(props: ComponentProps<typeof Chat>) {
  const [mode, setMode] = useState<Mode>("chat");
  const [agentVisited, setAgentVisited] = useState(false);
  const storageKey = `ai-conversation-mode:${props.currentUser?.email ?? "anonymous"}`;
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "agent") { setMode("agent"); setAgentVisited(true); }
    } catch { /* Switching remains available without local preferences. */ }
  }, [storageKey]);
  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === "agent") setAgentVisited(true);
    try { localStorage.setItem(storageKey, next); } catch { /* No request state is stored here. */ }
  };
  const control = <div className="ai-conversation-mode" role="group" aria-label="对话模式">
    <button type="button" aria-pressed={mode === "chat"} onClick={() => changeMode("chat")}>Chat</button>
    <button type="button" aria-pressed={mode === "agent"} onClick={() => changeMode("agent")}>Agent</button>
  </div>;
  return <div className="ai-conversation-workspace"><AiConversationShell key={storageKey} mode={mode} onMode={changeMode}>
    <div className="ai-conversation-surface" hidden={mode !== "chat"}>
      <ModeBoundary control={control}><Suspense fallback={<p role="status">正在恢复对话…</p>}><Chat {...props} composerModeControl={control} /></Suspense></ModeBoundary>
    </div>
    {agentVisited && <div className="ai-conversation-surface" hidden={mode !== "agent"}>
      <ModeBoundary control={control}><Suspense fallback={<p role="status">正在恢复 Agent…</p>}><Agent currentUser={props.currentUser} initialContextPrompt={props.initialContextPrompt} embedded composerModeControl={control} /></Suspense></ModeBoundary>
    </div>}
  </AiConversationShell></div>;
}
