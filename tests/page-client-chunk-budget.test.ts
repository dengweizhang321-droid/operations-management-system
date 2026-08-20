import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

const PAGE_ENTRY_MAX_BYTES = 500_000;
const AI_ASSISTANT_CHUNK_MAX_BYTES = 180_000;
const CUSTOMER_SERVICE_CHUNK_MAX_BYTES = 150_000;
const AI_RUNTIME_MARKER = "/api/ai/conversations?";
const CUSTOMER_RUNTIME_MARKER = "/api/customer-service/analyze";

type ClientManifestEntry = {
  file?: string;
  imports?: string[];
};

function collectStaticClientFiles(
  manifest: Record<string, ClientManifestEntry>,
  entryKey: string,
) {
  const pending = [entryKey];
  const visited = new Set<string>();
  const files = new Set<string>();
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) continue;
    if (entry.file) files.add(entry.file);
    for (const importedKey of entry.imports ?? []) pending.push(importedKey);
  }
  return files;
}

test("page keeps AI assistant and customer service behind direct lazy boundaries", async () => {
  const [page, aiAssistant, customerService] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-assistant-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/customer-service-view.tsx", import.meta.url), "utf8"),
  ]);

  for (const [scope, modulePath] of [["ai", "ai-assistant-view"], ["customer_service", "customer-service-view"]]) {
    assert.match(page, new RegExp(`createReloadableLazy\\("${scope}", \\(\\) => import\\("\\./${modulePath}"\\)\\)`));
    assert.doesNotMatch(page, new RegExp(`^import (?!type )[^\\n]+from "\\./${modulePath}"`, "m"));
  }
  assert.match(page, /onRetry=\{\(\) => \{ resetReloadableLazyScope\(active\); \}\}/);
  assert.doesNotMatch(page, /function AiAssistantView\(|function CustomerServiceView\(/);
  assert.doesNotMatch(page, /conversationGenerationRef|listGenerationRef|newAiModelDraft|customerProblemTypes/);
  assert.match(page, /customer_service: \([^\n]+<CustomerServiceView[^\n]+currentUser=\{currentUser\}[^\n]+onNavigate=\{onNavigate\}/);
  assert.match(page, /ai: \([^\n]+<AiAssistantView currentUser=\{currentUser\}/);

  assert.match(aiAssistant, /conversationControllerRef\.current\?\.abort\(\)/);
  assert.match(aiAssistant, /generation !== conversationGenerationRef\.current/);
  assert.match(aiAssistant, /messageGenerationRef/);
  assert.match(aiAssistant, /deleteConversation/);
  assert.match(aiAssistant, /加载更多对话/);
  assert.match(aiAssistant, /加载更早消息/);

  assert.match(customerService, /listControllerRef\.current\?\.abort\(\)/);
  assert.match(customerService, /listGenerationRef\.current === generation/);
  assert.match(customerService, /listRequestKeyRef\.current === requestKey/);
  assert.match(customerService, /response\.status === 409/);
  assert.match(customerService, /dialogId="customer-service-conversation-detail"/);
  assert.match(customerService, /messageTotalCount|messagesTruncated/);

  for (const lazyView of [aiAssistant, customerService]) {
    assert.doesNotMatch(lazyView, /from "\.\/page"|import\("\.\/page"\)/);
  }
});

test("fresh production artifacts keep the page entry and lazy view chunks within budget", async (context) => {
  const manifestUrl = new URL("../dist/client/.vite/manifest.json", import.meta.url);
  let manifestStat;
  try {
    manifestStat = await stat(manifestUrl);
  } catch {
    context.skip("production client artifacts are not present");
    return;
  }

  const sourceStats = await Promise.all([
    stat(new URL("../app/page.tsx", import.meta.url)),
    stat(new URL("../app/ai-assistant-view.tsx", import.meta.url)),
    stat(new URL("../app/customer-service-view.tsx", import.meta.url)),
    stat(new URL("../app/customer-service-import-card.tsx", import.meta.url)),
    stat(new URL("../app/ui/searchable-select.tsx", import.meta.url)),
    stat(new URL("../app/shell/view-contract.ts", import.meta.url)),
    stat(new URL("../app/shell/reloadable-lazy.tsx", import.meta.url)),
    stat(new URL("../app/shell/module-error-boundary.tsx", import.meta.url)),
  ]);
  if (manifestStat.mtimeMs < Math.max(...sourceStats.map((item) => item.mtimeMs))) {
    context.skip("production client artifacts predate the page chunk boundary sources");
    return;
  }

  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as Record<string, ClientManifestEntry>;
  const pageEntry = manifest["app/page.tsx"]?.file;
  assert.ok(pageEntry, "client manifest must expose app/page.tsx");
  const pageStaticFiles = collectStaticClientFiles(manifest, "app/page.tsx");
  const pageEntryUrl = new URL(`../dist/client/${pageEntry}`, import.meta.url);
  const [pageEntrySource, pageEntryStat] = await Promise.all([readFile(pageEntryUrl, "utf8"), stat(pageEntryUrl)]);
  assert.ok(
    pageEntryStat.size <= PAGE_ENTRY_MAX_BYTES,
    `page entry is ${pageEntryStat.size} bytes; budget is ${PAGE_ENTRY_MAX_BYTES}`,
  );
  assert.doesNotMatch(pageEntrySource, new RegExp(AI_RUNTIME_MARKER));
  assert.doesNotMatch(pageEntrySource, new RegExp(CUSTOMER_RUNTIME_MARKER));

  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const javascriptAssets = (await readdir(assetsUrl)).filter((name) => name.endsWith(".js"));
  const markedAssets = new Map<string, Array<{ name: string; bytes: number }>>([
    [AI_RUNTIME_MARKER, []],
    [CUSTOMER_RUNTIME_MARKER, []],
  ]);
  for (const name of javascriptAssets) {
    const assetUrl = new URL(name, assetsUrl);
    const source = await readFile(assetUrl, "utf8");
    for (const marker of markedAssets.keys()) {
      if (source.includes(marker)) markedAssets.get(marker)?.push({ name, bytes: (await stat(assetUrl)).size });
    }
  }

  const aiChunks = markedAssets.get(AI_RUNTIME_MARKER) ?? [];
  const customerChunks = markedAssets.get(CUSTOMER_RUNTIME_MARKER) ?? [];
  assert.equal(aiChunks.length, 1, "one lazy client chunk must own the AI assistant runtime");
  assert.equal(customerChunks.length, 1, "one lazy client chunk must own the customer-service runtime");
  assert.notEqual(`assets/${aiChunks[0]?.name}`, pageEntry);
  assert.notEqual(`assets/${customerChunks[0]?.name}`, pageEntry);
  assert.equal(
    pageStaticFiles.has(`assets/${aiChunks[0]?.name}`),
    false,
    "the AI runtime must not be reachable through the page entry's static import graph",
  );
  assert.equal(
    pageStaticFiles.has(`assets/${customerChunks[0]?.name}`),
    false,
    "the customer-service runtime must not be reachable through the page entry's static import graph",
  );
  assert.ok(
    (aiChunks[0]?.bytes ?? Number.POSITIVE_INFINITY) <= AI_ASSISTANT_CHUNK_MAX_BYTES,
    `AI assistant chunk is ${aiChunks[0]?.bytes} bytes; budget is ${AI_ASSISTANT_CHUNK_MAX_BYTES}`,
  );
  assert.ok(
    (customerChunks[0]?.bytes ?? Number.POSITIVE_INFINITY) <= CUSTOMER_SERVICE_CHUNK_MAX_BYTES,
    `customer-service chunk is ${customerChunks[0]?.bytes} bytes; budget is ${CUSTOMER_SERVICE_CHUNK_MAX_BYTES}`,
  );
});
