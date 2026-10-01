/** C author UI checks. Loopback synthetic fixture only; no business services. */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = process.cwd();
const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID()}`;
const evidenceParent = "E:/codex-artifacts/netshop-scheme2-20261001/comparison/page";
await mkdir(evidenceParent, { recursive: true });
const evidence = resolve(evidenceParent, runId), runtime = resolve(root, ".runtime", `comparison-ui-${runId}`);
await mkdir(evidence); await mkdir(runtime, { recursive: true });
const writeEvidence = (name, value) => writeFile(resolve(evidence, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), { flag: "wx" });
const entry = `
import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ComparisonTrendChart,ComparisonDistributionChart,ComparisonAmountBars} from '../../app/netshop/comparison/ComparisonCharts';
import {InsightMetric,InsightReadState} from '../../app/netshop/shared/components';
import {useScopedRead} from '../../app/netshop/shared/request-state';
import StatisticalPeriodPicker from '../../app/statistical-period-picker';
import '../../app/globals.css';
import '../../app/shell/top-navigation.css';
import '../../app/styles/shared-theme.css';
import '../../app/netshop/comparison/comparison.css';
const metric=(value,unit='CNY_CENT',reason=null,status=null)=>({value,unit,status:status||(reason?'unavailable':'available'),reasonCode:reason,basis:'product_day_sum',sourceIds:['synthetic-product'],aggregation:unit==='RATIO'?'ratio_of_sums':'sum',coverageRef:'synthetic:current'});
function Harness(){
 const [scope,setScope]=useState('A'),[open,setOpen]=useState(false),[baseline,setBaseline]=useState({startDate:'2026-08-01',endDate:'2026-08-28'});
 const load=useCallback(async signal=>{await new Promise(r=>setTimeout(r,scope==='A'?200:10));if(scope==='F')throw Error('合成权限失败');return {scope};},[scope]);
 const read=useScopedRead(scope,load);
 const series=['合成店A','合成店B','合成店C','合成店D'].map((label,index)=>({key:label,label,values:[{label:'09-01',metric:metric(100+index*500)},{label:'09-02',metric:metric(null,'CNY_CENT','missing_day')},{label:'09-03',metric:metric(300+index*500)}]}));
 return <main className="netshop-comparison" data-column="comparison"><div className="nc-heading"><div><h1>店铺与平台对比</h1><p>合成 UI 作者验证；本轮不连接生产 API。</p></div></div><section className="insights-filter-bar"><div className="nc-controls"><label>合成范围<select aria-label="合成范围" value={scope} onChange={e=>setScope(e.target.value)}>{['A','B','C','F'].map(s=><option key={s}>{s}</option>)}</select></label><label className="nc-date date-selector">独立基期<button aria-label="选择独立基期" onClick={()=>setOpen(v=>!v)}>{baseline.startDate} — {baseline.endDate}</button>{open&&<StatisticalPeriodPicker minDate="2025-01-01" maxDate="2026-10-01" startDate={baseline.startDate} endDate={baseline.endDate} onCancel={()=>setOpen(false)} onApply={(startDate,endDate)=>{setBaseline({startDate,endDate});setOpen(false)}}/>}</label></div></section><p id="read-scope">{read.data?.scope}</p><InsightReadState status={read.status} error={read.error}/><div className="nc-grid"><section className="nc-card"><h2><span className="nc-section-number">3.1</span>规模与增长</h2><div className="nc-kpis"><InsightMetric label="真实零" metric={metric(0)}/><InsightMetric label="缺字段" metric={metric(null,'COUNT','missing_field')}/><InsightMetric label="部分覆盖" metric={metric(12345,'CNY_CENT','incomplete_coverage','partial')}/><InsightMetric label="负值" metric={metric(-12345)}/></div><div className="nc-table-scroll"><table className="nc-table"><thead><tr><th>对象</th>{['本期','基期','差额','增长','占比','纳入状态'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{series.map(x=><tr key={x.key}><td>{x.label}</td><td>123.45元</td><td>100元</td><td>23.45元</td><td>23.45%</td><td>25%</td><td>完整覆盖</td></tr>)}</tbody></table></div></section><section className="nc-card nc-half"><h2>3.2 经营效率</h2><ComparisonDistributionChart xLabel="平台成交" yLabel="商品成交转化率" points={series.map((x,i)=>({key:x.key,label:x.label,x:metric(50000+i*60000),y:metric(.015+i*.005,'RATIO'),partial:i===2}))}/></section><section className="nc-card nc-half"><h2>3.3 趋势</h2><ComparisonTrendChart series={series} title="合成趋势"/></section><section className="nc-card nc-half"><h2>3.4 结构</h2><ComparisonAmountBars rows={[{key:'A',label:'合成标签A',metric:metric(12345)},{key:'B',label:'未知标签',metric:metric(0)}]}/></section><section className="nc-card nc-half"><h2>3.5 推广</h2><p className="nc-caption">分类映射不成立时展示该区不可用。</p></section><section className="nc-card"><h2>3.6 可比性</h2><p className="nc-caption">部分覆盖可查看，不能混入完整排名。缺字段不会填写 0。</p><ComparisonTrendChart series={[{key:'invalid',label:'无有效基准',values:[{label:'09-01',metric:metric(null,'MULTIPLE','zero_denominator')}]}]} title="无效指数" indexed/></section></div></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
await writeFile(resolve(runtime,"entry.tsx"), entry, { flag:"wx" });
try { await build({entryPoints:[resolve(runtime,"entry.tsx")],bundle:true,outfile:resolve(runtime,"ui.js"),format:"esm",platform:"browser",conditions:["style"],jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},logLevel:"warning"}); }
catch (error) { await writeEvidence("build-failure.json",{status:"failed",message:error.message});throw error; }
const server=createServer(async(request,response)=>{
 const path=new URL(request.url,"http://127.0.0.1").pathname;
 response.setHeader("Content-Security-Policy","default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'");
 if(path==="/ui.js"||path==="/ui.css"){response.setHeader("Content-Type",path.endsWith(".js")?"text/javascript":"text/css");response.end(await readFile(resolve(runtime,path.slice(1))));return;}
 if(path==="/favicon.ico"){response.writeHead(204).end();return;}
 if(path!=="/"){response.writeHead(404).end();return;}
 response.setHeader("Content-Type","text/html;charset=utf-8");response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{margin:0;padding:12px}#root{max-width:1400px;margin:auto}</style><div id="root"></div><script type="module" src="/ui.js"></script></html>');
});
let browser,page; const checks=[],errors=[];
try{
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(3171,"127.0.0.1",resolve)});
 const resource={role:"C-ui-author",runId,port:3171,pid:process.pid,root,evidence,runtime,synthetic:true,status:"running"};
 await writeEvidence("resource.json",resource);console.log(JSON.stringify(resource));
 // Parent receives the resource before this explicit local test gate is released.
 if(process.argv.includes("--gate"))for(let elapsed=0;elapsed<60000;elapsed+=250){try{await access(resolve(runtime,"continue"));break;}catch{await new Promise(r=>setTimeout(r,250));if(elapsed>=59750)throw Error("UI resource gate was not released");}}
 browser=await chromium.launch({executablePath:process.env.NETSHOP_UI_CHROME??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:3171/");
 const check=async(name,callback)=>{await callback();checks.push(name)};
 await check("six regions and honest metric states",async()=>{for(const prefix of ['3.1','3.2','3.3','3.4','3.5','3.6'])await page.getByRole('heading').filter({hasText:prefix}).waitFor();await page.getByText('0 元',{exact:true}).first().waitFor();await page.getByText('来源缺少字段',{exact:true}).waitFor();await page.getByText('-123.45 元',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="系统主导航"]').count(),0)});
 await check("missing day breaks the trend and invalid index stays empty",async()=>{assert.equal(await page.locator('svg[aria-label="合成趋势"] line[stroke="currentColor"]').count(),0);await page.getByText('有效正基准和完整覆盖不足，当前不绘制指数。',{exact:true}).waitFor()});
 await check("quick switching rejects late response",async()=>{await page.getByLabel('合成范围').selectOption('A');await page.getByLabel('合成范围').selectOption('B');await page.locator('#read-scope').filter({hasText:/^B$/}).waitFor();await page.getByLabel('合成范围').selectOption('C');await new Promise(r=>setTimeout(r,250));assert.equal(await page.locator('#read-scope').textContent(),'C')});
 await check("read failure clears old scope",async()=>{await page.getByLabel('合成范围').selectOption('F');await page.getByRole('alert').waitFor();assert.equal(await page.locator('#read-scope').textContent(),'')});
 await check("original controlled two-month picker applies baseline independently",async()=>{await page.getByLabel('选择独立基期').click();assert.equal(await page.locator('.period-calendar').count(),2);await page.locator('.period-shortcuts').getByRole('button',{name:'前7天',exact:true}).click();await page.locator('.period-picker-footer').getByRole('button',{name:'确定',exact:true}).click();await page.getByLabel('选择独立基期').filter({hasText:'2026-09-18 — 2026-09-24'}).waitFor()});
 await page.screenshot({path:resolve(evidence,'desktop.png'),fullPage:true});
 for(const width of [390,320])await check(`viewport ${width} local scrolling and actual glyph size`,async()=>{await page.setViewportSize({width,height:900});const geometry=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,fonts:[...document.querySelectorAll('.nc-chart-svg text')].map(e=>Number.parseFloat(getComputedStyle(e).fontSize)),table:document.querySelector('.nc-table-scroll').getBoundingClientRect().width}));assert.ok(geometry.scroll<=geometry.client+1,JSON.stringify(geometry));assert.ok(geometry.fonts.every(size=>size>=12),JSON.stringify(geometry));await page.locator('.nc-table-scroll').evaluate(e=>e.scrollLeft=150);const sticky=await page.locator('.nc-table tbody td:first-child').first().evaluate(e=>({left:e.getBoundingClientRect().left,parent:e.closest('.nc-table-scroll').getBoundingClientRect().left}));assert.ok(Math.abs(sticky.left-sticky.parent)<=2,JSON.stringify(sticky));await page.screenshot({path:resolve(evidence,`narrow-${width}.png`),fullPage:true});await page.getByLabel('选择独立基期').click();await page.locator('.stat-period-picker').waitFor();const picker=await page.locator('.stat-period-picker').boundingBox();assert.ok(picker.x>=0&&picker.x+picker.width<=width+1,JSON.stringify(picker));await page.screenshot({path:resolve(evidence,`picker-${width}.png`),fullPage:true});await page.keyboard.press('Escape')});
 assert.deepEqual(errors,[]);await writeEvidence('result.json',{status:'passed',checks,errors,synthetic:true,sourceScope:'chart-primitives-only',notProduction:true});console.log(JSON.stringify({status:'passed',checks:checks.length,evidence}));
}catch(error){if(page)await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true}).catch(()=>{});await writeEvidence('failure.json',{status:'failed',message:error.message,checks,errors});console.error(error);process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));await writeEvidence('resource-stopped.json',{pid:process.pid,port:3171,status:'stopped',browserClosed:true});}
