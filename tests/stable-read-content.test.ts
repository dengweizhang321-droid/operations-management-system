import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("retained presentation preserves geometry, blocks old actions and clears on failure, period or auth packet change", {
  skip: !existsSync(chrome), timeout: 30_000,
}, async () => {
  const bundle = await build({ stdin: { contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{StableReadContent}from'./app/ui/stable-read-content';
    function Fixture(){const[state,setState]=useState({owner:'September',identity:{id:1},pending:false,complete:true,error:false,label:'A',height:1600});
      const[count,setCount]=useState(0);window.changeRead=next=>setState(s=>({...s,...next}));
      return <><div style={{height:250}}>Live filters</div><output>{count}</output>
       <StableReadContent {...state}><section style={{height:state.height,position:"relative",overflow:"hidden"}} data-label={state.label}>
         {state.label}<button style={{position:"absolute",top:700}} onClick={()=>setCount(n=>n+1)}>Result action</button></section></StableReadContent></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`,
    loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
  });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", r => r.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://stable-read-fixture.invalid/");
    await page.addStyleTag({ content: await readFile(new URL("../app/globals.css", import.meta.url), "utf8") });
    await page.addStyleTag({ content: "html{scroll-behavior:auto}" });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator('[data-label="A"]').waitFor();
    await page.evaluate(() => { window.scrollTo(0, 600); Object.assign(window, { savedRow: document.querySelector('[data-label="A"]') }); });
    const scroll = await page.evaluate(() => window.scrollY);
    const change = async (next: Record<string, unknown>) => {
      await page.evaluate(next => (window as unknown as { changeRead: (s: unknown) => void }).changeRead(next), next);
      await page.waitForTimeout(50);
    };
    await change({ pending: true, complete: false, label: "loading", height: 30 });
    assert.equal(await page.locator('[data-label="loading"]').count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { savedRow: Element }).savedRow.isConnected), true);
    assert.equal(await page.locator('.stable-read-body').getAttribute("inert"), "");
    assert.equal(await page.locator('.stable-read-content').getAttribute("aria-busy"), "true");
    assert.equal(await page.evaluate(() => window.scrollY), scroll);
    // Native pointer clicks on retained content cannot trigger the old business action.
    const button = await page.getByText("Result action", { exact: true }).boundingBox();
    await page.mouse.click(button!.x + 5, button!.y + 5);
    assert.equal(await page.locator("output").innerText(), "0");
    await change({ pending: false, complete: false, label: "partial", height: 90 });
    assert.equal(await page.locator('[data-label="partial"]').count(), 0);
    await change({ pending: false, complete: true, label: "B", height: 50 });
    assert.equal(await page.locator('[data-label="B"]').count(), 1);
    assert.equal(await page.locator('[data-label="A"]').count(), 0);
    assert.equal(await page.evaluate(() => window.scrollY), scroll, "short success must not clamp scroll");
    await change({ pending: true, complete: false, label: "loading2" });
    await change({ error: true, pending: false, label: "failed" });
    assert.equal(await page.locator('[data-label="B"]').count(), 0);
    assert.equal(await page.locator('[data-label="failed"]').count(), 1);
    assert.equal(await page.locator('.stable-read-content').getAttribute("aria-busy"), "false");
    await change({ error: false, pending: true, label: "retry" });
    assert.equal(await page.locator('[data-label="B"]').count(), 0, "failure removes old snapshots, retry cannot resurrect them");
    await change({ pending: false, complete: true, label: "C", height: 500 });
    await change({ identity: { id: 1 }, pending: true, complete: false, label: "new auth" });
    assert.equal(await page.locator('[data-label="C"]').count(), 0, "even equal-JSON auth packets own different snapshots");
    await change({ pending: false, complete: true, label: "D" });
    await change({ owner: "October", pending: true, complete: false, label: "new period" });
    assert.equal(await page.locator('[data-label="D"]').count(), 0);
    assert.equal(await page.locator('.stable-read-content').evaluate(el => (el as HTMLElement).style.minHeight), "");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
