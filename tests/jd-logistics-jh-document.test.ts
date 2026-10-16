import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { resetJhSourceDocument } from "../tools/jd-logistics-export";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("JH return discards the retained iframe and its pending route timers before observing a fresh source", { skip: !existsSync(chrome), timeout: 15000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent('<iframe srcdoc="<body>retained source</body>"></iframe><script>setTimeout(()=>{document.body.innerHTML="stale route replaced the new source";},1000);</script>');
  const retained = page.frames().find(frame => frame !== page.mainFrame())!;
  assert.equal(await retained.locator("body").innerText(), "retained source");
  await resetJhSourceDocument(page);
  assert.equal(retained.isDetached(), true);
  assert.equal(await page.locator("body").innerText(), "");
  await page.setContent('<body><div role="tab" aria-selected="true">C仓</div><div role="tab" aria-selected="true">明细表</div></body>');
  await page.waitForTimeout(1100);
  assert.equal(await page.getByRole("tab", { name: "明细表", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("body").innerText(), "C仓\n明细表");
});

test("a failed or incomplete blank navigation cannot advance JH source collection", async t => {
  await t.test("navigation rejection is preserved", async () => {
    const page = { goto: async () => { throw Error("navigation failed"); } } as unknown as Page;
    await assert.rejects(resetJhSourceDocument(page), /navigation failed/);
  });
  for (const [name, url, frames] of [["redirected", "https://jh.jdl.com/#/downloadCenterVev", 1], ["retained child", "about:blank", 2]] as const) {
    await t.test(name, async () => {
      const page = { goto: async () => undefined, url: () => url, frames: () => Array.from({ length: frames }, () => ({})) } as unknown as Page;
      await assert.rejects(resetJhSourceDocument(page), /JD_LOGISTICS_JH_DOCUMENT_NOT_RESET/);
    });
  }
});
