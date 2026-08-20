import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/page.tsx", import.meta.url);

function viewSource(page: string, start: string, end: string) {
  const startIndex = page.indexOf(start);
  const endIndex = page.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `missing view start: ${start}`);
  assert.ok(endIndex > startIndex, `missing view end: ${end}`);
  return page.slice(startIndex, endIndex);
}

test("ShopView makes one scoped summary request and rejects stale responses", async () => {
  const page = await readFile(pagePath, "utf8");
  const shop = viewSource(page, "function ShopView(", "type SalesTab =");

  assert.equal((shop.match(/\/api\/sales\/summary/g) ?? []).length, 1);
  assert.match(shop, /activeTab === "products" \|\| activeTab === "promotion"/);
  assert.match(shop, /selectedOutletKeys\.forEach\(\(key\) => query\.append\("outlet", key\)\)/);
  assert.match(shop, /requestJson<SalesSummaryResponse>[\s\S]+signal: controller\.signal/);
  assert.match(shop, /requestControllerRef\.current\?\.abort\(\)/);
  assert.match(shop, /generation !== requestGenerationRef\.current/);
  assert.match(shop, /payload\.filterOptions\?\.shops \?\? payload\.outlets/);
  assert.doesNotMatch(shop, /filteredResponse|filteredPayload/);
});

test("netshop views send platform-qualified outlets instead of independent shop-name filters", async () => {
  const page = await readFile(pagePath, "utf8");
  const daily = viewSource(page, "function ShopDailyProductPerformanceView(", "function ShopProductDataView(");
  const catalog = viewSource(page, "function ShopSkuView(", "function ShopPromotionView(");
  const promotion = viewSource(page, "function ShopPromotionView(", "type OutletTab =");
  const storeVisitors = viewSource(page, "function StoreSpuVisitorMetric(", "function StoreAnalysisView(");

  for (const source of [daily, catalog]) {
    assert.match(source, /selectedOutletKeys\.forEach\(\(outlet\) => params\.append\("outlet", outlet\)\)/);
    assert.doesNotMatch(source, /params\.append\("shop"/);
    assert.match(source, /netshopOutletFilterKey\(shop\.platform, shop\.shopName\)/);
    assert.match(source, /label: `\$\{shop\.shopName[^}]*\} · \$\{shop\.platform\}`/);
  }
  assert.match(promotion, /outlet: netshopOutletFilterKey\(pageConfig\.platform, pageConfig\.shopName\)/);
  assert.doesNotMatch(promotion, /shop: pageConfig\.shopName/);
  assert.match(storeVisitors, /scopeOutlets\.forEach\(\(outlet\) => params\.append\("outlet", outlet\)\)/);
  assert.match(page, /promotionOutlets\.forEach\(\(outlet\) => params\.append\("outlet", outlet\)\)/);
});

test("ImportView loads history only for history views and isolates six domain failures", async () => {
  const page = await readFile(pagePath, "utf8");
  const importView = viewSource(page, "function ImportView(", "type ShellViewProps");

  assert.match(importView, /useState\(false\)[\s\S]+historyVisible = activeSection === "history" \|\| activeSection === "continuity"/);
  assert.ok(importView.indexOf("if (!historyVisible) return;") < importView.indexOf("Promise.allSettled(["));
  assert.equal((importView.match(/requestJson<[^\n]+\("\/api\//g) ?? []).length, 6);
  assert.match(importView, /Promise\.allSettled\(\[/);
  assert.match(importView, /historyRequestControllerRef\.current\?\.abort\(\)/);
  assert.match(importView, /generation !== historyRequestGenerationRef\.current/);
  assert.match(importView, /setHistory\(\(current\) => combined\.length > 0 \|\| domainErrors\.length === 0 \? combined : current\)/);
  assert.match(importView, /setHistoryDomainErrors\(domainErrors\)/);
  assert.match(importView, /if \(!historyVisible\) \{[\s\S]+historyRequestGenerationRef\.current \+= 1;[\s\S]+\.abort\(\)/);
  assert.doesNotMatch(importView, /await Promise\.all\(\[[\s\S]+\/api\/imports\/sales/);
  assert.match(importView, /const canImport = currentUser\?\.role === "admin"/);
  assert.match(importView, /if \(!canImport\) \{[\s\S]+仅管理员可以上传和导入业务数据/);
  assert.match(importView, /type="file"[\s\S]{0,180}disabled=\{!canImport\}/);
  assert.match(importView, /className=\{`dropzone[\s\S]{0,240}disabled=\{!canImport\}/);
  assert.match(importView, /disabled=\{!canImport \|\| !selectedFile \|\| uploading\}/);
  assert.match(importView, /当前账号仅可查看导入历史/);
});

test("heavy module views are lazy and the dashboard does not eagerly import their runtime chunks", async () => {
  const page = await readFile(pagePath, "utf8");
  for (const [scope, modulePath] of [
    ["market", "market-view"],
    ["n8n_workflows", "n8n-workflow-view"],
    ["workflow", "operations-view"],
    ["sales", "sales-category-view"],
    ["settings", "settings-view"],
    ["customer_service", "customer-service-view"],
    ["ai", "ai-assistant-view"],
  ]) {
    assert.match(page, new RegExp(`createReloadableLazy\\("${scope}", \\(\\) => import\\("\\./${modulePath}"\\)\\)`));
    assert.doesNotMatch(page, new RegExp(`^import (?!type )[^\\n]+from "\\./${modulePath}"`, "m"));
  }
  assert.match(page, /const GlobalSearchDialog = lazy\(\(\) => import\("\.\/global-search-dialog"\)\)/);
  assert.match(page, /if \(!currentUser \|\| active !== "market"\) return;[\s\S]+import\("\.\/market-view"\)/);
  assert.match(page, /<Suspense fallback=\{<section className="panel data-state" role="status"/);
  assert.match(page, /\{searchOpen && <GlobalSearchLoadBoundary[\s\S]+<Suspense fallback=\{<GlobalSearchLoadingDialog[\s\S]+<GlobalSearchDialogView/);
  assert.match(page, /GlobalSearchLoadingDialog[\s\S]+<Dialog open onClose=\{onClose\}/);
  assert.match(page, /class GlobalSearchLoadBoundary[\s\S]+<Dialog open onClose=\{this\.props\.onClose\}/);
  assert.match(page, /setGlobalSearchLoadVersion\(\(version\) => version \+ 1\)/);
  assert.doesNotMatch(page, /fallback=\{<div className="modal-backdrop"/);
  assert.doesNotMatch(page, /function SettingsView\(|type OperatingSettings =/);
  assert.doesNotMatch(page, /function CustomerServiceView\(|function AiAssistantView\(/);
});

test("global search pagination is query-keyed, cancellable, deduplicated, and target-gated", async () => {
  const page = await readFile(pagePath, "utf8");
  const home = page.slice(page.indexOf("export default function Home()"));

  assert.match(home, /new URLSearchParams\(\{ q: query, group: groupKey, page: String\(nextPage\) \}\)/);
  assert.match(home, /Math\.min\(10_000, Math\.max\(2, page\)\)/);
  assert.match(home, /hasMore: nextPage < 10_000 && incomingGroup\.hasMore/);
  assert.match(home, /globalSearchGroupRequestKeyRef\.current = requestKey/);
  assert.match(home, /generation !== globalSearchGroupGenerationRef\.current \|\| requestKey !== globalSearchGroupRequestKeyRef\.current/);
  assert.match(home, /globalSearchGroupControllerRef\.current\?\.abort\(\)/);
  assert.match(home, /const seenIds = new Set\(currentGroup\.items\.map\(\(item\) => item\.id\)\)/);
  assert.match(home, /currentResult\.groups\.map\(\(group\) => group\.key === groupKey \? mergedGroup : group\)/);
  assert.match(home, /cancelGlobalSearchRequests\(\);[\s\S]+setGlobalSearchQuery\(value\)/);
  assert.match(home, /import\("\.\/global-search-dialog"\)[\s\S]+parseGlobalSearchTarget\(item\.target\)/);
  assert.match(home, /isGlobalSearchItemModuleValid,[\s\S]+isGlobalSearchTargetForItem,[\s\S]+parseGlobalSearchTarget/);
  assert.match(home, /if \(target && isGlobalSearchTargetForItem\(item, target\)\)/);
  assert.match(home, /targetModule = target\.module;[\s\S]+targetView = target\.view/);
  assert.match(home, /else if \(isGlobalSearchItemModuleValid\(item\)\)[\s\S]+targetModule = item\.module/);
  assert.match(home, /selectModule\(targetModule, undefined, targetView\)/);
  assert.match(home, /Navigation fails closed if the validation chunk cannot be loaded/);
});
