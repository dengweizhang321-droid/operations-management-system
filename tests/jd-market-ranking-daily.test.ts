import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertJdMarketImageCoverage, jdMarketHelperRequestError, parseJdMarketImageRows } from "../tools/jd-market-ranking-daily";
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

test("JD market n8n workflow stays inactive and uses the three loopback stages", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jd-market-ranking-daily.workflow.json", import.meta.url), "utf8")) as {
    active: boolean;
    nodes: Array<{ type: string; parameters?: { url?: string } }>;
  };
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest").map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jd-market/plan",
    "http://127.0.0.1:5791/jd-market/run",
    "http://127.0.0.1:5791/jd-market/verify",
  ]);
});

test("JD market runner fixes the requested identity and requires completed import plus coverage verification", async () => {
  const [runner, config] = await Promise.all([
    readFile(new URL("../tools/jd-market-ranking-daily.ts", import.meta.url), "utf8"),
    readFile(new URL("../config/jd-market-ranking-daily.json", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"dimension": "SKU"/);
  assert.match(config, /"categoryPath": \["商用净饮水设备", "商用净水设备"\]/);
  assert.match(runner, /batch\?\.status !== "completed"/);
  assert.match(runner, /missingAfterImport\.length/);
  assert.match(runner, /results\.find\(\(result\) => result\.block\.data\.length === 0\)/);
  assert.match(runner, /assertJdMarketImageCoverage\(skuIds, result\)/);
  assert.match(runner, /已停止生成和导入空图片榜单/);
  assert.match(runner, /images\[sku\]\?\.productUrl \|\| `https:\/\/item\.jd\.com/);
  assert.match(runner, /assertJdProductDetailStoreIdentity/);
  assert.match(runner, /page\.on\("request"/);
  assert.match(runner, /capturedRankRequests\.set\(page/);
  assert.match(runner, /fileInfo\.size !== chunk\.fileSizeBytes/);
  assert.match(runner, /saveEvidenceScreenshot\(page, plan, "exportPanel"\)/);
  assert.match(runner, /AbortSignal\.timeout\(300_000\)/);
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
  assert.match(selectorHelper, /candidates\.count\(\) === 1/);
  assert.doesNotMatch(selectorHelper, /candidate\.innerText/);
  assert.match(selectorHelper, /hover\(\{ timeout: 3_000, force: true \}\)/);
  assert.match(selectorHelper, /click\(\{ timeout: 3_000, force: true \}\)/);
  assert.doesNotMatch(selectorHelper, /dispatchEvent/);
  assert.match(runner, /hoverUniqueDropdownOption\(surface, frame, config\.categoryPath\[0\], selectors\.nth\(1\)\)/);
  assert.doesNotMatch(runner, /getByText\([^\n]+\.last\(\)\.click\(\)/);
  assert.match(runner, /dayGranularity\.isChecked\(\)/);
  assert.match(runner, /waitForRankingSurface\(frame\)/);
  assert.match(runner, /if \(await candidates\.count\(\) === 0 && control\) await control\.click/);
  assert.match(runner, /clickUniqueDropdownOption\(surface, frame, "SKU", selectors\.nth\(0\)\)/);
  assert.match(runner, /attempt < 300/);
  assert.match(runner, /not\(ancestor::\*\[@id='sz-old-version'\]\)/);
  assert.match(runner, /exportPanel\.count\(\) !== 1/);
  assert.match(runner, /fromInput\.inputValue\(\) !== startDate/);
  assert.doesNotMatch(runner, /#jdsz-from"\)\.fill\([^\n]+\.catch\(/);
});
