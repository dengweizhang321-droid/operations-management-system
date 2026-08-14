import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertJdMarketImageCoverage, jdMarketHelperRequestError, jdMarketReplayableHeaders, parseJdMarketImageRows, validateJdMarketDailyConfig } from "../tools/jd-market-ranking-daily";
import { parseJdSilentNoWindowHeader } from "../tools/tmall-sycm-cookie-pipeline";

test("JD silent-window header is strict and shared by multi-store and market plans", () => {
  assert.equal(parseJdSilentNoWindowHeader(undefined), false);
  assert.equal(parseJdSilentNoWindowHeader("0"), false);
  assert.equal(parseJdSilentNoWindowHeader("1"), true);
  assert.throws(() => parseJdSilentNoWindowHeader("true"), /请求头无效/);
  assert.throws(() => parseJdSilentNoWindowHeader(["1"]), /请求头无效/);
});

test("JD market helper binds one execution and rejects foreign or out-of-order requests", () => {
  assert.equal(jdMarketHelperRequestError("ready", false, "/jd-market/plan", "execution-1", null), null);
  assert.deepEqual(jdMarketHelperRequestError("ready", false, "/jd-market/run", "execution-1", null), { error: "execution_not_claimed", expected: "/jd-market/plan" });
  assert.deepEqual(jdMarketHelperRequestError("planned", false, "/jd-market/run", "other", "execution-1"), { error: "execution_mismatch" });
  assert.deepEqual(jdMarketHelperRequestError("planned", true, "/jd-market/run", "execution-1", "execution-1"), { error: "pipeline_busy" });
  assert.deepEqual(jdMarketHelperRequestError("planned", false, "/jd-market/verify", "execution-1", "execution-1"), { error: "invalid_stage", expected: "executed", actual: "planned" });
});

test("JD market image responses accept array and SKU-keyed shapes but fail closed on missing images", () => {
  assert.deepEqual(parseJdMarketImageRows({ content: { data: [{
    skuId: 1001,
    imgSrc: "//img10.360buyimg.com/n7/jfs/a.jpg?x=1",
    proUrl: "//item.jd.com/1001.html?utm_source=test",
  }] } }), {
    "1001": {
      imageUrl: "https://img10.360buyimg.com/n5/jfs/a.jpg",
      productUrl: "https://item.jd.com/1001.html",
    },
  });
  assert.deepEqual(parseJdMarketImageRows({ content: { data: {
    "1002": { imgSrc: "https://img11.360buyimg.com/imgzone/jfs/b.jpg", proUrl: "https://item.jd.com/1002.html" },
  } } }), {
    "1002": {
      imageUrl: "https://img11.360buyimg.com/imgzone/jfs/b.jpg",
      productUrl: "https://item.jd.com/1002.html",
    },
  });
  assert.throws(() => assertJdMarketImageCoverage(["1001", "1002"], {
    "1001": { imageUrl: "https://img10.360buyimg.com/n5/jfs/a.jpg", productUrl: "" },
  }), /缺少 1 个 SKU 主图.*停止生成和导入空图片榜单/);
});

test("JD market image requests replay only the native bounded header allowlist", () => {
  assert.deepEqual(jdMarketReplayableHeaders({
    Accept: "application/json",
    "P-Pin": "signed-in-user",
    Cookie: "must-not-replay",
    Host: "must-not-replay",
    "X-Requested-With": "XMLHttpRequest",
  }), {
    Accept: "application/json",
    "P-Pin": "signed-in-user",
    "X-Requested-With": "XMLHttpRequest",
  });
});

test("JD market n8n workflow stays inactive, uses Profile 3 hidden Chromium, and preserves the three loopback stages", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jd-market-ranking-daily.workflow.json", import.meta.url), "utf8")) as {
    name: string;
    active: boolean;
    nodes: Array<{ type: string; parameters?: { url?: string; rule?: { interval?: Array<{ expression?: string }> }; headerParameters?: { parameters?: Array<{ name?: string; value?: string }> }; options?: { timeout?: number } } }>;
  };
  assert.equal(workflow.active, false);
  assert.match(workflow.name, /Profile 3隐藏Chromium/);
  const schedule = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedule?.parameters?.rule?.interval?.[0]?.expression, "0 10 * * *");
  const requests = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requests.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jd-market/plan",
    "http://127.0.0.1:5791/jd-market/run",
    "http://127.0.0.1:5791/jd-market/verify",
  ]);
  assert.deepEqual(requests.map((node) => node.parameters?.options?.timeout), [900_000, 21_600_000, 900_000]);
  for (const request of requests) {
    assert.deepEqual(request.parameters?.headerParameters?.parameters, [
      { name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" },
      { name: "X-TERUISI-JD-SILENT-NO-WINDOW", value: "1" },
    ]);
  }
});

test("JD market config fixes five unique category identities and rejects ambiguous targets", async () => {
  const config = JSON.parse(await readFile(new URL("../config/jd-market-ranking-daily.json", import.meta.url), "utf8"));
  const validated = validateJdMarketDailyConfig(config);
  assert.equal(validated.version, 3);
  assert.equal(validated.silentNoWindow, true);
  assert.deepEqual(validated.categories.map((target) => [target.categoryPath.join(" > "), target.systemCategory]), [
    ["商用净饮水设备 > 商用净水设备", "商用净水设备"],
    ["商用净饮水设备 > 商用开水器/蒸气奶泡机", "商用开水器蒸气奶泡机"],
    ["商用食品机械设备 > 商用炒菜机", "商用炒菜机"],
    ["商用食品机械设备 > 商用绞肉机/切肉机/切片机", "商用绞肉机切肉机切片机"],
    ["商用食品机械设备 > 商用切菜机", "商用切菜机"],
  ]);
  assert.equal(validated.maxDaysPerFile, 20);
  assert.throws(() => validateJdMarketDailyConfig({
    ...config,
    categories: [...config.categories, { ...config.categories[0], categoryPath: ["重复一级类目", "重复二级类目"] }],
  }), /配置无效/);
  assert.throws(() => validateJdMarketDailyConfig({
    ...config,
    categories: [{ ...config.categories[0], categoryPath: ["只有一级"] }],
  }), /配置无效/);
  assert.throws(() => validateJdMarketDailyConfig({ ...config, categories: config.categories.slice(0, 4) }), /配置无效/);
  assert.throws(() => validateJdMarketDailyConfig({ ...config, scope: "self" }), /配置无效/);
  assert.throws(() => validateJdMarketDailyConfig({ ...config, silentNoWindow: false }), /配置无效/);
});

test("JD market store key resolves only to the controlled Profile 3 identity", async () => {
  const [config, registry] = await Promise.all([
    readFile(new URL("../config/jd-market-ranking-daily.json", import.meta.url), "utf8").then((raw) => JSON.parse(raw)),
    readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8").then((raw) => JSON.parse(raw)),
  ]);
  const selected = registry.stores.filter((store: { storeKey?: string }) => store.storeKey === config.storeKey);
  assert.equal(selected.length, 1);
  assert.deepEqual({
    shopName: selected[0].shopName,
    shopId: selected[0].shopId,
    profileName: selected[0].browser.profileName,
    debugPort: selected[0].browser.debugPort,
  }, {
    shopName: "志高商用洗碗机旗舰店",
    shopId: "711743",
    profileName: "Profile 3",
    debugPort: 9227,
  });
});

test("JD market runner fixes the requested identities and requires completed import plus per-category coverage verification", async () => {
  const [runner, config] = await Promise.all([
    readFile(new URL("../tools/jd-market-ranking-daily.ts", import.meta.url), "utf8"),
    readFile(new URL("../config/jd-market-ranking-daily.json", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"dimension": "SKU"/);
  assert.match(config, /"categories": \[/);
  assert.match(runner, /for \(const target of config\.categories\)/);
  assert.match(runner, /for \(const targetPlan of plan\.targets\)/);
  assert.match(runner, /candidate\.capturedAt >= categorySelectionStartedAt/);
  assert.match(runner, /缺少用于刷新同类目请求的受控备用类目/);
  assert.match(runner, /市场榜单计划类目清单或隐藏 Chromium 约束与当前受控配置不一致/);
  assert.match(runner, /store\.browser\.profileName !== plan\.browserProfileName/);
  assert.match(runner, /!plan\.silentNoWindow/);
  assert.match(runner, /batch\?\.status !== "completed"/);
  assert.match(runner, /missingAfterImport\.length/);
  assert.match(runner, /results\.find\(\(result\) => result\.block\.data\.length === 0\)/);
  assert.match(runner, /assertJdMarketImageCoverage\(skuIds, result\)/);
  assert.match(runner, /capturedImageRequests\.get\(page\)/);
  assert.match(runner, /fetchImages\(frame, skuIds, imageHeaders\)/);
  assert.match(runner, /\.user-info \.shop-name a\[href\*="mall\.jd\.com\/index-"\]/);
  assert.match(runner, /已停止生成和导入空图片榜单/);
  assert.match(runner, /images\[sku\]\?\.productUrl \|\| `https:\/\/item\.jd\.com/);
  assert.match(runner, /assertJdProductDetailStoreIdentity/);
  assert.match(runner, /page\.on\("request"/);
  assert.match(runner, /capturedRankRequests\.set\(page/);
  assert.match(runner, /fileInfo\.size !== chunk\.fileSizeBytes/);
  assert.match(runner, /if \(exportPanelCount === 1\)/);
  assert.match(runner, /saveEvidenceScreenshot\(page, plan, targetPlan, "exportPanel"\)/);
  assert.match(runner, /page\.screenshot\(\{ path: filePath, fullPage: false, timeout: 5_000 \}\)/);
  assert.match(runner, /target\.evidenceWarnings/);
  assert.match(runner, /await rm\(filePath, \{ force: true \}\)/);
  assert.match(runner, /withJackyunRunLock\(\{/);
  assert.match(runner, /runId,/);
  assert.match(runner, /purpose: "jd-market-ranking-daily"/);
  assert.match(runner, /lockDirectory: lockPath/);
  assert.doesNotMatch(runner, /open\(lockPath, "wx"\)/);
  assert.match(runner, /const coverageRequestTimeoutMs = 120_000/);
  assert.match(runner, /const importRequestTimeoutMs = 900_000/);
  assert.match(runner, /AbortSignal\.timeout\(coverageRequestTimeoutMs\)/);
  assert.match(runner, /AbortSignal\.timeout\(importRequestTimeoutMs\)/);
  assert.match(runner, /keepWindowHidden: plan\.silentNoWindow/);
  assert.match(runner, /静默模式拒绝复用未受本次窗口守护控制/);
  assert.match(runner, /closeChromeBrowser\(store\.browser\.debugPort\)/);
  assert.match(runner, /60 \* 60_000/);
  assert.match(runner, /昨日数据尚未开放/);
  assert.match(runner, /未缩短日期范围或导入空集合/);
  assert.match(runner, /readyDates = dates\.at\(-1\) === cutoffDate/);
  assert.match(runner, /dates: \[cutoffDate\]/);
  const selectorHelper = runner.slice(runner.indexOf("async function triggerUniqueDropdownOption"), runner.indexOf("function activeExportPanel"));
  assert.match(selectorHelper, /jmtd-dropdown-option/);
  assert.match(selectorHelper, /hasText: exactLabel/);
  assert.match(selectorHelper, /lastCandidateCount === 1/);
  assert.match(selectorHelper, /lastVisibleLabels/);
  assert.match(selectorHelper, /可见选项=/);
  assert.doesNotMatch(selectorHelper, /candidate\.innerText/);
  assert.match(selectorHelper, /hover\(\{ timeout: 3_000, force: true \}\)/);
  assert.match(selectorHelper, /click\(\{ timeout: 3_000, force: true \}\)/);
  assert.doesNotMatch(selectorHelper, /dispatchEvent/);
  assert.match(runner, /selectUniqueCategoryPath\(surface, frame, selectors\.nth\(1\), target\.categoryPath\)/);
  assert.match(runner, /await control\.click\(\{ timeout: 3_000, force: true \}\)/);
  assert.match(runner, /waitAttempt < 10/);
  assert.match(runner, /parentCount === 1/);
  assert.match(runner, /revealedChildCount === 1/);
  assert.match(runner, /scrollIntoViewIfNeeded\(\{ timeout: 1_000 \}\)/);
  assert.match(runner, /child\.isVisible\(\)/);
  assert.match(runner, /scrollAttempt < 20/);
  assert.match(runner, /frame\.page\(\)\.mouse\.wheel\(0, scrollAttempt === 0 \? -10_000 : 550\)/);
  assert.match(runner, /maximumOptionX - minimumOptionX < 20/);
  assert.match(runner, /optionBox\.x > maximumOptionX/);
  assert.doesNotMatch(runner, /getByText\([^\n]+\.last\(\)\.click\(\)/);
  assert.match(runner, /dayGranularity\.isChecked\(\)/);
  assert.match(runner, /waitForRankingSurface\(frame\)/);
  assert.match(runner, /if \(lastCandidateCount === 0 && control\) await control\.click/);
  assert.match(runner, /clickUniqueDropdownOption\(surface, frame, "SKU", selectors\.nth\(0\)\)/);
  assert.match(runner, /attempt < 300/);
  assert.match(runner, /not\(ancestor::\*\[@id='sz-old-version'\]\)/);
  assert.match(runner, /exportPanelCount > 1/);
  assert.doesNotMatch(runner, /exportPanel\.count\(\) !== 1/);
  assert.match(runner, /fromInput\.inputValue\(\) !== startDate/);
  assert.doesNotMatch(runner, /#jdsz-from"\)\.fill\([^\n]+\.catch\(/);
});
