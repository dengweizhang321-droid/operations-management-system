/* Synthetic UI checks only. This script never queries a business API or PostgreSQL. */
(async () => {
const { default: assert } = await import('node:assert/strict');
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { default: crypto } = await import('node:crypto');
const { chromium } = await import('playwright-core');
const demoRoot = path.resolve(__dirname, '../../../app/netshop/comparison/demo');

const url = new URL(process.argv[2] || 'http://127.0.0.1:3170/');
assert.equal(url.hostname, '127.0.0.1', 'Only an isolated loopback demo is allowed');
assert.ok(Number(url.port) >= 3100 && Number(url.port) <= 3900);
const out = path.join(demoRoot, 'evidence');
fs.mkdirSync(out, {recursive: true});
const cases = [];
const errors = [];
const requests = [];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(demoRoot, f))).digest('hex');

  const browser = await chromium.launch({headless: true, ...(process.env.COMPARISON_CHROME ? {executablePath: process.env.COMPARISON_CHROME} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}, locale: 'zh-CN', timezoneId: 'Asia/Shanghai'});
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push({method: r.method(), url: r.url()}));
  const check = async (name, fn) => {
    try { await fn(); cases.push({name, result: 'pass'}); }
    catch (e) { cases.push({name, result: 'fail', detail: e.message}); }
  };
  const snapshot = () => page.evaluate(() => window.comparisonDemo.snapshot());
  const set = patch => page.evaluate(x => window.comparisonDemo.setState(x), patch);
  const topForCapture = () => page.evaluate(() => {window.scrollTo({top:0,left:0,behavior:'instant'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  try {
    const response = await page.goto(url.href);
    await page.waitForFunction(() => Boolean(window.comparisonDemo));
    await check('Static-only CSP and synthetic disclosure', async () => {
      assert.equal(response.status(), 200);
      assert.ok(response.headers()['content-security-policy'].includes("connect-src 'none'"));
      assert.match(await page.locator('body').innerText(), /合成/);
    });
    await check('System font, palette and top-level column positions match the approved shell', async () => {
      assert.equal(fs.readFileSync(path.join(demoRoot,'system-tokens.css'),'utf8'),fs.readFileSync(path.join(demoRoot,'../../../styles/tokens.css'),'utf8'));
      const style=await page.evaluate(()=>{
        const header=document.querySelector('.system-masthead'),tabs=document.querySelector('.system-subnav'),active=tabs.querySelector('.active');
        return {font:getComputedStyle(document.body).fontFamily,bodySize:getComputedStyle(document.body).fontSize,tableSize:getComputedStyle(document.querySelector('td')).fontSize,bg:getComputedStyle(header).backgroundColor,tabBg:getComputedStyle(active).backgroundColor,margin:getComputedStyle(document.querySelector('.app-body')).marginLeft,header:header.getBoundingClientRect().toJSON(),tabs:tabs.getBoundingClientRect().toJSON(),columns:[...tabs.querySelectorAll('button')].map(e=>e.textContent)};
      });
      assert.match(style.font,/Inter.*SF Pro Display.*PingFang SC.*Microsoft YaHei/);
      assert.equal(style.bodySize,'14px'); assert.equal(style.tableSize,'13px');
      assert.equal(style.bg,'rgb(41, 63, 50)'); assert.equal(style.tabBg,'rgb(243, 247, 244)');
      assert.equal(style.margin,'0px'); assert.equal(style.header.top,0); assert.ok(style.tabs.top>=style.header.bottom);
      assert.deepEqual(style.columns.slice(0,5),['店铺全景','网店总览','店铺与平台对比','商品表现','推广分析']);
    });
    await check('Only approved balanced design remains with six sections', async () => {
      const s=await snapshot();
      assert.equal(s.state.design,1);
      assert.equal(await page.locator('.design-choice').count(),0);
      assert.deepEqual(await page.evaluate(()=>window.comparisonDemo.designs.map(x=>x.id)),[1]);
      for(let section=1;section<=6;section++)assert.ok(await page.locator(`[data-section="3.${section}"]`).count());
      assert.ok((await snapshot()).selectedIds.length>=2&&(await snapshot()).selectedIds.length<=4);
      await topForCapture();await page.screenshot({path:path.join(out,'balanced-desktop.png'),fullPage:true});
    });
    await check('Category selection changes summaries, trends, structure and ranking context', async () => {
      await set({mode:'shops',platform:'JD',source:'platform',categoryId:'all',grain:'day',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-03'});
      const before=await snapshot();
      await page.getByTestId('category-filter').selectOption('commercial');
      const after=await snapshot();
      assert.equal(after.state.categoryId,'commercial');
      assert.notEqual(after.totals.current.amount,before.totals.current.amount);
      assert.notEqual(after.series[0].points[0].value,before.series[0].points[0].value);
      assert.ok(after.objects.every(o=>o.categories[0]===1));
      assert.match(await page.locator('.scope-summary').innerText(),/商用设备/);
      assert.notEqual(after.objects[0].products,before.objects[0].products);
    });
    await check('Synthetic category facts conserve signed integer totals and missing fields', async () => {
      const fields=['amount','orders','units','net','cost','grossProfit','platformAmount','refund','spend','attribution','impressions','clicks','visitors'];
      await set({categoryId:'all',source:'erp',currentStart:'2026-08-01',currentEnd:'2026-08-03',previousStart:'2026-07-01',previousEnd:'2026-07-03'});
      const full=await snapshot(),partitions=[];
      for(const categoryId of ['commercial','cooking','parts','unknown']){await set({categoryId});partitions.push(await snapshot());}
      for(const object of full.objects)for(const period of ['current','previous'])for(const field of fields){
        const values=partitions.map(p=>p.objects.find(o=>o.id===object.id)[period][field]);
        if(object[period][field]===null)assert.ok(values.every(v=>v===null));
        else assert.equal(values.reduce((a,b)=>a+b,0),object[period][field]);
      }
      await set({platform:'TMALL',categoryId:'unknown'});
      const missing=(await snapshot()).objects.find(o=>o.id==='TMALL:E');
      assert.equal(missing.current.net,null);assert.equal(missing.previous.amount,null);
    });
    await check('Category changes reset pagination and preserve filter scope through details', async () => {
      await set({platform:'all',source:'platform',categoryId:'all',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28',page:2});
      await page.getByTestId('category-filter').selectOption('parts');
      assert.equal((await snapshot()).state.page,1);
      const before=(await snapshot()).state;
      await page.evaluate(()=>window.comparisonDemo.openDetail('store','JD:A'));
      assert.match(await page.locator('.drawer').innerText(),/配件/);
      await page.getByTestId('detail-close').click();assert.deepEqual((await snapshot()).state,before);
      await set({categoryId:'all'});
    });
    await check('Calendar clicks only commit on confirmation and keep the category scope', async () => {
      await set({platform:'JD',categoryId:'commercial',currentStart:'2026-09-01',currentEnd:'2026-09-28'});
      const before=(await snapshot()).state;
      await page.getByTestId('custom-current').click();
      await page.getByTestId('date-day-2026-09-10').click();
      assert.ok(await page.getByTestId('date-apply').isDisabled());
      await page.getByTestId('date-day-2026-09-20').click();
      assert.deepEqual((await snapshot()).state,before);
      await page.screenshot({path:path.join(out,'balanced-custom-date-desktop.png'),fullPage:false});
      await page.getByTestId('date-apply').click();
      const s=await snapshot();assert.equal(s.state.currentStart,'2026-09-10');assert.equal(s.state.currentEnd,'2026-09-20');assert.equal(s.state.categoryId,'commercial');
      assert.ok(await page.getByTestId('custom-current').evaluate(el=>el===document.activeElement));
    });
    await check('Calendar clear, cancellation and Escape preserve the committed periods', async () => {
      const before=(await snapshot()).state;
      await page.getByTestId('custom-current').click();await page.getByTestId('date-clear').click();
      assert.ok(await page.getByTestId('date-apply').isDisabled());
      await page.getByTestId('date-cancel').click();assert.deepEqual((await snapshot()).state,before);
      await page.getByTestId('custom-previous').click();await page.keyboard.press('Escape');
      assert.deepEqual((await snapshot()).state,before);
    });
    await check('Calendar previous-month shortcut updates the baseline only', async () => {
      const before=(await snapshot()).state;
      await page.getByTestId('custom-previous').click();await page.getByTestId('date-shortcut-上月').click();await page.getByTestId('date-apply').click();
      const s=await snapshot();assert.equal(s.state.previousStart,'2026-08-01');assert.equal(s.state.previousEnd,'2026-08-31');assert.equal(s.state.currentStart,before.currentStart);assert.equal(s.state.currentEnd,before.currentEnd);
    });
    await check('Mouse drag can select a range across the two months without early application', async () => {
      const before=(await snapshot()).state;
      await page.getByTestId('custom-current').click();
      const start=await page.getByTestId('date-day-2026-08-30').boundingBox(),end=await page.getByTestId('date-day-2026-09-03').boundingBox();
      await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
      await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:15});await page.mouse.up();
      const draft=await page.evaluate(()=>window.comparisonDatePicker.snapshot());
      assert.equal(draft.startDate,'2026-08-30');assert.equal(draft.endDate,'2026-09-03');assert.deepEqual((await snapshot()).state,before);
      await page.getByTestId('date-cancel').click();
    });
    await check('Invalid, future, reversed and excessive custom ranges cannot be confirmed', async () => {
      const before=(await snapshot()).state;
      await page.getByTestId('custom-current').click();
      for(const [start,end] of [['2026-09-31','2026-09-30'],['2026-10-01','2026-10-02'],['2026-09-20','2026-09-10'],['2025-01-01','2026-09-30']]){
        await page.getByTestId('date-draft-start').fill(start);await page.getByTestId('date-draft-end').fill(end);assert.ok(await page.getByTestId('date-apply').isDisabled());
        assert.deepEqual((await snapshot()).state,before);
      }
      await page.getByTestId('date-cancel').click();
      await set({categoryId:'all',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28'});
    });
    await check('Product detail never replaces a selected category with another category', async () => {
      for(const categoryId of ['cooking','parts','unknown']){
        await set({categoryId});await page.evaluate(()=>window.comparisonDemo.openDetail('product','JD:A'));
        const body=await page.locator('.drawer').innerText();assert.match(body,/单品明细未提供/);assert.doesNotMatch(body,/10001|532 元/);
        await page.getByTestId('detail-close').click();
      }
      await set({categoryId:'commercial'});await page.evaluate(()=>window.comparisonDemo.openDetail('product','JD:A'));
      assert.match(await page.locator('.drawer').innerText(),/M-001/);
      assert.deepEqual(await page.locator('.drawer tbody tr td:nth-child(3)').allTextContents(),['商用设备','商用设备']);
      await page.getByTestId('detail-close').click();await set({categoryId:'all'});
    });
    await check('Sold product count respects source coverage, zero sales and category conservation', async () => {
      await set({platform:'JD',source:'platform',categoryId:'all',currentStart:'2026-08-01',currentEnd:'2026-08-01'});
      const full=await snapshot();assert.equal(full.objects.find(o=>o.id==='JD:C').products,0);
      const categories=[];
      for(const categoryId of ['commercial','cooking','parts','unknown']){await set({categoryId});categories.push(await snapshot());}
      for(const row of full.objects){assert.equal(categories.reduce((total,s)=>total+s.objects.find(o=>o.id===row.id).products,0),row.products);assert.ok(row.products<=row.current.days.reduce((total,d)=>total+d.units,0));}
      await set({categoryId:'all',source:'erp',currentStart:'2026-09-15',currentEnd:'2026-09-15'});
      assert.equal((await snapshot()).objects.find(o=>o.id==='JD:C').products,null);
      await set({source:'platform',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28'});
    });
    await check('Reselected objects keep matching chip and trend colors', async () => {
      await set({platform:'JD',selectedIds:['JD:A','JD:B','JD:C']});
      await page.getByTestId('object-JD-A').click();await page.getByTestId('object-JD-A').click();
      assert.deepEqual((await snapshot()).state.selectedIds,['JD:A','JD:B','JD:C']);
      const pairs=await page.evaluate(()=>['A','B','C'].map(code=>{
        const chip=document.querySelector(`[data-testid="object-JD-${code}"] i`);
        const legend=[...document.querySelectorAll('.legend span')].find(el=>el.textContent.includes(`京东 ${code} 店`));
        return [getComputedStyle(chip).backgroundColor,getComputedStyle(legend.querySelector('i')).backgroundColor];
      }));
      assert.ok(pairs.every(([chip,legend])=>chip===legend));
    });
    await check('Platform mode keeps platforms separate from shop totals', async () => {
      await page.getByTestId('platform-filter').selectOption('all');
      await set({currentStart:'2026-09-01',currentEnd:'2026-09-03',source:'platform',coverage:'all'});
      await page.getByTestId('mode-platforms').click();
      const s = await snapshot();
      assert.equal(s.state.mode, 'platforms');
      assert.equal(s.objects.length, 2);
      assert.equal(new Set(s.objects.map(x => x.id)).size, 2);
      assert.ok(s.totals.current.amount>0);
      for(const platform of s.objects) {
        assert.equal(platform.current.amount,platform.children.reduce((sum,shop)=>sum+shop.current.amount,0));
      }
      assert.equal(s.totals.current.amount,s.objects.reduce((sum,o)=>sum+o.current.amount,0));
      const expander = page.locator('[data-testid^="expand-platform-"]').first();
      await expander.click();
      assert.match(await page.getByTestId('ranking-table').innerText(), /演示/);
      assert.deepEqual((await snapshot()).totals.current, s.totals.current);
    });
    await check('Source/date/grain controls alter the actual dataset', async () => {
      await page.getByTestId('mode-shops').click();
      await page.getByTestId('platform-filter').selectOption('JD');
      const before = await snapshot();
      await page.getByTestId('source-filter').selectOption('erp');
      const erp = await snapshot();
      assert.equal(erp.state.source, 'erp');
      assert.notEqual(erp.totals.current.amount, before.totals.current.amount);
      await page.getByTestId('custom-current').click();
      await page.getByTestId('date-draft-end').fill('2026-09-20');
      await page.getByTestId('date-apply').click();
      const shorter = await snapshot();
      assert.notEqual(shorter.totals.current.amount, erp.totals.current.amount);
      await page.getByTestId('grain-week').click();
      assert.equal((await snapshot()).state.grain, 'week');
      await page.getByTestId('grain-month').click();
      assert.equal((await snapshot()).state.grain, 'month');
      await page.getByTestId('grain-day').click();
    });
    await check('Partial coverage is visible and cannot produce full growth or rate', async () => {
      await set({platform:'all',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-29',previousStart:'2026-08-01',previousEnd:'2026-08-29'});
      await page.getByTestId('coverage-filter').selectOption('partial');
      const s = await snapshot();
      assert.ok(s.objects.length > 0);
      assert.ok(s.objects.every(x => x.status !== 'available'));
      assert.ok(s.objects.every(x => x.growth.value == null));
      assert.ok(s.objects.every(x => x.ratios.promotionRate == null));
      await page.getByTestId('coverage-filter').selectOption('complete');
      assert.ok((await snapshot()).objects.every(x => x.status === 'available'));
    });
    await check('Rapid range changes end with the latest explicit range', async () => {
      await set({platform:'JD',source:'erp',coverage:'all',currentEnd:'2026-09-20'});
      await set({platform:'TMALL',source:'platform',currentEnd:'2026-09-29'});
      const s = await snapshot();
      assert.equal(s.state.platform,'TMALL');
      assert.ok(s.objects.every(x => x.platform === 'TMALL'));
      assert.equal(s.state.currentEnd,'2026-09-29');
    });
    await check('Demo detail and return preserve the comparison range', async () => {
      const before = (await snapshot()).state;
      const detailId=(await snapshot()).objects[0].id;
      await page.evaluate(id => window.comparisonDemo.openDetail('store',id), detailId);
      assert.deepEqual((await snapshot()).drawer,{kind:'store',id:detailId});
      await page.getByTestId('detail-close').click();
      assert.deepEqual((await snapshot()).state, before);
    });
    await check('Zero, negative and missing baselines cannot generate growth or normalized indexes', async () => {
      await set({design:1,mode:'shops',platform:'JD',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-28',selectedIds:['JD:A','JD:B','JD:C'],normalized:true});
      let s = await snapshot();
      assert.equal(s.objects.find(o=>o.id==='JD:C').previous.amount,0);
      assert.equal(s.objects.find(o=>o.id==='JD:C').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='JD:C').points.every(p=>p.value===null));
      await set({source:'erp'});
      s = await snapshot();
      assert.ok(s.objects.find(o=>o.id==='JD:B').previous.amount<0);
      assert.equal(s.objects.find(o=>o.id==='JD:B').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='JD:B').points.every(p=>p.value===null));
      await set({platform:'TMALL'});
      s = await snapshot();
      assert.equal(s.objects.find(o=>o.id==='TMALL:E').previous.amount,null);
      assert.equal(s.objects.find(o=>o.id==='TMALL:E').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='TMALL:E').points.every(p=>p.value===null));
    });
    await check('Weighted ratios and cross-period ranking use the complete selected candidates', async () => {
      await set({platform:'JD',source:'platform',coverage:'all',currentEnd:'2026-09-28',selectedIds:['JD:A','JD:B'],normalized:false});
      const s = await snapshot();
      const rows = s.objects.filter(o=>['JD:A','JD:B'].includes(o.id));
      const weighted = rows.reduce((sum,o)=>sum+o.current.attribution,0)/rows.reduce((sum,o)=>sum+o.current.spend,0);
      assert.ok(Math.abs(s.totals.ratios.roas-weighted)<1e-12);
      assert.ok(Math.abs(s.totals.ratios.roas-rows.reduce((sum,o)=>sum+o.ratios.roas,0)/rows.length)>1e-8);
      assert.ok(s.currentRank.indexOf('JD:A')<s.currentRank.indexOf('JD:B'));
      assert.ok(s.previousRank.indexOf('JD:A')>s.previousRank.indexOf('JD:B'));
    });
    await check('Mixed-platform promotion remains separate and cannot produce a combined ROAS', async () => {
      await set({platform:'all',selectedIds:['JD:A','TMALL:D']});
      const s = await snapshot();
      assert.equal(s.totals.ratios.roas,null);
      assert.equal(s.totals.current.attribution,null);
      assert.match(s.totals.promotionReason,/不同平台/);
    });
    await check('Local ranking pagination and balanced sections remain interactive', async () => {
      await set({design:1,platform:'all',page:1,selectedIds:['JD:A','JD:B','TMALL:D']});
      await page.getByTestId('rank-next').click();assert.equal((await snapshot()).state.page,2);
      await page.getByTestId('rank-previous').click();assert.equal((await snapshot()).state.page,1);
      for(let section=1;section<=6;section++)assert.ok(await page.locator(`[data-section="3.${section}"]`).count());
    });
    await check('Synthetic limited-scope fixture rejects a shop outside that fixture scope', async () => {
      await set({design:1,platform:'all',permission:'limited',selectedIds:['JD:B','TMALL:E']});
      const s = await snapshot();
      assert.deepEqual(s.objects.map(o=>o.id).sort(),['JD:A','TMALL:D']);
      assert.ok(!s.selectedIds.includes('JD:B')&&!s.selectedIds.includes('TMALL:E'));
      // This models UI scope only. Formal principal/PG permission tests remain required.
      await set({permission:'full'});
    });
    await check('Complete coverage requires both periods, and a partial baseline prevents decomposition', async () => {
      await set({mode:'shops',platform:'TMALL',source:'erp',coverage:'complete',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28'});
      assert.ok(!(await snapshot()).objects.some(o=>o.id==='TMALL:E'));
      await set({coverage:'all'});
      assert.equal((await snapshot()).objects.find(o=>o.id==='TMALL:E').status,'partial');
      await set({platform:'JD',source:'platform',currentStart:'2026-08-01',currentEnd:'2026-08-28',previousStart:'2026-09-01',previousEnd:'2026-09-28'});
      const s = await snapshot();
      assert.ok(s.candidateSets.unknown.includes('JD:C'));
      assert.equal(s.objects.find(o=>o.id==='JD:C').status,'partial');
    });
    await check('Trend buckets and normalized values match the summary for stable shop identities', async () => {
      await set({design:1,mode:'shops',platform:'JD',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-28',selectedIds:['JD:A','JD:B'],grain:'week',normalized:false});
      let s=await snapshot();
      for(const id of ['JD:A','JD:B']){
        const row=s.objects.find(o=>o.id===id),series=s.series.find(o=>o.id===id);
        assert.equal(series.points.length,1);
        assert.equal(series.points[0].value,row.current.amount);
      }
      await set({normalized:true});
      s=await snapshot();
      for(const id of ['JD:A','JD:B']){
        const row=s.objects.find(o=>o.id===id),point=s.series.find(o=>o.id===id).points[0];
        const expected=(row.current.amount/point.days)/(row.previous.amount/row.previous.coverage.requested)*100;
        assert.ok(Math.abs(point.value-expected)<1e-10);
      }
      await set({mode:'platforms',platform:'all',grain:'month',normalized:false});
      s=await snapshot();
      for(const platform of s.objects){
        assert.equal(s.series.find(o=>o.id===platform.id).points[0].value,platform.current.amount);
      }
    });
    await check('ERP summary labels coverage independently of the selected platform source', async () => {
      await set({design:1,mode:'shops',platform:'TMALL',source:'platform',coverage:'all',currentStart:'2026-08-01',currentEnd:'2026-08-03',previousStart:'2026-07-01',previousEnd:'2026-07-03',selectedIds:['TMALL:D','TMALL:E']});
      const s=await snapshot();
      assert.equal(s.totals.current.coverage.erp,3);
      assert.equal(s.totals.current.coverage.requested,6);
      const card=page.locator('.kpi-card').filter({hasText:'ERP 订单毛利'});
      assert.match(await card.innerText(),/已覆盖/);
      assert.match(await card.innerText(),/3\/6 店日/);
    });
    await check('Negative net sales remain in tables and do not enter the scale bubble chart', async () => {
      await set({platform:'JD',source:'erp',currentStart:'2026-08-01',currentEnd:'2026-08-03',previousStart:'2026-07-01',previousEnd:'2026-07-03',selectedIds:['JD:A','JD:B']});
      assert.ok((await snapshot()).objects.find(o=>o.id==='JD:B').current.amount<0);
      const scatter=page.locator('svg[aria-label="规模与客单价分布"]');
      assert.equal(await scatter.locator('circle').count(),1);
      assert.doesNotMatch(await scatter.textContent(),/京东 B 店/);
      assert.match(await page.getByTestId('ranking-table').innerText(),/京东 B 店/);
    });
    await set({mode:'shops',platform:'JD',source:'platform',coverage:'all',grain:'day',currentStart:'2026-09-01',currentEnd:'2026-09-29',previousStart:'2026-08-01',previousEnd:'2026-08-29'});
    await page.setViewportSize({width:390,height:844});
    await check('Selected balanced view fits a narrow screen and keeps chart labels readable', async () => {
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const textSizes=await page.evaluate(()=>[...document.querySelectorAll('svg.chart-svg text')].map(el=>Number.parseFloat(getComputedStyle(el).fontSize)*el.getScreenCTM().a));
      assert.ok(textSizes.length>0&&textSizes.every(size=>size>=11.9));
      await topForCapture();await page.screenshot({path:path.join(out,'balanced-narrow.png'),fullPage:true});
    });
    await check('Custom-time dialog fits a narrow screen with readable native controls', async () => {
      await page.getByTestId('custom-current').click();
      const dimensions=await page.getByTestId('date-picker').evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth,font:getComputedStyle(el.querySelector('button[data-date-action="day"]')).fontSize}));
      assert.ok(dimensions.left>=0&&dimensions.right<=390);assert.ok(dimensions.scroll<=dimensions.client+1);assert.equal(dimensions.font,'13px');
      await page.screenshot({path:path.join(out,'balanced-custom-date-narrow.png'),fullPage:false});
      await page.getByTestId('date-cancel').click();
      await page.setViewportSize({width:320,height:740});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.getByTestId('custom-previous').click();
      assert.ok(await page.getByTestId('date-picker').evaluate(el=>el.getBoundingClientRect().right<=320&&el.scrollWidth<=el.clientWidth+1));
      await page.getByTestId('date-cancel').click();
    });
    await check('No JS errors or business/network requests', async () => {
      assert.deepEqual(errors, []);
      assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).origin === url.origin));
      assert.ok(requests.every(r => !new URL(r.url).pathname.startsWith('/api/')));
    });
  } finally {
    await browser.close();
    const report = {
      scope: 'synthetic isolated UI only',
      sourceHashes: Object.fromEntries(['index.html','demo.js','demo.css','system-tokens.css','system-frame.css','date-picker.js','date-picker.css'].filter(f=>fs.existsSync(path.join(demoRoot,f))).map(f=>[f,sha(f)])),
      testedAt: new Date().toISOString(),
      viewport: ['1440x1080','390x844'],
      cases, errors, requests,
      passed: cases.filter(x=>x.result==='pass').length,
      failed: cases.filter(x=>x.result==='fail').length,
      PostgreSQL: 'not implemented/not tested in this design stage',
      productionPermissions: 'not tested; required after F/P/A integration',
      productionOperations: []
    };
    fs.writeFileSync(path.join(out,'ui-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,cases:cases.filter(x=>x.result==='fail')},null,2));
    if(report.failed) process.exitCode=1;
  }
})().catch(e => {console.error(e);process.exitCode=1;});
