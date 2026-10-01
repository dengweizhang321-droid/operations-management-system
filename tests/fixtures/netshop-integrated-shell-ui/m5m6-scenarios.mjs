import assert from "node:assert/strict";
export async function runM5M6Scenarios({page,context,origin,check,save,evidence}){
  const query=new URLSearchParams({module:"shop",view:"platforms",period:"custom",from:"2026-09-01",to:"2026-09-01",shopDimension:"spu",shopPageSize:"1"});
  await page.goto(`${origin}/?${query}`);
  await check("M5M6 actual Home registers S/C and C consumes complete owning PG mixed-platform DTO",async()=>{
    await page.getByRole("heading",{name:"店铺与平台对比",exact:true}).waitFor();
    await page.locator(".nc-table-group").first().waitFor();
    assert.equal(await page.getByRole("navigation",{name:"主导航",exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(()=>[window.__integratedModules.panorama,window.__integratedModules.comparison]),[true,true]);
    assert.equal(await page.locator("[data-column='comparison']").count(),1);
    assert.ok((await page.locator(".netshop-comparison").innerText()).includes("所属比较来源准备中"));
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
  await check("all five actual menus and S legacy ERP / O classic-balanced switches remain present",async()=>{
    await page.getByRole("button",{name:"原ERP分析",exact:true}).click();
    await page.getByRole("button",{name:"店铺全景",exact:true}).click();
    for(const name of ["网店总览","店铺分析","平台对比","推广分析","商品表现"]){await page.getByRole("tab",{name,exact:true}).click();await page.getByRole("tab",{name,exact:true,selected:true}).waitFor();if(name==="网店总览"){await page.getByRole("button",{name:"旧视图",exact:true}).click();await page.getByRole("button",{name:"新视图",exact:true}).click();}}
  });
  return {completedScope:"M5M6 actual Home basic S/C author preparation with owning corpus; partial domains; visible and native returns verified",pending:["Complete C/S same-scope direct topic and detail corpus, context directory","C independent custom-baseline/platform/label-only owning captures","Final Sales/finance adapter receipts and independent Q M7"],limitations:["Synthetic browser transport only; no live/business/PG/production/model call in this tool","C table-only and S section-only presentation projections; no business formula, F carrier or source-value rewrite","S nested P SPU3000 and A JDSKU1000 remain distinct; no fake exact-product bridge","Current dependency_pending remains explicit; this run does not certify all eight S chapters or M7","O/legacy switches mount their real source-pending views; no complete legacy metrics supplied"]};
}
