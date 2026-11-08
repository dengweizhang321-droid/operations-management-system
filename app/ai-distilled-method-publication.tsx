"use client";

import { useEffect, useRef, useState } from "react";
import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";

type Publication = { state: "enabled" | "disabled" | "unavailable" | "unpublished"; skillId: string; libraryVersion: number; publishedLibraryVersion: number | null };
type Candidate = {
  id: string; operationId: string; version: number; contentDigest: string; reportVersionDigest: string;
  reviewedBy: string; reviewedAt: string | null; reviewNote: string; unverifiedRecommendations: number;
  method: { name: string; description: string; body: string };
  publication: Publication;
};
type Listing = { items: Candidate[]; domains: Record<string, string>; hasMore: boolean };
const path = "/api/ai/pi/skill-candidates";

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const { response, data } = await fetchBoundedJson({ url, init: { ...options, cache: "no-store" },
    signal: options.signal ?? undefined, timeoutMs: 45_000, maxBytes: 256 * 1024 });
  if (!response.ok) throw Error(data && typeof data === "object" && "error" in data ? String(data.error) : "请求失败，请刷新记录");
  if (!data || typeof data !== "object") throw Error("发布响应格式无效，请刷新记录");
  return data as T;
}

const publicationLabels: Record<Publication["state"], string> = {
  unpublished: "待发布", enabled: "已发布 · 已启用", disabled: "已发布 · 已停用", unavailable: "发布状态待核实",
};

type LibraryProps = { libraryVersion?: number; onLibraryChange: () => void };

export default function AiDistilledMethodPublication({ libraryVersion, onLibraryChange }: LibraryProps) {
  const [opened, setOpened] = useState(false);
  return <section className="panel" aria-label="已批准的文字方法候选">
    <div className="section-header"><h3>文字方法发布</h3><button type="button" className="secondary-button" aria-expanded={opened} onClick={() => setOpened(value => !value)}>{opened ? "收起发布台" : "查看已批准候选"}</button></div>
    <p>在 Agent 已完成任务中生成草稿并人工审核。批准后由管理员选择领域和触发词，发布到此资源库。</p>
    {opened && <CandidateList libraryVersion={libraryVersion} onLibraryChange={onLibraryChange} />}
  </section>;
}

function CandidateList({ libraryVersion, onLibraryChange }: LibraryProps) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    setListing(null); setError("");
    void api<Listing>(`${path}?publicationPage=${page}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setListing(value);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取候选失败");
    });
    return () => controller.abort();
  }, [page, reload, selected, libraryVersion]);
  if (selected) return <CandidateForm key={selected} id={selected} onClose={() => setSelected("")}
    libraryVersion={libraryVersion} onLibraryChange={onLibraryChange} />;
  return <>
    {error ? <p role="alert" className="report-error">{error}</p> : !listing && <p role="status">正在读取已批准候选…</p>}
    {listing?.items.length === 0 && <p>暂无已批准候选。</p>}
    {listing?.items.map(item => <div key={item.id} className="section-header">
      <p>{item.method.name} · {publicationLabels[item.publication.state]}</p>
      <button type="button" className="secondary-button" onClick={() => setSelected(item.id)}>查看候选与发布记录</button>
    </div>)}
    <div className="report-actions">
      <button type="button" disabled={page === 1} onClick={() => { setListing(null); setPage(value => value - 1); }}>上一页</button>
      <span>第 {page} 页</span>
      <button type="button" disabled={!listing?.hasMore} onClick={() => { setListing(null); setPage(value => value + 1); }}>下一页</button>
      <button type="button" onClick={() => setReload(value => value + 1)}>刷新候选</button>
    </div>
  </>;
}

function CandidateForm({ id, onClose, libraryVersion, onLibraryChange }: LibraryProps & { id: string; onClose: () => void }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [keywordsText, setKeywordsText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const needsRead = useRef(true);
  const refreshedPublished = useRef(false);
  const onLibraryChangeRef = useRef(onLibraryChange);
  useEffect(() => { onLibraryChangeRef.current = onLibraryChange; }, [onLibraryChange]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    needsRead.current = true; setChecking(true); setReadError(""); setConfirmed(false);
    void api<Listing>(`${path}?publicationId=${encodeURIComponent(id)}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.items?.length !== 1 || value.items[0].id !== id) throw Error("读取结果与原候选不一致");
      setListing(value); needsRead.current = false;
      if (refreshedPublished.current && ["enabled", "disabled"].includes(value.items[0].publication.state)) {
        setFailure(""); onLibraryChangeRef.current();
      }
      refreshedPublished.current = false;
    }).catch(cause => {
      if (!controller.signal.aborted) setReadError(cause instanceof Error ? cause.message : "读取候选失败");
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [id, reload, libraryVersion]);
  const item = listing?.items[0];
  const keywords = keywordsText.split("\n").map(value => value.trim()).filter(Boolean);
  const keywordsValid = keywords.length >= 1 && keywords.length <= 8
    && new Set(keywords.map(value => value.toLowerCase())).size === keywords.length
    && keywords.every(value => Array.from(value).length <= 32);
  const mayPublish = item?.publication.state === "unpublished" && !checking && !readError && !busy
    && (libraryVersion === undefined || item.publication.libraryVersion >= libraryVersion);
  const refresh = () => { needsRead.current = true; setConfirmed(false); setChecking(true); setReload(value => value + 1); };
  const publish = async () => {
    if (!item || !mayPublish || !confirmed || !domains.length || !keywordsValid || inFlight.current || needsRead.current) return;
    inFlight.current = true; setBusy(true); setFailure("");
    try {
      const result = await api<{ item: { id: string; version: number; contentDigest: string }; publication: Publication }>(
        `${path}/${encodeURIComponent(id)}/publish`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: item.version, contentDigest: item.contentDigest,
            expectedLibraryVersion: item.publication.libraryVersion, domains, keywords }) });
      if (result.item?.id !== id || result.item.version !== item.version || result.item.contentDigest !== item.contentDigest
          || result.publication?.skillId !== item.publication.skillId
          || result.publication.publishedLibraryVersion !== item.publication.libraryVersion + 1)
        throw Error("发布回执与原候选版本不一致");
    } catch (cause) {
      if (alive.current) setFailure(cause instanceof Error ? cause.message : "发布连接中断");
    } finally {
      inFlight.current = false;
      if (alive.current) { setBusy(false); refreshedPublished.current = true; refresh(); }
    }
  };
  return <div>
    <div className="report-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>返回候选列表</button>
      <button type="button" className="secondary-button" disabled={busy || checking} onClick={refresh}>刷新原候选</button>
    </div>
    {busy && <p role="status">正在提交此候选的发布请求…</p>}
    {checking && <p role="status">正在核对原候选与资源库版本…</p>}
    {readError && <p role="alert" className="report-error">读取失败，发布状态待核实。{readError}</p>}
    {failure && <p role="alert" className="report-error">{item?.publication.state === "unpublished" && !checking && !readError ? "当前资源库尚无该候选的发布记录。" : "发布结果待核实。"}{failure}</p>}
    {item && <><h4>{item.method.name}</h4><p>{item.method.description}</p><p className="report-body">{item.method.body}</p>
      <p role="status">{publicationLabels[item.publication.state]} · 当前资源库 v{item.publication.libraryVersion}{item.publication.publishedLibraryVersion !== null && ` · 发布版本 v${item.publication.publishedLibraryVersion}`}</p>
      <p>审核人 {item.reviewedBy} · 保留 {item.unverifiedRecommendations} 条未验证建议。{item.reviewNote && ` 审核备注 ${item.reviewNote}`}</p>
      <details><summary>来源与版本</summary><p>来源任务 <code>{item.operationId}</code><br />报告 <code>{item.reportVersionDigest}</code><br />候选 <code>{item.id}</code> · v{item.version}<br />正文 <code>{item.contentDigest}</code><br />文字方法 <code>{item.publication.skillId}</code></p></details>
      {item.publication.state === "unpublished" && <form onSubmit={event => { event.preventDefault(); void publish(); }}>
        <fieldset disabled={!mayPublish}><legend>适用领域</legend>
          {Object.entries(listing!.domains).map(([key, label]) => <label key={key} className="report-checkbox"><input type="checkbox" checked={domains.includes(key)} onChange={event => { setConfirmed(false); setDomains(values => event.target.checked ? [...values, key] : values.filter(value => value !== key)); }} />{label}</label>)}
        </fieldset>
        <label>触发词（每行一词，1–8 个，每词最多 32 字）<textarea rows={3} disabled={!mayPublish} value={keywordsText} onChange={event => { setConfirmed(false); setKeywordsText(event.target.value); }} /></label>
        <label className="report-checkbox"><input type="checkbox" checked={confirmed} disabled={!mayPublish || !domains.length || !keywordsValid} onChange={event => setConfirmed(event.target.checked)} />确认将以上正文发布并启用为文字方法</label>
        <button type="submit" className="primary-button" disabled={!mayPublish || !confirmed || !domains.length || !keywordsValid}>发布为文字方法（基于 v{item.publication.libraryVersion}）</button>
      </form>}
    </>}
  </div>;
}
