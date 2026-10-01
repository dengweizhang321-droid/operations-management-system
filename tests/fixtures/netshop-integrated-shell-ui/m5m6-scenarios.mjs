import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function runM5M6Scenarios({page,context,origin,check,save,evidence,root}){
  const query=new URLSearchParams({module:"shop",view:"platforms",period:"custom",from:"2026-09-01",to:"2026-09-01",shopDimension:"spu",shopPageSize:"1"});
  await page.goto(`${origin}/?${query}`);
  await check("M5M6 actual Home registers S/C and C consumes complete owning PG mixed-platform DTO",async()=>{
    await page.getByRole("heading",{name:"店铺与平台对比",exact:true}).waitFor();
    await page.locator(".nc-table-group").first().waitFor();
    assert.equal(await page.getByRole("navigation",{name:"主导航",exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(()=>[window.__integratedModules.panorama,window.__integratedModules.comparison]),[true,true]);
    assert.equal(await page.locator("[data-column='comparison']").count(),1);
    assert.ok((await page.locator(".netshop-comparison").innerText()).includes("ERP 比较：当前来源不可用（身份或分类未关联）"));
  });
  await check("C actual search-independent page/sort keeps summary and complete candidate distribution",async()=>{
    const summary=await page.locator(".nc-summary").count()?await page.locator(".nc-summary").innerText():await page.locator(".nc-kpis").first().innerText();
    await page.getByLabel("对比排名排序").selectOption("value_asc");
    await page.getByRole("button",{name:"下一页",exact:true}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("shopPage")==="2");
    await page.waitForFunction(()=>document.querySelector(".nc-table-group"));
    assert.equal(await page.locator(".nc-summary").count()?await page.locator(".nc-summary").innerText():await page.locator(".nc-kpis").first().innerText(),summary);
    const latest=await page.evaluate(()=>window.__integrated.calls.filter(call=>call.path==="/api/netshop/comparison-insights").at(-1));assert.equal(new URLSearchParams(latest.query).get("page"),"2");
  });
  await page.screenshot({path:`${evidence}/m5m6-comparison-desktop.png`,fullPage:true});
  const sq=new URLSearchParams({module:"shop",view:"analysis",period:"custom",from:"2026-09-01",to:"2026-09-01",shopPlatform:"京东",shopOutlet:"京东\u001fA",shopDimension:"spu",shopPageSize:"5",shopSection:"performance"});
  await page.goto(`${origin}/?${sq}`);
  await check("actual S single-shop Home consumes untouched e8f7 P/A/Series composite and keeps missing domains partial",async()=>{
    await page.getByRole("heading",{name:"店铺全景",exact:true}).waitFor();
    await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
    assert.equal(await page.locator("[data-column='panorama']").count(),1);
    assert.equal(await page.getByRole("navigation",{name:"店铺全景章节导航",exact:true}).count(),1);
    const text=await page.locator(".netshop-panorama").innerText();assert.ok(text.includes("准备")||text.includes("尚未"));
    await save("S-actual-composite-dom.txt",text);
  });
  await check("actual S title scrolls while shared top navigation remains fixed",async()=>{
    const before=await page.locator(".sp-title").boundingBox();await page.evaluate(()=>window.scrollTo(0,350));
    const after=await page.locator(".sp-title").boundingBox(),masthead=await page.locator(".shell-masthead").boundingBox();
    assert.ok(after.y<before.y-100);assert.ok(Math.abs(masthead.y)<1);await page.evaluate(()=>window.scrollTo(0,0));
  });
  await page.screenshot({path:`${evidence}/m5m6-panorama-desktop.png`,fullPage:true});
  await check("S actual whole-store P callback and visible return recover the original complete URL",async()=>{
    const original=page.url();
    await page.getByRole("button",{name:"进入同店商品表现",exact:true}).click();
    await page.getByRole("heading",{name:"商品经营明细",exact:true}).waitFor();
    await page.locator(".np-table tbody tr").first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopOutlet"),"京东\u001fA");
    await page.getByRole("button",{name:"返回原范围",exact:true}).click();
    await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
    assert.equal(page.url(),original);
    assert.equal(new URL(page.url()).searchParams.has("shopReturnOrigin"),false);
  });
  await check("S actual whole-store P callback retains native browser back",async()=>{
    const original=page.url();
    await page.getByRole("button",{name:"进入同店商品表现",exact:true}).click();
    await page.getByRole("heading",{name:"商品经营明细",exact:true}).waitFor();
    await page.goBack();
    await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
    assert.equal(page.url(),original);
  });
  for(const width of [390,320]){
    await page.setViewportSize({width,height:900});
    await check(`real complete layout S ${width}px contains page overflow within table scroll areas`,async()=>{const metrics=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,replacement:document.body.innerText.includes("\ufffd")}));assert.ok(metrics.body<=metrics.viewport+2,JSON.stringify(metrics));assert.equal(metrics.replacement,false);await save(`panorama-${width}-geometry.json`,metrics);});
    await page.screenshot({path:`${evidence}/m5m6-panorama-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  for(const name of ["sales","sales-missing-order","workflow"]){
    const body=JSON.parse(await readFile(resolve(root,`tests/fixtures/netshop-panorama/response-${name}.json`),"utf8")),carrier=body.context;
    const request=new URLSearchParams({module:"shop",view:"analysis",period:carrier.requestedScope.periodKind,from:carrier.periods.current.startDate,to:carrier.periods.current.endDate,shopPlatform:carrier.requestedScope.platforms[0],shopOutlet:carrier.requestedScope.shopKeys[0],shopDimension:carrier.requestedScope.dimension,shopPageSize:String(body.tableScope.pageSize),shopSection:body.tableScope.section});
    await page.evaluate(value=>sessionStorage.setItem("integrated-panorama-capture",value),name);
    await page.goto(`${origin}/?${request}`);
    await check(`actual Home accepts untouched owning ${name} composite and preserves its conditional source states`,async()=>{
      await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("shopOutlet"),carrier.requestedScope.shopKeys[0]);
      if(name==="workflow"){
        for(const item of body.sources.workflow.data.items)assert.ok((await page.locator(".sp-timeline").innerText()).includes(item.title));
        assert.equal(await page.locator(".sp-timeline li").count(),body.sources.workflow.data.pagination.returned);
      }else{
        const quantity=page.locator("#panorama-performance .sp-kpi").filter({hasText:"ERP净原生数量"});
        assert.ok((await quantity.innerText()).includes(String(body.sources.sales.data.periods.current.metrics.netQuantity.value)));
        const mean=page.locator("#panorama-performance .sp-kpi").filter({hasText:"ERP已导入订单组净额均值"});
        if(name==="sales-missing-order")assert.ok((await mean.innerText()).includes("缺少可靠ERP订单号"));
        const margin=page.locator("#panorama-performance .sp-kpi").filter({hasText:"订单毛利"});
        assert.equal(await margin.locator(".insights-metric").getAttribute("data-status"),"unavailable");
      }
      const telemetry=await page.evaluate(()=>window.__integrated);assert.equal(telemetry.projections.at(-1).fixture,`S-owning-${name}`);
      await save(`S-${name}-actual-dom.txt`,await page.locator(".netshop-panorama").innerText());
    });
    await page.screenshot({path:`${evidence}/m5m6-panorama-${name}.png`,fullPage:true});
  }
  await page.evaluate(()=>sessionStorage.removeItem("integrated-panorama-capture"));
  await page.goto(`${origin}/?${sq}`);
  await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
  await check("all five actual menus and S legacy ERP / O classic-balanced switches remain present",async()=>{
    await page.getByRole("button",{name:"原ERP分析",exact:true}).click();
    await page.getByRole("button",{name:"店铺全景",exact:true}).click();
    for(const name of ["网店总览","店铺分析","平台对比","推广分析","商品表现"]){await page.getByRole("tab",{name,exact:true}).click();await page.getByRole("tab",{name,exact:true,selected:true}).waitFor();if(name==="网店总览"){await page.getByRole("button",{name:"旧视图",exact:true}).click();await page.getByRole("button",{name:"新视图",exact:true}).click();}}
  });
  await page.goto(`${origin}/?${sq}`);
  await page.getByRole("heading",{name:"逐来源店日覆盖",exact:true}).waitFor();
  await check("actual Home AI draft carries the selected S shop and current dates without sending a model request",async()=>{
    await page.getByRole("button",{name:"让 AI 分析当前网店分析页面",exact:true}).click();
    await page.getByRole("button",{name:"对话详情",exact:true}).click();
    const details=await page.locator(".ai-workbench-details").innerText();
    assert.ok(details.includes("平台：京东"));assert.ok(details.includes("店铺：京东\u001fA"));
    assert.ok((await page.locator(".ai-workbench-context").innerText()).includes("2026-09-01 至 2026-09-01"));
    assert.ok(details.includes("页面筛选不是查询结果"));
    await save("S-actual-ai-draft-context.txt",details);
    assert.deepEqual(await page.evaluate(()=>window.__integrated.paidAttempts),[]);
  });
  const cManifest=JSON.parse(await readFile(resolve(root,"tests/fixtures/netshop-integrated-shell-ui/m5m6-C-source/metadata.json"),"utf8"));
  for(const name of ["actual-owning-platform","actual-owning-label-default","actual-owning-two-chart","actual-owning-erp","actual-owning-erp-zero"]){
    const record=cManifest.records.find(item=>item.case===name),raw=new URLSearchParams(record.query);
    const body=JSON.parse(await readFile(resolve(root,`tests/fixtures/netshop-integrated-shell-ui/m5m6-C-source/${name}.json`),"utf8"));
    const current=body.currentContext.periods.current;
    const request=new URLSearchParams({module:"shop",view:"platforms",period:body.currentContext.requestedScope.periodKind,from:current.startDate,to:current.endDate,shopDimension:body.currentContext.requestedScope.dimension,shopPageSize:"5",shopComparisonIntent:JSON.stringify({...body.comparisonScope,selectedBaseline:body.selectedBaseline}),shopComparisonPrefs:JSON.stringify({schemaVersion:"comparison-ui-v1",metricKey:body.metricKey,chartObjectKeys:body.chartObjectKeys,columnKeys:[body.metricKey],sort:body.sort})});
    for(const platform of raw.getAll("platform"))request.append("shopPlatform",platform);
    for(const outlet of raw.getAll("outlet"))request.append("shopOutlet",outlet);
    await page.evaluate(value=>sessionStorage.setItem("integrated-comparison-capture",value),name);
    await page.goto(`${origin}/?${request}`);
    await check(`actual Home consumes complete unchanged C ${name} and retains its independent baseline and native scope`,async()=>{
      await page.locator(".nc-table-group").first().waitFor();
      assert.equal(await page.getByLabel("对比模式").inputValue(),body.comparisonScope.mode);
      assert.equal(await page.getByLabel("对比指标来源").inputValue(),body.comparisonScope.metricSource);
      assert.ok((await page.locator(".netshop-comparison").innerText()).includes(`${body.baselineContext.periods.current.startDate} — ${body.baselineContext.periods.current.endDate}`));
      const calls=await page.evaluate(()=>window.__integrated.calls),sent=new URLSearchParams(calls.filter(call=>call.path==="/api/netshop/comparison-insights").at(-1).query);
      assert.equal(JSON.parse(sent.get("comparisonScope")).mode,body.comparisonScope.mode);
      assert.equal(sent.get("metricKey"),body.metricKey);
      if(body.comparisonScope.category.mode==="label_only")assert.equal(JSON.parse(sent.get("comparisonScope")).category.evidenceVersion,body.comparisonScope.category.evidenceVersion);
      if(body.comparisonScope.metricSource==="erp")assert.ok((await page.locator(".netshop-comparison").innerText()).includes("历史成本"));
      await save(`C-${name}-actual-dom.txt`,await page.locator(".netshop-comparison").innerText());
    });
    await page.screenshot({path:`${evidence}/m5m6-comparison-${name}.png`,fullPage:true});
    if(name==="actual-owning-platform")await check("actual C custom-baseline AI draft preserves both periods and platform mode without a model call",async()=>{
      await page.getByRole("button",{name:"让 AI 分析当前网店分析页面",exact:true}).click();
      await page.getByRole("button",{name:"对话详情",exact:true}).click();
      const details=await page.locator(".ai-workbench-details").innerText();
      assert.ok(details.includes("基期起日：2026-08-30"));assert.ok(details.includes("基期截止日：2026-08-31"));assert.ok(details.includes("比较对象模式：platform"));
      assert.ok((await page.locator(".ai-workbench-context").innerText()).includes("2026-09-01 至 2026-09-02"));
      await save("C-custom-baseline-actual-ai-draft-context.txt",details);
      assert.deepEqual(await page.evaluate(()=>window.__integrated.paidAttempts),[]);
    });
  }
  return {completedScope:"M5M6 actual Home basic S/C author preparation with owning corpus; partial domains; visible and native returns verified",pending:["Complete C/S same-scope direct topic and detail corpus, context directory","C independent custom-baseline/platform/label-only owning captures","Final Sales/finance adapter receipts and independent Q M7"],limitations:["Synthetic browser transport only; no live/business/PG/production/model call in this tool","C table-only and S section-only presentation projections; no business formula, F carrier or source-value rewrite","S nested P SPU3000 and A JDSKU1000 remain distinct; no fake exact-product bridge","Current dependency_pending remains explicit; this run does not certify all eight S chapters or M7","O/legacy switches mount their real source-pending views; no complete legacy metrics supplied"]};
}
