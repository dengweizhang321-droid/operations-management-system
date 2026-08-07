import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  activationGate, canTransitionItem, canTransitionJob, normalizeImagePriceCents, normalizeImagePriceYuan, normalizeSegments,
  parseVisionAnnotation, stableStratifiedSample, validationMetrics,
} from "../lib/market/annotation-types";
import { DEFAULT_MARKET_SEGMENTS, marketSegmentsForCategory } from "../lib/market/default-taxonomy";
import { activatePromptVersion, claimLocalAnnotation, classifyCloudAnnotationFailure, commitAnnotationItems, commitSelectedAnnotationItems, completeLocalAnnotation, createAnnotationJob, createPriceRecognitionJob, createValidationRun, deletePromptVersion, getAnnotationJobProgress, getAnnotationReviewWorkspace, getAnnotationWorkspace, runCloudAnnotationBatch, runCloudAnnotationPump, runNextCloudAnnotation, runNextValidation, searchAnnotationCatalog, setAnnotationConcurrency, setFilteredAnnotationSelection, updateAnnotationItems } from "../lib/market/annotation-service";
import { AnnotationAgentError, annotationAgentErrorResponse } from "../lib/market/annotation-agent-errors";
import { ensureAnnotationSchema } from "../lib/market/annotation-schema";
import { ensureMarketSchemaCore } from "../lib/market/schema-core";
import type { MarketDatabase } from "../lib/market/database";
import { defaultMarketAnnotationConcurrency, MARKET_ANNOTATION_CONCURRENCY_LIMITS, MARKET_ANNOTATION_JOB_LIMITS, normalizeMarketAnnotationConcurrency, normalizeMarketAnnotationJobLimit } from "../lib/market/annotation-limits";
import { annotationRecoveredConcurrency, annotationRequestRetryKind, annotationRetryConcurrency, annotationRetryDelayMs, isRetryableAnnotationRequestError } from "../lib/market/annotation-retry";
import { defaultAnnotationPromptBody } from "../lib/market/annotation-prompt-template";

test("annotation automatic retry uses bounded adaptive backoff and classifies only temporary failures", () => {
  assert.equal(annotationRetryDelayMs("waiting", 0), 2_000);
  assert.equal(annotationRetryDelayMs("transient", 1), 5_000);
  assert.equal(annotationRetryDelayMs("transient", 3), 20_000);
  assert.equal(annotationRetryDelayMs("transient", 8), 30_000);
  assert.equal(annotationRetryDelayMs("rate_limit", 1), 60_000);
  assert.equal(annotationRetryDelayMs("rate_limit", 8), 300_000);
  assert.equal(annotationRetryDelayMs("transient", Number.NaN, 600_000), 300_000);
  assert.equal(annotationRetryConcurrency("waiting", 10, 10, 1), 10);
  assert.equal(annotationRetryConcurrency("transient", 10, 10, 1), 8);
  assert.equal(annotationRetryConcurrency("transient", 8, 10, 2), 4);
  assert.equal(annotationRetryConcurrency("rate_limit", 10, 10, 1), 5);
  assert.equal(annotationRecoveredConcurrency(8, 10, 2), 8);
  assert.equal(annotationRecoveredConcurrency(8, 10, 3), 9);
  assert.equal(annotationRecoveredConcurrency(8, 10, 6), 10);
  assert.equal(annotationRequestRetryKind(new Error("价格识别请求超时")), "transient");
  assert.equal(annotationRequestRetryKind({ status: 503, message: "gateway unavailable" }), "transient");
  assert.equal(annotationRequestRetryKind({ status: 429, message: "too many requests" }), "rate_limit");
  assert.equal(annotationRequestRetryKind({ status: 403, message: "forbidden" }), null);
  assert.equal(isRetryableAnnotationRequestError(new TypeError("Failed to fetch")), true);
});

test("cloud annotation failures return bounded operational codes and messages", () => {
  assert.deepEqual(classifyCloudAnnotationFailure(new Error("模型调用超时")), {
    failureKind: "transient", failureCode: "model_timeout", failureMessage: "模型调用超时", retryAfterMs: 5_000,
  });
  assert.equal(classifyCloudAnnotationFailure(new Error("模型接口网络错误")).failureCode, "model_network");
  assert.equal(classifyCloudAnnotationFailure(new Error("主图获取失败：imgzone image request timed out")).failureCode, "image_fetch");
  assert.equal(classifyCloudAnnotationFailure(new Error("视觉模型调用失败（状态码 429：busy）")).failureCode, "provider_rate_limit");
  assert.deepEqual(classifyCloudAnnotationFailure(new Error("database exploded with internal detail")), {
    failureKind: "permanent", failureCode: "annotation_failed", failureMessage: "识别失败", retryAfterMs: 0,
  });
});

test("market annotation jobs default to and accept at most 10,000 items", () => {
  assert.deepEqual(MARKET_ANNOTATION_JOB_LIMITS, { default: 10_000, maximum: 10_000 });
  assert.equal(normalizeMarketAnnotationJobLimit(), 10_000);
  assert.equal(normalizeMarketAnnotationJobLimit(10_000), 10_000);
  assert.throws(() => normalizeMarketAnnotationJobLimit(10_001), /1 到 10000/);
});

test("annotation model concurrency defaults are executor-aware and bounded from 1 to 50", () => {
  assert.deepEqual(MARKET_ANNOTATION_CONCURRENCY_LIMITS, { minimum: 1, maximum: 50, cloudDefault: 10, localDefault: 1 });
  assert.equal(defaultMarketAnnotationConcurrency("cloud"), 10);
  assert.equal(defaultMarketAnnotationConcurrency("local"), 1);
  assert.equal(normalizeMarketAnnotationConcurrency(20, "cloud"), 20);
  assert.equal(normalizeMarketAnnotationConcurrency(50, "local"), 50);
  assert.throws(() => normalizeMarketAnnotationConcurrency(0, "cloud"), /1 到 50/);
  assert.throws(() => normalizeMarketAnnotationConcurrency(51, "local"), /1 到 50/);
  assert.throws(() => normalizeMarketAnnotationConcurrency(1.5, "cloud"), /1 到 50/);
});

test("annotation concurrency is remembered per category and executor with idempotent audit", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,status,created_by) VALUES
      ('setting-a','类目A','prompt-a','cloud','queued','operator@test'),
      ('setting-b','类目B','prompt-b','cloud','queued','operator@test');
  `);
  const actor = { email: "operator@test", role: "operator" };
  await setAnnotationConcurrency(db, { category: "类目A", executor: "cloud", concurrency: 15 }, actor);
  await setAnnotationConcurrency(db, { category: "类目A", executor: "local", concurrency: 1 }, actor);
  await setAnnotationConcurrency(db, { category: "类目B", executor: "cloud", concurrency: 20 }, actor);
  await setAnnotationConcurrency(db, { category: "类目A", executor: "cloud", concurrency: 15 }, actor);
  const settings = sqlite.prepare("SELECT category,executor,concurrency FROM market_annotation_concurrency_settings ORDER BY category,executor").all();
  assert.deepEqual(settings.map((row) => ({ ...row })), [
    { category: "类目A", executor: "cloud", concurrency: 15 },
    { category: "类目A", executor: "local", concurrency: 1 },
    { category: "类目B", executor: "cloud", concurrency: 20 },
  ]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action='set_market_annotation_concurrency'").get() as { count: number }).count, 3);
  await assert.rejects(() => setAnnotationConcurrency(db, { category: "类目A", executor: "cloud", concurrency: 0 }, actor), /1 到 50/);
  await assert.rejects(() => setAnnotationConcurrency(db, { category: "类目A", executor: "cloud", concurrency: 51 }, actor), /1 到 50/);
  await assert.rejects(() => setAnnotationConcurrency(db, { category: "类目A", executor: "remote", concurrency: 1 }, actor), /cloud 或 local/);
  await assert.rejects(() => setAnnotationConcurrency(db, { category: "不存在", executor: "cloud", concurrency: 10 }, actor), /不存在/);
  sqlite.close();
});

test("annotation state machines reject unsafe skips", () => {
  assert.equal(canTransitionJob("queued", "running"), true);
  assert.equal(canTransitionJob("queued", "committed"), false);
  assert.equal(canTransitionJob("committed", "queued"), false);
  assert.equal(canTransitionItem("queued", "claimed"), true);
  assert.equal(canTransitionItem("queued", "committed"), false);
  assert.equal(canTransitionItem("approved", "committed"), true);
  assert.equal(canTransitionItem("committed", "review_pending"), false);
});

test("segments and image price are server-normalized", () => {
  assert.deepEqual(normalizeSegments(["台式", " 台式 ", "立式"]), ["台式", "立式"]);
  assert.throws(() => normalizeSegments(["只有一个"]), /2 到 80/);
  assert.equal(normalizeImagePriceCents("199900"), 199900);
  assert.equal(normalizeImagePriceCents(""), null);
  assert.throws(() => normalizeImagePriceCents(1.2), /整数分/);
  assert.throws(() => normalizeImagePriceCents(-1), /整数分/);
  assert.equal(normalizeImagePriceYuan("1999.90"), 199990);
  assert.equal(normalizeImagePriceYuan(null), null);
});

test("vision results require structured enum, price type, cents, and bounded confidence", () => {
  const parsed = parseVisionAnnotation("```json\n{\"segment\":\"台式\",\"image_price_cents\":199900,\"price_type\":\"到手价\",\"price_low_cents\":189900,\"price_high_cents\":209900,\"confidence\":0.92,\"reason\":\"结构匹配\"}\n```", ["台式", "立式"]);
  assert.equal(parsed.segment, "台式");
  assert.equal(parsed.imagePriceCents, 199900);
  assert.equal(parsed.priceType, "到手价");
  assert.equal(parsed.priceLowCents, 189900);
  assert.equal(parsed.priceHighCents, 209900);
  assert.equal(parsed.confidenceBps, 9200);
  const yuanParsed = parseVisionAnnotation({ segment: "台式", image_price_yuan: 1999.9, price_type: "标准售价", price_low_yuan: 1899, price_high_yuan: 2099, confidence: 0.88, reason: "主图标价" }, ["台式", "立式"]);
  assert.equal(yuanParsed.imagePriceCents, 199990);
  assert.equal(yuanParsed.priceLowCents, 189900);
  assert.equal(yuanParsed.priceHighCents, 209900);
  assert.throws(() => parseVisionAnnotation({ segment: "自造品类", image_price_cents: null, confidence: 0.5 }, ["台式", "立式"]), /枚举之外/);
  assert.throws(() => parseVisionAnnotation({ segment: "台式", image_price_cents: null, confidence: 1.1 }, ["台式", "立式"]), /0 到 1/);
});

test("every imported market category has a dedicated starter taxonomy", () => {
  const categories = ["商用洗碗机", "商用绞肉机切肉机切片机", "商用净水设备", "商用开水器蒸气奶泡机", "商用切菜机", "商用炒菜机", "商用净饮水设备"];
  assert.deepEqual(Object.keys(DEFAULT_MARKET_SEGMENTS).sort(), [...categories].sort());
  for (const category of categories) {
    const segments = marketSegmentsForCategory(category);
    assert.ok(segments.length >= 9, `${category} should have category-specific segments`);
    assert.equal(segments.at(-1), "其他");
  }
  assert.deepEqual(marketSegmentsForCategory("未配置类目"), ["主要产品", "配件耗材", "其他"]);
});

test("frozen validation sampling is deterministic and stratified", () => {
  const rows = [
    { id: "a1", goldSegment: "A" }, { id: "a2", goldSegment: "A" }, { id: "a3", goldSegment: "A" },
    { id: "b1", goldSegment: "B" }, { id: "b2", goldSegment: "B" }, { id: "c1", goldSegment: "C" },
  ];
  const first = stableStratifiedSample(rows, 5, "seed-16");
  const second = stableStratifiedSample([...rows].reverse(), 5, "seed-16");
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first.slice(0, 3).map((row) => row.goldSegment)), new Set(["A", "B", "C"]));
});

test("activation gate blocks overall, macro, and per-class regressions", () => {
  const baselineRows = Array.from({ length: 20 }, (_, index) => ({ goldSegment: index < 10 ? "A" : "B", predictedSegment: index === 9 || index === 19 ? "错" : index < 10 ? "A" : "B", goldImagePriceCents: null, predictedImagePriceCents: null }));
  const candidateRows = baselineRows.map((row, index) => ({ ...row, predictedSegment: index === 8 ? "错" : row.predictedSegment }));
  const baseline = validationMetrics(baselineRows);
  const candidate = validationMetrics(candidateRows);
  const gate = activationGate(baseline, candidate, 20);
  assert.equal(gate.passed, false);
  assert.match(gate.reasons.join(" "), /退化/);
  assert.equal(activationGate(null, candidate, 50).passed, false);
  const releaseRows = Array.from({ length: 50 }, (_, index) => ({ goldSegment: index % 2 ? "A" : "B", predictedSegment: index % 2 ? "A" : "B", goldImagePriceCents: 10_000 + index, predictedImagePriceCents: 10_000 + index }));
  assert.deepEqual(activationGate(null, validationMetrics(releaseRows), 50), { passed: true, reasons: [] });
});

test("annotation implementation wires real cloud images, idempotency, permissions, search, and local pull", async () => {
  const [route, worker, service, model, imageCache, ui, marketUi, masterRoute, runner, migration, concurrencyMigration] = await Promise.all([
    readFile(new URL("../app/api/market/annotations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/annotations/worker/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/image-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-annotation-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/master/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../tools/market-annotation-runner.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0016_market_sku_annotations.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0054_market_annotation_concurrency_settings.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /adminActions.*commit.*activate_prompt.*delete_prompt.*create_agent/s);
  assert.match(route, /case "run_batch".*runCloudAnnotationBatch/s);
  assert.match(route, /case "set_concurrency".*setAnnotationConcurrency/s);
  assert.match(route, /case "run_batch": result = await runCloudAnnotationBatch\(db, text\(parsed, "jobId"\), 1\)/);
  assert.match(route, /requireAppPrincipal\(adminActions\.has\(action\)/);
  assert.match(worker, /authenticateLocalAgent/);
  assert.match(worker, /annotationAgentErrorResponse/);
  assert.doesNotMatch(worker, /error instanceof Error \? error\.message/);
  assert.match(service, /model_type IN \('vision','image'\)/);
  assert.match(service, /candidateIds/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /version=version\+1/);
  assert.match(service, /ROW_NUMBER\(\) OVER \(PARTITION BY m\.category, m\.sku_code/);
  assert.match(service, /m\.sku_code LIKE \?.*a\.segment LIKE \?/s);
  assert.match(service, /lease_token_hash/);
  assert.match(service, /status<>'deleted'/);
  assert.match(service, /reuseAnnotationHistory/);
  assert.match(service, /fanOutInferenceUnitResult/);
  assert.match(route, /getAnnotationJobProgress/);
  assert.match(ui, /loadJobProgress/);
  assert.match(service, /history_job\.prompt_version_id=\?/);
  assert.match(model, /type: "image_url"/);
  assert.match(model, /loadCachedAnnotationImage/);
  assert.match(model, /prepareAnnotationModelImage/);
  assert.match(model, /max_tokens: Math\.min\(boundedModelSetting\(model\.max_tokens, 800, 128, 1_600\), outputTokenCap \?\? 1_600\)/);
  assert.match(model, /fixedSegment \? 400 : undefined/);
  assert.match(model, /不要重新分类，只识别当前新主图价格/);
  assert.match(model, /boundedModelSetting\(model\.timeout_ms, DEFAULT_MODEL_TIMEOUT_MS, 3_000, 120_000\)/);
  assert.match(model, /VISION_ANNOTATION_TIMEOUT_MAX_MS = 90_000/);
  assert.match(model, /Math\.min\(boundedModelSetting\(model\.timeout_ms, DEFAULT_MODEL_TIMEOUT_MS, 3_000, 120_000\), VISION_ANNOTATION_TIMEOUT_MAX_MS\)/);
  assert.match(imageCache, /getCachedMarketImageForAnnotation/);
  assert.match(imageCache, /annotationModelImageObjectKey/);
  assert.match(masterRoute, /case "run_price_recognition_batch".*runCloudAnnotationBatch\(db, text\(parsed, "jobId"\), 1\)/s);
  assert.match(marketUi, /action: "run_price_recognition_batch"/);
  assert.match(marketUi, /PRICE_RECOGNITION_REQUEST_TIMEOUT_MS = 110_000/);
  assert.match(marketUi, /PRICE_RECOGNITION_CONCURRENCY = 2/);
  assert.match(marketUi, /PRICE_RECOGNITION_BATCH_SIZE = 1/);
  assert.match(marketUi, /系统将在.*秒后自动刷新并续跑/);
  assert.match(marketUi, /const refreshRecognitionProgress = loadLatest/);
  assert.match(marketUi, /successesSinceFailure >= 3/);
  assert.match(marketUi, /自动恢复双通道价格识别/);
  assert.doesNotMatch(marketUi, /请刷新后继续原任务|再次点击将继续原任务/);
  assert.match(model, /response_format: \{ type: "json_schema"/);
  assert.match(model, /tool_choice: \{ type: "tool"/);
  assert.match(model, /MODEL_RESPONSE_MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(model, /readBodyLimited\(response, MODEL_RESPONSE_MAX_BYTES\)/);
  assert.doesNotMatch(model, /data\?\.error\?\.message/);
  assert.match(service, /sample_snapshot_json/);
  assert.match(service, /datetime\('now','\+3 minutes'\)/);
  assert.match(service, /annotationConcurrency\(db, job\.category, "cloud"\)/);
  assert.match(service, /datetime\(active\.lease_expires_at\)>datetime\('now'\)\)<\?/);
  assert.match(service, /commit_token_hash/);
  assert.match(ui, /SKU AI 标注/);
  assert.match(ui, /MARKET_ANNOTATION_CONCURRENCY_LIMITS\.maximum/);
  assert.match(ui, /Array\.from\(\{ length: MARKET_ANNOTATION_CONCURRENCY_LIMITS\.maximum \}/);
  assert.match(ui, /const CLOUD_BATCH_SIZE = 1/);
  assert.match(ui, /action: "run_batch"/);
  assert.match(ui, /MARKET_ANNOTATION_JOB_LIMITS\.default/);
  assert.match(ui, /MARKET_ANNOTATION_JOB_LIMITS\.maximum/);
  assert.match(ui, /单个任务最多 10,000 条/);
  assert.match(route, /MARKET_ANNOTATION_JOB_LIMITS\.default/);
  assert.match(service, /normalizeMarketAnnotationJobLimit/);
  assert.match(ui, /模型供应商限流\$\{cause\}，\$\{concurrencyChange\}/);
  assert.match(ui, /CLOUD_PROGRESS_REFRESH_EVERY/);
  assert.match(ui, /全部三级类目/);
  assert.match(ui, /输入类目关键词/);
  assert.match(ui, /filteredCategories/);
  assert.match(ui, /new URLSearchParams\(\{ view: "review"/);
  assert.match(ui, /new URLSearchParams\(\{ view: "catalog"/);
  assert.doesNotMatch(ui, /void load\(item\.id, search, searchPage, 1\)/);
  assert.match(ui, /action: "commit_selected"/);
  assert.match(ui, /action: "select_filtered"/);
  assert.match(ui, /全选筛选结果（跨页/);
  assert.match(ui, /for \(let batch = 1; batch <= 20; batch \+= 1\)/);
  assert.match(ui, /if \(!result\?\.hasMore\) break/);
  assert.match(ui, /selectedPageIds/);
  assert.match(ui, /dirtyDraftIdsRef\.current\.has\(item\.id\) && existing\.version === serverDraft\.version/);
  assert.match(ui, /loadedReviewScopeKey === activeReviewScopeKey/);
  assert.match(service, /MAX_FILTERED_SELECTION = 5_000/);
  assert.match(service, /COMMIT_SELECTION_BATCH_SIZE = 500/);
  assert.match(ui, /AI 标注识别来源/);
  assert.match(ui, /完整市场 SKU 库检索/);
  assert.match(ui, /const LOAD_TIMEOUT_MS = 30_000/);
  assert.match(ui, /const ACTION_TIMEOUT_MS = 110_000/);
  assert.match(ui, /模型或网络暂时异常\$\{cause\}，\$\{concurrencyChange\}/);
  assert.match(ui, /decision\.suppressedByGlobalRateLimit \|\| !decision\.countedIncident/);
  assert.match(ui, /decision\.shouldPause/);
  assert.match(ui, /failureCode.*failureMessage/);
  assert.match(ui, /识别已自动暂停/);
  assert.match(ui, /每成功 3 张逐步恢复/);
  assert.match(ui, /系统已恢复为.*路并发识别/);
  assert.match(ui, /当前 AI 标注任务模型并发数/);
  assert.match(ui, /保存并应用/);
  assert.match(ui, /annotation-task-setup/);
  assert.match(ui, /annotation-current-run/);
  const currentConcurrencyControl = ui.slice(ui.indexOf('aria-label="当前 AI 标注任务模型并发数"'), ui.indexOf("</label>", ui.indexOf('aria-label="当前 AI 标注任务模型并发数"')));
  assert.ok(currentConcurrencyControl.length > 0);
  assert.doesNotMatch(currentConcurrencyControl, /!category|busy !==/);
  assert.match(ui, /activeCloudRunRef\.current/);
  assert.match(ui, /new AnnotationRunRetryController/);
  assert.match(ui, /waitForWindow\(workerIndex\)/);
  assert.match(ui, /activeRequestCount < retryController\.workerLimit/);
  assert.doesNotMatch(ui, /workerIndex >= retryController\.workerLimit/);
  assert.match(ui, /仅出错通道将在/);
  assert.match(ui, /云端建议 10–20；过高易触发限流并计入失败/);
  assert.match(ui, /本地 Ollama 建议 1/);
  assert.doesNotMatch(ui, /请刷新后继续原任务|请稍后点击“继续云端识别”/);
  assert.match(ui, /signal: controller\.signal/);
  assert.match(ui, /loadSequence !== loadSequenceRef\.current/);
  assert.match(ui, /系统将自动刷新任务状态并续跑原任务/);
  assert.match(ui, /if \(!response\.ok \|\| !payload\)/);
  assert.match(ui, /requestError\.status = response\.status/);
  assert.match(ui, /setInitialLoading\(false\)/);
  assert.match(ui, /SKU AI 标注工作台加载失败/);
  assert.match(ui, />重试<\/button>/);
  assert.match(runner, /TERUISI_ANNOTATION_AGENT_TOKEN/);
  assert.match(runner, /OLLAMA_BASE_URL must point to localhost/);
  assert.match(runner, /OLLAMA_TIMEOUT_MS = 120_000/);
  assert.match(runner, /OLLAMA_RESPONSE_MAX_BYTES = 1024 \* 1024/);
  assert.match(runner, /readLimitedBody\(response, OLLAMA_RESPONSE_MAX_BYTES\)/);
  assert.match(runner, /workerConcurrency/);
  assert.match(runner, /active\.size < workerConcurrency/);
  assert.doesNotMatch(runner, /payload\?\.error \|\| \("Ollama/);
  for (const table of ["market_annotation_jobs", "market_annotation_items", "market_sku_annotations", "market_annotation_commit_receipts", "market_annotation_prompt_versions", "market_annotation_validation_samples", "market_annotation_validation_runs", "market_annotation_validation_results", "market_annotation_local_agents"]) assert.match(migration, new RegExp(table));
  assert.match(concurrencyMigration, /market_annotation_concurrency_settings/);
  assert.match(concurrencyMigration, /BETWEEN 1 AND 50/);
});

test("the background cloud pump picks the oldest runnable job and reports its remembered concurrency", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    CREATE TABLE ai_models (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, model_type TEXT NOT NULL, model_name TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO ai_models VALUES ('vision-1','测试视觉','openai_compatible','vision','vision-test','https://api.invalid/v1','','enabled');
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('pump-prompt','泵类目',1,'manual','active','["型号A","其他"]','这是用于验证后台泵按任务顺序推进云端识别的正式 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by) VALUES ('泵类目','cloud',6,'admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, reuse_status, created_by, created_at)
      VALUES ('pump-done','泵类目','pump-prompt','cloud','vision-1','review_ready',1,'ready','admin@test','2026-01-01 00:00:00'),
             ('pump-old','泵类目','pump-prompt','cloud','vision-1','running',1,'ready','admin@test','2026-01-02 00:00:00'),
             ('pump-new','泵类目','pump-prompt','cloud','vision-1','running',1,'ready','admin@test','2026-01-03 00:00:00');
    INSERT INTO market_annotation_items (id, job_id, category, sku_code, product_name, status)
      VALUES ('pump-old-item','pump-old','泵类目','SKU-OLD','旧任务候选','queued'),
             ('pump-new-item','pump-new','泵类目','SKU-NEW','新任务候选','queued');
  `);

  const first = await runCloudAnnotationPump(db);
  assert.equal(first.idle, false);
  assert.equal(first.jobId, "pump-old");
  assert.equal(first.concurrency, 6);
  // 模型端点不可达，条目按瞬时失败记账并保留续跑能力，泵不会因此崩掉。
  const attempted = sqlite.prepare("SELECT status, attempt_count attemptCount FROM market_annotation_items WHERE id='pump-old-item'").get() as { status: string; attemptCount: number };
  assert.deepEqual({ ...attempted }, { status: "failed", attemptCount: 1 });

  // 已收尾的任务不会被自动选中；显式指定时只做一次对账并立刻返回 done，不调模型。
  const settled = await runCloudAnnotationPump(db, { jobId: "pump-done" });
  assert.equal(settled.done, true);
  assert.equal(sqlite.prepare("SELECT status FROM market_annotation_jobs WHERE id='pump-done'").get<{ status: string }>()!.status, "review_ready");

  sqlite.prepare("UPDATE market_annotation_items SET status='committed', attempt_count=3 WHERE id='pump-old-item'").run();
  assert.equal((await runCloudAnnotationPump(db)).jobId, "pump-new");

  sqlite.prepare("UPDATE market_annotation_items SET status='committed', attempt_count=3 WHERE id='pump-new-item'").run();
  assert.deepEqual({ ...(await runCloudAnnotationPump(db)) }, { idle: true, jobId: "", category: "", concurrency: 0 });
  sqlite.close();
});

test("the cloud pump runner reuses the browser retry controller and the worker route exposes it", async () => {
  const [runner, workerRoute, pkg] = await Promise.all([
    readFile(new URL("../tools/market-annotation-cloud-pump.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/annotations/worker/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(workerRoute, /action === "pump_cloud"/);
  assert.match(workerRoute, /authenticateLocalAgent/);
  assert.match(workerRoute, /runCloudAnnotationPump\(db, \{ jobId: jobId \|\| undefined \}\)/);
  assert.match(runner, /AnnotationRunRetryController/);
  assert.match(runner, /activeRequestCount >= retry\.workerLimit/);
  assert.match(runner, /Array\.from\(\{ length: MARKET_ANNOTATION_CONCURRENCY_LIMITS\.maximum \}/);
  assert.match(runner, /retry\.updateTarget\(Number\(next\)\)/);
  assert.match(runner, /Number\(next\) === retry\.targetConcurrency\) return/);
  assert.match(runner, /decision\.suppressedByGlobalRateLimit \|\| !decision\.countedIncident/);
  assert.match(runner, /decision\.shouldPause/);
  assert.match(runner, /后台泵停止续跑/);
  assert.match(runner, /TERUISI_ANNOTATION_AGENT_TOKEN/);
  assert.match(runner, /REQUEST_TIMEOUT_MS = 110_000/);
  for (const signal of ["SIGINT", "SIGTERM"]) assert.match(runner, new RegExp(signal));
  assert.match(pkg, /"market:annotation-cloud-pump": "node --import tsx tools\/market-annotation-cloud-pump\.ts"/);
});

test("create job always answers a click with one actionable blocking reason", async () => {
  const ui = await readFile(new URL("../app/market-annotation-view.tsx", import.meta.url), "utf8");
  assert.match(ui, /const createJobBlockReason = \(\) => \{/);
  assert.match(ui, /还没有已激活的 Prompt 版本/);
  assert.match(ui, /没有可用的云端视觉模型/);
  assert.match(ui, /const blocked = createJobBlockReason\(\);\n\s*if \(blocked\) throw new Error\(blocked\);/);
  assert.match(ui, /无法创建任务：\{createBlockReason\}/);
  assert.match(ui, /disabled=\{busy !== ""\} onClick=\{createJob\}/);
  assert.match(ui, /busy === "create-job" \? "创建任务中…"/);
  assert.doesNotMatch(ui, /disabled=\{!canEdit \|\| !activePrompt \|\| busy !== ""/);
  assert.match(ui, /defaultAnnotationPromptBody\(nextCategory, nextSegments\)/);
  const template = defaultAnnotationPromptBody("商用净饮水设备", ["商用直饮机", "净饮一体机"]);
  assert.match(template, /「商用净饮水设备」/);
  assert.match(template, /当前允许的细分品类：商用直饮机、净饮一体机。/);
  assert.match(defaultAnnotationPromptBody("", []), /该三级类目/);
  assert.match(defaultAnnotationPromptBody("", []), /尚未维护细分品类字典/);
});

test("prompt deletion is admin-audited, soft, and blocked after task use", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('draft-1','净水设备',1,'manual','draft','["RO净水机","其他"]','这是一个尚未激活且长度足够的测试 Prompt 正文，用于验证安全删除规则。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('job-1','净水设备','draft-1','cloud','queued',0,'admin@test');
  `);
  const db = sqliteAdapter(sqlite);
  await assert.rejects(() => deletePromptVersion(db, "draft-1", { email: "admin@test", role: "admin" }), /已被任务/);
  sqlite.prepare("DELETE FROM market_annotation_jobs WHERE id='job-1'").run();
  const deleted = await deletePromptVersion(db, "draft-1", { email: "admin@test", role: "admin" });
  assert.equal(deleted.version, 1);
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_prompt_versions WHERE id='draft-1'").get() as { status: string }).status, "deleted");
  const audit = sqlite.prepare("SELECT action, reason, actor FROM market_annotation_prompt_audits WHERE prompt_id='draft-1'").get() as { action: string; reason: string; actor: string };
  assert.deepEqual({ ...audit }, { action: "delete_draft", reason: "管理员删除未使用的 Prompt 草稿", actor: "admin@test" });
  await assert.rejects(() => deletePromptVersion(db, "draft-1", { email: "admin@test", role: "admin" }), /只能删除/);
  sqlite.close();
});

test("an unvalidated prompt activates only with an explicit audited admin reason", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec(`INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
    VALUES ('draft-activate','净水设备',1,'manual','draft','["RO净水机","其他"]','这是一个没有冻结验证结果、需要管理员显式确认后才能启用的测试 Prompt。','admin@test')`);
  const db = sqliteAdapter(sqlite);
  await assert.rejects(() => activatePromptVersion(db, { promptId: "draft-activate" }, { email: "admin@test", role: "admin" }), /尚未通过冻结样本门禁/);
  await activatePromptVersion(db, { promptId: "draft-activate", explicitOverride: true, reason: "管理员人工确认启用首个版本" }, { email: "admin@test", role: "admin" });
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_prompt_versions WHERE id='draft-activate'").get() as { status: string }).status, "active");
  const audit = sqlite.prepare("SELECT action, reason FROM market_annotation_prompt_audits WHERE prompt_id='draft-activate'").get() as { action: string; reason: string };
  assert.deepEqual({ ...audit }, { action: "activate_override", reason: "管理员人工确认启用首个版本" });
  sqlite.close();
});

test("stale prompt taxonomies cannot create jobs, reactivate, or commit old labels", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`DELETE FROM market_subcategory_taxonomy WHERE category='字典防线';
    INSERT INTO market_subcategory_taxonomy (id,category,subcategory,status,created_by,updated_by)
      VALUES ('taxonomy-current','字典防线','新标签','active','test','test');
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES
        ('stale-active','字典防线',1,'manual','active','["旧标签"]','这是一个已经落后于当前字典且正文长度足够的旧 Prompt。','admin@test'),
        ('stale-draft','字典防线',2,'manual','draft','["旧标签"]','这是另一个已经落后于当前字典且正文长度足够的旧 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,status,total_count,created_by)
      VALUES ('stale-job','字典防线','stale-active','cloud','review_ready',1,'admin@test');
    INSERT INTO market_annotation_items
      (id,job_id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,status,reviewed_segment,selected)
      VALUES ('stale-item','stale-job','字典防线','POP','STALE-SKU','SKU','2026-06','stale-hash','approved','旧标签',1);
    INSERT INTO market_price_snapshots (id,category,scope,sku_code,ranking_dimension,month,image_content_sha256)
      VALUES ('stale-snapshot','字典防线','POP','STALE-SKU','SKU','2026-06','stale-hash');`);

  await assert.rejects(() => createAnnotationJob(db, {
    category: "字典防线", promptVersionId: "stale-active", executor: "cloud", modelId: "missing-model", limit: 1,
  }, { email: "operator@test", role: "operator" }), /枚举已过期/);
  await assert.rejects(() => activatePromptVersion(db, {
    promptId: "stale-draft", explicitOverride: true, reason: "管理员尝试回滚旧枚举",
  }, { email: "admin@test", role: "admin" }), /枚举已过期/);
  await assert.rejects(() => commitAnnotationItems(db, {
    jobId: "stale-job", candidateIds: ["stale-item"], idempotencyKey: "stale-taxonomy-commit-001",
  }, { email: "admin@test", role: "admin" }), /不是当前细分品类字典/);
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_items WHERE id='stale-item'").get() as { status: string }).status, "approved");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_commit_receipts WHERE job_item_id='stale-item'").get() as { count: number }).count, 0);
  sqlite.close();
});

test("prompt activation transaction rejects a taxonomy changed after its initial check", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const base = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(base);
  await ensureAnnotationSchema(base);
  sqlite.exec(`DELETE FROM market_subcategory_taxonomy WHERE category='激活竞态';
    INSERT INTO market_subcategory_taxonomy (id,category,subcategory,status,sort_order,created_by,updated_by) VALUES
      ('activation-old-a','激活竞态','旧甲','active',0,'test','test'),
      ('activation-old-b','激活竞态','旧乙','active',1,'test','test');
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES ('activation-race-prompt','激活竞态',1,'manual','draft','["旧甲","旧乙"]','这是一个用于验证 Prompt 激活与字典重命名竞态的足够长正文。','admin@test');`);
  let changed = false;
  const db = sqliteAdapter(sqlite, { afterFirst: async (sql) => {
    if (!changed && sql.includes("market_annotation_validation_runs")) {
      changed = true;
      sqlite.exec(`UPDATE market_subcategory_taxonomy SET status='archived' WHERE id='activation-old-a';
        INSERT INTO market_subcategory_taxonomy (id,category,subcategory,status,sort_order,created_by,updated_by)
        VALUES ('activation-new','激活竞态','新甲','active',0,'other','other');`);
    }
  } });
  await assert.rejects(() => activatePromptVersion(db, {
    promptId: "activation-race-prompt", explicitOverride: true, reason: "管理员显式确认竞态测试",
  }, { email: "admin@test", role: "admin" }), /NOT NULL constraint failed/);
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_prompt_versions WHERE id='activation-race-prompt'").get() as { status: string }).status, "draft");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_prompt_audits WHERE prompt_id='activation-race-prompt'").get() as { count: number }).count, 0);
  sqlite.close();
});

test("annotation commit refuses a missing image-version snapshot before writing a receipt", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES ('missing-snapshot-prompt','无快照类目',1,'manual','active','["有效标签"]','这是一个用于验证缺失快照时禁止伪成功入库的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,status,total_count,created_by)
      VALUES ('missing-snapshot-job','无快照类目','missing-snapshot-prompt','cloud','review_ready',1,'admin@test');
    INSERT INTO market_annotation_items
      (id,job_id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,status,reviewed_segment,selected)
      VALUES ('missing-snapshot-item','missing-snapshot-job','无快照类目','POP','NO-SNAPSHOT','SKU','2026-06','missing-hash','approved','有效标签',1);`);
  await assert.rejects(() => commitAnnotationItems(db, {
    jobId: "missing-snapshot-job", candidateIds: ["missing-snapshot-item"], idempotencyKey: "missing-snapshot-commit-001",
  }, { email: "admin@test", role: "admin" }), /价格快照或图片版本已变化/);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_commit_receipts").get() as { count: number }).count, 0);
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_items WHERE id='missing-snapshot-item'").get() as { status: string }).status, "approved");
  sqlite.close();
});

test("expired local lease is reclaimable and its old token cannot overwrite the new claim", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) {
    sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-1','绞肉机',1,'manual','active','["台式","立式"]','这是一个足够长且用于测试本地租约回收的视觉分类 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, local_model_name, status, total_count, created_by)
      VALUES ('job-1','绞肉机','prompt-1','local','qwen-vl','queued',1,'admin@test');
    INSERT INTO market_annotation_items (id, job_id, sku_code, product_name, brand, source_image_url, status)
      VALUES ('item-1','job-1','SKU-1','台式绞肉机','品牌','https://img10.360buyimg.com/imgzone/jfs/t1/a.jpg','queued');
  `);
  const db = sqliteAdapter(sqlite);
  const first = await claimLocalAnnotation(db, { id: "agent-1" });
  assert.ok(first.task);
  assert.match(first.task!.leaseExpiresAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  sqlite.prepare("UPDATE market_annotation_items SET lease_expires_at=datetime('now','-1 minute') WHERE id='item-1'").run();
  const second = await claimLocalAnnotation(db, { id: "agent-1" });
  assert.ok(second.task);
  assert.notEqual(second.task!.leaseToken, first.task!.leaseToken);
  await assert.rejects(() => completeLocalAnnotation(db, { id: "agent-1" }, { itemId: "item-1", leaseToken: first.task!.leaseToken, result: { segment: "台式", image_price_cents: 19900, confidence: 0.9, reason: "测试" } }), /lease.*冲突/);
  await completeLocalAnnotation(db, { id: "agent-1" }, { itemId: "item-1", leaseToken: second.task!.leaseToken, result: { segment: "台式", image_price_cents: 19900, confidence: 0.9, reason: "测试" } });
  const row = sqlite.prepare("SELECT status, attempt_count attemptCount, lease_token_hash leaseTokenHash FROM market_annotation_items WHERE id='item-1'").get() as { status: string; attemptCount: number; leaseTokenHash: string };
  assert.deepEqual({ ...row }, { status: "review_pending", attemptCount: 2, leaseTokenHash: "" });
  sqlite.close();
});

test("local claims honor the remembered per-category concurrency cap", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES ('local-cap-prompt','本地并发类目',1,'manual','active','["型号A","其他"]','这是用于验证本地模型并发租约上限的正式 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,local_model_name,status,total_count,created_by)
      VALUES ('local-cap-job','本地并发类目','local-cap-prompt','local','qwen-vl','queued',2,'admin@test');
    INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by)
      VALUES ('本地并发类目','local',1,'admin@test');
    INSERT INTO market_annotation_items (id,job_id,category,sku_code,product_name,status) VALUES
      ('local-cap-one','local-cap-job','本地并发类目','SKU-L1','商品1','queued'),
      ('local-cap-two','local-cap-job','本地并发类目','SKU-L2','商品2','queued');
  `);
  const first = await claimLocalAnnotation(db, { id: "agent-one" });
  assert.equal(first.task?.inferenceConcurrency, 1);
  assert.equal(first.workerConcurrency, 1);
  const blocked = await claimLocalAnnotation(db, { id: "agent-two" });
  assert.equal(blocked.task, null);
  assert.equal((sqlite.prepare("SELECT attempt_count attempts FROM market_annotation_items WHERE id='local-cap-two'").get() as { attempts: number }).attempts, 0);
  sqlite.prepare("UPDATE market_annotation_concurrency_settings SET concurrency=2 WHERE category='本地并发类目' AND executor='local'").run();
  const second = await claimLocalAnnotation(db, { id: "agent-two" });
  assert.equal(second.task?.itemId, "local-cap-two");
  assert.equal(second.task?.inferenceConcurrency, 2);
  assert.equal(second.workerConcurrency, 2);
  sqlite.close();
});

test("validation run freezes full sample snapshots and hashes seed, model, and snapshot content", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec(`
    INSERT INTO ai_models VALUES ('vision-1','enabled','vision');
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('active-1','绞肉机',1,'manual','active','["台式","立式"]','这是当前激活的基线 Prompt，其正文长度满足创建和验证要求。','admin@test');
    INSERT INTO market_annotation_prompt_versions (id, category, version, parent_id, source, status, segments_json, prompt_body, created_by)
      VALUES ('candidate-2','绞肉机',2,'active-1','manual','draft','["台式","立式"]','这是待验证的候选 Prompt，其正文长度满足创建和验证要求。','admin@test');
  `);
  const insert = sqlite.prepare("INSERT INTO market_annotation_validation_samples (id, category, sku_code, product_name, brand, image_url, gold_segment, gold_image_price_cents, created_by) VALUES (?, '绞肉机', ?, ?, '品牌', ?, ?, ?, 'admin@test')");
  for (let index = 0; index < 50; index += 1) insert.run(`gold-${index}`, `SKU-${index}`, `商品-${index}`, `https://img10.360buyimg.com/imgzone/${index}.jpg`, index % 2 ? "立式" : "台式", 10_000 + index);
  const db = sqliteAdapter(sqlite);
  const first = await createValidationRun(db, { candidatePromptId: "candidate-2", modelId: "vision-1", sampleCount: 50, seed: "sealed-v1" }, { email: "operator@test", role: "operator" });
  const frozen = sqlite.prepare("SELECT sample_snapshot_json snapshot FROM market_annotation_validation_results WHERE run_id=? AND sample_id='gold-0' LIMIT 1").get(first.id) as { snapshot: string };
  const snapshot = JSON.parse(frozen.snapshot) as Record<string, unknown>;
  assert.deepEqual(snapshot, { id: "gold-0", skuCode: "SKU-0", productName: "商品-0", brand: "品牌", imageUrl: "https://img10.360buyimg.com/imgzone/0.jpg", goldSegment: "台式", goldImagePriceCents: 10000 });
  sqlite.prepare("UPDATE market_annotation_validation_samples SET gold_segment='立式', gold_image_price_cents=99999 WHERE id='gold-0'").run();
  assert.equal((JSON.parse(frozen.snapshot) as Record<string, unknown>).goldSegment, "台式");
  const second = await createValidationRun(db, { candidatePromptId: "candidate-2", modelId: "vision-1", sampleCount: 50, seed: "sealed-v1" }, { email: "operator@test", role: "operator" });
  assert.notEqual(first.sampleHash, second.sampleHash);
  sqlite.close();
});

test("stale cloud claims recover with CAS and stop after the third attempt", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec(`
    CREATE TABLE ai_models (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, model_type TEXT NOT NULL, model_name TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO ai_models VALUES ('vision-1','测试视觉','openai_compatible','vision','vision-test','https://api.example.com/v1','','enabled');
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-1','绞肉机',1,'manual','active','["台式","立式"]','这是用于测试云端任务超时回收与最大尝试次数的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, created_by)
      VALUES ('cloud-job','绞肉机','prompt-1','cloud','vision-1','running',1,'admin@test');
    INSERT INTO market_annotation_items (id, job_id, sku_code, product_name, status, lease_token_hash, lease_agent_id, lease_expires_at, attempt_count)
      VALUES ('cloud-item','cloud-job','SKU-C','云端测试','inferencing','old-token','cloud',datetime('now','-1 minute'),1);
  `);
  const db = sqliteAdapter(sqlite);
  await runNextCloudAnnotation(db, "cloud-job");
  let row = sqlite.prepare("SELECT status, attempt_count attemptCount, lease_token_hash leaseTokenHash FROM market_annotation_items WHERE id='cloud-item'").get() as { status: string; attemptCount: number; leaseTokenHash: string };
  assert.deepEqual({ ...row }, { status: "failed", attemptCount: 2, leaseTokenHash: "" });
  await runNextCloudAnnotation(db, "cloud-job");
  row = sqlite.prepare("SELECT status, attempt_count attemptCount, lease_token_hash leaseTokenHash FROM market_annotation_items WHERE id='cloud-item'").get() as typeof row;
  assert.deepEqual({ ...row }, { status: "failed", attemptCount: 3, leaseTokenHash: "" });
  const exhausted = await runNextCloudAnnotation(db, "cloud-job");
  assert.equal(exhausted.done, true);
  sqlite.close();
});

test("cloud annotation batches are bounded and refresh an empty job once", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('batch-prompt','批处理类目',1,'manual','active','["型号A","其他"]','这是用于验证云端图片识别批处理边界和最终状态刷新的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, created_by)
      VALUES ('batch-job','批处理类目','batch-prompt','cloud','vision-1','queued',0,'admin@test');
  `);
  const db = sqliteAdapter(sqlite);
  await assert.rejects(() => runCloudAnnotationBatch(db, "batch-job", 9), /limit 必须是 1 到 8/);
  const result = await runCloudAnnotationBatch(db, "batch-job", 4);
  assert.equal(result.done, true);
  assert.equal(result.processedCount, 0);
  assert.equal((sqlite.prepare("SELECT status FROM market_annotation_jobs WHERE id='batch-job'").get() as { status: string }).status, "review_ready");
  sqlite.close();
});

test("cloud annotation refuses a claim at the remembered category concurrency", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('concurrency-prompt','并发类目',1,'manual','active','["型号A","其他"]','这是用于验证同任务最多两个云端推理租约的正式 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, created_by)
      VALUES ('concurrency-job','并发类目','concurrency-prompt','cloud','vision-1','running',3,'admin@test');
    INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by)
      VALUES ('并发类目','cloud',2,'admin@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, status, lease_token_hash, lease_agent_id, lease_expires_at)
    VALUES
      ('active-one','concurrency-job','并发类目','pop','SKU-1','SKU','2026-01','hash-1','inferencing','lease-1','cloud',datetime('now','+2 minutes')),
      ('active-two','concurrency-job','并发类目','pop','SKU-2','SKU','2026-01','hash-2','inferencing','lease-2','cloud',datetime('now','+2 minutes')),
      ('queued-three','concurrency-job','并发类目','pop','SKU-3','SKU','2026-01','hash-3','queued','','',NULL);
  `);
  const result = await runNextCloudAnnotation(db, "concurrency-job");
  assert.equal(result.waiting, true);
  const queued = sqlite.prepare("SELECT status,attempt_count attempts FROM market_annotation_items WHERE id='queued-three'").get() as Record<string, unknown>;
  assert.deepEqual({ ...queued }, { status: "queued", attempts: 0 });
  sqlite.close();
});

test("expired validation claim at max attempts seals once and completed metrics are immutable", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0016_market_sku_annotations.sql", "../drizzle/0017_market_annotation_reliability.sql"]) sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('candidate','绞肉机',1,'manual','draft','["台式","立式"]','这是用于测试冻结验证完成后不可重算的候选 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_validation_runs (id, category, candidate_prompt_id, model_id, status, seed, requested_sample_count, sample_count, sample_hash, created_by)
      VALUES ('run-1','绞肉机','candidate','vision-1','running','seed',50,1,'hash','operator@test');
    INSERT INTO market_annotation_validation_results (id, run_id, sample_id, prompt_version_id, status, sample_snapshot_json, claim_token_hash, lease_expires_at, attempt_count, updated_at)
      VALUES ('result-1','run-1','gold-1','candidate','inferencing','{"id":"gold-1","skuCode":"SKU-1","productName":"商品","brand":"品牌","imageUrl":"","goldSegment":"台式","goldImagePriceCents":10000}','old',datetime('now','-1 minute'),3,CURRENT_TIMESTAMP);
  `);
  const db = sqliteAdapter(sqlite);
  const completed = await runNextValidation(db, "run-1");
  assert.equal(completed.done, true);
  const persisted = sqlite.prepare("SELECT metrics_json metrics, gate_json gate FROM market_annotation_validation_runs WHERE id='run-1'").get() as { metrics: string; gate: string };
  sqlite.prepare("UPDATE market_annotation_validation_results SET sample_snapshot_json='{}', predicted_segment='立式' WHERE id='result-1'").run();
  const repeated = await runNextValidation(db, "run-1");
  assert.equal(repeated.done, true);
  assert.equal(JSON.stringify(repeated.metrics), persisted.metrics);
  assert.equal(JSON.stringify(repeated.gate), persisted.gate);
  sqlite.close();
});

test("catalog pagination is strict and LIKE wildcards are bound as literals", async () => {
  await assert.rejects(() => searchAnnotationCatalog({} as MarketDatabase, { page: 1.5 }), /page 必须.*整数/);
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async first<T>() { observed.push({ sql, values }); return { total: 0 } as T; },
        async all<T>() { observed.push({ sql, values }); return { results: [] as T[] }; },
      };
    },
  } as unknown as MarketDatabase;
  await searchAnnotationCatalog(database, { q: "%_", page: 1, pageSize: 30 });
  assert.equal(observed.length, 1);
  assert.ok(observed.every((entry) => entry.sql.includes("ESCAPE '\\'")));
  assert.ok(observed.every((entry) => entry.values.slice(0, 5).every((value) => value === "%\\%\\_%")));
});

test("agent errors expose only fixed status classes and hide unknown internals", () => {
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("authentication")), { status: 401, error: "本地 agent 认证失败" });
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("bad_request")), { status: 400, error: "本地 agent 请求参数无效" });
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("lease_conflict")), { status: 409, error: "任务 lease 已失效或发生版本冲突，请重新领取" });
  assert.deepEqual(annotationAgentErrorResponse(new Error("D1_ERROR: no such table secret")), { status: 500, error: "本地 agent 服务暂时不可用" });
});

test("runtime schema upgrades an existing 0016 database before creating new-column indexes", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0016_market_sku_annotations.sql", import.meta.url), "utf8"));
  const firstConnection = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(firstConnection);

  const columnNames = (table: string) => new Set((sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name));
  assert.deepEqual([...columnNames("market_annotation_jobs")].filter((name) => name.startsWith("commit_")), ["commit_token_hash", "commit_started_at"]);
  for (const column of ["work_key", "reuse_status", "reuse_started_at"]) assert.ok(columnNames("market_annotation_jobs").has(column));
  assert.ok(columnNames("market_annotation_commit_receipts").has("batch_id"));
  assert.ok(columnNames("market_annotation_commit_receipts").has("request_digest"));
  for (const column of ["sample_snapshot_json", "claim_token_hash", "lease_expires_at", "attempt_count", "updated_at"]) assert.ok(columnNames("market_annotation_validation_results").has(column));
  for (const column of ["category", "ranking_dimension", "month", "image_content_sha256", "ai_price_type", "ai_price_low_cents", "ai_price_high_cents", "reviewed_price_type", "reviewed_price_low_cents", "reviewed_price_high_cents"]) assert.ok(columnNames("market_annotation_items").has(column));

  const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((row) => row.name));
  assert.ok(indexes.has("market_annotation_commits_batch_idx"));
  assert.ok(indexes.has("market_annotation_validation_result_lease_idx"));
  assert.ok(indexes.has("market_annotation_items_job_snapshot_uq"));
  assert.ok(indexes.has("market_annotation_items_reuse_idx"));
  assert.ok(indexes.has("market_annotation_items_segment_reuse_idx"));
  assert.ok(indexes.has("market_annotation_items_job_inference_unit_idx"));
  assert.ok(indexes.has("market_annotation_jobs_active_work_uq"));
  assert.ok(indexes.has("market_annotation_concurrency_settings_updated_idx"));
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_annotation_prompt_audits'").get());
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_annotation_concurrency_settings'").get());

  // A distinct runtime connection must also be safe after the first upgrade.
  await ensureAnnotationSchema(sqliteAdapter(sqlite));
  sqlite.close();
});

test("0053 installs the bounded SKU classification reuse index idempotently", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE market_annotation_items (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, scope TEXT NOT NULL, sku_code TEXT NOT NULL,
    ranking_dimension TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const migration = await readFile(new URL("../drizzle/0053_market_annotation_segment_reuse.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.exec(migration);
  const columns = (sqlite.prepare("PRAGMA index_info('market_annotation_items_segment_reuse_idx')").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(columns, ["category", "scope", "sku_code", "ranking_dimension", "status", "updated_at"]);
  sqlite.close();
});

test("0054 installs bounded per-category annotation concurrency settings idempotently", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../drizzle/0054_market_annotation_concurrency_settings.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.exec(migration);
  sqlite.prepare("INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by) VALUES ('类目','cloud',50,'admin')").run();
  assert.throws(() => sqlite.prepare("INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by) VALUES ('越界','cloud',51,'admin')").run(), /CHECK constraint/);
  assert.throws(() => sqlite.prepare("INSERT INTO market_annotation_concurrency_settings (category,executor,concurrency,updated_by) VALUES ('执行器','remote',1,'admin')").run(), /CHECK constraint/);
  sqlite.close();
});

test("0055 adds active-job idempotency and inference-unit indexes without rewriting legacy jobs", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0016_market_sku_annotations.sql", import.meta.url), "utf8"));
  sqlite.exec(`ALTER TABLE market_annotation_items ADD COLUMN category TEXT NOT NULL DEFAULT '';
    ALTER TABLE market_annotation_items ADD COLUMN scope TEXT NOT NULL DEFAULT '';
    ALTER TABLE market_annotation_items ADD COLUMN ranking_dimension TEXT NOT NULL DEFAULT 'SKU';
    ALTER TABLE market_annotation_items ADD COLUMN image_content_sha256 TEXT NOT NULL DEFAULT '';`);
  sqlite.exec("INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,status,created_by) VALUES ('legacy-job','类目','prompt','cloud','running','admin')");
  const migration = await readFile(new URL("../drizzle/0055_market_annotation_throughput.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) sqlite.exec(statement);
  const legacy = sqlite.prepare("SELECT work_key workKey,reuse_status reuseStatus FROM market_annotation_jobs WHERE id='legacy-job'").get() as Record<string, unknown>;
  assert.deepEqual({ ...legacy }, { workKey: "", reuseStatus: "pending" });
  const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((row) => row.name));
  assert.ok(indexes.has("market_annotation_jobs_active_work_uq"));
  assert.ok(indexes.has("market_annotation_items_job_inference_unit_idx"));
  sqlite.close();
});

test("market annotation commit directly inherits standard prices across matching SKU-image months only", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-1','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-1','净水',1,'manual','active','["台式","立式"]','这是用于测试月度价格识别的正式 Prompt，正文长度满足校验要求。','admin@test');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, image_url, raw_json, last_import_batch_id)
    VALUES
      ('jan',1,'2026-01-01','2026-01-31','净水','pop','SKU','POP','SKU-1','商品','品牌',100000,1,1,'https://img10.360buyimg.com/imgzone/a.jpg','{}','batch'),
      ('feb',2,'2026-02-01','2026-02-28','净水','pop','SKU','POP','SKU-1','商品','品牌',100000,1,1,'https://img10.360buyimg.com/imgzone/a.jpg','{}','batch'),
      ('mar',3,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-1','商品','品牌',100000,1,1,'https://img10.360buyimg.com/imgzone/b.jpg','{}','batch');
    INSERT INTO market_image_cache (source_url,status,content_sha256) VALUES
      ('https://img10.360buyimg.com/imgzone/a.jpg','ready','hash-a'),
      ('https://img10.360buyimg.com/imgzone/b.jpg','ready','hash-b');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status)
    VALUES
      ('ps-jan','净水','pop','SKU-1','SKU','2026-01','hash-a','https://img10.360buyimg.com/imgzone/a.jpg','missing'),
      ('ps-feb','净水','pop','SKU-1','SKU','2026-02','hash-a','https://img10.360buyimg.com/imgzone/a.jpg','missing'),
      ('ps-mar','净水','pop','SKU-1','SKU','2026-03','hash-b','https://img10.360buyimg.com/imgzone/b.jpg','missing');
  `);
  const job = await createAnnotationJob(db, { category: "净水", promptVersionId: "prompt-1", executor: "cloud", modelId: "vision-1", limit: 10 }, { email: "operator@test", role: "operator" });
  const items = sqlite.prepare("SELECT id, month, image_content_sha256 hash FROM market_annotation_items WHERE job_id=? ORDER BY month").all(job.id) as Array<{ id: string; month: string; hash: string }>;
  assert.deepEqual(items.map((item) => ({ month: item.month, hash: item.hash })), [
    { month: "2026-01", hash: "hash-a" },
    { month: "2026-02", hash: "hash-a" },
    { month: "2026-03", hash: "hash-b" },
  ]);
  sqlite.prepare("UPDATE market_annotation_items SET status='approved', selected=1, reviewed_segment='台式', reviewed_image_price_cents=199900, reviewed_price_type='标准售价', reviewed_price_low_cents=199900, reviewed_price_high_cents=199900, ai_image_price_cents=199900, ai_price_type='标准售价', ai_confidence_bps=9000, ai_reason='主图', image_source='imgzone', resolved_image_url=source_image_url WHERE id=?").run(items[1]!.id);
  sqlite.prepare("UPDATE market_annotation_jobs SET status='review_ready' WHERE id=?").run(job.id);
  await commitAnnotationItems(db, { jobId: job.id, candidateIds: [items[1]!.id], idempotencyKey: "monthly-price-commit-001" }, { email: "admin@test", role: "admin" });
  const snapshots = sqlite.prepare("SELECT month, confirmed_market_price_cents price, confirmation_status status FROM market_price_snapshots ORDER BY month").all() as Array<{ month: string; price: number | null; status: string }>;
  assert.deepEqual(snapshots.map((row) => ({ ...row })), [
    { month: "2026-01", price: 199900, status: "confirmed" },
    { month: "2026-02", price: 199900, status: "confirmed" },
    { month: "2026-03", price: null, status: "missing" },
  ]);
  sqlite.close();
});

test("new annotation jobs reuse same-image prices and mark changed images for price-only recognition", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-1','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-1','净水',1,'manual','active','["台式","立式"]','这是用于测试历史同图价格复用的正式 Prompt，正文长度满足校验要求。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, completed_count, reviewed_count, committed_count, created_by)
      VALUES ('old-job','净水','prompt-1','cloud','committed',1,1,1,1,'admin@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, source_image_url,
       resolved_image_url, image_source, status, reviewed_segment, reviewed_image_price_cents, reviewed_price_type, reviewed_by)
      VALUES ('old-item','old-job','净水','pop','SKU-1','SKU','2026-01','hash-a','历史商品','https://img10.360buyimg.com/imgzone/a.jpg',
       'https://img10.360buyimg.com/imgzone/a.jpg','imgzone','committed','台式',199900,'标准售价','admin@test');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, image_url, raw_json, last_import_batch_id)
    VALUES
      ('feb',1,'2026-02-01','2026-02-28','净水','pop','SKU','POP','SKU-1','同图商品','品牌',100000,1,1,'https://img10.360buyimg.com/imgzone/a.jpg','{}','batch'),
      ('mar',2,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-1','新图商品','品牌',100000,1,1,'https://img10.360buyimg.com/imgzone/b.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, ai_price_type,
       confirmed_market_price_cents, price_low_cents, price_high_cents, confirmation_status, confirmed_at, source_job_item_id)
    VALUES
      ('ps-jan','净水','pop','SKU-1','SKU','2026-01','hash-a','https://img10.360buyimg.com/imgzone/a.jpg','标准售价',199900,199900,199900,'confirmed','2026-02-01 00:00:00','old-item'),
      ('ps-feb','净水','pop','SKU-1','SKU','2026-02','hash-a','https://img10.360buyimg.com/imgzone/a.jpg','',NULL,NULL,NULL,'missing',NULL,''),
      ('ps-mar','净水','pop','SKU-1','SKU','2026-03','hash-b','https://img10.360buyimg.com/imgzone/b.jpg','',NULL,NULL,NULL,'missing',NULL,'');
  `);

  const job = await createAnnotationJob(db, { category: "净水", promptVersionId: "prompt-1", executor: "cloud", modelId: "vision-1", limit: 10 }, { email: "operator@test", role: "operator" });
  const items = sqlite.prepare(`SELECT month, status, reviewed_segment segment, reviewed_image_price_cents price,
    reviewed_price_type price_type, reviewed_by reviewer, ai_image_price_cents ai_price, image_source
    FROM market_annotation_items WHERE job_id=? ORDER BY month`).all(job.id) as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((row) => ({ ...row })), [
    { month: "2026-03", status: "queued", segment: "台式", price: null, price_type: "", reviewer: "system:history_same_sku_segment", ai_price: null, image_source: "none" },
  ]);
  const inherited = sqlite.prepare(`SELECT confirmed_market_price_cents price, ai_price_type priceType,
    confirmation_status status, confirmed_by confirmedBy FROM market_price_snapshots WHERE id='ps-feb'`).get() as Record<string, unknown>;
  assert.deepEqual({ ...inherited }, { price: 199900, priceType: "标准售价", status: "confirmed", confirmedBy: "system:history_same_image" });
  assert.equal(job.totalCount, 1);
  assert.equal(job.completedCount, 0);
  assert.equal(job.status, "running");
  sqlite.close();
});

test("price recognition resumes the compatible unfinished job instead of creating duplicates", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-resume','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('resume-prompt','净水',1,'manual','active','["台式","立式"]','这是用于验证价格识别超时后续跑原任务且不重复创建的正式 Prompt。','admin@test');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, image_url, raw_json, last_import_batch_id)
      VALUES ('resume-ranking',1,'2026-04-01','2026-04-30','净水','pop','SKU','POP','SKU-RESUME','续跑商品','https://img10.360buyimg.com/imgzone/resume.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status)
      VALUES ('resume-snapshot','净水','pop','SKU-RESUME','SKU','2026-04','resume-hash','https://img10.360buyimg.com/imgzone/resume.jpg','missing');
  `);

  const first = await createPriceRecognitionJob(db, { category: "净水", modelId: "vision-resume", limit: 100 }, { email: "operator@test", role: "operator" });
  sqlite.prepare("UPDATE market_annotation_items SET status='failed',attempt_count=1,error_message='模型调用超时' WHERE job_id=?").run(first.id);
  sqlite.prepare("UPDATE market_annotation_jobs SET status='failed' WHERE id=?").run(first.id);
  const resumed = await createPriceRecognitionJob(db, { category: "净水", modelId: "vision-resume", limit: 100 }, { email: "operator@test", role: "operator" });
  assert.equal(resumed.id, first.id);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_jobs WHERE category='净水'").get() as { count: number }).count, 1);

  sqlite.prepare("UPDATE market_annotation_items SET status='review_pending',ai_segment='台式',ai_image_price_cents=19900 WHERE job_id=?").run(first.id);
  sqlite.prepare("UPDATE market_annotation_jobs SET status='review_ready' WHERE id=?").run(first.id);
  const reviewResume = await createPriceRecognitionJob(db, { category: "净水", modelId: "vision-resume", limit: 100 }, { email: "operator@test", role: "operator" });
  assert.equal(reviewResume.id, first.id);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_items WHERE job_id=?").get(first.id) as { count: number }).count, 1);
  const completed = sqlite.prepare("SELECT status,ai_image_price_cents price FROM market_annotation_items WHERE job_id=?").get(first.id) as Record<string, unknown>;
  assert.deepEqual({ ...completed }, { status: "review_pending", price: 19900 });
  sqlite.close();
});

test("compatible general job creation is idempotent across concurrent callers", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-idempotent','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES ('prompt-idempotent','净水',1,'manual','active','["台式","立式"]','这是用于验证并发创建只保留一个兼容任务的正式 Prompt。','admin@test');
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,image_url,raw_json,last_import_batch_id)
      VALUES ('idempotent-ranking',1,'2026-05-01','2026-05-31','净水','pop','SKU','POP','SKU-IDEMPOTENT','幂等商品','https://img10.360buyimg.com/imgzone/idempotent.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,image_url,confirmation_status)
      VALUES ('idempotent-snapshot','净水','pop','SKU-IDEMPOTENT','SKU','2026-05','idempotent-hash','https://img10.360buyimg.com/imgzone/idempotent.jpg','missing');
  `);
  const actor = { email: "operator@test", role: "operator" };
  const input = { category: "净水", promptVersionId: "prompt-idempotent", executor: "cloud", modelId: "vision-idempotent", limit: 10 } as const;
  const [first, second] = await Promise.all([createAnnotationJob(db, input, actor), createAnnotationJob(db, input, actor)]);
  assert.equal(first.id, second.id);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_annotation_jobs").get() as { count: number }).count, 1);
  assert.notEqual((sqlite.prepare("SELECT work_key workKey FROM market_annotation_jobs").get() as { workKey: string }).workKey, "");
  sqlite.close();
});

test("price-only classification reuse never crosses scope or ranking dimension and ignores stale segments", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-1','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-isolation','净水',1,'manual','active','["台式","立式"]','这是用于验证历史分类复用范围隔离和失效分类拦截的正式 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('history-isolation','净水','prompt-isolation','local','committed',3,'admin@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, status, reviewed_segment, reviewed_by, reviewed_at)
    VALUES
      ('history-wrong-scope','history-isolation','净水','self','SKU-SCOPE','SKU','2026-01','old-scope','committed','台式','admin@test','2026-02-01'),
      ('history-wrong-dimension','history-isolation','净水','pop','SKU-DIM','SPU','2026-01','old-dim','committed','台式','admin@test','2026-02-01'),
      ('history-stale-segment','history-isolation','净水','pop','SKU-STALE','SKU','2026-01','old-stale','committed','已停用品类','admin@test','2026-02-01');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, image_url, raw_json, last_import_batch_id)
    VALUES
      ('scope-target',1,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-SCOPE','范围隔离','https://img10.360buyimg.com/imgzone/scope.jpg','{}','batch'),
      ('dimension-target',2,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-DIM','维度隔离','https://img10.360buyimg.com/imgzone/dim.jpg','{}','batch'),
      ('stale-target',3,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-STALE','失效分类','https://img10.360buyimg.com/imgzone/stale.jpg','{}','batch'),
      ('new-target',4,'2026-03-01','2026-03-31','净水','pop','SKU','POP','SKU-NEW','全新商品','https://img10.360buyimg.com/imgzone/new.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status)
    VALUES
      ('scope-snapshot','净水','pop','SKU-SCOPE','SKU','2026-03','new-scope','https://img10.360buyimg.com/imgzone/scope.jpg','missing'),
      ('dimension-snapshot','净水','pop','SKU-DIM','SKU','2026-03','new-dim','https://img10.360buyimg.com/imgzone/dim.jpg','missing'),
      ('stale-snapshot','净水','pop','SKU-STALE','SKU','2026-03','new-stale','https://img10.360buyimg.com/imgzone/stale.jpg','missing'),
      ('new-snapshot','净水','pop','SKU-NEW','SKU','2026-03','new-sku','https://img10.360buyimg.com/imgzone/new.jpg','missing');
  `);

  const job = await createAnnotationJob(db, { category: "净水", promptVersionId: "prompt-isolation", executor: "cloud", modelId: "vision-1", limit: 10 }, { email: "operator@test", role: "operator" });
  const items = sqlite.prepare("SELECT sku_code skuCode,reviewed_segment segment,reviewed_by reviewer,status FROM market_annotation_items WHERE job_id=? ORDER BY sku_code").all(job.id) as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((row) => ({ ...row })), [
    { skuCode: "SKU-DIM", segment: "", reviewer: "", status: "queued" },
    { skuCode: "SKU-NEW", segment: "", reviewer: "", status: "queued" },
    { skuCode: "SKU-SCOPE", segment: "", reviewer: "", status: "queued" },
    { skuCode: "SKU-STALE", segment: "", reviewer: "", status: "queued" },
  ]);
  sqlite.close();
});

test("local price-only tasks expose one fixed segment and reject classification drift", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('local-price-prompt','净水',1,'manual','active','["台式","立式"]','这是用于验证本地价格专用任务固定历史分类的正式 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, local_model_name, status, total_count, created_by)
      VALUES ('local-price-job','净水','local-price-prompt','local','qwen-vision','running',1,'admin@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, source_image_url, status, reviewed_segment, reviewed_by)
      VALUES ('local-price-item','local-price-job','净水','pop','SKU-LOCAL','SKU','2026-03','new-local','本地价格识别','https://img10.360buyimg.com/imgzone/local.jpg','queued','台式','system:history_same_sku_segment');
  `);

  const claimed = await claimLocalAnnotation(db, { id: "agent-price" });
  assert.equal(claimed.task?.recognitionMode, "price_only");
  assert.equal(claimed.task?.fixedSegment, "台式");
  assert.deepEqual(claimed.task?.segments, ["台式"]);
  assert.match(claimed.task?.promptBody ?? "", /不要重新分类，只识别当前新主图价格/);
  await assert.rejects(() => completeLocalAnnotation(db, { id: "agent-price" }, {
    itemId: "local-price-item", leaseToken: claimed.task!.leaseToken,
    result: { segment: "立式", image_price_cents: 19900, price_type: "标准售价", price_low_cents: 19900, price_high_cents: 19900, confidence: 0.9, reason: "错误改分类" },
  }), /请求参数无效/);
  sqlite.close();
});

test("one local inference fans out to every same-image month without another claim", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
      VALUES ('fanout-prompt','净水',1,'manual','active','["台式","立式"]','这是用于验证同图跨月份只执行一次本地推理的正式 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,local_model_name,reuse_status,status,total_count,created_by)
      VALUES ('fanout-job','净水','fanout-prompt','local','qwen-vl','ready','queued',2,'admin@test');
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,image_url,raw_json,last_import_batch_id)
      VALUES
      ('fanout-june',1,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-FANOUT','同图商品','https://img10.360buyimg.com/imgzone/fanout.jpg','{}','batch'),
      ('fanout-july',2,'2026-07-01','2026-07-31','净水','pop','SKU','POP','SKU-FANOUT','同图商品','https://img10.360buyimg.com/imgzone/fanout.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,image_url,confirmation_status)
      VALUES
      ('fanout-ps-june','净水','pop','SKU-FANOUT','SKU','2026-06','fanout-hash','https://img10.360buyimg.com/imgzone/fanout.jpg','missing'),
      ('fanout-ps-july','净水','pop','SKU-FANOUT','SKU','2026-07','fanout-hash','https://img10.360buyimg.com/imgzone/fanout.jpg','missing');
    INSERT INTO market_annotation_items
      (id,job_id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,product_name,source_image_url,status)
      VALUES
      ('fanout-a','fanout-job','净水','pop','SKU-FANOUT','SKU','2026-06','fanout-hash','同图商品','https://img10.360buyimg.com/imgzone/fanout.jpg','queued'),
      ('fanout-b','fanout-job','净水','pop','SKU-FANOUT','SKU','2026-07','fanout-hash','同图商品','https://img10.360buyimg.com/imgzone/fanout.jpg','queued');
  `);
  const claim = await claimLocalAnnotation(db, { id: "agent-fanout" });
  assert.equal(claim.task?.itemId, "fanout-a");
  const completed = await completeLocalAnnotation(db, { id: "agent-fanout" }, {
    itemId: "fanout-a", leaseToken: claim.task!.leaseToken,
    result: { segment: "台式", image_price_cents: 288800, price_type: "标准售价", price_low_cents: 288800, price_high_cents: 288800, confidence: 0.93, reason: "同一主图" },
  });
  assert.equal(completed.reusedCount, 1);
  const items = sqlite.prepare("SELECT month,status,ai_image_price_cents price,attempt_count attempts FROM market_annotation_items WHERE job_id='fanout-job' ORDER BY month").all() as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((row) => ({ ...row })), [
    { month: "2026-06", status: "review_pending", price: 288800, attempts: 1 },
    { month: "2026-07", status: "review_pending", price: 288800, attempts: 0 },
  ]);
  const snapshots = sqlite.prepare("SELECT month,confirmation_status status,ai_image_price_cents price FROM market_price_snapshots WHERE sku_code='SKU-FANOUT' ORDER BY month").all() as Array<Record<string, unknown>>;
  assert.deepEqual(snapshots.map((row) => ({ ...row })), [
    { month: "2026-06", status: "ai_pending", price: 288800 },
    { month: "2026-07", status: "ai_pending", price: 288800 },
  ]);
  assert.equal((await claimLocalAnnotation(db, { id: "agent-fanout" })).task, null);
  const progress = await getAnnotationJobProgress(db, "fanout-job");
  assert.deepEqual({ active: progress.activeClaims, units: progress.uniqueInferenceUnits, remaining: progress.remainingInferenceUnits }, { active: 0, units: 1, remaining: 0 });
  sqlite.close();
});

test("cloud annotation reuses exact same-image results for the same prompt and model without another model call", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec("CREATE TABLE ai_models (id TEXT PRIMARY KEY, status TEXT NOT NULL, model_type TEXT NOT NULL)");
  sqlite.exec("INSERT INTO ai_models VALUES ('vision-1','enabled','vision')");
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-reuse','净水',1,'manual','active','["台式","立式"]','这是用于验证同图同模型结果复用且不会重复调用模型的正式 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, completed_count, created_by)
      VALUES ('history-job','净水','prompt-reuse','cloud','vision-1','review_ready',1,1,'operator@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name,
       source_image_url, resolved_image_url, image_source, status, ai_segment, ai_image_price_cents, ai_price_type,
       ai_price_low_cents, ai_price_high_cents, ai_confidence_bps, ai_reason, ai_raw_digest,
       reviewed_segment, reviewed_image_price_cents, reviewed_price_type)
      VALUES ('history-ai','history-job','净水','pop','SKU-REUSE','SKU','2026-01','hash-reuse','历史商品',
       'https://img10.360buyimg.com/imgzone/reuse.jpg','https://img10.360buyimg.com/imgzone/reuse.jpg','imgzone','review_pending',
       '台式',288800,'标准售价',288800,288800,9300,'同图识别结果','digest-reuse','台式',288800,'标准售价');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode,
       sku_code, product_name, brand, gmv_cents, quantity, visitors, image_url, raw_json, last_import_batch_id)
      VALUES ('reuse-feb',1,'2026-02-01','2026-02-28','净水','pop','SKU','POP','SKU-REUSE','新月份同图商品','品牌',
       100000,1,1,'https://img10.360buyimg.com/imgzone/reuse.jpg','{}','batch');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status)
      VALUES ('reuse-snapshot','净水','pop','SKU-REUSE','SKU','2026-02','hash-reuse','https://img10.360buyimg.com/imgzone/reuse.jpg','missing');
  `);

  const created = await createAnnotationJob(db, { category: "净水", promptVersionId: "prompt-reuse", executor: "cloud", modelId: "vision-1", limit: 10 }, { email: "operator@test", role: "operator" });
  const createdItem = sqlite.prepare("SELECT status,ai_segment segment,ai_image_price_cents price,attempt_count attempts FROM market_annotation_items WHERE job_id=?").get(created.id) as Record<string, unknown>;
  assert.deepEqual({ ...createdItem }, { status: "review_pending", segment: "台式", price: 288800, attempts: 0 });
  assert.equal(created.completedCount, 1);

  sqlite.exec(`
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, model_id, status, total_count, created_by)
      VALUES ('queued-reuse-job','净水','prompt-reuse','cloud','vision-1','running',1,'operator@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, source_image_url, status)
      VALUES ('queued-reuse-item','queued-reuse-job','净水','pop','SKU-REUSE','SKU','2026-02','hash-reuse','待复用商品','https://img10.360buyimg.com/imgzone/reuse.jpg','queued');
  `);
  const resumed = await runNextCloudAnnotation(db, "queued-reuse-job");
  assert.equal("reusedCount" in resumed ? resumed.reusedCount : 0, 1);
  const resumedItem = sqlite.prepare("SELECT status,ai_segment segment,ai_image_price_cents price,attempt_count attempts FROM market_annotation_items WHERE id='queued-reuse-item'").get() as Record<string, unknown>;
  assert.deepEqual({ ...resumedItem }, { status: "review_pending", segment: "台式", price: 288800, attempts: 0 });

  sqlite.exec(`
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,model_id,reuse_status,status,total_count,completed_count,created_by)
      VALUES ('same-job-reuse','净水','prompt-reuse','cloud','vision-1','pending','running',2,1,'operator@test');
    INSERT INTO market_annotation_items
      (id,job_id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,source_image_url,status,
       ai_segment,ai_image_price_cents,ai_price_type,ai_confidence_bps,ai_reason,ai_raw_digest,reviewed_segment,reviewed_image_price_cents)
      VALUES
      ('same-job-a','same-job-reuse','净水','pop','SKU-SAME-JOB','SKU','2026-03','same-job-hash','https://img10.360buyimg.com/imgzone/same.jpg','review_pending','立式',399900,'标准售价',9200,'同任务结果','same-digest','立式',399900),
      ('same-job-b','same-job-reuse','净水','pop','SKU-SAME-JOB','SKU','2026-04','same-job-hash','https://img10.360buyimg.com/imgzone/same.jpg','queued','',NULL,'',NULL,'','','',NULL);
    INSERT INTO market_price_snapshots
      (id,category,scope,sku_code,ranking_dimension,month,image_content_sha256,image_url,confirmation_status)
      VALUES ('same-job-snapshot','净水','pop','SKU-SAME-JOB','SKU','2026-04','same-job-hash','https://img10.360buyimg.com/imgzone/same.jpg','missing');
  `);
  const sameJob = await runNextCloudAnnotation(db, "same-job-reuse");
  assert.equal("reusedCount" in sameJob ? sameJob.reusedCount : 0, 1);
  const sameJobItem = sqlite.prepare("SELECT status,ai_segment segment,ai_image_price_cents price,attempt_count attempts FROM market_annotation_items WHERE id='same-job-b'").get() as Record<string, unknown>;
  assert.deepEqual({ ...sameJobItem }, { status: "review_pending", segment: "立式", price: 399900, attempts: 0 });
  sqlite.close();
});

test("deposit and installment annotation commits do not create official market prices", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('prompt-1','净水',1,'manual','active','["台式","立式"]','这是用于测试定金和分期金额不形成正式价格的 Prompt。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('job-1','净水','prompt-1','local','review_ready',1,'operator@test');
    INSERT INTO market_price_snapshots (id, category, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status)
      VALUES ('ps-1','净水','SKU-1','SKU','2026-02','hash-a','https://img10.360buyimg.com/imgzone/a.jpg','missing');
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
      VALUES ('deposit-ranking',1,'2026-02-01','2026-02-28','净水','','SKU','POP','SKU-1','商品','{}','batch');
    INSERT INTO market_annotation_items
      (id, job_id, category, sku_code, ranking_dimension, month, image_content_sha256, product_name, brand, source_image_url, status, selected, reviewed_segment, reviewed_image_price_cents, reviewed_price_type, ai_image_price_cents, ai_price_type, ai_confidence_bps, ai_reason)
    VALUES
      ('item-1','job-1','净水','SKU-1','SKU','2026-02','hash-a','商品','品牌','https://img10.360buyimg.com/imgzone/a.jpg','approved',1,'台式',9900,'定金',9900,'定金',8800,'只看到定金');
  `);
  await commitAnnotationItems(db, { jobId: "job-1", candidateIds: ["item-1"], idempotencyKey: "deposit-price-001" }, { email: "admin@test", role: "admin" });
  const row = sqlite.prepare("SELECT confirmed_market_price_cents price, ai_price_type aiType, confirmation_status status FROM market_price_snapshots WHERE id='ps-1'").get() as { price: number | null; aiType: string; status: string };
  assert.deepEqual({ ...row }, { price: null, aiType: "定金", status: "review_pending" });
  sqlite.close();
});

test("runtime schema shares concurrent initialization for one connection", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const baseConnection = sqliteAdapter(sqlite);
  let batchCalls = 0;
  const countingConnection = {
    prepare: (sql: string) => baseConnection.prepare(sql),
    batch: async (statements: Parameters<MarketDatabase["batch"]>[0]) => {
      batchCalls += 1;
      return baseConnection.batch(statements);
    },
  } as MarketDatabase;

  await Promise.all([ensureAnnotationSchema(countingConnection), ensureAnnotationSchema(countingConnection)]);
  assert.equal(batchCalls, 2);
  sqlite.close();
});

test("annotation review filters AI sources and selects the filtered result across pages", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('selection-prompt','净水',1,'manual','active','["台式","立式"]','这是用于验证筛选来源和跨页全选功能的测试 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('selection-job','净水','selection-prompt','local','review_ready',3,'operator@test');
    INSERT INTO market_annotation_items
      (id, job_id, category, sku_code, product_name, status, reviewed_segment, ai_segment, ai_image_price_cents, ai_confidence_bps, ai_reason)
    VALUES
      ('selection-ai-1','selection-job','净水','AI-1','AI 商品 1','review_pending','台式','台式',19900,9000,'主图识别'),
      ('selection-ai-2','selection-job','净水','AI-2','AI 商品 2','review_pending','立式','立式',29900,8500,'主图识别'),
      ('selection-manual','selection-job','净水','MANUAL-1','人工商品','review_pending','台式','',NULL,NULL,'');
  `);
  const ai = await setFilteredAnnotationSelection(db, { jobId: "selection-job", selected: true, recognitionSource: "ai" }, { email: "operator@test", role: "operator" });
  assert.equal(ai.changed, 2);
  assert.deepEqual((sqlite.prepare("SELECT id FROM market_annotation_items WHERE selected=1 ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id), ["selection-ai-1", "selection-ai-2"]);
  const nonAi = await setFilteredAnnotationSelection(db, { jobId: "selection-job", selected: true, recognitionSource: "non_ai" }, { email: "operator@test", role: "operator" });
  assert.equal(nonAi.changed, 1);
  assert.equal((sqlite.prepare("SELECT selected FROM market_annotation_items WHERE id='selection-manual'").get() as { selected: number }).selected, 1);
  await setFilteredAnnotationSelection(db, { jobId: "selection-job", selected: false, recognitionSource: "ai" }, { email: "operator@test", role: "operator" });
  assert.deepEqual((sqlite.prepare("SELECT id FROM market_annotation_items WHERE selected=1 ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id), ["selection-manual"]);
  sqlite.close();
});

test("review selection safely rebases a stale version when review content is unchanged", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('rebase-prompt','并发复核',1,'manual','active','["类型甲","类型乙"]','这是用于验证选择状态并发重放不会覆盖复核内容的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('rebase-job','并发复核','rebase-prompt','local','review_ready',1,'operator@test');
    INSERT INTO market_annotation_items (id, job_id, category, sku_code, product_name, status, reviewed_segment, reviewed_image_price_cents, reviewed_price_low_cents, reviewed_price_high_cents)
      VALUES ('rebase-item','rebase-job','并发复核','REBASE-1','并发商品','review_pending','类型甲',19900,18900,20900);
  `);
  const initial = sqlite.prepare("SELECT version FROM market_annotation_items WHERE id='rebase-item'").get() as { version: number };
  sqlite.prepare("UPDATE market_annotation_items SET selected=0, version=version+1 WHERE id='rebase-item'").run();

  const rebased = await updateAnnotationItems(db, "rebase-job", [{ id: "rebase-item", version: initial.version, segment: "类型甲", imagePriceCents: 19900, selected: true }], { email: "operator@test", role: "operator" });
  assert.equal(rebased.changed, 1);
  const saved = sqlite.prepare("SELECT selected, status, version, reviewed_price_low_cents lowPrice, reviewed_price_high_cents highPrice FROM market_annotation_items WHERE id='rebase-item'").get() as { selected: number; status: string; version: number; lowPrice: number; highPrice: number };
  assert.deepEqual({ selected: saved.selected, status: saved.status, lowPrice: saved.lowPrice, highPrice: saved.highPrice }, { selected: 1, status: "approved", lowPrice: 18900, highPrice: 20900 });

  sqlite.prepare("UPDATE market_annotation_items SET reviewed_segment='类型乙', version=version+1 WHERE id='rebase-item'").run();
  await assert.rejects(() => updateAnnotationItems(db, "rebase-job", [{ id: "rebase-item", version: saved.version, segment: "类型甲", imagePriceCents: 19900, selected: false }], { email: "operator@test", role: "operator" }), /复核内容已被他人修改/);
  sqlite.close();
});

test("filtered selection accepts 911 importable rows and commit resumes in bounded 500-row batches", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('large-selection-prompt','批量类目',1,'manual','active','["可入库"]','这是用于验证九百一十一条跨页选择和分批入库的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by) VALUES
      ('large-selection-job','批量类目','large-selection-prompt','local','review_ready',912,'operator@test'),
      ('large-selection-running','批量类目','large-selection-prompt','local','running',1,'operator@test');
  `);
  const insert = sqlite.prepare("INSERT INTO market_annotation_items (id, job_id, category, sku_code, product_name, status, reviewed_segment) VALUES (?, 'large-selection-job', '批量类目', ?, ?, 'review_pending', ?)");
  const insertRanking = sqlite.prepare(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES (?,?,'2026-06-01','2026-06-30','批量类目','','SKU','POP',?,?,'{}','batch')`);
  const insertSnapshot = sqlite.prepare(`INSERT INTO market_price_snapshots
    (id,category,scope,sku_code,ranking_dimension,month,image_content_sha256) VALUES (?,'批量类目','',?,'SKU','','')`);
  sqlite.exec("BEGIN");
  for (let index = 1; index <= 911; index += 1) {
    insert.run(`large-item-${index}`, `LARGE-${index}`, `批量商品 ${index}`, "可入库");
    insertRanking.run(`large-ranking-${index}`, index, `LARGE-${index}`, `批量商品 ${index}`);
    insertSnapshot.run(`large-snapshot-${index}`, `LARGE-${index}`);
  }
  insert.run("large-invalid", "LARGE-INVALID", "无效细分品类", "已失效");
  sqlite.prepare("INSERT INTO market_annotation_items (id, job_id, category, sku_code, product_name, status, reviewed_segment) VALUES ('large-running', 'large-selection-running', '批量类目', 'LARGE-RUNNING', '仍在识别', 'review_pending', '可入库')").run();
  sqlite.exec("COMMIT");

  const workspace = await getAnnotationReviewWorkspace(db, { aggregateJobs: true, itemCategories: ["批量类目"] });
  assert.equal(workspace.itemPagination.total, 913);
  assert.equal(workspace.selection.filteredReviewableCount, 911);

  const selected = await setFilteredAnnotationSelection(db, { aggregateJobs: true, categories: ["批量类目"], selected: true }, { email: "operator@test", role: "operator" });
  assert.equal(selected.changed, 911);
  assert.equal((sqlite.prepare("SELECT selected FROM market_annotation_items WHERE id='large-invalid'").get() as { selected: number }).selected, 0);
  assert.equal((sqlite.prepare("SELECT selected FROM market_annotation_items WHERE id='large-running'").get() as { selected: number }).selected, 0);

  const first = await commitSelectedAnnotationItems(db, { aggregateJobs: true, categories: ["批量类目"], idempotencyKey: "large-selection-batch-001" }, { email: "admin@test", role: "admin" });
  assert.equal(first.committed, 500);
  assert.equal(first.remainingSelected, 411);
  assert.equal(first.hasMore, true);
  const second = await commitSelectedAnnotationItems(db, { aggregateJobs: true, categories: ["批量类目"], idempotencyKey: "large-selection-batch-002" }, { email: "admin@test", role: "admin" });
  assert.equal(second.committed, 411);
  assert.equal(second.remainingSelected, 0);
  assert.equal(second.hasMore, false);
  sqlite.close();
});

test("annotation review paginates one task with a 20-row default", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    CREATE TABLE ai_models (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, model_type TEXT NOT NULL, model_name TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, is_default_text_model INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('page-prompt','分页类目',1,'manual','active','["甲","乙"]','这是用于验证任务内分页的测试 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by)
      VALUES ('page-job','分页类目','page-prompt','local','review_ready',45,'operator@test');
  `);
  const insert = sqlite.prepare("INSERT INTO market_annotation_items (id, job_id, category, sku_code, product_name, status) VALUES (?, 'page-job', '分页类目', ?, ?, 'review_pending')");
  for (let index = 1; index <= 45; index += 1) insert.run(`page-item-${String(index).padStart(2, "0")}`, `PAGE-${String(index).padStart(2, "0")}`, `分页商品 ${index}`);

  const first = await getAnnotationWorkspace(db, { jobId: "page-job" });
  assert.deepEqual(first.itemPagination, { page: 1, pageSize: 20, total: 45, pageCount: 3 });
  assert.equal(first.items.length, 20);
  const last = await getAnnotationWorkspace(db, { jobId: "page-job", itemPage: 3 });
  assert.equal(last.items.length, 5);
  assert.equal(last.items[0]?.skuCode, "PAGE-41");
  sqlite.close();
});

test("annotation review aggregates historical jobs and filters by tertiary category", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    CREATE TABLE ai_models (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, model_type TEXT NOT NULL, model_name TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, is_default_text_model INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by) VALUES
      ('aggregate-prompt-a','三级类目甲',1,'manual','active','["甲一"]','这是三级类目甲用于跨任务汇总测试的 Prompt 正文。','admin@test'),
      ('aggregate-prompt-b','三级类目乙',1,'manual','active','["乙一"]','这是三级类目乙用于独立筛选测试的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by) VALUES
      ('aggregate-job-a1','三级类目甲','aggregate-prompt-a','local','review_ready',1,'operator@test'),
      ('aggregate-job-a2','三级类目甲','aggregate-prompt-a','local','review_ready',1,'operator@test'),
      ('aggregate-job-b1','三级类目乙','aggregate-prompt-b','local','review_ready',1,'operator@test');
    INSERT INTO market_annotation_items (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, status, reviewed_segment) VALUES
      ('aggregate-item-a1','aggregate-job-a1','三级类目甲','pop','AGG-A','SKU','2026-01','same-a','甲商品第一次识别','review_pending','甲一'),
      ('aggregate-item-a2','aggregate-job-a2','三级类目甲','pop','AGG-A','SKU','2026-01','same-a','甲商品第二次识别','review_pending','甲一'),
      ('aggregate-item-b1','aggregate-job-b1','三级类目乙','pop','AGG-B','SKU','2026-01','hash-b','乙商品','review_pending','乙一');
  `);

  const all = await getAnnotationWorkspace(db, { aggregateJobs: true });
  assert.deepEqual(all.reviewSummary, { jobCount: 3, recordCount: 3, uniqueCandidateCount: 2 });
  assert.deepEqual(all.reviewCategories.map((item) => ({ ...item })), [
    { value: "三级类目甲", jobCount: 2, recordCount: 2 },
    { value: "三级类目乙", jobCount: 1, recordCount: 1 },
  ]);
  const both = await getAnnotationWorkspace(db, { aggregateJobs: true, itemCategories: ["三级类目甲", "三级类目乙"] });
  assert.equal(both.itemPagination.total, 3);
  await assert.rejects(() => getAnnotationWorkspace(db, { aggregateJobs: true, itemCategories: Array.from({ length: 51 }, (_, index) => `类目-${index}`) }), /最多选择 50 个/);
  const category = await getAnnotationWorkspace(db, { aggregateJobs: true, itemCategory: "三级类目甲" });
  assert.equal(category.itemPagination.total, 2);
  assert.deepEqual(category.reviewSummary, { jobCount: 2, recordCount: 2, uniqueCandidateCount: 1 });
  assert.ok(category.items.every((item) => item.category === "三级类目甲"));
  const reviewOnly = await getAnnotationReviewWorkspace(db, { aggregateJobs: true, itemCategories: ["三级类目甲"] });
  assert.equal(reviewOnly.itemPagination.total, 2);
  assert.equal("catalog" in reviewOnly, false);

  const selected = await setFilteredAnnotationSelection(db, { aggregateJobs: true, categories: ["三级类目甲", "三级类目乙"], selected: true }, { email: "operator@test", role: "operator" });
  assert.equal(selected.changed, 3);
  assert.deepEqual((sqlite.prepare("SELECT id FROM market_annotation_items WHERE selected=1 ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id), ["aggregate-item-a1", "aggregate-item-a2", "aggregate-item-b1"]);
  sqlite.close();
});

test("aggregate batch commit groups selected review items by job", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db);
  sqlite.exec(`
    INSERT INTO market_annotation_prompt_versions (id, category, version, source, status, segments_json, prompt_body, created_by)
      VALUES ('commit-all-prompt','三级类目甲',1,'manual','active','["甲一"]','这是用于验证跨任务分组入库的 Prompt 正文。','admin@test');
    INSERT INTO market_annotation_jobs (id, category, prompt_version_id, executor, status, total_count, created_by) VALUES
      ('commit-all-job-1','三级类目甲','commit-all-prompt','local','review_ready',1,'operator@test'),
      ('commit-all-job-2','三级类目甲','commit-all-prompt','local','review_ready',1,'operator@test');
    INSERT INTO market_price_snapshots (id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, image_url, confirmation_status) VALUES
      ('commit-all-price-1','三级类目甲','pop','COMMIT-1','SKU','2026-01','commit-hash-1','https://img10.360buyimg.com/imgzone/1.jpg','missing'),
      ('commit-all-price-2','三级类目甲','pop','COMMIT-2','SKU','2026-01','commit-hash-2','https://img10.360buyimg.com/imgzone/2.jpg','missing');
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id) VALUES
      ('commit-ranking-1',1,'2026-01-01','2026-01-31','三级类目甲','pop','SKU','POP','COMMIT-1','商品一','{}','batch'),
      ('commit-ranking-2',2,'2026-01-01','2026-01-31','三级类目甲','pop','SKU','POP','COMMIT-2','商品二','{}','batch');
    INSERT INTO market_annotation_items (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, source_image_url, status, selected, reviewed_segment, reviewed_image_price_cents, reviewed_price_type) VALUES
      ('commit-all-item-1','commit-all-job-1','三级类目甲','pop','COMMIT-1','SKU','2026-01','commit-hash-1','商品一','https://img10.360buyimg.com/imgzone/1.jpg','approved',1,'甲一',10000,'标准售价'),
      ('commit-all-item-2','commit-all-job-2','三级类目甲','pop','COMMIT-2','SKU','2026-01','commit-hash-2','商品二','https://img10.360buyimg.com/imgzone/2.jpg','approved',1,'甲一',20000,'标准售价');
  `);

  const result = await commitSelectedAnnotationItems(db, { aggregateJobs: true, categories: ["三级类目甲"], idempotencyKey: "aggregate-commit-001" }, { email: "admin@test", role: "admin" });
  assert.equal(result.ok, true);
  assert.equal(result.committed, 2);
  assert.equal(result.jobs, 2);
  assert.deepEqual((sqlite.prepare("SELECT status FROM market_annotation_items ORDER BY id").all() as Array<{ status: string }>).map((row) => row.status), ["committed", "committed"]);
  sqlite.close();
});

test("runtime schema clears a failed readiness cache entry so the same connection can retry", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const baseConnection = sqliteAdapter(sqlite);
  let failFirstBatch = true;
  const flakyConnection = {
    prepare: (sql: string) => baseConnection.prepare(sql),
    batch: async (statements: Parameters<MarketDatabase["batch"]>[0]) => {
      if (failFirstBatch) {
        failFirstBatch = false;
        throw new Error("injected schema setup failure");
      }
      return baseConnection.batch(statements);
    },
  } as MarketDatabase;

  await assert.rejects(ensureAnnotationSchema(flakyConnection), /injected schema setup failure/);
  await ensureAnnotationSchema(flakyConnection);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_annotation_jobs'").get());
  sqlite.close();
});

function sqliteAdapter(sqlite: DatabaseSync, hooks: { afterFirst?: (sql: string) => Promise<void> } = {}): MarketDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() { const result = (statement.get(...values) ?? null) as T | null; await hooks.afterFirst?.(sql); return result; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as MarketDatabase;
}
