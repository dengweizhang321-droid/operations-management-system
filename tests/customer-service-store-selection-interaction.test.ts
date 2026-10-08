import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";

const chrome=process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe";
type Fixture = {calls:Record<string, unknown>[];done:number;release:null|(()=>void)};
declare global {interface Window {storeSelectionFixture:Fixture;renderStoreSelection:(canImport:boolean)=>void;}}

test("四店选择必填、提交身份固定且上传时不可换店，非管理员禁用", {skip:!existsSync(chrome),timeout:60_000}, async()=>{
  const bundle=await build({stdin:{contents:`
    import {createRoot} from 'react-dom/client';
    import Card from './app/customer-service-import-card';
    const root=createRoot(document.getElementById('root'));
    window.renderStoreSelection=(canImport)=>root.render(<Card canImport={canImport} onCompleted={async()=>{window.storeSelectionFixture.done++;}}/>);
    window.renderStoreSelection(true);`,loader:"tsx",resolveDir:fileURLToPath(new URL("../",import.meta.url))},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'}});
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720}});const errors:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<div id="root"></div>'}));
    await page.goto("https://store-selection-fixture.invalid/");
    await page.addStyleTag({content:await readFile(new URL("../app/styles/tokens.css",import.meta.url),"utf8")});
    await page.addStyleTag({content:await readFile(new URL("../app/globals.css",import.meta.url),"utf8")});
    await page.evaluate(()=>{
      const s:Fixture={calls:[],done:0,release:null};window.storeSelectionFixture=s;
      window.fetch=async(_input,init)=>{
        if(init?.method==="PUT")return Response.json({ok:true});
        const body=JSON.parse(String(init?.body));s.calls.push(body);
        if(body.action==="init")return Response.json({ok:true,upload:{id:`${body.kind}-${s.calls.length}`,receivedChunkIndexes:[]}});
        if(body.action==="complete"){
          await new Promise<void>(resolve=>{s.release=resolve;});
          return Response.json({ok:true,status:"imported",message:"合成导入完成"});
        }
        throw new Error("unexpected fixture request");
      };
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const select=page.getByRole("button",{name:"客服导入店铺",exact:true});await select.waitFor();
    assert.match(await select.innerText(),/请选择店铺/);
    const files=async()=>{
      await page.locator('input[type="file"]').nth(0).setInputFiles({name:"synthetic.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from("synthetic")});
      await page.locator('input[type="file"]').nth(1).setInputFiles({name:"synthetic.log",mimeType:"text/plain",buffer:Buffer.from("synthetic")});
    };
    await files();assert.equal(await page.getByRole("button",{name:"开始导入并匹配",exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.storeSelectionFixture.calls.length),0);
    await select.click();
    assert.deepEqual(await page.getByRole("option").allTextContents(),jdCustomerServiceStores.map(store=>store.shopName));
    if(process.env.CUSTOMER_STORE_SCREENSHOT)await page.screenshot({path:process.env.CUSTOMER_STORE_SCREENSHOT,fullPage:true});
    for(const [index,store] of jdCustomerServiceStores.entries()) {
      if(index>0){await files();await select.click();}
      await page.getByRole("option",{name:store.shopName,exact:true}).click();
      assert.match(await page.locator('.customer-service-import-actions small').innerText(),new RegExp(store.shopName));
      await page.getByRole("button",{name:"开始导入并匹配",exact:true}).click();
      await page.waitForFunction(()=>window.storeSelectionFixture.release!==null);
      assert.equal(await select.isDisabled(),true);
      assert.equal(await page.getByRole("button",{name:/选择会话记录|synthetic.xlsx/}).isDisabled(),true);
      const requests=await page.evaluate(()=>window.storeSelectionFixture.calls);
      const complete=requests.at(-1)!;assert.equal(complete.storeKey,store.storeKey);assert.equal(complete.shopName,store.shopName);
      const init=requests.filter(item=>item.action==="init").slice(-2);
      assert.ok(init.every(item=>String(item.fingerprint).startsWith(`${store.storeKey}:`)));
      await page.evaluate(()=>{const s=window.storeSelectionFixture;s.release!();s.release=null;});
      await page.waitForFunction(expected=>window.storeSelectionFixture.done===expected,index+1);
      assert.equal(await select.isDisabled(),false);
    }
    await page.evaluate(()=>window.renderStoreSelection(false));
    await page.getByRole("button",{name:"仅管理员可导入",exact:true}).waitFor();
    assert.equal(await select.isDisabled(),true);
    assert.equal(await page.getByRole("button",{name:"选择会话记录 Excel",exact:false}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
