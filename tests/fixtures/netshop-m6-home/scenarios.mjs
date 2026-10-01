import assert from "node:assert/strict";
import { resolve } from "node:path";
function locationFor(record){
 const b=record.body,c=b.currentContext,q=new URLSearchParams(record.query),s=c.requestedScope;
 const intent={...b.comparisonScope,selectedBaseline:b.selectedBaseline};
 const prefs={schemaVersion:"comparison-ui-v1",metricKey:b.metricKey,sort:b.sort,columnKeys:[b.metricKey],chartObjectKeys:JSON.parse(q.get("chartObjectKeys")||"[]")};
 const url=new URLSearchParams({module:"shop",view:"platforms",period:s.periodKind,from:c.periods.current.startDate,to:c.periods.current.endDate,shopDimension:s.dimension,shopGrain:b.trendGrain,shopPage:q.get("page")||"1",shopPageSize:q.get("pageSize")||"20",shopComparisonIntent:JSON.stringify(intent),shopComparisonPrefs:JSON.stringify(prefs)});
 s.platforms.forEach(p=>url.append("shopPlatform",p));s.shopKeys.forEach(k=>url.append("shopOutlet",k));return url;
}
export async function runM6Scenarios({page,origin,check,save,evidence,records,manifest}){
 const cases=records.filter(r=>r.kind==="comparison"&&(r.status||200)===200),first=cases.find(r=>r.name==="signed-c-smoke")||cases[0];
 const ready=()=>page.locator("[data-column='comparison'] .nc-table-group").first().waitFor();
 const open=async record=>{
  if(page.url().startsWith(origin))await page.evaluate(name=>sessionStorage.setItem("m6-case",name),record.name);
  const url=origin+"/?"+locationFor(record);await page.goto(url);
  // A cold URL is intentionally unbound until auth loads. Restore the original
  // account-bound presentation entry through the existing history helper after
  // Home's first scoped read, without changing any source response or account.
  await page.waitForFunction(()=>window.__m6.calls.some(c=>c.path==="/api/netshop/comparison-insights"));
  await page.evaluate(url=>window.__m6RestorePresentation(url),url);await ready();
 };
 await open(first);
 await check("M6 actual Home uniquely registers C alongside S/P/A and uses one primary navigation",async()=>{
  assert.deepEqual(await page.evaluate(()=>window.__m6Modules),{comparison:true,panorama:true,products:true,promotion:true});
  assert.equal(await page.getByRole("navigation",{name:"主导航",exact:true}).count(),1);assert.equal(await page.locator("[data-column='comparison']").count(),1);
 });
 for(const record of cases){
  await open(record);
  await check("Exact original "+record.name+" query/header/phase renders unchanged C body",async()=>{
   const served=await page.evaluate(()=>window.__m6.served.at(-1));assert.equal(served.fixture,record.name);assert.equal(served.noBodyProjection,true);
   assert.equal(await page.getByLabel("对比模式",{exact:true}).inputValue(),record.body.comparisonScope.mode);
   assert.equal(await page.getByLabel("对比指标来源",{exact:true}).inputValue(),record.body.comparisonScope.metricSource);
   assert.equal(await page.getByLabel("对比指标",{exact:true}).inputValue(),record.body.metricKey);
   assert.ok((await page.locator(".netshop-comparison").innerText()).includes(record.body.baselineContext.periods.current.startDate));
   await save(record.name+"-dom.txt",await page.locator(".netshop-comparison").innerText());
  });
 }
 await open(first);
 for(const width of[1440,1280,390,320]){
  await page.setViewportSize({width,height:1000});
  await check("Actual full-layout C "+width+" viewport contains page overflow in native scrollports",async()=>{
   const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,invalidUnicode:document.body.innerText.includes("\ufffd")}));
   assert.ok(value.scroll<=value.width+2,JSON.stringify(value));assert.equal(value.invalidUnicode,false);await save("viewport-"+width+".json",value);
  });
  await page.screenshot({path:resolve(evidence,"m6-"+width+"-viewport.png"),fullPage:false});
 }
 await page.setViewportSize({width:1440,height:1000});
 await check("Unknown complete comparison query is denied and original C body clears before new reply",async()=>{
  const current=first.body;
  const unknownSort=["name_asc","value_asc","growth_desc","decline_desc"].find(sort=>!cases.some(r=>r.body.sort===sort&&r.body.metricKey===current.metricKey&&JSON.stringify(r.body.comparisonScope)===JSON.stringify(current.comparisonScope)&&JSON.stringify(r.body.currentContext.requestedScope)===JSON.stringify(current.currentContext.requestedScope)));
  assert.ok(unknownSort,"Need a legitimate uncaptured sort query, never mislabel an existing captured response unknown");
  await page.getByLabel("对比排名排序",{exact:true}).selectOption(unknownSort);
  await page.waitForFunction(()=>!document.querySelector(".nc-table-group"));
  assert.ok((await page.locator(".netshop-comparison").innerText()).includes("当前范围"));
 });
 for(const status of[401,403,409,503]){
  await open(first);await check("C real reader status "+status+" fences and clears protected previous scope",async()=>{
   await page.evaluate(s=>window.__m6Control.error=s,status);await page.getByRole("button",{name:"重新读取",exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector(".nc-table-group"));assert.equal(await page.locator(".nc-table-group").count(),0);
  });
 }
 await open(first);
 await check("Actual Home AI draft is unsent and binds C original independent baseline/object/category",async()=>{
  await page.getByRole("button",{name:"让 AI 分析当前网店分析页面",exact:true}).click();await page.getByRole("button",{name:"对话详情",exact:true}).click();
  const text=await page.locator(".ai-workbench-details").innerText(),period=await page.locator(".ai-workbench-context").innerText();assert.ok(period.includes(first.body.currentContext.periods.current.startDate+" 至 "+first.body.currentContext.periods.current.endDate));
  if(first.body.selectedBaseline.kind==="custom")assert.ok(text.includes(first.body.selectedBaseline.startDate));
  assert.equal(await page.evaluate(()=>window.__m6.models.length),0);await save("m6-ai-unsent.txt",text);
 });
 const needed=["fiveOldNavAndOERP","metric22","allGrains","sortPageQ","nativePlatformTotals","memberFold","calendarClicks","sameSeedPDrill","sameSeedADrill","late401403409","accountScope"];
 const missing=needed.filter(name=>!manifest.validationCases?.some(c=>c.gate===name));
 if(missing.length){await save("full-gates-pending.json",{missing,reason:"Need final exact same-run full-query/direct corpus; never fabricate a complete total from a page"});throw new Error("M6 full gates pending: "+missing.join(","));}
 // Gate cases are explicit, source-bound declarative actual-control steps; no body retargeting.
 for(const gate of manifest.validationCases){
  const record=cases.find(r=>r.name===gate.capture);assert.ok(record,"Gate must reference a validated original capture");
  assert.ok(Array.isArray(gate.steps)&&gate.steps.length>0&&Array.isArray(gate.assertions)&&gate.assertions.length>0,"Full gate cannot be an empty label");
  await open(record);await check("Final source-bound gate "+gate.gate,async()=>{
   for(const step of gate.steps||[]){
    if(step.action==="select")await page.getByLabel(step.label,{exact:true}).selectOption(step.value);
    else if(step.action==="click")await page.getByRole("button",{name:step.name,exact:true}).click();
    else if(step.action==="back")await page.goBack();
    else if(step.action==="fill")await page.getByLabel(step.label,{exact:true}).fill(step.value);
    else throw Error("Unknown gate action; no code/evaluate/CSS overrides allowed");
   }
   if(gate.expectedCapture){await page.waitForFunction(name=>window.__m6.served.at(-1)?.fixture===name,gate.expectedCapture);}
   if(gate.returnExact){assert.equal(page.url(),origin+"/?"+locationFor(record));}
   for(const assertion of gate.assertions){
    assert.ok(Array.isArray(assertion.sourcePath)&&assertion.sourcePath.length>0,"Assertion must bind an original source field");
    let expected=record.body;for(const key of assertion.sourcePath)expected=expected[key];
    assert.notEqual(expected,undefined,"Missing original source field is pending, never invented");
    if(assertion.kind==="count")assert.equal(await page.locator(assertion.selector).count(),Array.isArray(expected)?expected.length:expected);
    else if(assertion.kind==="text")assert.ok((await page.locator(assertion.selector).innerText()).includes(String(expected)));
    else throw Error("Unknown source-bound assertion; no aggregate/evaluate escape hatch");
   }
  });
 }
 return{completedScope:"M6 actual Home original complete corpus and declared full gates",independentReviewConclusion:null};
}
