import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  activationGate, canTransitionItem, canTransitionJob, normalizeImagePriceCents, normalizeSegments,
  parseVisionAnnotation, stableStratifiedSample, validationMetrics,
} from "../lib/market/annotation-types";
import { claimLocalAnnotation, completeLocalAnnotation, createValidationRun, runNextCloudAnnotation, runNextValidation, searchAnnotationCatalog } from "../lib/market/annotation-service";
import { AnnotationAgentError, annotationAgentErrorResponse } from "../lib/market/annotation-agent-errors";
import type { MarketDatabase } from "../lib/market/database";

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
});

test("vision results require structured enum, cents, and bounded confidence", () => {
  const parsed = parseVisionAnnotation("```json\n{\"segment\":\"台式\",\"image_price_cents\":199900,\"confidence\":0.92,\"reason\":\"结构匹配\"}\n```", ["台式", "立式"]);
  assert.equal(parsed.segment, "台式");
  assert.equal(parsed.imagePriceCents, 199900);
  assert.equal(parsed.confidenceBps, 9200);
  assert.throws(() => parseVisionAnnotation({ segment: "自造品类", image_price_cents: null, confidence: 0.5 }, ["台式", "立式"]), /枚举之外/);
  assert.throws(() => parseVisionAnnotation({ segment: "台式", image_price_cents: null, confidence: 1.1 }, ["台式", "立式"]), /0 到 1/);
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
  const [route, worker, service, model, ui, runner, migration] = await Promise.all([
    readFile(new URL("../app/api/market/annotations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/annotations/worker/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-annotation-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../tools/market-annotation-runner.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0016_market_sku_annotations.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /adminActions.*commit.*activate_prompt.*create_agent/s);
  assert.match(route, /requireAppPrincipal\(adminActions\.has\(action\)/);
  assert.match(worker, /authenticateLocalAgent/);
  assert.match(worker, /annotationAgentErrorResponse/);
  assert.doesNotMatch(worker, /error instanceof Error \? error\.message/);
  assert.match(service, /model_type='vision'/);
  assert.match(service, /candidateIds/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /version=version\+1/);
  assert.match(service, /ROW_NUMBER\(\) OVER \(PARTITION BY m\.category, m\.sku_code/);
  assert.match(service, /m\.sku_code LIKE \?.*a\.segment LIKE \?/s);
  assert.match(service, /lease_token_hash/);
  assert.match(model, /type: "image_url"/);
  assert.match(model, /response_format: \{ type: "json_schema"/);
  assert.match(model, /tool_choice: \{ type: "tool"/);
  assert.match(model, /MODEL_RESPONSE_MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(model, /readBodyLimited\(response, MODEL_RESPONSE_MAX_BYTES\)/);
  assert.doesNotMatch(model, /data\?\.error\?\.message/);
  assert.match(service, /sample_snapshot_json/);
  assert.match(service, /datetime\('now','\+2 minutes'\)/);
  assert.match(service, /commit_token_hash/);
  assert.match(ui, /SKU AI 标注/);
  assert.match(ui, /candidateIds: selectedIds/);
  assert.match(ui, /完整市场 SKU 库检索/);
  assert.match(runner, /TERUISI_ANNOTATION_AGENT_TOKEN/);
  assert.match(runner, /OLLAMA_BASE_URL must point to localhost/);
  assert.match(runner, /OLLAMA_TIMEOUT_MS = 120_000/);
  assert.match(runner, /OLLAMA_RESPONSE_MAX_BYTES = 1024 \* 1024/);
  assert.match(runner, /readLimitedBody\(response, OLLAMA_RESPONSE_MAX_BYTES\)/);
  assert.doesNotMatch(runner, /payload\?\.error \|\| \("Ollama/);
  for (const table of ["market_annotation_jobs", "market_annotation_items", "market_sku_annotations", "market_annotation_commit_receipts", "market_annotation_prompt_versions", "market_annotation_validation_samples", "market_annotation_validation_runs", "market_annotation_validation_results", "market_annotation_local_agents"]) assert.match(migration, new RegExp(table));
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
  assert.equal(observed.length, 2);
  assert.ok(observed.every((entry) => entry.sql.includes("ESCAPE '\\'")));
  assert.ok(observed.every((entry) => entry.values.slice(0, 5).every((value) => value === "%\\%\\_%")));
});

test("agent errors expose only fixed status classes and hide unknown internals", () => {
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("authentication")), { status: 401, error: "本地 agent 认证失败" });
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("bad_request")), { status: 400, error: "本地 agent 请求参数无效" });
  assert.deepEqual(annotationAgentErrorResponse(new AnnotationAgentError("lease_conflict")), { status: 409, error: "任务 lease 已失效或发生版本冲突，请重新领取" });
  assert.deepEqual(annotationAgentErrorResponse(new Error("D1_ERROR: no such table secret")), { status: 500, error: "本地 agent 服务暂时不可用" });
});

function sqliteAdapter(sqlite: DatabaseSync): MarketDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
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
