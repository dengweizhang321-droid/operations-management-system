import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { jdMarketHelperRequestError } from "../tools/jd-market-ranking-daily";

test("JD market helper binds one execution and rejects foreign or out-of-order requests", () => {
  assert.equal(jdMarketHelperRequestError("ready", false, "/jd-market/plan", "execution-1", null), null);
  assert.deepEqual(jdMarketHelperRequestError("ready", false, "/jd-market/run", "execution-1", null), { error: "execution_not_claimed", expected: "/jd-market/plan" });
  assert.deepEqual(jdMarketHelperRequestError("planned", false, "/jd-market/run", "other", "execution-1"), { error: "execution_mismatch" });
  assert.deepEqual(jdMarketHelperRequestError("planned", true, "/jd-market/run", "execution-1", "execution-1"), { error: "pipeline_busy" });
  assert.deepEqual(jdMarketHelperRequestError("planned", false, "/jd-market/verify", "execution-1", "execution-1"), { error: "invalid_stage", expected: "executed", actual: "planned" });
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
  assert.match(runner, /results\.every\(\(result\) => result\.block\.data\.length > 0/);
  assert.match(runner, /assertJdProductDetailStoreIdentity/);
  assert.match(runner, /fileInfo\.size !== chunk\.fileSizeBytes/);
  assert.match(runner, /saveEvidenceScreenshot\(page, plan, "exportPanel"\)/);
  const selectorHelper = runner.slice(runner.indexOf("async function findUniqueDropdownOption"), runner.indexOf("async function waitForSelectorText"));
  assert.doesNotMatch(selectorHelper, /frame\.evaluate/);
  assert.match(selectorHelper, /jmtd-base-input-top/);
  assert.match(selectorHelper, /candidates\.length === 1/);
  assert.match(runner, /hoverUniqueDropdownOption\(frame, config\.categoryPath\[0\]\)/);
  assert.doesNotMatch(runner, /getByText\([^\n]+\.last\(\)\.click\(\)/);
  assert.match(runner, /dayGranularity\.isChecked\(\)/);
  assert.match(runner, /rankingSurface\(frame\)\.locator\("\.jmtd-label"\)/);
  assert.match(runner, /return frame\.locator\("#sz-old-version"\)\.filter\(\{ visible: true \}\)/);
  assert.match(runner, /surface\.count\(\) !== 1/);
  assert.match(runner, /not\(ancestor::\*\[@id='sz-old-version'\]\)/);
  assert.match(runner, /exportPanel\.count\(\) !== 1/);
  assert.match(runner, /fromInput\.inputValue\(\) !== startDate/);
  assert.doesNotMatch(runner, /#jdsz-from"\)\.fill\([^\n]+\.catch\(/);
});
