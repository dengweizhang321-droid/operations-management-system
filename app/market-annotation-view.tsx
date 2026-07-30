"use client";
/* eslint-disable @next/next/no-img-element -- JD competitor images are external audited sources. */

import { useCallback, useEffect, useRef, useState } from "react";
import { MARKET_ANNOTATION_JOB_LIMITS } from "@/lib/market/annotation-limits";

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type Model = { id: string; name: string; protocol: string; modelName: string };
type Prompt = { id: string; category: string; version: number; parentId: string | null; source: string; status: string; segments: string[]; promptBody: string; changeNote: string; metrics: Record<string, unknown>; createdAt: string };
type Job = { id: string; category: string; promptVersionId: string; executor: string; modelId: string | null; localModelName: string; status: string; totalCount: number; completedCount: number; failedCount: number; reviewedCount: number; committedCount: number; createdAt: string };
type Item = { id: string; candidateId: string; jobId: string; category: string; skuCode: string; productName: string; brand: string; sourceImageUrl: string; resolvedImageUrl: string; imageSource: string; status: string; aiSegment: string; aiImagePriceCents: number | null; aiConfidenceBps: number | null; aiReason: string; reviewedSegment: string; reviewedImagePriceCents: number | null; reviewPriceSource: "history_same_image" | "ai" | "manual"; selected: boolean; version: number; errorMessage: string; createdAt: string };
type CatalogItem = { skuCode: string; productName: string; brand: string; category: string; imageUrl: string; imageCacheStatus: string; rankingPriceCents: number | null; annotationId?: string; finalSegment?: string; finalImagePriceCents?: number | null; reviewStatus: string };
type ValidationRun = { id: string; category: string; candidatePromptId: string; baselinePromptId?: string; status: string; sampleCount: number; sampleHash: string; metrics: Record<string, unknown>; gate: { passed?: boolean; reasons?: string[] } };
type ValidationResult = { id: string; runId: string; status: string; skuCode: string; productName: string; goldSegment: string; predictedSegment: string; isCorrect: number; errorMessage: string };
type Workspace = { categories: Array<{ value: string; count: number }>; reviewCategories: Array<{ value: string; jobCount: number; recordCount: number }>; taxonomy: Array<{ category: string; value: string }>; prompts: Prompt[]; jobs: Job[]; items: Item[]; itemPagination: { page: number; pageSize: number; pageCount: number; total: number }; reviewSummary: { jobCount: number; recordCount: number; uniqueCandidateCount: number }; selection: { filteredReviewableCount: number; filteredSelectedCount: number; scopeSelectedCount: number }; models: Model[]; textModels: Model[]; catalog: { items: CatalogItem[]; page: number; pageSize: number; pageCount: number; total: number; query: string }; validationRuns: ValidationRun[]; validationResults: ValidationResult[]; agents: Array<{ id: string; name: string; status: string; lastSeenAt?: string; revokedAt?: string }>; error?: string };
type ReviewWorkspace = Pick<Workspace, "items" | "itemPagination" | "reviewSummary" | "selection"> & { error?: string };
type CatalogWorkspace = Pick<Workspace, "catalog"> & { error?: string };
type Draft = { segment: string; price: string; selected: boolean; version: number };

const LOAD_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 120_000;
const CLOUD_CONCURRENCY = 2;
const CLOUD_PROGRESS_REFRESH_EVERY = 12;
const CLOUD_PROGRESS_REFRESH_MS = 30_000;
const money = (cents: number | null | undefined) => cents === null || cents === undefined ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
const yuanInput = (cents: number | null | undefined) => cents === null || cents === undefined ? "" : String(cents / 100);
const centsInput = (yuan: string) => yuan.trim() === "" ? null : Math.round(Number(yuan) * 100);
const annotationProductHref = (skuCode: unknown) => {
  const sku = String(skuCode ?? "").trim();
  return /^\d{6,20}$/.test(sku) ? `https://item.jd.com/${sku}.html` : "";
};
const annotationRecognitionLabel = (item: Pick<Item, "status" | "aiSegment" | "aiImagePriceCents" | "aiConfidenceBps" | "aiReason" | "reviewPriceSource">) => {
  if (item.reviewPriceSource === "history_same_image") return "历史同图价格待审";
  const recognized = Boolean(item.aiSegment || item.aiImagePriceCents !== null || item.aiConfidenceBps !== null || item.aiReason);
  if (recognized) return "AI 已识别";
  return item.status === "failed" ? "AI 识别失败" : "未生成 AI 结果";
};
const annotationResultMessage = (item: Pick<Item, "aiReason" | "errorMessage" | "status" | "reviewPriceSource">) => {
  if (item.reviewPriceSource === "history_same_image") return "主图与历史已确认图片一致，默认沿用上次标准售价，请人工复核后入库";
  if (item.aiReason) return item.aiReason;
  if (/状态码\s*429/.test(item.errorMessage)) return `${item.errorMessage}：模型供应商限流或额度不足，请稍后重试并检查额度`;
  if (/状态码\s*400/.test(item.errorMessage)) return `${item.errorMessage}：请求被接口拒绝，请先在 AI 助理中重新执行图片能力测试，并核对模型标识及结构化输出兼容性`;
  if (item.errorMessage) return item.errorMessage;
  return item.status === "inferencing" ? "识别处理中" : "等待识别";
};
const annotationReviewScopeKey = (input: { page: number; pageSize: number; categories: string[]; segment: string; storageStatus: string; recognitionSource: string }) => JSON.stringify(input);
export default function MarketAnnotationView({ currentUser, embedded = false }: { currentUser: CurrentUser; embedded?: boolean }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [jobId, setJobId] = useState("");
  const [category, setCategory] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [executor, setExecutor] = useState<"cloud" | "local">("cloud");
  const [visionModelId, setVisionModelId] = useState("");
  const [textModelId, setTextModelId] = useState("");
  const [localModelName, setLocalModelName] = useState("gemma4");
  const [limit, setLimit] = useState(MARKET_ANNOTATION_JOB_LIMITS.default);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [promptId, setPromptId] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [segmentsText, setSegmentsText] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [search, setSearch] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [catalogRequested, setCatalogRequested] = useState(false);
  const [loadedReviewScopeKey, setLoadedReviewScopeKey] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [itemPageSize, setItemPageSize] = useState(20);
  const [reviewCategories, setReviewCategories] = useState<string[]>([]);
  const [itemSegment, setItemSegment] = useState("");
  const [storageStatus, setStorageStatus] = useState<"" | "pending" | "committed">("");
  const [recognitionSource, setRecognitionSource] = useState<"" | "ai" | "non_ai">("");
  const [reviewView, setReviewView] = useState<"list" | "gallery">("list");
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
  const reviewLoadSequenceRef = useRef(0);
  const catalogLoadSequenceRef = useRef(0);
  const initialReadyRef = useRef(false);
  const catalogSectionRef = useRef<HTMLElement | null>(null);
  const isAdmin = currentUser?.role === "admin";
  const canEdit = currentUser?.role === "admin" || currentUser?.role === "operator";

  const load = useCallback(async (nextJobId = jobId, q = search, page = searchPage, nextItemPage = itemPage, resetDrafts = false) => {
    const loadSequence = ++loadSequenceRef.current;
    const params = new URLSearchParams({ q, page: String(page), pageSize: "30", itemPage: String(nextItemPage), itemPageSize: String(itemPageSize), aggregateJobs: "1", includeCatalog: "0" });
    if (nextJobId) params.set("jobId", nextJobId);
    reviewCategories.forEach((value) => params.append("itemCategory", value));
    if (itemSegment) params.set("itemSegment", itemSegment);
    if (storageStatus) params.set("storageStatus", storageStatus);
    if (recognitionSource) params.set("recognitionSource", recognitionSource);
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
    setLoadedReviewScopeKey(annotationReviewScopeKey({ page: nextItemPage, pageSize: itemPageSize, categories: reviewCategories, segment: itemSegment, storageStatus, recognitionSource }));
    setData((current) => ({ ...payload, catalog: current?.catalog ?? payload.catalog }));
    const resolvedJobId = nextJobId || payload.jobs[0]?.id || "";
    setJobId(resolvedJobId);
    if (!nextJobId && resolvedJobId) setItemPage(1);
    const resolvedCategory = category;
    setVisionModelId((current) => current || payload.models[0]?.id || "");
    setTextModelId((current) => current || payload.textModels[0]?.id || "");
    if (!promptId) {
      const initialPrompt = payload.prompts.find((item) => item.category === resolvedCategory && item.status === "active") ?? payload.prompts.find((item) => item.category === resolvedCategory);
      const taxonomyText = payload.taxonomy.filter((item) => item.category === resolvedCategory).map((item) => item.value).join("\n");
      if (initialPrompt) { setPromptId(initialPrompt.id); setPromptBody(initialPrompt.promptBody); setSegmentsText(taxonomyText || initialPrompt.segments.join("\n")); }
      else if (resolvedCategory) setSegmentsText(taxonomyText);
    }
    setDrafts((current) => Object.fromEntries(payload.items.map((item) => {
      const serverDraft = { segment: item.reviewedSegment || item.aiSegment, price: yuanInput(item.reviewedImagePriceCents), selected: item.selected, version: item.version };
      const existing = current[item.id];
      const preserve = !resetDrafts && Boolean(existing) && dirtyDraftIdsRef.current.has(item.id) && existing.version === serverDraft.version;
      if (!preserve) dirtyDraftIdsRef.current.delete(item.id);
      return [item.id, preserve ? existing : serverDraft];
    })));
  }, [jobId, search, searchPage, itemPage, itemPageSize, category, reviewCategories, promptId, itemSegment, storageStatus, recognitionSource]);

  const loadReview = useCallback(async (resetDrafts = false) => {
    const loadSequence = ++reviewLoadSequenceRef.current;
    const params = new URLSearchParams({ view: "review", itemPage: String(itemPage), itemPageSize: String(itemPageSize), aggregateJobs: "1" });
    reviewCategories.forEach((value) => params.append("itemCategory", value));
    if (itemSegment) params.set("itemSegment", itemSegment);
    if (storageStatus) params.set("storageStatus", storageStatus);
    if (recognitionSource) params.set("recognitionSource", recognitionSource);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    let response: Response;
    let payload: ReviewWorkspace | null;
    try {
      response = await fetch("/api/market/annotations?" + params, { cache: "no-store", signal: controller.signal });
      payload = await response.json().catch(() => null) as ReviewWorkspace | null;
    } catch (reason) {
      if (loadSequence !== reviewLoadSequenceRef.current) return;
      if (controller.signal.aborted) throw new Error("读取人工复核列表超时，请重试");
      throw reason;
    } finally {
      window.clearTimeout(timeout);
    }
    if (loadSequence !== reviewLoadSequenceRef.current) return;
    if (!response.ok || !payload) throw new Error(payload?.error || "读取人工复核列表失败");
    setLoadedReviewScopeKey(annotationReviewScopeKey({ page: itemPage, pageSize: itemPageSize, categories: reviewCategories, segment: itemSegment, storageStatus, recognitionSource }));
    setData((current) => current ? { ...current, ...payload } : current);
    setDrafts((current) => Object.fromEntries(payload.items.map((item) => {
      const serverDraft = { segment: item.reviewedSegment || item.aiSegment, price: yuanInput(item.reviewedImagePriceCents), selected: item.selected, version: item.version };
      const existing = current[item.id];
      const preserve = !resetDrafts && Boolean(existing) && dirtyDraftIdsRef.current.has(item.id) && existing.version === serverDraft.version;
      if (!preserve) dirtyDraftIdsRef.current.delete(item.id);
      return [item.id, preserve ? existing : serverDraft];
    })));
  }, [itemPage, itemPageSize, reviewCategories, itemSegment, storageStatus, recognitionSource]);

  const loadCatalog = useCallback(async () => {
    const loadSequence = ++catalogLoadSequenceRef.current;
    const params = new URLSearchParams({ view: "catalog", q: search, page: String(searchPage), pageSize: "30" });
    const response = await fetch("/api/market/annotations?" + params, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as CatalogWorkspace | null;
    if (loadSequence !== catalogLoadSequenceRef.current) return;
    if (!response.ok || !payload) throw new Error(payload?.error || "读取完整 SKU 库失败");
    setData((current) => current ? { ...current, catalog: payload.catalog } : current);
  }, [search, searchPage]);

  const loadInitial = useCallback(async () => {
    setInitialLoading(true);
    setError("");
    try {
      await load();
      initialReadyRef.current = true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setInitialLoading(false);
    }
  }, [load]);

  useEffect(() => { const timer = window.setTimeout(() => void loadInitial(), 0); return () => window.clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!initialReadyRef.current) return; const timer = window.setTimeout(() => void loadReview().catch((reason) => setError(reason instanceof Error ? reason.message : "读取人工复核列表失败")), 0); return () => window.clearTimeout(timer); }, [loadReview]);
  useEffect(() => {
    const section = catalogSectionRef.current;
    if (!section || catalogRequested) return;
    if (!("IntersectionObserver" in window)) { setCatalogRequested(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setCatalogRequested(true);
    }, { rootMargin: "240px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, [catalogRequested, data]);
  useEffect(() => { if (!initialReadyRef.current || !catalogRequested) return; const timer = window.setTimeout(() => void loadCatalog().catch((reason) => setError(reason instanceof Error ? reason.message : "读取完整 SKU 库失败")), 260); return () => window.clearTimeout(timer); }, [catalogRequested, loadCatalog]);

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
  const reviewableIds = new Set((data?.items ?? []).filter((item) => ["review_pending", "approved", "rejected"].includes(item.status)).map((item) => item.id));
  const activeReviewScopeKey = annotationReviewScopeKey({ page: itemPage, pageSize: itemPageSize, categories: reviewCategories, segment: itemSegment, storageStatus, recognitionSource });
  const reviewScopeReady = loadedReviewScopeKey === activeReviewScopeKey;
  const importableIds = new Set((data?.items ?? []).filter((item) => {
    if (!reviewableIds.has(item.id)) return false;
    const job = data?.jobs.find((candidate) => candidate.id === item.jobId);
    const prompt = data?.prompts.find((candidate) => candidate.id === job?.promptVersionId);
    return job?.status === "review_ready" && Boolean(prompt?.segments.includes(drafts[item.id]?.segment ?? ""));
  }).map((item) => item.id));
  const updateDraft = (id: string, patch: Partial<Draft>) => { dirtyDraftIdsRef.current.add(id); setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } })); };

  const choosePrompt = (item: Prompt) => { setPromptId(item.id); setCategory(item.category); setPromptBody(item.promptBody); setSegmentsText((data?.taxonomy ?? []).filter((entry) => entry.category === item.category).map((entry) => entry.value).join("\n") || item.segments.join("\n")); setChangeNote(""); };
  const chooseCategory = (nextCategory: string) => {
    setCategoryQuery("");
    setCategory(nextCategory);
    const nextJob = data?.jobs.find((item) => !nextCategory || item.category === nextCategory);
    if (nextJob) setJobId(nextJob.id);
    const nextPrompt = data?.prompts.find((item) => item.category === nextCategory && item.status === "active") ?? data?.prompts.find((item) => item.category === nextCategory);
    if (nextPrompt) choosePrompt(nextPrompt); else { setPromptId(""); setPromptBody(""); setSegmentsText((data?.taxonomy ?? []).filter((item) => item.category === nextCategory).map((item) => item.value).join("\n")); }
  };
  const createJob = () => act("create-job", async () => {
    const result = await post({ action: "create_job", category, promptVersionId: activePrompt?.id, executor, modelId: executor === "cloud" ? visionModelId : undefined, localModelName: executor === "local" ? localModelName : undefined, limit });
    const id = String(result?.id || ""); dirtyDraftIdsRef.current.clear(); setItemPage(1); setJobId(id); setNotice("标注任务已创建"); await load(id, search, searchPage, 1);
  });
  const pumpCloud = () => act("run-cloud", async () => {
    stopRef.current = false;
    let waiting = false;
    let done = false;
    let rateLimitStopped = false;
    let workerLimit = CLOUD_CONCURRENCY;
    let blockedUntil = 0;
    let rateLimitHits = 0;
    let processedCount = 0;
    let reusedCount = 0;
    let failedCount = 0;
    let lastRefreshAt = Date.now();
    let lastRefreshCount = 0;
    let refreshing = false;
    let fatalError: unknown = null;
    const waitForWindow = async () => {
      while (!stopRef.current && Date.now() < blockedUntil) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(1_000, blockedUntil - Date.now())));
      }
    };
    const refreshProgress = async (force = false) => {
      const shouldRefresh = force || processedCount - lastRefreshCount >= CLOUD_PROGRESS_REFRESH_EVERY || Date.now() - lastRefreshAt >= CLOUD_PROGRESS_REFRESH_MS;
      if (!shouldRefresh || refreshing) return;
      refreshing = true;
      try {
        await load(jobId);
        lastRefreshAt = Date.now();
        lastRefreshCount = processedCount;
      } finally {
        refreshing = false;
      }
    };
    const worker = async (workerIndex: number) => {
      for (let index = 0; index < MARKET_ANNOTATION_JOB_LIMITS.maximum && !stopRef.current && !done && !rateLimitStopped; index += 1) {
        if (workerIndex >= workerLimit) break;
        await waitForWindow();
        if (stopRef.current || done || rateLimitStopped || workerIndex >= workerLimit) break;
        let result: Record<string, unknown> | undefined;
        try {
          result = await post({ action: "run_next", jobId });
        } catch (reason) {
          fatalError = reason;
          stopRef.current = true;
          break;
        }
        if (result?.done) { done = true; break; }
        if (result?.waiting) { waiting = true; break; }
        if (result?.raced) continue;
        const reused = Math.max(0, Number(result?.reusedCount ?? 0));
        if (reused) { reusedCount += reused; processedCount += reused; }
        else if (result?.itemId) processedCount += 1;
        const failureKind = String(result?.failureKind ?? "");
        if (failureKind) failedCount += 1;
        if (failureKind === "rate_limit") {
          rateLimitHits += 1;
          if (rateLimitHits === 1) {
            workerLimit = 1;
            blockedUntil = Date.now() + Math.max(60_000, Number(result?.retryAfterMs ?? 0));
            setNotice("模型供应商出现 429 限流：已自动从双通道降为单通道，并冷却 60 秒后续跑。");
          } else {
            rateLimitStopped = true;
            break;
          }
        } else if (failureKind === "transient") {
          blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(5_000, Number(result?.retryAfterMs ?? 0)));
        }
        if (workerIndex === 0) await refreshProgress();
      }
    };
    await Promise.all(Array.from({ length: CLOUD_CONCURRENCY }, (_, index) => worker(index)));
    await refreshProgress(true);
    if (fatalError) throw fatalError;
    const summary = `本轮处理 ${processedCount} 条（复用同图同模型结果 ${reusedCount} 条，识别失败 ${failedCount} 条）`;
    setNotice(rateLimitStopped
      ? `${summary}；供应商连续 429，系统已自动暂停，避免继续消耗失败次数。请稍后点击“继续云端识别”。`
      : stopRef.current ? `${summary}；已暂停，可稍后续跑`
        : done ? `${summary}；云端识别队列已处理完毕`
          : waiting ? `${summary}；已有识别 claim 执行中，lease 到期后可恢复`
            : `${summary}；本轮双通道已结束`);
  });
  const saveReviewGroups = async (ids: string[]) => {
    const groups = new Map<string, Array<{ id: string; version: number; segment: string; imagePriceCents: number | null; selected: boolean }>>();
    for (const id of ids) {
      const item = data?.items.find((candidate) => candidate.id === id);
      const draft = drafts[id];
      if (!item || !draft) continue;
      const updates = groups.get(item.jobId) ?? [];
      updates.push({ id, version: draft.version, segment: draft.segment, imagePriceCents: centsInput(draft.price), selected: draft.selected });
      groups.set(item.jobId, updates);
    }
    for (const [reviewJobId, updates] of groups) await post({ action: "review", jobId: reviewJobId, updates });
  };
  const saveReview = (ids?: string[]) => act("save-review", async () => {
    if (!reviewScopeReady) throw new Error("三级品类筛选仍在刷新，请等待列表更新后再保存");
    const targetIds = ids ?? (data?.items ?? []).filter((item) => reviewableIds.has(item.id) && dirtyDraftIdsRef.current.has(item.id)).map((item) => item.id);
    if (!targetIds.length) throw new Error("当前页没有待保存的人工复核修改");
    await saveReviewGroups(targetIds); targetIds.forEach((id) => dirtyDraftIdsRef.current.delete(id)); await loadReview(); setNotice("人工复核已按任务分组保存");
  });
  const setFilteredSelection = (selected: boolean) => act("select-filtered", async () => {
    if (!reviewScopeReady) throw new Error("三级品类筛选仍在刷新，请等待列表更新后再全选");
    const result = await post({ action: "select_filtered", aggregateJobs: true, categories: reviewCategories, selected, itemSegment: itemSegment || undefined, storageStatus: storageStatus || undefined, recognitionSource: recognitionSource || undefined });
    dirtyDraftIdsRef.current.clear(); await loadReview(true);
    setNotice(selected ? `已跨页全选当前筛选结果 ${String(result?.changed ?? 0)} 条` : `已清空当前筛选结果 ${String(result?.changed ?? 0)} 条选择`);
  });
  const commit = () => act("commit", async () => {
    if (!reviewScopeReady) throw new Error("三级品类筛选仍在刷新，请等待列表更新后再入库");
    const selectedPageIds = (data?.items ?? []).filter((item) => importableIds.has(item.id) && dirtyDraftIdsRef.current.has(item.id)).map((item) => item.id);
    if (!selectedCount) throw new Error("请先勾选需要入库的候选项");
    if (selectedPageIds.length) await saveReviewGroups(selectedPageIds);
    const operationId = "ui_aggregate_" + Date.now().toString(36);
    let committed = 0;
    let duplicates = 0;
    for (let batch = 1; batch <= 20; batch += 1) {
      setNotice(`正在分批入库：已完成 ${committed} 条，本批最多处理 500 条`);
      const result = await post({ action: "commit_selected", aggregateJobs: true, categories: reviewCategories, idempotencyKey: `${operationId}_${batch}` });
      committed += Number(result?.committed ?? 0);
      duplicates += Number(result?.duplicates ?? 0);
      if (result?.ok === false || result?.partial) {
        await loadReview(true);
        throw new Error(String(result?.error || `部分成功：已入库 ${committed} 条；页面已刷新，可重新点击续跑`));
      }
      if (!result?.hasMore) break;
      if (batch === 20) throw new Error(`已连续处理 ${committed} 条，但仍有剩余选择；请再次点击批量入库继续`);
    }
    selectedPageIds.forEach((id) => dirtyDraftIdsRef.current.delete(id)); await loadReview(true); setNotice(`已分批入库 ${committed} 条，重复请求 ${duplicates} 条`);
  });
  const savePrompt = (mode: "manual" | "generate") => act("prompt", async () => {
    if (!category) throw new Error("“全部三级类目”仅用于浏览和筛选；保存 Prompt 前请选择一个具体类目");
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
    const result = await post({ action: "evolve_prompt", category, parentId: selectedPrompt.id, segments: segmentsText.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean), textModelId, visionModelId, sampleCount, seed, changeNote });
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
      else { setPromptId(""); setPromptBody(""); setSegmentsText((data?.taxonomy ?? []).filter((entry) => entry.category === item.category).map((entry) => entry.value).join("\n")); }
    }
    await load(jobId); setNotice(`Prompt v${item.version} 草稿已删除`);
  });
  const createAgent = () => act("agent", async () => { const name = window.prompt("本地 agent 名称", "办公室 Ollama") || ""; const result = await post({ action: "create_agent", name }); setAgentToken(String(result?.token || "")); await load(jobId); });

  if (!data) return <section className="panel data-state">{initialLoading ? <><span className="state-spinner" /><strong>正在加载 SKU AI 标注工作台</strong></> : <><strong>SKU AI 标注工作台加载失败</strong><p>{error || "暂时无法读取数据，请稍后重试"}</p><button className="secondary-button" onClick={() => void loadInitial()}>重试</button></>}</section>;
  const currentRun = data.validationRuns.find((run) => !category || run.category === category);
  const normalizedCategoryQuery = categoryQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredCategories = data.categories.filter((item) => !normalizedCategoryQuery || item.value.toLocaleLowerCase("zh-CN").includes(normalizedCategoryQuery));
  const categoryTotal = data.categories.reduce((sum, item) => sum + item.count, 0);
  const currentResults = currentRun ? data.validationResults.filter((item) => item.runId === currentRun.id) : [];
  const importableItems = data.items.filter((item) => importableIds.has(item.id));
  const allChecked = importableItems.length > 0 && importableItems.every((item) => drafts[item.id]?.selected);
  const serverSelectedOnPage = importableItems.filter((item) => item.selected).length;
  const draftSelectedOnPage = importableItems.filter((item) => drafts[item.id]?.selected).length;
  const selectedCount = Math.max(0, data.selection.scopeSelectedCount - serverSelectedOnPage + draftSelectedOnPage);
  const filteredSelectedCount = Math.max(0, data.selection.filteredSelectedCount - serverSelectedOnPage + draftSelectedOnPage);
  const allFilteredChecked = data.selection.filteredReviewableCount > 0 && filteredSelectedCount === data.selection.filteredReviewableCount;
  const hasDirtyDrafts = data.items.some((item) => { const draft = drafts[item.id]; return Boolean(draft) && (draft.segment !== (item.reviewedSegment || item.aiSegment) || draft.price !== yuanInput(item.reviewedImagePriceCents) || draft.selected !== item.selected); });
  const visibleJobs = data.jobs.filter((item) => !category || item.category === category);
  const reviewSegments = [...new Set(data.taxonomy.filter((item) => !reviewCategories.length || reviewCategories.includes(item.category)).map((item) => item.value))];
  const reviewCategoryLabel = !reviewCategories.length ? "全部三级类目" : reviewCategories.length === 1 ? reviewCategories[0]! : `已选 ${reviewCategories.length} 个三级类目`;
  const toggleReviewCategory = (value: string, checked: boolean) => {
    setItemSegment("");
    setItemPage(1);
    setReviewCategories((current) => checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
  };
  const reviewSegmentsFor = (item: Item) => {
    const taxonomyValues = data.taxonomy.filter((entry) => entry.category === item.category).map((entry) => entry.value);
    const itemJob = data.jobs.find((entry) => entry.id === item.jobId);
    const itemPrompt = data.prompts.find((entry) => entry.id === itemJob?.promptVersionId);
    return taxonomyValues.length ? taxonomyValues : itemPrompt?.segments ?? [];
  };

  return <div className="market-annotation-module">
    {(error || notice) && <div className={"market-feedback " + (error ? "error" : "success")}>{error || notice}</div>}
    <section className={`panel annotation-hero ${embedded ? "annotation-hero-embedded" : ""}`}><div><span className="eyebrow">HUMAN-IN-THE-LOOP VISION</span><h2>{embedded ? "SKU 数据库 · AI 标注与入库" : "市场 SKU 细分品类 AI 标注"}</h2><p>云端视觉为默认执行器；京东 imgzone 大图优先、n5 兼容回退。AI 候选必须人工复核后才能批量入库。</p></div><div className="annotation-progress"><strong>{currentJob ? currentJob.completedCount + "/" + currentJob.totalCount : "尚未创建"}</strong><span>{currentJob?.status || "等待任务"}</span></div></section>

    <section className="panel annotation-task-card"><div className="section-header"><div><h3>1. 创建与执行任务</h3><p>同图、同 Prompt、同模型的成功结果会直接复用；新图片采用安全双通道识别，遇到 429 自动降级并冷却。D1 持久化进度，关页后可继续。</p></div></div><div className="annotation-form-row">
      <label><span>筛选三级类目</span><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="输入类目关键词" /></label>
      <label><span>三级类目</span><select value={category} onChange={(event) => chooseCategory(event.target.value)}><option value="">全部三级类目（{categoryTotal}）</option>{filteredCategories.map((item) => <option key={item.value} value={item.value}>{item.value}（{item.count}）</option>)}{normalizedCategoryQuery && !filteredCategories.length && <option disabled>没有匹配的三级类目</option>}</select></label>
      <label><span>执行器</span><select value={executor} onChange={(event) => setExecutor(event.target.value as "cloud" | "local")}><option value="cloud">云端视觉（默认）</option><option value="local">本地 Ollama（可选容灾）</option></select></label>
      {executor === "cloud" ? <label><span>enabled vision 模型</span><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)}>{data.models.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.modelName}</option>)}</select></label> : <label><span>Ollama 模型名</span><input value={localModelName} onChange={(event) => setLocalModelName(event.target.value)} /></label>}
      <label><span>任务上限</span><input type="number" min={1} max={MARKET_ANNOTATION_JOB_LIMITS.maximum} value={limit} onChange={(event) => setLimit(Number(event.target.value))} /><small>单个任务最多 10,000 条，可随时暂停并继续。</small></label>
      <button className="primary-button" disabled={!canEdit || !activePrompt || busy !== "" || (executor === "cloud" && !visionModelId)} onClick={createJob}>创建任务</button>
    </div><small>{category ? <>当前激活 Prompt：{activePrompt ? "v" + activePrompt.version + " · " + activePrompt.id : "该类目尚无激活版本"}</> : "当前为全部三级类目，仅浏览和筛选；创建任务前请选择具体类目。"}</small>
    <div className="annotation-job-list">{visibleJobs.map((item) => <button className={jobId === item.id ? "active" : ""} key={item.id} onClick={() => { dirtyDraftIdsRef.current.clear(); setJobId(item.id); }}><strong>{item.category}</strong><span>{item.executor} · {item.status}</span><small>{item.completedCount}/{item.totalCount} · 失败 {item.failedCount} · 入库 {item.committedCount}</small></button>)}</div>
    {currentJob?.executor === "cloud" && <div className="annotation-actions"><button className="primary-button" disabled={!canEdit || busy !== ""} onClick={pumpCloud}>{busy === "run-cloud" ? "云端双通道识别中…" : "继续云端识别（安全双通道）"}</button><button className="secondary-button" disabled={busy !== "run-cloud"} onClick={() => { stopRef.current = true; }}>完成当前条后暂停</button></div>}
    </section>

    <section className="panel annotation-review-card">
      <div className="section-header">
        <div><h3>2. 人工复核与批量入库</h3><p>汇总当前类目全部历史 AI 标注任务；支持跨任务筛选、复核、全选和分组入库。</p></div>
        <div className="annotation-actions"><button className="secondary-button" disabled={!canEdit || !reviewScopeReady || busy !== ""} onClick={() => void saveReview()}>保存复核</button><button className="primary-button" disabled={!isAdmin || !reviewScopeReady || !selectedCount || busy !== ""} onClick={commit}>批量入库（{selectedCount}）</button></div>
      </div>
      <div className="annotation-review-toolbar">
        <div className="annotation-review-category-filter"><span>三级类目（可多选）</span><details><summary aria-label="AI 标注三级类目多选">{reviewCategoryLabel}</summary><div className="annotation-review-category-menu"><button type="button" disabled={!reviewCategories.length} onClick={() => { setReviewCategories([]); setItemSegment(""); setItemPage(1); }}>全部三级类目</button>{data.reviewCategories.map((item) => <label key={item.value}><input type="checkbox" checked={reviewCategories.includes(item.value)} onChange={(event) => toggleReviewCategory(item.value, event.target.checked)} /><span>{item.value}</span><small>{item.jobCount} 个任务 / {item.recordCount} 条</small></label>)}</div></details></div>
        <label><span>细分品类</span><select value={itemSegment} onChange={(event) => { setItemSegment(event.target.value); setItemPage(1); }}><option value="">全部细分品类</option>{reviewSegments.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>入库状态</span><select value={storageStatus} onChange={(event) => { setStorageStatus(event.target.value as "" | "pending" | "committed"); setItemPage(1); }}><option value="">全部状态</option><option value="pending">待入库</option><option value="committed">已入库</option></select></label>
        <label><span>AI 结果</span><select aria-label="AI 标注识别来源" value={recognitionSource} onChange={(event) => { setRecognitionSource(event.target.value as "" | "ai" | "non_ai"); setItemPage(1); }}><option value="">全部 AI 结果</option><option value="ai">AI 已识别</option><option value="non_ai">未生成 AI 结果（含失败）</option></select></label>
        <label className="annotation-select-page"><input type="checkbox" checked={allChecked} disabled={!canEdit || !reviewScopeReady || !importableItems.length || busy !== ""} onChange={(event) => {
          const selected = event.target.checked;
          importableIds.forEach((id) => dirtyDraftIdsRef.current.add(id));
          setDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, importableIds.has(id) ? { ...draft, selected } : draft])));
          setNotice(selected ? `当前页已选择 ${importableItems.length} 条可入库项` : "已清空当前页选择");
        }} />全选当前页可入库项（{importableItems.length} 条）</label>
        <label className="annotation-select-page annotation-select-filtered"><input type="checkbox" checked={allFilteredChecked} disabled={!canEdit || !reviewScopeReady || !data.selection.filteredReviewableCount || busy !== ""} onChange={(event) => void setFilteredSelection(event.target.checked)} />全选筛选结果（跨页 {data.selection.filteredReviewableCount} 条）</label>
        <small>{reviewScopeReady ? "仅选择识别任务已完成、且细分品类仍符合任务 Prompt 的记录；超过 500 条会在入库时自动分批续跑。" : "正在应用三级品类与复核筛选，请稍候……"}</small>
        {!reviewScopeReady && <button className="secondary-button" disabled={busy !== ""} onClick={() => void loadReview(true).catch((reason) => setError(reason instanceof Error ? reason.message : "读取人工复核列表失败"))}>重新加载筛选结果</button>}
        <div className="market-view-switch" role="group" aria-label="AI 标注展示方式"><button className={reviewView === "list" ? "active" : ""} onClick={() => setReviewView("list")}>列表</button><button className={reviewView === "gallery" ? "active" : ""} onClick={() => setReviewView("gallery")}>大图</button></div>
      </div>
      {recognitionSource === "non_ai" && <p className="annotation-filter-note">此筛选不会调用模型；它显示尚未生成 AI 结果的候选，包括等待识别和此前识别失败的记录。</p>}
      <footer className="annotation-pagination annotation-review-pagination">
        <span>{reviewCategoryLabel}：已汇总 {data.reviewSummary.jobCount} 个任务 · 筛选后 {data.itemPagination.total} 条任务记录 · {data.reviewSummary.uniqueCandidateCount} 个不重复候选</span>
        <label>每页 <select aria-label="AI 标注每页条数" value={itemPageSize} disabled={hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onChange={(event) => { setItemPageSize(Number(event.target.value)); setItemPage(1); }}><option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option></select></label>
        <button disabled={itemPage <= 1 || hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onClick={() => setItemPage((page) => Math.max(1, page - 1))}>上一页</button>
        <label>第 <select aria-label="AI 标注页码" value={itemPage} disabled={hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onChange={(event) => setItemPage(Number(event.target.value))}>{Array.from({ length: data.itemPagination.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> / {data.itemPagination.pageCount} 页</label>
        <button disabled={itemPage >= data.itemPagination.pageCount || hasDirtyDrafts} title={hasDirtyDrafts ? "请先保存当前页编辑" : ""} onClick={() => setItemPage((page) => Math.min(data.itemPagination.pageCount, page + 1))}>下一页</button>
      </footer>
      {reviewView === "list" ? <div className="data-table-wrap annotation-review-table-wrap"><table className="data-table annotation-review-table"><thead><tr><th>选择</th><th>大图 / 实际来源</th><th>SKU / 商品链接</th><th>识别批次</th><th>AI 结果</th><th>人工细分品类</th><th>主图价格（元）</th><th>置信度 / 状态</th></tr></thead><tbody>{data.items.map((item) => {
        const draft = drafts[item.id];
        const reviewable = reviewableIds.has(item.id);
        const importable = importableIds.has(item.id);
        const href = annotationProductHref(item.skuCode);
        const imageUrl = item.resolvedImageUrl || item.sourceImageUrl;
        const itemJob = data.jobs.find((entry) => entry.id === item.jobId);
        const itemSegments = reviewSegmentsFor(item);
        return <tr key={item.id}>
          <td><input type="checkbox" checked={importable && (draft?.selected ?? false)} disabled={!canEdit || !reviewScopeReady || !importable} title={reviewable && !importable ? "任务尚未完成，或细分品类不符合该任务 Prompt" : undefined} onChange={(event) => updateDraft(item.id, { selected: event.target.checked })} /></td>
          <td>{imageUrl ? (href ? <a className="annotation-image-link" href={href} target="_blank" rel="noreferrer" aria-label={`打开商品 ${item.productName || item.skuCode}`}><img className="annotation-image" src={imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <img className="annotation-image" src={imageUrl} alt={item.productName || item.skuCode} loading="lazy" />) : <span className="annotation-no-image">无图</span>}<small className={item.imageSource === "imgzone" ? "green-text" : "orange-text"}>{item.imageSource === "imgzone" ? "imgzone 大图" : item.imageSource === "n5" ? "n5 回退" : "未取到安全图片"}</small></td>
          <td>{href ? <a className="annotation-product-link" href={href} target="_blank" rel="noreferrer"><strong>{item.skuCode}</strong><small title={item.productName}>{item.productName || "未命名商品"}</small><span>打开商品链接 ↗</span></a> : <><strong>{item.skuCode}</strong><small title={item.productName}>{item.productName}</small></>}<code>{item.candidateId}</code></td>
          <td><strong>{itemJob?.createdAt?.slice(0, 10) || item.createdAt.slice(0, 10)}</strong><small>{itemJob?.executor || "—"} · {itemJob?.status || "—"}</small><code>{item.jobId.slice(0, 18)}…</code></td>
          <td><strong>{item.aiSegment || "—"}</strong><small>{annotationResultMessage(item)}</small></td>
          <td><select value={draft?.segment ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { segment: event.target.value })}><option value="">请选择</option>{itemSegments.map((value) => <option key={value}>{value}</option>)}</select></td>
          <td><input type="number" min={0} step="0.01" value={draft?.price ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { price: event.target.value })} /><small>{item.reviewPriceSource === "history_same_image" ? `历史同图：${money(item.reviewedImagePriceCents)}` : `AI：${money(item.aiImagePriceCents)}`}</small></td>
          <td><strong>{item.aiConfidenceBps === null ? "—" : (item.aiConfidenceBps / 100).toFixed(1) + "%"}</strong><small>{annotationRecognitionLabel(item)} · {item.status} · v{item.version}</small></td>
        </tr>;
      })}{!data.items.length && <tr><td colSpan={8}><div className="table-state">当前筛选范围没有候选项。</div></td></tr>}</tbody></table></div> : <div className="annotation-review-gallery">{data.items.map((item) => {
        const draft = drafts[item.id];
        const reviewable = reviewableIds.has(item.id);
        const importable = importableIds.has(item.id);
        const href = annotationProductHref(item.skuCode);
        const imageUrl = item.resolvedImageUrl || item.sourceImageUrl;
        const itemJob = data.jobs.find((entry) => entry.id === item.jobId);
        const itemSegments = reviewSegmentsFor(item);
        return <article key={item.id}>
          <label className="annotation-gallery-select"><input type="checkbox" checked={importable && (draft?.selected ?? false)} disabled={!canEdit || !reviewScopeReady || !importable} title={reviewable && !importable ? "任务尚未完成，或细分品类不符合该任务 Prompt" : undefined} onChange={(event) => updateDraft(item.id, { selected: event.target.checked })} />{item.status === "committed" ? "已入库" : importable ? "加入本次入库" : "暂不可入库"}</label>
          <div className="annotation-gallery-image">{imageUrl ? (href ? <a href={href} target="_blank" rel="noreferrer" aria-label={`打开商品 ${item.productName || item.skuCode}`}><img src={imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <img src={imageUrl} alt={item.productName || item.skuCode} loading="lazy" />) : <span>无图</span>}</div>
          {href ? <a className="annotation-product-link" href={href} target="_blank" rel="noreferrer"><h4>{item.productName || item.skuCode}</h4><span>打开商品链接 ↗</span></a> : <h4>{item.productName || item.skuCode}</h4>}
          <small>{item.skuCode} · {annotationRecognitionLabel(item)} · {item.imageSource}</small>
          <small>批次：{itemJob?.createdAt?.slice(0, 10) || item.createdAt.slice(0, 10)} · {itemJob?.status || "—"}</small>
          <p>{annotationResultMessage(item)}</p>
          <label><span>细分品类</span><select value={draft?.segment ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { segment: event.target.value })}><option value="">请选择</option>{itemSegments.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>主图价格（元）</span><input type="number" min={0} step="0.01" value={draft?.price ?? ""} disabled={!canEdit || !reviewable} onChange={(event) => updateDraft(item.id, { price: event.target.value })} /><small>{item.reviewPriceSource === "history_same_image" ? `历史同图默认：${money(item.reviewedImagePriceCents)}` : `AI：${money(item.aiImagePriceCents)}`}</small></label>
          <footer><strong>{item.aiSegment || "未识别"}</strong><span>{item.aiConfidenceBps === null ? "—" : (item.aiConfidenceBps / 100).toFixed(1) + "%"}</span></footer>
        </article>;
      })}{!data.items.length && <div className="table-state">当前筛选范围没有候选项。</div>}</div>}
    </section>

    <section className="annotation-two-column"><article className="panel annotation-prompt-card"><div className="section-header"><div><h3>3. Prompt 版本与自动进化</h3><p>正文与枚举始终明文可见；编辑只创建不可变子版本。未使用的草稿可以删除，激活及归档版本永久保留。</p></div></div>{error && <div className="market-feedback error">{error}</div>}
      <div className="annotation-prompt-history">{data.prompts.filter((item) => !category || item.category === category).map((item) => <div key={item.id} className="annotation-prompt-version"><button className={`annotation-prompt-select ${selectedPrompt?.id === item.id ? "active" : ""}`} onClick={() => choosePrompt(item)}><strong>v{item.version} · {item.status}</strong><span>{item.source}</span><small>{item.id}</small></button>{isAdmin && item.status === "draft" && <button className="annotation-prompt-delete" disabled={busy !== ""} title={`删除 v${item.version} 草稿`} onClick={() => void deletePrompt(item)}>删除</button>}</div>)}</div>
      <label><span>细分品类枚举（由细分品类设置统一维护）</span><textarea value={segmentsText} readOnly /></label><label><span>Prompt 正文</span><textarea className="annotation-prompt-body" value={promptBody} onChange={(event) => setPromptBody(event.target.value)} placeholder="写明视觉分类规则、价格识别口径和严格 JSON 输出" /></label><label><span>版本说明</span><input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} /></label>
      <div className="annotation-form-row"><label><span>AI 文本模型</span><select value={textModelId} onChange={(event) => setTextModelId(event.target.value)}>{data.textModels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>抽样数</span><input type="number" min={1} max={500} value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))} /></label><label><span>固定 seed</span><input value={seed} onChange={(event) => setSeed(event.target.value)} /></label></div>
      <div className="annotation-actions"><button className="secondary-button" disabled={!canEdit || !category || busy !== ""} onClick={() => void savePrompt("manual")}>保存人工子版本</button><button className="secondary-button" disabled={!canEdit || !category || !textModelId || busy !== ""} onClick={() => void savePrompt("generate")}>AI 生成</button><button className="secondary-button" disabled={!canEdit || !category || !selectedPrompt || !textModelId || !visionModelId || busy !== ""} onClick={evolve}>AI 进化并测试</button><button className="secondary-button" disabled={!canEdit || !category || !selectedPrompt || !visionModelId || busy !== ""} onClick={() => void testPrompt()}>冻结抽样测试</button>{selectedPrompt?.status === "active" ? <button className="primary-button" disabled>当前激活版本</button> : selectedPrompt && <button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void activate(selectedPrompt, selectedPrompt.status === "archived")}>{selectedPrompt.status === "archived" ? "回滚到此版" : "激活此版"}</button>}</div>
    </article>
    <article className="panel annotation-validation-card"><div className="section-header"><div><h3>冻结抽样验证</h3><p>默认 50 条，按品类分层并以 seed+hash 冻结；逐条错例永久保留。</p></div></div>{currentRun ? <><div className="annotation-validation-summary"><strong>{currentRun.status}</strong><span>{currentRun.sampleCount} 条 · hash {currentRun.sampleHash?.slice(0, 12)}</span><em className={currentRun.gate?.passed ? "green-text" : "orange-text"}>{currentRun.gate?.passed ? "门禁通过" : (currentRun.gate?.reasons || []).join("；") || "待完成"}</em></div><div className="annotation-validation-errors">{currentResults.filter((item) => !item.isCorrect || item.errorMessage).slice(0, 80).map((item) => <div key={item.id}><strong>{item.skuCode} · {item.goldSegment} → {item.predictedSegment || "失败"}</strong><small>{item.productName}</small><span>{item.errorMessage}</span></div>)}</div></> : <p className="soft-text">尚无冻结验证运行。</p>}</article>
    </section>

    <section ref={catalogSectionRef} className="panel annotation-catalog-card"><div className="section-header"><div><h3>4. 完整市场 SKU 库检索</h3><p>滚动到此区域时才读取完整库，不受榜单页面 200 条展示上限影响；优先展示已缓存商品图。</p></div><div className="annotation-actions">{isAdmin && <button className="secondary-button" disabled={!goldIds.length} onClick={() => void act("gold", async () => { await post({ action: "mark_gold", annotationIds: goldIds }); setGoldIds([]); await load(jobId); setNotice("已加入冻结验证金标集"); })}>设为金标（{goldIds.length}）</button>}</div></div><input className="annotation-search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchPage(1); }} placeholder="搜索 SKU、商品名、品牌、三级类目、最终细分品类" />{catalogRequested ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>金标</th><th>图片</th><th>SKU / 商品</th><th>品牌</th><th>三级类目</th><th>最终细分品类</th><th>价格</th><th>复核状态</th></tr></thead><tbody>{data.catalog.items.map((item) => <tr key={item.category + item.skuCode}><td><input type="checkbox" disabled={!item.annotationId || !isAdmin} checked={Boolean(item.annotationId && goldIds.includes(item.annotationId))} onChange={() => item.annotationId && setGoldIds((current) => current.includes(item.annotationId!) ? current.filter((id) => id !== item.annotationId) : [...current, item.annotationId!])} /></td><td>{item.imageUrl ? <img className="annotation-catalog-image" src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /> : <span className="annotation-no-image">无图</span>}<small>{item.imageCacheStatus === "ready" ? "已缓存" : "源图"}</small></td><td><strong>{item.skuCode}</strong><small>{item.productName}</small></td><td>{item.brand || "—"}</td><td>{item.category}</td><td><strong>{item.finalSegment || "—"}</strong></td><td><small>榜单 {money(item.rankingPriceCents)}</small><small>主图 {money(item.finalImagePriceCents)}</small></td><td>{item.reviewStatus}</td></tr>)}</tbody></table></div><footer className="annotation-pagination"><span>共 {data.catalog.total} 条</span><button disabled={searchPage <= 1} onClick={() => setSearchPage((page) => page - 1)}>上一页</button><strong>{searchPage}/{data.catalog.pageCount}</strong><button disabled={searchPage >= data.catalog.pageCount} onClick={() => setSearchPage((page) => page + 1)}>下一页</button></footer></> : <div className="table-state">完整 SKU 目录将在滚动接近此区域时加载。</div>}</section>

    <section className="panel annotation-agent-card"><div className="section-header"><div><h3>5. 本地 Ollama agent（可选容灾）</h3><p>Cloudflare 不回连 localhost；本机 runner 使用一次性 token 主动领取带 lease 的任务。</p></div>{isAdmin && <button className="secondary-button" onClick={createAgent}>创建 agent</button>}</div>{agentToken && <div className="annotation-token"><strong>仅显示一次</strong><code>{agentToken}</code></div>}<pre>TERUISI_SITE_URL=https://你的站点{`\n`}TERUISI_ANNOTATION_AGENT_TOKEN=创建时的一次性token{`\n`}OLLAMA_BASE_URL=http://127.0.0.1:11434{`\n`}npm run market:annotation-agent</pre><div className="annotation-agent-list">{data.agents.map((agent) => <div key={agent.id}><strong>{agent.name}</strong><span>{agent.status} · 最近心跳 {agent.lastSeenAt || "从未"}</span>{isAdmin && agent.status === "enabled" && <button className="row-action danger" onClick={() => void act("revoke", async () => { await post({ action: "revoke_agent", agentId: agent.id }); await load(jobId); })}>撤销</button>}</div>)}</div></section>
  </div>;
}
