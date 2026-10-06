import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("shared filter draft preserves search, scroll and focus, auto-applies dimensions, confirms text by Enter and resets across scopes", {
  skip: !existsSync(chrome), timeout: 30_000,
}, async () => {
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import SalesFilterBar from './app/sales-filter-bar';
    function Fixture(){const[filters,setFilters]=useState({platforms:[],outletKeys:[],categories:[],channels:[],productQuery:''});
      const[scope,setScope]=useState('第一页'),[count,setCount]=useState(0),[missing,setMissing]=useState(false);
      return <><button onClick={()=>setScope(s=>s==='第一页'?'第二页':'第一页')}>切换范围</button>
      <button onClick={()=>setMissing(true)}>隐藏候选元数据</button>
      <output aria-label="应用次数">{count}</output><output aria-label="已应用条件">{JSON.stringify(filters)}</output>
      <SalesFilterBar filters={filters} scopeLabel={scope} maxSelectionsPerDimension={3}
      onChange={next=>{setFilters(next);setCount(n=>n+1)}} options={{platforms:['京东','天猫'],shops:[],categories:missing?[]:Array.from({length:80},(_,i)=>'分类'+String(i).padStart(2,'0'))}}/></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
  });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://shared-filter-fixture.invalid/");
    await page.addStyleTag({content: ".searchable-select{position:relative}.searchable-select-menu{position:absolute;z-index:5;background:white}.searchable-select-options{height:100px;overflow:auto}.searchable-select-options button{display:block;height:30px}"});
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "销售分析品类", exact: true }).click();
    const menu = page.getByRole("listbox", { name: "销售分析品类选项" });
    const search = page.getByRole("searchbox", { name: "搜索销售分析品类" });
    await search.fill("分类");
    assert.equal(await menu.getByRole("button", { name: "全选", exact: true }).isDisabled(), true);
    const scroll = menu.locator(".searchable-select-options");
    await scroll.evaluate(el => el.scrollTop = 1800);
    const position = await scroll.evaluate(el => el.scrollTop);
    assert.equal(await page.getByRole("button", { name: "应用筛选", exact: true }).count(), 0);
    await menu.getByRole("option", { name: "分类60", exact: true }).click();
    await menu.getByRole("option", { name: "分类61", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "1");
    assert.equal(await scroll.evaluate(el => el.scrollTop), position);
    assert.equal(await search.inputValue(), "分类");
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await menu.getByRole("option", { name: "分类62", exact: true }).click();
    assert.equal(await menu.getByRole("option", { name: "分类63", exact: true }).isDisabled(), true);
    await menu.getByRole("option", { name: "分类61", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "2");
    assert.deepEqual(JSON.parse(await page.getByLabel("已应用条件").innerText()).categories, ["分类60", "分类62"]);
    await page.keyboard.press("Escape");
    const input = page.getByRole("textbox", { name: "销售分析货品编码或名称" });
    await input.fill("尚未确认");await page.waitForTimeout(750);
    assert.equal(await page.getByLabel("应用次数").innerText(), "2");
    await page.getByRole("button", { name: "销售分析平台", exact: true }).click();
    await page.getByRole("listbox", { name: "销售分析平台选项" }).getByRole("option", { name: "京东", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "3");
    assert.equal(JSON.parse(await page.getByLabel("已应用条件").innerText()).productQuery, "");
    assert.equal(await input.inputValue(), "尚未确认");
    await input.press("Enter");
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "4");
    assert.equal(JSON.parse(await page.getByLabel("已应用条件").innerText()).productQuery, "尚未确认");
    await input.dispatchEvent("compositionstart");await input.fill("商用");await input.press("Enter");
    await page.waitForTimeout(750);assert.equal(await page.getByLabel("应用次数").innerText(), "4");
    await input.dispatchEvent("compositionend");
    // Synthetic composition has no OS candidate engine to consume Enter;
    // restore the committed word before testing the post-composition key.
    await input.fill("商用");
    await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
    assert.equal(await page.getByLabel("应用次数").innerText(), "4");
    await input.press("Enter");await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "5");
    await input.fill("取消的编辑");await page.getByRole("button", { name: "切换范围", exact: true }).click();
    await page.waitForTimeout(750);assert.equal(await input.inputValue(), "商用");
    await page.getByRole("button", { name: "隐藏候选元数据", exact: true }).click();
    assert.match(await page.getByRole("button", { name: "销售分析品类", exact: true }).innerText(), /已选 2 项/);
    await page.getByRole("button", { name: "销售分析品类", exact: true }).click();
    assert.equal(await menu.getByRole("option", { selected: true }).count(), 0);
    await menu.getByRole("button", { name: "清空", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "6");
    await page.keyboard.press("Escape");await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="应用次数"]')?.textContent === "7");
    assert.equal(await input.inputValue(), "");
  } finally { await browser.close(); }
});
