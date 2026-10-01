import assert from "node:assert/strict";
import { resolve } from "node:path";

function locationFor(record,extra={}){
 const b=record.body,c=b.context,s=c.requestedScope,t=b.tableScope,w=c.periods.current;
 const q=new URLSearchParams({module:"shop",view:"analysis",period:s.periodKind,from:w.startDate,to:w.endDate,shopDimension:s.dimension,shopPageSize:String(t.pageSize),shopGrain:t.grain,shopSection:t.section,...extra});
 s.platforms.forEach(p=>q.append("shopPlatform",p));s.shopKeys.forEach(k=>q.append("shopOutlet",k));return q;
}
export async function runM5Scenarios({page,origin,check,save,evidence,records}){
 const allRecords=records;records=records.filter(r=>!r.kind||r.kind==="panorama");
 const defaultCase=records.find(r=>r.name==="original-composite")||records.find(r=>r.body.sources.products.state==="ready"&&r.body.sources.products.data.sections.items.length&&r.body.sources.products.data.sections.pagination.total===r.body.sources.products.data.sections.items.length)||records[0];
 const searchId=defaultCase.body.sources.products.data.sections.items[0]?.identity.id;
 assert.ok(searchId,"Whole-list/q drill tests need a complete original nonempty P nested capture");
 const ready=()=>page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
 const open=async(record=defaultCase,extra={})=>{
  if(page.url().startsWith(origin))await page.evaluate(name=>{sessionStorage.setItem("m5-case",name);sessionStorage.setItem("m5-user","A");},record.name);
  await page.goto(origin+"/?"+locationFor(record,extra));await ready();
 };
 const chooseNear7=async(tag)=>{
  await page.getByRole("button",{name:"选择全景统计期间",exact:true}).click();
  const popup=page.getByLabel("自定义统计周期",{exact:true}),quick=popup.getByRole("button",{name:"近7天",exact:true});
  const geometry=()=>page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const trigger=document.querySelector(".sp-date-trigger"),picker=document.querySelector(".netshop-panorama .stat-period-picker"),bar=picker.querySelector(".period-shortcuts"),button=[...bar.querySelectorAll("button")].find(b=>b.textContent==="近7天");
   const parents=[];for(let e=picker;e&&e!==document.documentElement;e=e.parentElement){const c=getComputedStyle(e);parents.push({tag:e.tagName,className:e.className,rect:rect(e),overflowX:c.overflowX,overflowY:c.overflowY,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,position:c.position});}
   return{viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},trigger:rect(trigger),label:rect(trigger.closest("label")),popup:rect(picker),shortcuts:rect(bar),quick:rect(button),scrollLeft:bar.scrollLeft,clientWidth:bar.clientWidth,scrollWidth:bar.scrollWidth,parents};
  });
  let boxes=await geometry();await save(tag+"-before.json",boxes);await page.screenshot({path:resolve(evidence,tag+"-before.png"),fullPage:false});
  assert.ok(boxes.popup.x>=-1&&boxes.popup.right<=boxes.viewport.width+1&&boxes.popup.y>=0&&boxes.popup.y<boxes.viewport.height,"Popup itself outside viewport: "+JSON.stringify(boxes));
  if(boxes.quick.x<boxes.shortcuts.x||boxes.quick.right>boxes.shortcuts.right){
   await page.mouse.move(Math.min(boxes.viewport.width-4,Math.max(4,boxes.shortcuts.x+boxes.shortcuts.width/2)),Math.min(boxes.viewport.height-4,Math.max(4,boxes.shortcuts.y+boxes.shortcuts.height/2)));
   await page.mouse.wheel(boxes.quick.x<boxes.shortcuts.x?-650:650,0);await page.waitForTimeout(100);
   const after=await geometry();await save(tag+"-after-wheel.json",after);assert.notEqual(after.scrollLeft,boxes.scrollLeft,"Real wheel must move the internal horizontal shortcuts");boxes=after;
  }
  assert.ok(boxes.quick.x>=Math.max(0,boxes.shortcuts.x)-1&&boxes.quick.right<=Math.min(boxes.viewport.width,boxes.shortcuts.right)+1,"Shortcut not reachable in real visible scrollport: "+JSON.stringify(boxes));
  await quick.click();await popup.getByRole("button",{name:"确定",exact:true}).click();
  await save(tag+"-after-apply.json",{url:page.url()});
 };
 await open();
 if(process.env.NETSHOP_M5_DATE_PROBE==="1"){
  for(const width of[1440,1280,390,320]){
   await page.setViewportSize({width,height:1000});await open();
   await check("Actual date-picker reachable near7/confirm at "+width,async()=>{await chooseNear7("date-probe-"+width);});
  }
  return{completedScope:"Actual Home isolated date-picker geometry/visible scroll probe",pending:["Full main matrix separate"],limitations:["No forced clicks or CSS mutation"]};
 }
 await check("Actual Home/unique history registers S/P/A and excludes C",async()=>{
  assert.deepEqual(await page.evaluate(()=>window.__m5Modules),{panorama:true,products:true,promotion:true,comparison:false});
  assert.equal(await page.locator("[data-column='panorama']").count(),1);
  assert.equal(await page.getByRole("navigation",{name:"主导航",exact:true}).count(),1);
  assert.equal(await page.getByRole("navigation",{name:"店铺全景章节导航",exact:true}).count(),1);
  assert.equal(await page.locator(".sp-chapter").count(),8);
  assert.equal(new URL(page.url()).searchParams.get("shopOutlet"),defaultCase.body.context.requestedScope.shopKeys[0]);
 });
 await check("Actual statistical-period trigger fits its own field instead of overflowing inherited fixed-height date-selector",async()=>{
  const boxes=await page.evaluate(()=>{
   const date=document.querySelector(".sp-date-trigger"),field=date.closest(".sp-date-selector");
   const rect=e=>{const r=e.getBoundingClientRect();return{y:r.y,height:r.height,bottom:r.bottom};};
   return{trigger:rect(date),field:rect(field),computedFieldHeight:getComputedStyle(field).height};
  });
  await save("date-field-containment.json",boxes);
  assert.ok(boxes.trigger.bottom<=boxes.field.bottom+1,JSON.stringify(boxes));
 });
 await check("Actual layout global CSS fixes shared nav while S title and own filters scroll",async()=>{
  const geometry=()=>page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
   return{masthead:rect(".shell-masthead"),navigation:rect("#primary-navigation"),workspace:rect(".workspace"),title:rect(".sp-title"),filters:rect(".sp-filter-row"),margin:getComputedStyle(document.querySelector(".workspace")).marginLeft};
  });
  const before=await geometry();await page.evaluate(()=>window.scrollTo(0,400));await page.waitForTimeout(90);const after=await geometry();
  assert.ok(Math.abs(before.masthead.y)<1);assert.ok(Math.abs(after.masthead.y)<1);assert.ok(before.navigation.width>before.navigation.height*3);
  assert.equal(before.margin,"0px");assert.ok(after.title.y<before.title.y-200);assert.ok(after.filters.y<before.filters.y-200);
  await save("desktop-layout.json",{before,after});await page.evaluate(()=>window.scrollTo(0,0));
 });
 await page.screenshot({path:resolve(evidence,"m5-home-desktop.png"),fullPage:true});
 await page.screenshot({path:resolve(evidence,"m5-home-desktop-viewport.png"),fullPage:false});
 await check("S whole-list P drill and single visible return restore the complete original URL",async()=>{
  const original=page.url();
  await page.getByRole("button",{name:"进入同店商品表现",exact:true}).click();
  await page.getByRole("heading",{name:"商品经营明细",exact:true}).waitFor();
  await page.locator(".np-table tbody tr").first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("shopOutlet"),defaultCase.body.context.requestedScope.shopKeys[0]);
  assert.equal(await page.getByRole("button",{name:"返回原范围",exact:true}).count(),1);
  await page.getByRole("button",{name:"返回原范围",exact:true}).click();await ready();
  assert.equal(page.url(),original);assert.equal(new URL(page.url()).searchParams.has("shopReturnOrigin"),false);
 });
 await check("Native browser back uses Home popstate and restores the exact same S scope",async()=>{
  const original=page.url();await page.getByRole("button",{name:"进入同店商品表现",exact:true}).click();
  await page.getByRole("heading",{name:"商品经营明细",exact:true}).waitFor();await page.goBack();await ready();assert.equal(page.url(),original);
 });
 if(defaultCase.seed){
  await check("Same-run F empty-outlet directory allows actual explicit single-store choice without retargeted carrier",async()=>{
   await open(defaultCase);const url=new URL(page.url());url.searchParams.delete("shopOutlet");await page.goto(url.toString());
   const select=page.getByLabel("全景平台与店铺",{exact:true});await select.waitFor({state:"visible"});assert.equal(await select.isVisible(),true);await select.locator("option").filter({hasText:defaultCase.body.context.requestedScope.shopKeys[0].split("\u001f")[1]}).waitFor({state:"attached"});
   assert.equal(await page.locator(".sp-chapter").count(),0);await select.selectOption(defaultCase.body.context.requestedScope.shopKeys[0]);await ready();
   const directory=await page.evaluate(()=>window.__m5.projections.filter(x=>x.kind.includes("F directory")).at(-1));assert.ok(directory);await save("same-run-directory-choice.json",directory);
  });
  await open(defaultCase);
  await check("Same-run six owning sources remain ready; native finance period carriers and ERP date axes are visible unchanged",async()=>{
   assert.deepEqual(Object.values(defaultCase.body.sources).map(x=>x.state),["ready","ready","ready","ready","ready","ready"]);
   const finance=page.getByLabel("财报原生月份与年度目标",{exact:true});await finance.waitFor();
   const currentText=await finance.innerText();assert.ok(currentText.includes("2026-09"));
   await finance.getByRole("button",{name:"环比基期涉及月份",exact:true}).click();assert.ok((await finance.innerText()).includes("2026-08"));
   await finance.getByRole("button",{name:"同比基期涉及月份",exact:true}).click();assert.ok((await finance.innerText()).includes("2025-09"));
   const erp=page.getByLabel("ERP原生趋势与日期明细",{exact:true});await erp.waitFor();
   const series=defaultCase.body.sources.sales.data.owning.previous.series;
   const dates=series.items.flatMap(item=>item.current.map(point=>point[0][0]));
   assert.ok((await erp.innerText()).includes(defaultCase.body.context.periods.current.startDate));
   for(const date of dates)assert.ok((await erp.innerText()).includes(date));
   const quantityIndex=series.metricColumns.indexOf("netQuantity");assert.ok(quantityIndex>=0);
   for(const point of series.items[0].current)assert.ok((await erp.locator(".sp-series-table-wrap").innerText()).includes(String(point[1][quantityIndex])));
   assert.ok((await erp.locator(".sp-erp-chart").count())>=1);await save("same-run-finance-erp-native-dom.txt",(await finance.innerText())+"\n"+(await erp.innerText()));
   await save("same-run-domain-status.json",{states:Object.fromEntries(Object.entries(defaultCase.body.sources).map(([k,v])=>[k,v.state])),dates,originalWholeResponseSHA256:defaultCase.sha256,noOldYearlyFixtureMixed:true});
  });
  await open(defaultCase);
  await check("Actual S exact SPU product drill consumes original direct P detail and native list-return scope",async()=>{
   await page.getByLabel("全景商品每页条数",{exact:true}).selectOption("20");await ready();
   await page.waitForFunction(()=> (new URL(location.href).searchParams.get("shopPageSize")||"20")==="20");
   const original=page.url(),detail=allRecords.find(r=>r.kind==="product-detail");assert.ok(detail);
   await page.locator("#panorama-products .sp-product-cell").getByRole("button",{name:detail.body.sections.performance.title,exact:true}).click();
   await page.getByRole("heading",{name:"两期经营成绩",exact:true}).waitFor();
   const request=await page.evaluate(()=>window.__m5.calls.filter(x=>x.path.endsWith("product-insights/detail")).at(-1));
   assert.deepEqual(JSON.parse(new URLSearchParams(request.query).get("productIdentity")),[detail.body.identity.platform,detail.body.identity.shopName,detail.body.identity.dimension,detail.body.identity.id]);
   await page.getByRole("button",{name:"← 返回商品列表",exact:true}).click();await ready();assert.equal(page.url(),original);
   assert.equal(new URL(page.url()).searchParams.has("shopReturnOrigin"),false);
  });
  await open(defaultCase);
  await check("Actual S same-store A widget/topic/detail uses native SKU object, separate from P SPU, and returns exact original scope",async()=>{
   await page.getByLabel("全景商品每页条数",{exact:true}).selectOption("20");await ready();
   await page.waitForFunction(()=> (new URL(location.href).searchParams.get("shopPageSize")||"20")==="20");
   await page.getByRole("button",{name:"推广花费，定位对应章节",exact:true}).click();
   await page.waitForFunction(()=>new URL(location.href).searchParams.get("shopSection")==="promotion");
   const original=page.url(),detail=allRecords.find(r=>r.kind==="promotion-detail");assert.ok(detail);
   await page.getByRole("button",{name:"进入同店同周期推广专题 →",exact:true}).click();await page.getByRole("heading",{name:"推广分析",exact:true}).waitFor();
   await page.getByRole("button",{name:detail.body.sections.item.title,exact:true}).click();await page.getByLabel("推广对象详情",{exact:true}).waitFor();
   const request=await page.evaluate(()=>window.__m5.calls.filter(x=>x.path.endsWith("promotion-insights/detail")).at(-1));
   assert.equal(new URLSearchParams(request.query).get("objectId"),detail.body.sections.item.rowKey);assert.equal(new URLSearchParams(request.query).get("dimension"),"sku");
   assert.equal(new URLSearchParams(request.query).has("productIdentity"),false);
   await page.getByRole("button",{name:"关闭详情",exact:true}).click();await page.getByRole("button",{name:"返回原列表",exact:true}).click();await ready();assert.equal(page.url(),original);
  });
  await open(defaultCase);
 }
 await check("q and page-size project only the complete captured P list, retaining whole-source summary and periods",async()=>{
  const before=await page.locator("#panorama-performance").innerText();
  const input=page.getByLabel("搜索商品ID或标题名称",{exact:true});await input.fill(searchId);
  await page.locator(".sp-search-toolbar").getByRole("button",{name:"搜索",exact:true}).click();await ready();
  await page.waitForFunction(id=>new URL(location.href).searchParams.get("shopQ")===id,searchId);
  assert.equal(await page.locator("#panorama-performance").innerText(),before);
  await page.getByLabel("全景商品每页条数",{exact:true}).selectOption("10");await ready();
  await page.waitForFunction(()=>new URL(location.href).searchParams.get("shopPageSize")==="10");
  assert.equal(await page.locator("#panorama-performance").innerText(),before);
  const projection=await page.evaluate(()=>window.__m5.projections.filter(p=>p.invariantEqual).at(-1));assert.ok(projection);await save("list-projection-invariant.json",projection);
 });
 await open();
 await check("Actual Home page=2 deep link reads a bounded empty later list without changing summary or complete source periods",async()=>{
  const before=await page.locator("#panorama-performance").innerText();
  await open(defaultCase,{shopPage:"2"});
  assert.equal(new URL(page.url()).searchParams.get("shopPage"),"2");
  assert.equal(await page.locator("#panorama-performance").innerText(),before);
  const last=await page.evaluate(()=>window.__m5.projections.filter(p=>p.path==="/api/netshop/store-panorama").at(-1));
  assert.equal(last.invariantEqual,true);assert.equal(new URLSearchParams(last.query).get("page"),"2");
  await save("page2-whole-source-invariant.json",last);
 });
 await open();
 for(const width of[390,320]){
  await page.setViewportSize({width,height:900});
  await check("Actual Home S "+width+"px contains overflow and preserves mobile shared navigation",async()=>{
   await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(80);
   const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,replacement:document.body.innerText.includes("\ufffd"),overflowElements:[...document.querySelectorAll(".netshop-panorama *")].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,className:e.className,x:r.x,right:r.right,width:r.width,client:e.clientWidth,scroll:e.scrollWidth,minWidth:s.minWidth,display:s.display,overflowX:s.overflowX,text:e.tagName==="SELECT"?e.getAttribute("aria-label"):null};}).filter(e=>e.right>innerWidth+2&&e.width>100).slice(0,45)}));
   await save("geometry-"+width+"-before-check.json",size);
   assert.ok(size.scroll<=size.width+2,JSON.stringify(size));assert.equal(size.replacement,false);
   const fields=await page.evaluate(()=>{
    const date=document.querySelector(".sp-date-trigger"),next=document.querySelector('[aria-label="全景商品维度"]').closest("label");
    return{dateBottom:date.getBoundingClientRect().bottom,nextFieldTop:next.getBoundingClientRect().top};
   });
   assert.ok(fields.dateBottom<=fields.nextFieldTop+1,JSON.stringify(fields));
   assert.equal(await page.locator("#primary-navigation").evaluate(e=>getComputedStyle(e).display),"none");
   await page.getByRole("button",{name:"打开主导航",exact:true}).click();await page.locator('#primary-navigation[role="dialog"]').waitFor({state:"visible"});
   await page.getByRole("button",{name:"关闭主导航",exact:true}).click();await save("geometry-"+width+".json",size);
  });
  await page.screenshot({path:resolve(evidence,"m5-home-"+width+".png"),fullPage:true});
  await page.screenshot({path:resolve(evidence,"m5-home-"+width+"-viewport.png"),fullPage:false});
 }
 await page.setViewportSize({width:1440,height:1000});
 for(const record of records){
  await open(record);
  await check("Complete immutable S capture "+record.name+" binds actual source identity/date and conditional domain states",async()=>{
   const url=new URL(page.url()),body=record.body;assert.equal(url.searchParams.get("shopOutlet"),body.context.requestedScope.shopKeys[0]);
   assert.equal(url.searchParams.get("from"),body.context.periods.current.startDate);assert.equal(url.searchParams.get("to"),body.context.periods.current.endDate);
   const projection=await page.evaluate(()=>window.__m5.projections.filter(x=>x.path==="/api/netshop/store-panorama").at(-1));assert.equal(projection.fixture,record.name);assert.equal(projection.kind,"unchanged complete captured owning response");
   if(body.sources.workflow.state==="ready"){const text=await page.locator(".sp-timeline").innerText();for(const item of body.sources.workflow.data.items)assert.ok(text.includes(item.title));assert.equal(await page.locator(".sp-timeline li").count(),body.sources.workflow.data.pagination.returned);}
   if(record.name==="sales-missing-order")assert.ok((await page.locator("#panorama-performance").innerText()).includes("缺少可靠ERP订单号"));
   await save(record.name+"-actual-dom.txt",await page.locator(".netshop-panorama").innerText());
  });
 }
 await open();
 await check("All five old navigation values, O classic/balanced and old ERP analysis retain actual entries/errors",async()=>{
  await page.getByRole("button",{name:"原ERP分析",exact:true}).click();assert.equal(new URL(page.url()).searchParams.get("shopAnalysisMode"),"legacy");
  await page.getByRole("button",{name:"店铺全景",exact:true}).click();await ready();
  for(const name of["网店总览","店铺分析","平台对比","推广分析","商品表现"]){
   await page.getByRole("tab",{name,exact:true}).click();await page.getByRole("tab",{name,exact:true,selected:true}).waitFor();
   if(name==="网店总览"){await page.getByRole("button",{name:"旧视图",exact:true}).click();await page.getByRole("button",{name:"新视图",exact:true}).click();}
  }
 });
 for(const status of[401,403,409,503]){
  await open();
  await check("Actual S scoped reader "+status+" clears previously trusted sections and displays authoritative error",async()=>{
   await page.evaluate(s=>window.__m5Control.error=s,status);
   await page.locator(".sp-filter-row").getByRole("button",{name:"刷新",exact:true}).click();
   await page.locator(".netshop-panorama").getByRole("button",{name:"重新读取",exact:false}).last().waitFor();
   assert.equal(await page.locator(".sp-chapter").count(),0);
   const text=await page.locator(".netshop-panorama").innerText();
   assert.ok(status===503?text.includes("M5 injected source failure"):status===409?text.includes("版本"):text.includes("权限"));
   await save("fault-"+status+".txt",text);
  });
 }
 for(const status of[200,401,403,409]){
  await open();
  await check("Late "+status+" after actual platform/shop scope cancellation cannot revive or invalidate new scope",async()=>{
   await page.evaluate(s=>window.__m5Control.defer={status:s===200?null:s},status);
   await page.locator(".sp-filter-row").getByRole("button",{name:"刷新",exact:true}).click();
   await page.waitForFunction(()=>!!window.__m5Control.pending);
   await page.getByLabel("全景平台",{exact:true}).selectOption("天猫");
   await page.waitForFunction(()=>new URL(location.href).searchParams.get("shopPlatform")==="天猫");
   assert.equal(new URL(page.url()).searchParams.has("shopOutlet"),false);
   const before=await page.locator(".netshop-panorama").innerText();
   await page.evaluate(()=>window.__m5Control.pending.release());await page.waitForTimeout(100);
   assert.equal(await page.locator(".netshop-panorama").innerText(),before);assert.equal(await page.locator(".sp-chapter").count(),0);
   assert.equal(await page.evaluate(()=>window.__m5.faults.at(-1).releasedAfterAbort),true);
  });
 }
 if(process.env.NETSHOP_M5_VALIDATION_SCOPE!=="transport"){
 await open();
 await check("Actual period picker changes date scope and clears unsupported old result without retargeting a carrier",async()=>{
  await chooseNear7("date-change");
  await page.waitForFunction(()=>new URL(location.href).searchParams.get("from")==="2026-09-25");
  assert.equal(new URL(page.url()).searchParams.get("to"),"2026-10-01");
  await page.waitForFunction(()=>!document.querySelector(".sp-chapter"));assert.equal(await page.locator(".sp-chapter").count(),0);
 });
 for(const status of[200,401,403,409]){
  await open();
  await check("Late "+status+" after actual date picker changes scope cannot overwrite the newer explicit source-pending error",async()=>{
   await page.evaluate(s=>window.__m5Control.defer={status:s===200?null:s},status);
   await page.locator(".sp-filter-row").getByRole("button",{name:"刷新",exact:true}).click();await page.waitForFunction(()=>!!window.__m5Control.pending);
   await chooseNear7("date-late-"+status);
   await page.waitForFunction(()=>new URL(location.href).searchParams.get("from")==="2026-09-25");
   await page.waitForFunction(()=>document.body.innerText.includes("当前范围的数据尚未准备完成"));
   const before=await page.locator(".netshop-panorama").innerText();
   await page.evaluate(()=>window.__m5Control.pending.release());await page.waitForTimeout(100);
   assert.equal(await page.locator(".netshop-panorama").innerText(),before);assert.equal(await page.locator(".sp-chapter").count(),0);
   assert.equal(await page.evaluate(()=>window.__m5.faults.at(-1).releasedAfterAbort),true);
  });
 }
 }
 await open();
 await check("Changed restricted account cannot receive old account fixture or retain its protected S sections",async()=>{
  await page.evaluate(()=>sessionStorage.setItem("m5-user","B"));await page.reload();
  await page.getByRole("heading",{name:"店铺全景",exact:true}).waitFor();
  await page.waitForFunction(()=>document.body.innerText.includes("权限"));
  assert.equal(await page.locator(".sp-chapter").count(),0);await save("account-restriction.txt",await page.locator(".netshop-panorama").innerText());
 });
 await open();
 await check("Actual Home AI draft names exact single shop/current dates as low-trust scope with no send",async()=>{
  await page.getByRole("button",{name:"让 AI 分析当前网店分析页面",exact:true}).click();
  await page.getByRole("button",{name:"对话详情",exact:true}).click();
  const details=await page.locator(".ai-workbench-details").innerText(),context=await page.locator(".ai-workbench-context").innerText();
  assert.ok(details.includes(defaultCase.body.context.requestedScope.shopKeys[0]));assert.ok(details.includes("平台：京东"));assert.ok(details.includes("页面筛选不是查询结果"));
  assert.ok(context.includes(defaultCase.body.context.periods.current.startDate+" 至 "+defaultCase.body.context.periods.current.endDate));
  assert.deepEqual(await page.evaluate(()=>window.__m5.models.filter(x=>!x.probe)),[]);await save("ai-unsent-scope.txt",details+"\n"+context);
 });
 await check("Bounded transport deliberately denies unknown GET, business writes, model sends and external fetch",async()=>{
  const statuses=await page.evaluate(async()=>{window.__m5Control.probe=true;try{return await Promise.all([fetch("/api/unknown"),fetch("/api/netshop/import",{method:"POST"}),fetch("/api/ai/chat",{method:"POST"}),fetch("https://example.invalid/blocked")].map(async p=>(await p).status));}finally{window.__m5Control.probe=false;}});
  assert.deepEqual(statuses,[503,405,405,503]);await save("safety-blocking-probes.json",{statuses,noRealRequests:true});
 });
 return{completedScope:defaultCase.seed?"M5 actual Home same-run six sources/directory/direct topics/details synthetic transport":"M5 actual Home/layout/history synthetic source-bound author baseline",validationScope:process.env.NETSHOP_M5_VALIDATION_SCOPE||"full",pending:[...(process.env.NETSHOP_M5_VALIDATION_SCOPE==="transport"?["Known Root CSS fixed-popup correction requires full date matrix and1440/1280/390/320 real click probe"]:[]),...(!defaultCase.seed?["Final same-run six-source/directory/direct corpus opt-in"]:[]),"Full original ERP/O operating-data regression inherited from M1/M4, only entry/error tested here","Real source, production and five-column M7 verification"],limitations:["Only explicitly captured same-seed records are matched; no older finance/year corpus mixed into current six-source body","Captured native S data and untouched nested P/A projection are synthetic PG evidence, not independent live HTTP","List q/page presentation projections retain complete summary/series/source periods; no browser business aggregation","Unknown date/shop/grain shows source_pending rather than fabricating context, coverage, tokens or amounts","Current account transport uses synthetic auth response and verifies UI invalidation only; backend permissions separately certified","Tool author execution is not independent Q"]};
}
