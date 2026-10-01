import assert from "node:assert/strict";
import { resolve } from "node:path";

/** Imperative gates exercise the installed Home; every gate keeps its own source,
 * actions, assertions and failure. Missing captures never waive a required gate. */
export async function runM6FullGates({page,open,ready,records,first,check,save,evidence}){
 const results=[],find=name=>{const r=records.find(r=>r.name===name);assert.ok(r,"Missing original capture "+name);return r;};
 let journal;
 const source=(record,path)=>{let v=record.body;for(const k of path)v=v?.[k];assert.notEqual(v,undefined,"Original source field missing: "+record.name+":"+path.join("."));journal.sources.push({capture:record.name,sha256:record.sha256,seed:record.seed,query:record.query,path,value:v});return v;};
 const act=async(name,fn)=>{journal.actions.push(name);await fn();};
 const verified=(name,fn)=>{fn();journal.assertions.push(name);};
 const served=async record=>{await page.waitForFunction(name=>window.__m6.served.at(-1)?.fixture===name,record.name);await ready();const reply=await page.evaluate(()=>window.__m6.served.at(-1));verified("Exact original query identity/header and unprojected bytes "+record.name,()=>{assert.equal(reply.sha256,record.sha256);assert.equal(reply.noBodyProjection,true);assert.equal(reply.completeOriginalQuery,true);});};
 const format=metric=>page.evaluate(m=>window.__m6Display.formatComparisonMetric(m),metric);
 const pending=async(reason)=>{const calls=await page.evaluate(()=>window.__m6.pending);const error=new Error(reason);error.pending=true;error.requiredCaptures=calls.map(c=>({endpoint:c.path,query:new URLSearchParams(c.query).toString(),reason:c.reason}));throw error;};
 const gate=async(name,fn)=>{
  journal={gate:name,status:"running",sources:[],actions:[],assertions:[]};
  try{await check("Home full gate "+name,async()=>{await fn();assert.ok(journal.sources.length&&journal.actions.length&&journal.assertions.length,"Gate cannot be an empty label");});journal.status="passed";}
  catch(error){journal.status=error.pending?"pending":"failed";journal.error=error.message;journal.requiredCaptures=error.requiredCaptures||[];journal.lastCalls=await page.evaluate(()=>window.__m6.calls.slice(-12));await save("gate-"+name+"-failed-dom.txt",await page.locator("body").innerText());await page.screenshot({path:resolve(evidence,"gate-"+name+"-failed.png"),fullPage:false});}
  await save("gate-"+name+".json",journal);results.push(journal);
 };
 const start=async record=>act("Open original account-bound Home scope "+record.name,()=>open(record));
 await gate("fiveOldNavAndOERP",async()=>{
  source(first,["currentContext","requestedScope"]);await start(first);
  const mapping=[["网店总览","outlets"],["店铺分析","analysis"],["平台对比","platforms"],["推广分析","promotion"],["商品表现","products"]];
  for(const [label,view] of mapping){await act("Actual old navigation "+label,()=>page.getByRole("tab",{name:label,exact:true}).click());await page.getByRole("tab",{name:label,exact:true,selected:true}).waitFor();verified("Old view value "+view,()=>assert.equal(new URL(page.url()).searchParams.get("view"),view));
   if(view==="outlets")for(const mode of["旧视图","新视图"])await act("Actual O "+mode,()=>page.getByRole("button",{name:mode,exact:true}).click());
   if(view==="analysis"){await act("Actual original ERP entry",()=>page.getByRole("button",{name:"原ERP分析",exact:true}).click());verified("Legacy ERP mode",()=>assert.equal(new URL(page.url()).searchParams.get("shopAnalysisMode"),"legacy"));await act("Actual panorama entry",()=>page.getByRole("button",{name:"店铺全景",exact:true}).click());}
  }
  const p=await page.evaluate(()=>window.__m6.pending);verified("Unavailable old source is recorded explicitly, no protected C response reused",()=>{assert.ok(p.some(c=>c.reason.includes("old-view pending")));});
  journal.inheritedProof={path:"tests/fixtures/netshop-m5-home/scenarios.mjs",scope:"M5 old O/ERP entry and error preservation only; operating data remains inherited, no new old-source capture"};
 });
 await gate("metric22",async()=>{
  await start(first);const keys=Object.keys(source(first,["sections","scale","summary","current"]));verified("Exactly 22 original metric fields",()=>assert.equal(keys.length,22));
  await act("Open actual column settings",()=>page.getByText("综合表列设置（规模 / 效率 / 推广）",{exact:true}).click());
  const boxes=page.locator("details.nc-columns input[type='checkbox']"),boxCount=await boxes.count();verified("22 actual column checkboxes",()=>assert.equal(boxCount,keys.length));
  for(let i=0;i<keys.length;i++)await act("Enable native column "+keys[i],()=>boxes.nth(i).check());
  const labels=await page.evaluate(()=>window.__m6Display.metricLabels),headers=await page.getByLabel("经营指标矩阵，横向滚动",{exact:true}).locator("th").allTextContents();
  for(const key of keys)verified("Visible metric header "+key,()=>assert.ok(headers.includes(labels[key])));
  const matrix=page.getByLabel("经营指标矩阵，横向滚动",{exact:true});
  for(const row of first.body.sections.scale.items){const metricSource=source(first,["sections","scale","items",first.body.sections.scale.items.indexOf(row),"current"]);const tr=matrix.locator("tbody tr").filter({has:page.getByRole("button",{name:row.platform+" · "+row.shopName,exact:true})});const cells=tr.locator("td");
   for(let j=0;j<headers.length-2;j++){const key=keys.find(k=>labels[k]===headers[j+1]);assert.ok(key);const expected=await format(metricSource[key]),cell=cells.nth(j+1),text=await cell.innerText(),status=await cell.locator(".nc-metric-cell").first().getAttribute("data-status");verified("Native original metric "+row.objectKey+":"+key+" with status",()=>{assert.ok(text.includes(expected));assert.equal(status,metricSource[key].status);});}
  }
  const erp=find("signed-c-platform-day"),qty=find("signed-c-platform-quantity");await start(erp);source(qty,["sections","scale","summary","current","erpNetQuantity"]);
  await act("Select actual ERP native quantity",()=>page.getByLabel("对比指标",{exact:true}).selectOption("erpNetQuantity"));await served(qty);
  const native=qty.body.sections.scale.summary.current.erpNetQuantity;verified("ERP quantity keeps its original native unit",()=>assert.equal(native.unit,"NATIVE_INTEGER_QUANTITY"));assert.ok((await page.locator(".nc-kpis").first().innerText()).includes(await format(native)));
 });
 await gate("allGrains",async()=>{
  const day=find("signed-c-platform-day");await start(day);
  const choices=await page.getByLabel("对比趋势粒度",{exact:true}).locator("option").evaluateAll(o=>o.map(x=>x.value));verified("All actual grain choices equal original three-value contract",()=>assert.deepEqual(choices,["day","week","month"]));
  for(const grain of["week","month","day"]){const r=find("signed-c-platform-"+grain),points=source(r,["sections","trends","items"]);await act("Select actual "+grain,()=>page.getByLabel("对比趋势粒度",{exact:true}).selectOption(grain));await served(r);verified("Exact original grain "+grain,()=>assert.equal(r.body.trendGrain,grain));const svg=await page.locator(".nc-chart svg").allTextContents();for(const item of points)for(const period of["current","baseline"])for(const point of item[period]){if(point.metric.value!==null)assert.ok(svg.join(" ").includes(point.date),"Original date absent "+point.date);}}
 });
 await gate("sortPageQ",async()=>{
  await start(first);const later=find("signed-c-page2"),before=source(first,["sections","scale","summary"]),population=source(first,["sections","comparability","items"]);source(later,["sections","scale","pagination"]);
  await act("Actual next page",()=>page.getByRole("button",{name:"下一页",exact:true}).click());await served(later);
  verified("Page two retains full owner summary/population",()=>{assert.deepEqual(later.body.sections.scale.summary,before);assert.deepEqual(later.body.sections.comparability.items,population);assert.equal(later.body.sections.scale.pagination.total,first.body.sections.scale.pagination.total);assert.equal(later.body.sections.scale.pagination.page,2);});
  const call=await page.evaluate(()=>window.__m6.calls.filter(c=>c.path==="/api/netshop/comparison-insights").at(-1));verified("Actual page-two request binds prior original section token",()=>assert.equal(new URLSearchParams(call.query).get("sectionToken"),first.body.sectionToken));
  const rejected=await page.evaluate(query=>{try{window.__m6ValidateComparison(query+"&q=unsupported");return false;}catch(e){return {code:e.code,message:e.message};}},first.query);verified("Original comparison validator rejects unsupported q",()=>assert.ok(rejected&&rejected.message));journal.actions.push("Invoke original validator with unsupported q; no fetch or substitute body");
  await start(first);await act("Actual legal ascending sort",()=>page.getByLabel("对比排名排序",{exact:true}).selectOption("value_asc"));await page.waitForFunction(()=>!document.querySelector(".nc-table-group"));
  const match=records.find(r=>r.kind==="comparison"&&r.body.sort==="value_asc"&&r.seed===first.seed);
  if(!match)await pending("Legal value_asc owner response absent; page2 and unsupported-q rejection verified, sort remains required");await served(match);source(match,["sections","scale","items"]);
 });
 await gate("nativePlatformTotals",async()=>{
  const r=find("signed-c-platform-day");await start(r);const periods=source(r,["sections","comparability","erpEvidence","platformPeriods"]);assert.equal(periods.length,2);
  await act("Open independent platform period evidence",()=>page.getByText("各平台整期原始来源",{exact:true}).click());
  const sections=page.locator(".nc-erp-platform-periods > section");assert.equal(await sections.count(),periods.length);
  for(let i=0;i<periods.length;i++){const item=periods[i],section=sections.nth(i);await act("Open "+item.platform+" original evidence",()=>section.getByText("ERP 原始来源与观察证据",{exact:true}).click());
   for(const [j,kind] of["current","baseline"].entries()){const v=source(r,["sections","comparability","erpEvidence","platformPeriods",i,"source","periodTotals",kind,"values"]),dl=section.locator(".nc-erp-values").nth(j),dd=await dl.locator("dd").allTextContents();const money=x=>x===null?"—":(x/100).toLocaleString("zh-CN",{maximumFractionDigits:2})+" 元";
    verified("Native owning totals "+item.platform+":"+kind+", no client summation",()=>{assert.equal(dd[0],money(v.netSalesCents));assert.equal(dd[5],money(v.costCents));assert.equal(dd[6],money(v.grossProfitCents));assert.equal(dd[7],money(v.reportedGrossProfitCents));});
    const quantity=await page.evaluate(x=>window.__m6Display.formatNativeIntegerQuantityValue(x),v.netQuantity);assert.equal(dd[2],quantity);
   }assert.ok((await section.innerText()).includes("零成本也不等于已核验真实零"));
  }const text=await page.locator(".nc-erp-platform-periods").innerText();verified("Unverified stored cost never promoted to trusted zero",()=>{assert.ok(text.includes("未核验历史成本"));assert.ok(text.includes("零成本也不等于已核验真实零"));});
 });
 await gate("memberFold",async()=>{
  const r=find("signed-c-platform-day");await start(r);const platforms=source(r,["sections","comparability","erpEvidence","source","platformSeries","items"]);
  await act("Open full original owner evidence",()=>page.locator(".nc-erp-evidence > .nc-erp-owned-evidence > summary").click());
  for(const platform of platforms){const label=platform.platform+" · "+platform.rawCandidateCount+" 个原始平台/店铺/渠道身份 · 已有授权记录";const fold=page.locator(".nc-erp-evidence > .nc-erp-owned-evidence .nc-erp-platform-evidence details").filter({has:page.getByText(label,{exact:true})});
   assert.equal(await fold.getAttribute("open"),null);await act("Open complete members "+platform.platform,()=>fold.locator("summary").click());const rows=await fold.getByLabel(platform.platform+"完整原始成员，横向滚动",{exact:true}).locator("tbody tr").allTextContents();verified("Every original rawMember retained for "+platform.platform,()=>{assert.equal(rows.length,platform.rawMembers.length);assert.equal(rows.length,platform.rawCandidateCount);platform.rawMembers.forEach((m,i)=>{assert.ok(rows[i].includes(m.platform+" · "+m.rawShopName));assert.ok(rows[i].includes(m.rawChannel));});});await act("Close complete members "+platform.platform,()=>fold.locator("summary").click());assert.equal(await fold.getAttribute("open"),null);
  }
 });
 await gate("calendarClicks",async()=>{
  await start(first);const current=source(first,["currentContext","periods","current"]),baseline=source(first,["baselineContext","periods","current"]),original=page.url();
  for(const [button,window] of[["选择对比本期",current],["选择对比独立基期",baseline]]){
   await act("Open actual calendar "+button,()=>page.getByRole("button",{name:button,exact:true}).click());const picker=page.getByLabel("自定义统计周期",{exact:true});await picker.waitFor();await act("Cancel actual calendar",()=>picker.getByRole("button",{name:"取消",exact:true}).click());assert.equal(page.url(),original);
   await act("Reopen actual calendar "+button,()=>page.getByRole("button",{name:button,exact:true}).click());await act("Clear actual date draft",()=>picker.getByRole("button",{name:"清空",exact:true}).click());await act("Click original start date "+window.startDate,()=>picker.getByRole("button",{name:window.startDate,exact:true}).first().click());await act("Click original end date "+window.endDate,()=>picker.getByRole("button",{name:window.endDate,exact:true}).first().click());await act("Apply original real date range",()=>picker.getByRole("button",{name:"确定",exact:true}).click());await ready();assert.equal(await picker.count(),0);verified("Cancel/apply retained original window with no fabricated dated response",()=>assert.equal(page.url(),original));
  }
 });
 const drillGate=async(kind)=>{
  const r=find("signed-c-platform-day");await start(r);const items=source(r,["sections",kind==="products"?"structure":"scale","items"]),row=items.find(x=>x.objectKey==="platform:京东");assert.ok(row);const original=page.url();
  const selector=kind==="products"?page.locator(".nc-structure-object").filter({has:page.getByRole("heading",{name:"京东",exact:true})}).getByRole("button",{name:"查看商品专题",exact:true}):page.getByLabel("推广对比表，横向滚动",{exact:true}).locator("tbody tr").filter({has:page.getByRole("button",{name:"京东",exact:true})}).getByRole("button",{name:"查看精确范围",exact:true});
  await act("Actual C → "+kind+" exact platform topic",()=>selector.click());await page.waitForFunction(view=>new URL(location.href).searchParams.get("view")===view,kind);
  const endpoint=kind==="products"?"/api/netshop/product-insights":"/api/netshop/promotion-insights";
  await page.waitForFunction(path=>window.__m6.calls.some(c=>c.path===path),endpoint);
  const url=new URL(page.url()),outlets=url.searchParams.getAll("shopOutlet");verified("Drill keeps original platform, outlets, dates and dimension",()=>{assert.equal(url.searchParams.get("shopPlatform"),"京东");assert.deepEqual(outlets,r.body.sections.scale.items.find(x=>x.objectKey==="platform:京东").shopKeys);assert.equal(url.searchParams.get("shopDimension"),r.body.currentContext.requestedScope.dimension);assert.equal(url.searchParams.get("from"),r.body.currentContext.periods.current.startDate);assert.equal(url.searchParams.get("to"),r.body.currentContext.periods.current.endDate);});
  const calls=await page.evaluate(()=>window.__m6.pending),missing=calls.filter(c=>c.path===endpoint);
  journal.observedMissingDirect=missing.map(c=>({endpoint:c.path,query:new URLSearchParams(c.query).toString(),reason:c.reason}));
  if(!missing.length){
   await page.waitForFunction(path=>window.__m6.served.some(c=>c.path===path),endpoint);const servedTopic=await page.evaluate(path=>window.__m6.served.filter(c=>c.path===path).at(-1),endpoint),direct=find(servedTopic.fixture);source(direct,["context","requestedScope"]);verified("Topic response originates from same exact seed and raw bytes",()=>{assert.equal(direct.seed,r.seed);assert.equal(servedTopic.sha256,direct.sha256);});
   const itemIndex=direct.body.sections.items.findIndex(x=>kind==="products"?!!x.identity:x.id!==null&&x.drillable),item=source(direct,["sections","items",itemIndex]);assert.ok(itemIndex>=0,"Original topic needs a real drillable detail identity");
   const title=item.title||item.id;await act("Actual source-bound topic → detail "+title,()=>page.getByRole("button",{name:title,exact:true}).first().click());
   const detailEndpoint=endpoint+"/detail";await page.waitForFunction(path=>window.__m6.calls.some(c=>c.path===path),detailEndpoint);
   const detailMissing=await page.evaluate(path=>window.__m6.pending.some(c=>c.path===path),detailEndpoint);if(detailMissing)await pending("Actual same-seed "+kind+" detail query missing; original identity retained");
   await page.waitForFunction(path=>window.__m6.served.some(c=>c.path===path),detailEndpoint);const detailReply=await page.evaluate(path=>window.__m6.served.filter(c=>c.path===path).at(-1),detailEndpoint),detail=find(detailReply.fixture);
   const identity=source(detail,kind==="products"?["identity"]:["sections","item"]);verified("Detail retains exact original identity and seed",()=>{assert.equal(detail.seed,r.seed);if(kind==="products")assert.deepEqual(identity,item.identity);else{assert.equal(identity.id,item.id);assert.equal(identity.shopKey,item.shopKey);}});
   await act("Actual detail back/close",()=>page.getByRole("button",{name:kind==="products"?"← 返回商品列表":"关闭详情",exact:true}).click());
   await act("Actual topic return to C",()=>page.getByRole("button",{name:kind==="products"?"返回原范围":"返回原列表",exact:true}).click());await ready();verified("Visible return restores original comparison URL",()=>assert.equal(page.url(),original));
  }else{
   await act("Browser back to original comparison",()=>page.goBack());await ready();verified("Drill browser back restores original comparison URL",()=>assert.equal(page.url(),original));
   await pending("Actual same-seed "+kind+" topic full query missing; no scope/dimension/pageSize retargeting");
  }
 };
 await gate("sameSeedPDrill",()=>drillGate("products"));await gate("sameSeedADrill",()=>drillGate("promotion"));
 await gate("late401403409",async()=>{
  const partial=find("signed-c-partial");source(partial,["comparisonScope","coverageFilter"]);
  for(const status of[200,401,403,409]){await start(first);source(first,["currentContext","scopeKey"]);await page.evaluate(s=>window.__m6Control.defer={status:s===200?null:s},status);await act("Defer original scoped refresh "+status,()=>page.getByRole("button",{name:"重新读取",exact:true}).click());await page.waitForFunction(()=>!!window.__m6Control.pending);
   await act("Actual source scope changes to partial",()=>page.getByLabel("对比覆盖状态",{exact:true}).selectOption("partial"));await served(partial);const before=await page.locator(".netshop-comparison").innerText(),url=page.url();await act("Release old original reply after cancellation "+status,()=>page.evaluate(()=>window.__m6Control.pending.release()));await page.waitForTimeout(100);verified("Late "+status+" cannot change newer exact original scope",()=>assert.equal(page.url(),url));assert.equal(await page.locator(".netshop-comparison").innerText(),before);assert.equal(await page.evaluate(()=>window.__m6.faults.at(-1).releasedAfterAbort),true);
  }
 });
 await gate("accountScope",async()=>{
  await start(first);source(first,["currentContext","requestedScope"]);source(find("signed-c-revoked"),["code"]);await act("Switch synthetic restricted principal via actual auth reload",async()=>{await page.evaluate(()=>sessionStorage.setItem("m6-user","B"));await page.reload();});await page.waitForFunction(()=>document.body.innerText.includes("权限"));const protectedRows=await page.locator(".nc-table-group").count(),rawEvidence=await page.locator(".nc-erp-owned-evidence").count(),serves=await page.evaluate(()=>window.__m6.served.length);verified("Prior account protected body clears and B receives no original A body",()=>{assert.equal(protectedRows,0);assert.equal(rawEvidence,0);assert.equal(serves,0);});journal.scope="Actual Home auth invalidation with synthetic principal; backend signed permission proofs remain in original corpus";await page.evaluate(()=>sessionStorage.setItem("m6-user","A"));
 });
 await save("full-gates.json",{results});const unresolved=results.filter(r=>r.status!=="passed");
 if(unresolved.length){await save("full-gates-pending.json",{unresolved:unresolved.map(r=>({gate:r.gate,status:r.status,error:r.error,requiredCaptures:r.requiredCaptures,lastCalls:r.lastCalls})),allElevenRequired:true});throw new Error("M6 full gates unresolved: "+unresolved.map(r=>r.gate+":"+r.status).join(","));}
 return {gates:results.map(({gate,status})=>({gate,status}))};
}
