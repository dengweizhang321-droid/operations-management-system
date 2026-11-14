import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("master panel no longer drives price recognition from the browser or calls the always-409 actions", async () => {
  const panel = await read("app/market-master-admin-panel.tsx");
  for (const dead of ["create_price_recognition_job", "run_price_recognition_batch", "run_price_recognition_next",
    "PRICE_RECOGNITION_CONCURRENCY", "PRICE_RECOGNITION_BATCH_SIZE", "postPriceRecognitionAction", "annotation-retry"]) {
    assert.ok(!panel.includes(dead), `${dead} must be gone from the master panel`);
  }
  assert.match(panel, /fetch\("\/api\/market\/annotations"[\s\S]{0,200}action: "start_category_recognition"/);
});

test("auto-annotation settings are admin-only at the Worker edge and the Django edge", async () => {
  const route = await read("app/api/market/annotations/route.ts");
  const adminSet = route.slice(route.indexOf("const ADMIN_ACTIONS"), route.indexOf("]);", route.indexOf("const ADMIN_ACTIONS")));
  assert.match(adminSet, /"set_auto_annotation"/);
  assert.doesNotMatch(adminSet, /"ensure_auto_annotation"|"start_category_recognition"/);
  const views = await read("backend/market/views.py");
  const django = views.slice(views.indexOf("ADMIN_ANNOTATION_ACTIONS = {"), views.indexOf("}", views.indexOf("ADMIN_ANNOTATION_ACTIONS = {")));
  assert.match(django, /"set_auto_annotation"/);
  assert.doesNotMatch(django, /"ensure_auto_annotation"/);
});

test("scheduler checks automatic recognition first, read-only, and never lets it break dispatch", async () => {
  const source = await read("lib/market/django-annotation-scheduled.ts");
  const fn = source.slice(source.indexOf("async function ensureAutoAnnotation"), source.indexOf("export async function runScheduledDjangoMarketAnnotation"));
  assert.match(fn, /try \{[\s\S]*"auto_annotation_due"[\s\S]*ensure_auto_annotation[\s\S]*\} catch \{/);
  assert.match(fn, /AbortSignal\.timeout\(3_000\)/);
  assert.match(fn, /AbortSignal\.timeout\(20_000\)/);
  const runner = source.slice(source.indexOf("export async function runScheduledDjangoMarketAnnotation"));
  assert.ok(runner.indexOf("await ensureAutoAnnotation()") >= 0
    && runner.indexOf("await ensureAutoAnnotation()") < runner.indexOf('"dispatch"'));
});

test("the internal runner identity is the one Django authorizes for ensure_auto_annotation", async () => {
  const scheduled = await read("lib/market/django-annotation-scheduled.ts");
  const django = await read("backend/market/annotations.py");
  const email = /email: "([^"]+)"/.exec(scheduled)?.[1];
  assert.ok(email);
  assert.ok(django.includes(`INTERNAL_ANNOTATION_RUNNER_EMAIL = "${email}"`));
});

test("annotation view offers a per-category toggle and model select that only admins can change", async () => {
  const view = await read("app/market-annotation-view.tsx");
  assert.match(view, /导入后自动识别/);
  assert.match(view, /结果进入待审核，不自动提交正式价格/);
  assert.match(view, /action: "set_auto_annotation", category: targetCategory, enabled, modelId/);
  assert.match(view, /type="checkbox"[^>]*disabled=\{!isAdmin/);
  assert.match(view, /aria-label=\{`\$\{target\} 自动识别视觉模型`\}[^>]*disabled=\{!isAdmin/);
});
