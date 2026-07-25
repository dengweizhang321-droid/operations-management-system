"use client";
/* eslint-disable @next/next/no-img-element -- JD competitor images are external audited sources. */

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultMarketSegmentsText } from "@/lib/market/default-taxonomy";

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type Model = { id: string; name: string; protocol: string; modelName: string };
type Prompt = { id: string; category: string; version: number; parentId: string | null; source: string; status: string; segments: string[]; promptBody: string; changeNote: string; metrics: Record<string, unknown>; createdAt: string };
type Job = { id: string; category: string; promptVersionId: string; executor: string; modelId: string | null; localModelName: string; status: string; totalCount: number; completedCount: number; failedCount: number; reviewedCount: number; committedCount: number; createdAt: string };
type Item = { id: string; candidateId: string; jobId: string; skuCode: string; productName: string; brand: string; sourceImageUrl: string; resolvedImageUrl: string; imageSource: string; status: string; aiSegment: string; aiImagePriceCents: number | null; aiConfidenceBps: number | null; aiReason: string; reviewedSegment: string; reviewedImagePriceCents: number | null; selected: boolean; version: number; errorMessage: string };
type CatalogItem = { skuCode: string; productName: string; brand: string; category: string; imageUrl: string; imageCacheStatus: string; rankingPriceCents: number | null; annotationId?: string; finalSegment?: string; finalImagePriceCents?: number | null; reviewStatus: string };
type ValidationRun = { id: string; category: string; candidatePromptId: string; baselinePromptId?: string; status: string; sampleCount: number; sampleHash: string; metrics: Record<string, unknown>; gate: { passed?: boolean; reasons?: string[] } };
type ValidationResult = { id: string; runId: string; status: string; skuCode: string; productName: string; goldSegment: string; predictedSegment: string; isCorrect: number; errorMessage: string };
type Workspace = { categories: Array<{ value: string; count: number }>; prompts: Prompt[]; jobs: Job[]; items: Item[]; itemPagination: { page: number; pageSize: number; pageCount: number; total: number }; models: Model[]; textModels: Model[]; catalog: { items: CatalogItem[]; page: number; pageSize: number; pageCount: number; total: number; query: string }; validationRuns: ValidationRun[]; validationResults: ValidationResult[]; agents: Array<{ id: string; name: string; status: string; lastSeenAt?: string; revokedAt?: string }>; error?: string };
type Draft = { segment: string; price: string; selected: boolean; version: number };

const LOAD_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 120_000;
const money = (cents: number | null | undefined) => cents === null || cents === undefined ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
export default function MarketAnnotationView({ currentUser }: { currentUser: CurrentUser }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [jobId, setJobId] = useState("");
  const [category, setCategory] = useState("");
  const [executor, setExecutor] = useState<"cloud" | "local">("cloud");
  const [visionModelId, setVisionModelId] = useState("");
  const [textModelId, setTextModelId] = useState("");
  const [localModelName, setLocalModelName] = useState("gemma4");
  const [limit, setLimit] = useState(500);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [promptId, setPromptId] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [segmentsText, setSegmentsText] = useState(defaultMarketSegmentsText(""));
  const [changeNote, setChangeNote] = useState("");
  const [search, setSearch] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const [goldIds, setGoldIds] = useState<string[]>([]);
  const [sampleCount, setSampleCount] = useState(50);
  const [seed, setSeed] = useState("market-annotation-v1");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [agentToken, setAgentToken] = useState("");
  const stopRef = useRef(false);
  const dirtyDraftIdsRef = useRef(new Set<string>());
  const loadSequenceRef = useRef(0);
  const isAdmin = currentUser?.role === "admin";
  const canEdit = currentUser?.role === "admin" || currentUser?.role === "operator";

  const load = useCallback(async (nextJobId = jobId, q = search, page = searchPage, nextItemPage = itemPage, resetDrafts = false) => {
    const loadSequence = ++loadSequenceRef.current;
    const params = new URLSearchParams({ q, page: String(page), pageSize: "30", itemPage: String(nextItemPage), itemPageSize: "100" });
    if (nextJobId) params.set("jobId", nextJobId);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    let response: Response;
    let payload: Workspace | null;
    try {
      response = await fetch("/api/market/annotations?" + params, { cache: "no-store", signal: controller.signal });
      try {
        payload = await response.json() as Workspace;
      } catch (reason) {
        if (controller.signal.aborted) throw reason;
        payload = null;
      }
    } catch (reason) {
      if (loadSequence !== loadSequenceRef.current) return;
      if (controller.signal.aborted) throw new Error("读取标注工作台超时，请重试");
      throw reason;
    } finally {
      window.clearTimeout(timeout);
    }
    if (loadSequence !== loadSequenceRef.current) return;
    if (!response.ok || !payload) throw new Error(payload?.error || "读取标注工作台失败");
    setData(payload);
    const resolvedJobId = nextJobId || payload.jobs[0]?.id || "";
    setJobId(resolvedJobId);
    if (!nextJobId && resolvedJobId) setItemPage(1);
    const resolvedCategory = category || payload.categories[0]?.value || "";
    setCategory((current) => current || resolvedCategory);
    setVisionModelId((current) => current || payload.models[0]?.id || "");
    setTextModelId((current) => current || payload.textModels[0]?.id || "");
    if (!promptId) {
      const initialPrompt = payload.prompts.find((item) => item.category === resolvedCategory && item.status === "active") ?? payload.prompts.find((item) => item.category === resolvedCategory);
      if (initialPrompt) { setPromptId(initialPrompt.id); setPromptBody(initialPrompt.promptBody); setSegmentsText(initialPrompt.segments.join("\n")); }
      else if (resolvedCategory) setSegmentsText(defaultMarketSegmentsText(resolvedCategory));
    }
    setDrafts((current) => Object.fromEntries(payload.items.map((item) => {
      const serverDraft = { segment: item.reviewedSegment || item.aiSegment, price: item.reviewedImagePriceCents === null ? "" : String(item.reviewedImagePriceCents), selected: item.selected, version: item.version };
      const existing = current[item.id];
      const dirty = !resetDrafts && existing && (existing.segment !== serverDraft.segment || existing.price !== serverDraft.price || existing.selected !== serverDraft.selected);
      return [item.id, dirty ? existing : serverDraft];
    })));
  }, [jobId, search, searchPage, itemPage, category, promptId]);

  const loadInitial = useCallback(async () => {
    setInitialLoading(true);
    setError("");
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setInitialLoading(false);
    }
  }, [load]);

  useEffect(() => { const timer = window.setTimeout(() => void loadInitial(), 0); return () => window.clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!jobId) return; const timer = window.setTimeout(() => void load(jobId, search, searchPage, itemPage).catch(() => undefined), 0); return () => window.clearTimeout(timer); }, [jobId, itemPage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(() => void load(jobId, search, searchPage, itemPage).catch(() => undefined), 260); return () => window.clearTimeout(timer); }, [search, searchPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS);
    let response: Response;
    let payload: { result?: unknown; error?: string } | null;
    try {
      response = await fetch("/api/market/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      try {
        payload = await response.json() as { result?: unknown; error?: string };
      } catch (reason) {
        if (controller.signal.aborted) throw reason;
        payload = null;
      }
    } catch (reason) {
      if (controller.signal.aborted) throw new Error("操作等待超时；服务端可能仍在处理，请先刷新工作台再决定是否重试");
      throw reason;
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok || !payload) throw new Error(payload?.error || "操作失败");
    return payload?.result as Record<string, unknown> | undefined;
  };
  const act = async (name: string, fn: () => Promise<void>) => { setBusy(name); setError(""); setNotice(""); try { await fn(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(""); } };
  const activePrompt = data?.prompts.find((item) => item.category === category && item.status === "active");
  const selectedPrompt = data?.prompts.find((item) => item.id === promptId && item.category === category) ?? activePrompt;
  const currentJob = data?.jobs.find((item) => item.id === jobId);
  const jobPrompt = data?.prompts.find((item) => item.id === currentJob?.promptVersionId);
  const segments = jobPrompt?.segments ?? selectedPrompt?.segments ?? segmentsText.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  const reviewableIds = new Set((data?.items ?? []).filter((item) => ["review_pending", "approved", "rejected"].includes(item.status)).map((item) => item.id));
  const selectedIds = Object.entries(drafts).filter(([id, draft]) => draft.selected && reviewableIds.has(id)).map(([id]) => id);
  const updateDraft = (id: string, patch: Partial<Draft>) => { dirtyDraftIdsRef.current.add(id); setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } })); };

  const choosePrompt = (item: Prompt) => { setPromptId(item.id); setCategory(item.category); setPromptBody(item.promptBody); setSegmentsText(item.segments.join("\n")); setChangeNote(""); };
  const chooseCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    const nextPrompt = data?.prompts.find((item) => item.category === nextCategory && item.status === "active") ?? data?.prompts.find((item) => item.category === nextCategory);
    if (nextPrompt) choosePrompt(nextPrompt); else { setPromptId(""); setPromptBody(""); setSegmentsText(defaultMarketSegmentsText(nextCategory)); }
  };
  const createJob = () => act("create-job", async () => {
    const result = await post({ action: "create_job", category, promptVersionId: activePrompt?.id, executor, modelId: executor === "cloud" ? visionModelId : undefined, localModelName: executor === "local" ? localModelName : undefined, limit });
    const id = String(result?.id || ""); dirtyDraftIdsRef.current.clear(); setItemPage(1); setJobId(id); setNotice("标注任务已创建"); await load(id, search, searchPage, 1);
  });
  const pumpCloud = () => act("run-cloud", async () => {
    stopRef.current = false;
    let waiting = false;
    for (let index = 0; index < 5_000 && !stopRef.current; index += 1) {
      const result = await post({ action: "run_next", jobId });
      if (result?.done) break;
      if (result?.waiting) { waiting = true; break; }
      if (index % 3 === 2) await load(jobId);
    }
    await load(jobId); setNotice(stopRef.current ? "已暂停，可稍后续跑" : waiting ? "已有识别 claim 执行中；lease 到期后可恢复" : "云端识别队列已处理完毕");
  });
  const saveReview = (ids = (data?.items ?? []).filter((item) => ["review_pending", "approved", "rejected"].includes(item.status)).map((item) => item.id)) => act("save-review", async () => {
    if (!ids.length) throw new Error("当前没有可保存的人工复核项");
    const updates = ids.map((id) => ({ id, version: drafts[id]!.version, segment: drafts[id]!.segment, imagePriceCents: drafts[id]!.price === "" ? null : Number(drafts[id]!.price), selected: drafts[id]!.selected }));
    await post({ action: "review", jobId, updates }); ids.forEach((id) => dirtyDraftIdsRef.current.delete(id)); await load(jobId, search, searchPage, itemPage); setNotice("人工复核已保存");
  });
  const commit = () => act("commit", async () => {
    if (!selectedIds.length) throw new Error("请先勾选需要入库的候选项");
    await post({ action: "review", jobId, updates: selectedIds.map((id) => ({ id, version: drafts[id]!.version, segment: drafts[id]!.segment, imagePriceCents: drafts[id]!.price === "" ? null : Number(drafts[id]!.price), selected: true })) });
    const result = await post({ action: "commit", jobId, candidateIds: selectedIds, idempotencyKey: "ui_" + jobId + "_" + Date.now().toString(36) });
    selectedIds.forEach((id) => dirtyDraftIdsRef.current.delete(id)); await load(jobId, search, searchPage, itemPage, true); setNotice("已入库 " + String(result?.committed ?? 0) + " 条，重复请求 " + String(result?.duplicates ?? 0) + " 条");
    if (result?.partial) throw new Error(`本批次部分成功：已入库 ${String(result.committed ?? 0)} 条；页面已刷新，可重新勾选剩余项续跑`);
  });
  const savePrompt = (mode: "manual" | "generate") => act("prompt", async () => {
    const body = { category, segments: segmentsText.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean), parentId: selectedPrompt?.id, changeNote };
    const result = mode === "manual" ? await post({ action: "create_prompt", ...body, promptBody }) : await post({ action: "generate_prompt", ...body, textModelId });
    await load(jobId); setPromptId(String(result?.id || "")); setNotice(mode === "manual" ? "人工 Prompt 子版本已创建" : "AI Prompt 候选已生成");
  });
  const testPrompt = (id = selectedPrompt?.id) => act("validation", async () => {
    if (!id) throw new Error("请选择 Prompt");
    const run = await post({ action: "create_validation", promptId: id, modelId: visionModelId, sampleCount, seed });
    await pumpValidation(String(run?.id || ""));
  });
  const evolve = () => act("evolve", async () => {
    if (!selectedPrompt) throw new Error("请选择需要进化的 Prompt");
    const result = await post({ action: "evolve_prompt", category, parentId: selectedPrompt.id, segments: selectedPrompt.segments, textModelId, visionModelId, sampleCount, seed, changeNote });
    const validation = result?.validation as Record<string, unknown> | undefined;
    await pumpValidation(String(validation?.id || "")); setNotice("AI 已生成子版本并完成冻结验证");
  });
  const pumpValidation = async (runId: string) => {
    if (!runId) throw new Error("验证运行 ID 为空");
    for (let index = 0; index < 1_100; index += 1) { const result = await post({ action: "run_validation_next", runId }); if (result?.done || result?.waiting) break; }
    await load(jobId);
  };
  const activate = (item: Prompt, rollback = false) => act("activate", async () => {
    const latestRun = data?.validationRuns.find((run) => run.candidatePromptId === item.id);
    const metricsGate = item.metrics?.gate as { passed?: boolean } | undefined;
    const gatePassed = Boolean((latestRun?.status === "completed" && latestRun.gate?.passed) || metricsGate?.passed);
    const message = rollback
      ? "请输入回滚原因（至少6字）"
      : gatePassed
        ? "该版本已通过门禁，可留空直接激活"
        : "该版本尚未通过冻结验证。管理员确认仍要启用时，必须保留至少6字的审计原因";
    const entered = window.prompt(message, rollback ? "回滚到已验证的稳定版本" : gatePassed ? "" : "管理员人工确认启用首个版本");
    if (entered === null) return;
    const reason = entered.trim();
    if ((!gatePassed || rollback) && reason.length < 6) throw new Error("该版本未通过门禁，必须填写至少 6 个字符的管理员确认原因");
    await post({ action: rollback ? "rollback_prompt" : "activate_prompt", promptId: item.id, explicitOverride: !rollback && !gatePassed, reason });
    await load(jobId); setNotice(rollback ? "Prompt 已回滚并重新激活" : "Prompt 已激活");
  });
  const deletePrompt = (item: Prompt) => act("delete-prompt", async () => {
    if (item.status !== "draft") throw new Error("只能删除尚未激活的草稿版本");
    if (!window.confirm(`确认删除 ${item.category} 的 v${item.version} 草稿？已被任务或验证引用的版本会由系统阻止删除。`)) return;
    await post({ action: "delete_prompt", promptId: item.id });
    if (selectedPrompt?.id === item.id) {
      const replacement = data?.prompts.find((prompt) => prompt.id !== item.id && prompt.category === item.category);
      if (replacement) choosePrompt(replacement);
      else { setPromptId(""); setPromptBody(""); setSegmentsText(defaultMarketSegmentsText(item.category)); }
    }
    await load(jobId); setNotice(`Prompt v${item.version} 草稿已删除`);
  });
  const createAgent = () => act("agent", async () => { const name = window.prompt("本地 agent 名称", "办公室 Ollama") || ""; const result = await post({ action: "create_agent", name }); setAgentToken(String(result?.token || "")); await load(jobId); });

  if (!data) return <section className="panel data-state">{initialLoading ? <><span className="state-spinner" /><strong>正在加载 SKU AI 标注工作台</strong></> : <><strong>SKU AI 标注工作台加载失败</strong><p>{error || "暂时无法读取数据，请稍后重试"}</p><button className="secondary-button" onClick={() => void loadInitial()}>重试</button></>}</section>;
  const currentRun = data.validationRuns[0];
  const currentResults = currentRun ? data.validationResults.filter((item) => item.runId === currentRun.id) : [];
  const reviewableItems = data.items.filter((item) => reviewableIds.has(item.id));
  const allChecked = reviewableItems.length > 0 && reviewableItems.every((item) => drafts[item.id]?.selected);
  const hasDirtyDrafts = data.items.some((item) => { const draft = drafts[item.id]; return Boolean(draft) && (draft.segment !== (item.reviewedSegment || item.aiSegment) || draft.price !== (item.reviewedImagePriceCents === null ? "" : String(item.reviewedImagePriceCents)) || draft.selected !== item.selected); });

  return <div className="market-annotation-module">
    {(error || notice) && <div className={"market-feedback " + (error ? "error" : "success")}>{error || notice}</div>}
    <section className="panel annotation-hero"><div><span className="eyebrow">HUMAN-IN-THE-LOOP VISION</span><h2>市场 SKU 细分品类 AI 标注</h2><p>云端视觉为默认执行器；京东 imgzone 大图优先、n5 兼容回退。AI 候选必须人工复核后才能批量入库。</p></div><div className="annotation-progress"><strong>{currentJob ? currentJob.completedCount + "/" + currentJob.totalCount : "尚未创建"}</strong><span>{currentJob?.status || "等待任务"}</span></div></section>

    <section className="panel annotation-task-card"><div className="section-header"><div><h3>1. 创建与执行任务</h3><p>每条云端请求只处理一个 SKU，D1 保存进度，关页后可继续。</p></div></div><div className="annotation-form-row">
      <label><span>三级类目</span><select value={category} onChange={(event) => chooseCategory(event.target.value)}>{data.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{item.count}）</option>)}</select></label>
      <label><span>执行器</span><select value={executor} onChange={(event) => setExecutor(event.target.value as "cloud" | "local")}><option value="cloud">云端视觉（默认）</option><option value="local">本地 Ollama（可选容灾）</option></select></label>
      {executor === "cloud" ? <label><span>enabled vision 模型</span><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)}>{data.models.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.modelName}</option>)}</select></label> : <label><span>Ollama 模型名</span><input value={localModelName} onChange={(event) => setLocalModelName(event.target.value)} /></label>}
      <label><span>任务上限</span><input type="number" min={1} max={5000} value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label>
      <button className="primary-button" disabled={!canEdit || !activePrompt || busy !== "" || (executor === "cloud" && !visionModelId)} onClick={createJob}>创建任务</button>
    </div><small>当前激活 Prompt：{activePrompt ? "v" + activePrompt.version + " · " + activePrompt.id : "该类目尚无激活版本"}</small>
    <div className="annotation-job-list">{data.jobs.map((item) => <button className={jobId === item.id ? "active" : ""} key={item.id} onClick={() => { dirtyDraftIdsRef.current.clear(); setItemPage(1); setJobId(item.id); void load(item.id, search, searchPage, 1); }}><strong>{item.category}</strong><span>{item.executor} · {item.status}</span><small>{item.completedCount}/{item.totalCount} · 失败 {item.failedCount} · 入库 {item.committedCount}</small></button>)}</div>
    {currentJob?.executor === "cloud" && <div className="annotation-actions"><button className="primary-button" disabled={!canEdit || busy !== ""} onClick={pumpCloud}>{busy === "run-cloud" ? "云端识别中…" : "继续云端识别"}</button><button className="secondary-button" onClick={() => { stopRef.current = true; }}>完成当前条后暂停</button></div>}
    </section>

    <section className="panel annotation-review-card"><div className="section-header"><div><h3>2. 人工复核与批量入库</h3><p>细分品类和主图识别价均可编辑；价格单位为“分”，不会覆盖榜单参考价。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!canEdit || busy !== ""} onClick={() => void saveReview()}>保存复核</button><button className="primary-button" disabled={!isAdmin || !selectedIds.length || busy !== ""} onClick={commit}>批准并入库（{selectedIds.length}）</button></div></div>
      <footer className="annotation-pagination"><span>任务共 {data.itemPagination.total} 条</span><button disabled={itemPage <= 1 || hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onClick={() => { const page = itemPage - 1; setItemPage(page); void load(jobId, search, searchPage, page); }}>上一页</button><strong>{itemPage}/{data.itemPagination.pageCount}</strong><button disabled={itemPage >= data.itemPagination.pageCount || hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onClick={() => { const page = itemPage + 1; setItemPage(page); void load(jobId, search, searchPage, page); }}>下一页</button></footer>
      <div className="data-table-wrap"><table className="data-table annotation-review-table"><thead><tr><th><input type="checkbox" checked={allChecked} disabled={!canEdit || !reviewableItems.length} onChange={(event) => setDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, reviewableIds.has(id) ? { ...draft, selected: event.target.checked } : draft])))} /></th><th>大图 / 实际来源</th><th>SKU / 商品</th><th>AI 结果</th><th>人工细分品类</th><th>主图价格（分）</th><th>置信度 / 状态</th></tr></thead><tbody>{data.items.map((item) => { const draft = drafts[item.id]; const reviewable = reviewableIds.has(item.id); return <tr key={item.id}><td><input type="checkbox" checked={reviewable && (draft?.selected ?? false)} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { selected: event.target.checked })} /></td><td>{(item.resolvedImageUrl || item.sourceImageUrl) ? <img className="annotation-image" src={item.resolvedImageUrl || item.sourceImageUrl} alt="" loading="lazy" /> : <span className="annotation-no-image">无图</span>}<small className={item.imageSource === "imgzone" ? "green-text" : "orange-text"}>{item.imageSource === "imgzone" ? "imgzone 大图" : item.imageSource === "n5" ? "n5 回退" : "未取到安全图片"}</small></td><td><strong>{item.skuCode}</strong><small title={item.productName}>{item.productName}</small><code>{item.candidateId}</code></td><td><strong>{item.aiSegment || "—"}</strong><small>{item.aiReason || item.errorMessage || "等待识别"}</small></td><td><select value={draft?.segment ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { segment: event.target.value })}><option value="">请选择</option>{segments.map((value) => <option key={value}>{value}</option>)}</select></td><td><input type="number" min={0} value={draft?.price ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { price: event.target.value })} /><small>AI：{money(item.aiImagePriceCents)}</small></td><td><strong>{item.aiConfidenceBps === null ? "—" : (item.aiConfidenceBps / 100).toFixed(1) + "%"}</strong><small>{item.status} · v{item.version}</small></td></tr>; })}{!data.items.length && <tr><td colSpan={7}><div className="table-state">选择或创建任务后显示候选项。</div></td></tr>}</tbody></table></div>
    </section>

    <section className="annotation-two-column"><article className="panel annotation-prompt-card"><div className="section-header"><div><h3>3. Prompt 版本与自动进化</h3><p>正文与枚举始终明文可见；编辑只创建不可变子版本。未使用的草稿可以删除，激活及归档版本永久保留。</p></div></div>{error && <div className="market-feedback error">{error}</div>}
      <div className="annotation-prompt-history">{data.prompts.filter((item) => !category || item.category === category).map((item) => <div key={item.id} className="annotation-prompt-version"><button className={`annotation-prompt-select ${selectedPrompt?.id === item.id ? "active" : ""}`} onClick={() => choosePrompt(item)}><strong>v{item.version} · {item.status}</strong><span>{item.source}</span><small>{item.id}</small></button>{isAdmin && item.status === "draft" && <button className="annotation-prompt-delete" disabled={busy !== ""} title={`删除 v${item.version} 草稿`} onClick={() => void deletePrompt(item)}>删除</button>}</div>)}</div>
      <label><span>细分品类枚举（每行一个）</span><textarea value={segmentsText} onChange={(event) => setSegmentsText(event.target.value)} /></label><label><span>Prompt 正文</span><textarea className="annotation-prompt-body" value={promptBody} onChange={(event) => setPromptBody(event.target.value)} placeholder="写明视觉分类规则、价格识别口径和严格 JSON 输出" /></label><label><span>版本说明</span><input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} /></label>
      <div className="annotation-form-row"><label><span>AI 文本模型</span><select value={textModelId} onChange={(event) => setTextModelId(event.target.value)}>{data.textModels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>抽样数</span><input type="number" min={1} max={500} value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))} /></label><label><span>固定 seed</span><input value={seed} onChange={(event) => setSeed(event.target.value)} /></label></div>
      <div className="annotation-actions"><button className="secondary-button" disabled={!canEdit || busy !== ""} onClick={() => void savePrompt("manual")}>保存人工子版本</button><button className="secondary-button" disabled={!canEdit || !textModelId || busy !== ""} onClick={() => void savePrompt("generate")}>AI 生成</button><button className="secondary-button" disabled={!canEdit || !selectedPrompt || !textModelId || !visionModelId || busy !== ""} onClick={evolve}>AI 进化并测试</button><button className="secondary-button" disabled={!canEdit || !selectedPrompt || !visionModelId || busy !== ""} onClick={() => void testPrompt()}>冻结抽样测试</button>{selectedPrompt?.status === "active" ? <button className="primary-button" disabled>当前激活版本</button> : selectedPrompt && <button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void activate(selectedPrompt, selectedPrompt.status === "archived")}>{selectedPrompt.status === "archived" ? "回滚到此版" : "激活此版"}</button>}</div>
    </article>
    <article className="panel annotation-validation-card"><div className="section-header"><div><h3>冻结抽样验证</h3><p>默认 50 条，按品类分层并以 seed+hash 冻结；逐条错例永久保留。</p></div></div>{currentRun ? <><div className="annotation-validation-summary"><strong>{currentRun.status}</strong><span>{currentRun.sampleCount} 条 · hash {currentRun.sampleHash?.slice(0, 12)}</span><em className={currentRun.gate?.passed ? "green-text" : "orange-text"}>{currentRun.gate?.passed ? "门禁通过" : (currentRun.gate?.reasons || []).join("；") || "待完成"}</em></div><div className="annotation-validation-errors">{currentResults.filter((item) => !item.isCorrect || item.errorMessage).slice(0, 80).map((item) => <div key={item.id}><strong>{item.skuCode} · {item.goldSegment} → {item.predictedSegment || "失败"}</strong><small>{item.productName}</small><span>{item.errorMessage}</span></div>)}</div></> : <p className="soft-text">尚无冻结验证运行。</p>}</article>
    </section>

    <section className="panel annotation-catalog-card"><div className="section-header"><div><h3>4. 完整市场 SKU 库检索</h3><p>服务端检索完整库，不受榜单页面 200 条展示上限影响；优先展示已缓存商品图。</p></div><div className="annotation-actions">{isAdmin && <button className="secondary-button" disabled={!goldIds.length} onClick={() => void act("gold", async () => { await post({ action: "mark_gold", annotationIds: goldIds }); setGoldIds([]); await load(jobId); setNotice("已加入冻结验证金标集"); })}>设为金标（{goldIds.length}）</button>}</div></div><input className="annotation-search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchPage(1); }} placeholder="搜索 SKU、商品名、品牌、三级类目、最终细分品类" /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>金标</th><th>图片</th><th>SKU / 商品</th><th>品牌</th><th>三级类目</th><th>最终细分品类</th><th>价格</th><th>复核状态</th></tr></thead><tbody>{data.catalog.items.map((item) => <tr key={item.category + item.skuCode}><td><input type="checkbox" disabled={!item.annotationId || !isAdmin} checked={Boolean(item.annotationId && goldIds.includes(item.annotationId))} onChange={() => item.annotationId && setGoldIds((current) => current.includes(item.annotationId!) ? current.filter((id) => id !== item.annotationId) : [...current, item.annotationId!])} /></td><td>{item.imageUrl ? <img className="annotation-catalog-image" src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /> : <span className="annotation-no-image">无图</span>}<small>{item.imageCacheStatus === "ready" ? "已缓存" : "源图"}</small></td><td><strong>{item.skuCode}</strong><small>{item.productName}</small></td><td>{item.brand || "—"}</td><td>{item.category}</td><td><strong>{item.finalSegment || "—"}</strong></td><td><small>榜单 {money(item.rankingPriceCents)}</small><small>主图 {money(item.finalImagePriceCents)}</small></td><td>{item.reviewStatus}</td></tr>)}</tbody></table></div><footer className="annotation-pagination"><span>共 {data.catalog.total} 条</span><button disabled={searchPage <= 1} onClick={() => setSearchPage((page) => page - 1)}>上一页</button><strong>{searchPage}/{data.catalog.pageCount}</strong><button disabled={searchPage >= data.catalog.pageCount} onClick={() => setSearchPage((page) => page + 1)}>下一页</button></footer></section>

    <section className="panel annotation-agent-card"><div className="section-header"><div><h3>5. 本地 Ollama agent（可选容灾）</h3><p>Cloudflare 不回连 localhost；本机 runner 使用一次性 token 主动领取带 lease 的任务。</p></div>{isAdmin && <button className="secondary-button" onClick={createAgent}>创建 agent</button>}</div>{agentToken && <div className="annotation-token"><strong>仅显示一次</strong><code>{agentToken}</code></div>}<pre>TERUISI_SITE_URL=https://你的站点{`\n`}TERUISI_ANNOTATION_AGENT_TOKEN=创建时的一次性token{`\n`}OLLAMA_BASE_URL=http://127.0.0.1:11434{`\n`}npm run market:annotation-agent</pre><div className="annotation-agent-list">{data.agents.map((agent) => <div key={agent.id}><strong>{agent.name}</strong><span>{agent.status} · 最近心跳 {agent.lastSeenAt || "从未"}</span>{isAdmin && agent.status === "enabled" && <button className="row-action danger" onClick={() => void act("revoke", async () => { await post({ action: "revoke_agent", agentId: agent.id }); await load(jobId); })}>撤销</button>}</div>)}</div></section>
  </div>;
}
