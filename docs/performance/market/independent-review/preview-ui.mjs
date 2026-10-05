import assert from 'node:assert/strict';
import{writeFile}from'node:fs/promises';
import{resolve}from'node:path';
import{existsSync}from'node:fs';
import{chromium}from'playwright-core';
let root=import.meta.dirname;while(!existsSync(resolve(root,'.git'))){const up=resolve(root,'..');if(up===root)throw Error('Requires Git worktree');root=up;}const out=resolve(root,'.runtime/market-independent-20261005'),checks=[],failures=[],errors=[],requests=[];
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());requests.push({url:u.pathname+u.search,method:req.method()});if(req.method()!=='GET')return route.abort('blockedbyclient');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'3186');return route.continue();});
async function check(name,fn){try{await fn();checks.push(name);console.log('PASS '+name)}catch(e){failures.push({name,error:e.message});console.log('FAIL '+name+': '+e.message)}}
try{
await page.goto('http://127.0.0.1:3186/?module=market',{waitUntil:'domcontentloaded',timeout:30000});
await page.getByLabel('市场开始日期').fill('2026-10-01');await page.getByLabel('市场结束日期').fill('2026-10-04');await page.getByRole('button',{name:'应用日期',exact:true}).click();
await check('actual_synthetic_ranking20_and_pagination',async()=>{await page.locator('.market-ranking-table tbody tr').first().waitFor();assert.equal(await page.locator('.market-ranking-table tbody tr').count(),20);const first=await page.locator('.market-ranking-table tbody tr').first().innerText();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 2 页',{exact:true}).waitFor();assert.equal(await page.locator('.market-ranking-table tbody tr').count(),20);assert.notEqual(await page.locator('.market-ranking-table tbody tr').first().innerText(),first);await page.getByRole('button',{name:'上一页',exact:true}).click();await page.getByText('第 1 / 2 页',{exact:true}).waitFor();});
await check('actual_synthetic_trend_drawer',async()=>{await page.getByRole('button',{name:'查看趋势',exact:true}).first().click();await page.getByRole('dialog',{name:'商品月度趋势'}).waitFor();await page.locator('.market-trend-drawer tbody tr').first().waitFor();await page.getByRole('dialog').getByRole('button',{name:/关闭/}).first().click();});
await check('actual_synthetic_compare_two_full_identities',async()=>{await page.locator('.market-compare-check').nth(0).click();await page.locator('.market-compare-check').nth(1).click();await page.getByRole('button',{name:/进入竞品对比/}).click();await page.locator('.market-compare-grid-live').waitFor();assert.equal(await page.locator('.market-compare-grid-live article').count(),2);});
await check('actual_synthetic_industry_complete',async()=>{await page.getByRole('tab',{name:/行业汇报/}).click();for(const heading of ['京东商用直饮机行业汇报','月度趋势','价格带分析','品牌竞争及品牌份额','细分类目拆分汇总','自营与 POP 经营结构','商品流量 × 转化象限','爆款标题与产品特征信号','细分类目 × 价格带 × 场景机会矩阵','消费者、服务、利润与合规补充清单'])await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.locator('.market-kpi-grid').waitFor();});
await page.screenshot({path:resolve(out,'actual-preview-report.png'),fullPage:true});
}catch(e){failures.push({name:'harness',error:e.stack})}finally{await writeFile(resolve(out,'actual-preview-ui.json'),JSON.stringify({checks,failures,errors,requests,boundary:'GET-only parent isolated preview3186/SQLite synthetic40; no performance claim; no model/write'},null,2));await browser.close()}
console.log(JSON.stringify({checks,failures,errors}));

