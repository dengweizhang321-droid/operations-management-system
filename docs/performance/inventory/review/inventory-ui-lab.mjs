import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Independent UI transport/interaction experiment; no production backend, credentials or writes.
const root = path.resolve(import.meta.dirname, '../../../..');
const baseline = process.env.INVENTORY_UI_BASELINE || 'bab42d8ce836b4ee9acd82e80de085ff71f9f494';
const fixturePath = process.env.INVENTORY_UI_FIXTURE || path.join(root, '.runtime/inventory-performance-ui/fixtures.json');
const out = path.join(root, '.runtime/inventory-independent-ui');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
assert(lstatSync(path.join(root, '.git')).isFile(), 'Independent worktree required');
assert(git('branch', '--show-current').startsWith('codex/'));
assert(!readdirSync(root).some(name => /^\.env($|\.)|^\.dev\.vars($|\.)/.test(name)), 'No production environment files');
for (const p of [root, out]) assert(!existsSync(p) || !lstatSync(p).isSymbolicLink());
await mkdir(out, { recursive: true });
if(existsSync(path.join(out,'result.json'))){
  const history=path.join(out,'history-'+new Date().toISOString().replaceAll(':','-'));
  await mkdir(history,{recursive:false});
  for(const name of readdirSync(out).filter(name=>name==='result.json'||name.endsWith('.png')))await copyFile(path.join(out,name),path.join(history,name));
}
const fixtureBytes = await readFile(fixturePath);
const fixtures = JSON.parse(fixtureBytes);
for (const key of ['overview', 'plan', 'age', 'inbound', 'guangdong']) assert(fixtures[key], `Missing synthetic fixture ${key}`);
const sources = ['inventory-module-view.tsx', 'inventory-guangdong-view.tsx', 'inventory-filter-bar.tsx'];
const hashes = {};
for (const file of sources) {
  const candidate = await readFile(path.join(root, 'app', file));
  hashes[file] = createHash('sha256').update(candidate).digest('hex');
  let prior = git('show', `${baseline}:app/${file}`);
  prior = prior.replaceAll('from "../', 'from "/').replaceAll('from "./', 'from "/app/');
  for (const local of sources) prior = prior.replaceAll(`/app/${local.slice(0, -4)}"`, `./baseline-${local.slice(0, -4)}"`);
  await writeFile(path.join(out, `baseline-${file}`), prior);
}
await writeFile(path.join(out, 'index.html'), '<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="/.runtime/inventory-independent-ui/main.tsx"></script></html>');
await writeFile(path.join(out, 'main.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Candidate from'/app/inventory-module-view';import Baseline from'./baseline-inventory-module-view';import'/app/globals.css';
const impl=new URLSearchParams(location.search).get('implementation')||'candidate';const View=impl==='baseline'?Baseline:Candidate;
const native=window.fetch;window.fetch=async(url,init={})=>{if(String(url).startsWith('/api/')&&typeof window.labFetch==='function'){const r=await window.labFetch(String(url),init.method||'GET',impl,window.labActor||'A',init.body||'');return new Response(JSON.stringify(r.body),{status:r.status,headers:{'content-type':'application/json'}})}return native(url,init)};
function Lab(){const[tab,setTab]=useState('overview'),[open,setOpen]=useState(false),[date,setDate]=useState('2026-09-01'),[actor,setActor]=useState('A');window.labActor=actor;return <main style={{padding:24}}><p>库存隔离UI实验 · {impl} · 合成API；不代表真实业务数据库性能</p><button onClick={()=>setOpen(!open)}>{open?'离开库存':'打开库存'}</button><select aria-label="实验身份" value={actor} onChange={e=>setActor(e.target.value)}><option>A</option><option>B</option></select><select aria-label="实验入口" value={tab} disabled={open} onChange={e=>setTab(e.target.value)}>{['overview','age','plan','stale','inbound','guangdong'].map(v=><option key={v}>{v}</option>)}</select><input aria-label="实验日期" type="date" value={date} onChange={e=>setDate(e.target.value)}/>{open&&<View customStartDate={date} customEndDate="2026-09-30" currentUser={{id:actor,role:'admin',displayName:'隔离实验'}} moduleView={tab} onModuleViewChange={setTab} onAskAi={()=>{}}/>}</main>}createRoot(document.getElementById('root')).render(<Lab/>);`);

const tabs = [['overview','库存总览'], ['age','库龄分析'], ['plan','备货计划'], ['stale','滞销清理'], ['inbound','京东入仓监控'], ['guangdong','广东入仓监控']].filter(([key])=>!process.env.INVENTORY_UI_ONLY_TAB||process.env.INVENTORY_UI_ONLY_TAB.split(',').includes(key));
let sequence = 0, failNext = false, failSection = '', failBothQuery = '', emptyNext = false, snapshot = '2026-10-05';
let retryRace = null;
const requests = [], measures = [], checks = [], failures = [];
const endpointFixture = (url) => url.pathname.endsWith('/overview') ? (url.searchParams.get('view') === 'plan' ? 'plan' : 'overview') : url.pathname.endsWith('/age-analysis') ? 'age' : url.pathname.endsWith('/inbound-monitor') ? 'inbound' : 'guangdong';
const cloned = value => JSON.parse(JSON.stringify(value));
function answer(url,actor='A') {
  const key = endpointFixture(url), body = cloned(fixtures[key]);
  if(body.filters?.brands)body.filters.brands.push('ACCOUNT-'+actor);
  const suffix = url.pathname.split('guangdong-monitor')[1];
  if (suffix === '/watchlist') return cloned(fixtures.watchlist || { version: fixtures.guangdong.version, items: fixtures.guangdong.items.map(row => ({...row, active:true, notes: row.notes || ''})) });
  if (suffix === '/suppliers') return cloned(fixtures.suppliers || { version: fixtures.guangdong.version, items: [{supplier:fixtures.guangdong.items[0]?.supplier || '合成供应商',leadDays:10,bufferDays:7}] });
  if (suffix === '/products') return { items: cloned(fixtures.guangdong.items).slice(0,2) };
  if (body.sync) body.sync.inventoryAsOf = snapshot;
  const q = url.searchParams.get('q') || '';
  const page = Number(url.searchParams.get(key === 'plan' ? 'planPage' : 'page') || 1);
  const marker = `UI-${q || 'ALL'}-P${page}-A${actor}`;
  const decorate = rows => rows.map((row, i) => ({...row, productName: `${marker}-${i}`, key: `${row.key || row.productCode}:${marker}`}));
  if (Array.isArray(body.items)) body.items = decorate(body.items);
  if (Array.isArray(body.plans)) body.plans = decorate(body.plans);
  if (body.mapping?.samples) body.mapping.samples = decorate(body.mapping.samples);
  const pagination = key === 'plan' ? body.plansPagination : body.pagination;
  if (pagination) Object.assign(pagination, { page, total: 120, totalPages: 3, returned: key === 'plan' ? body.plans.length : body.items?.length || 0, truncated: page < 3 });
  if (emptyNext || q==='EMPTY') { emptyNext = false; body.hasInventory = false; body.watchCount=0; body.items = []; if (body.mapping) body.mapping.samples = []; body.plans = []; }
  const section=url.searchParams.get('section');
  if(section){
    const canonical=[...url.searchParams.entries()].filter(([key])=>key!=='section').sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
    body.readSection=section;
    body.readScope=createHash('sha256').update(JSON.stringify([url.pathname,canonical])).digest('hex');
    body.readSnapshot=createHash('sha256').update(snapshot).digest('hex');
    if(section==='summary'){
      for(const field of ['items','plans'])if(field in body)body[field]=[];
      if(body.mapping)body.mapping.samples=[];
    }
  }
  return body;
}
const apiPlugin = {name:'inventory-synthetic-api', configureServer(vite){vite.middlewares.use('/api', (req,res)=>{res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'隔离预览仅支持读取'}));return;}const url=new URL('/api'+req.url,'http://127.0.0.1');res.end(JSON.stringify(answer(url)));});}};
const portProbe=createNetServer();await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',resolve);});const labPort=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const server = await createServer({configFile:false,root,plugins:[react(),apiPlugin],cacheDir:path.join(out,'vite-cache-'+Date.now()),resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true,entries:[path.join(out,'index.html')],include:['react','react-dom','react-dom/client']},server:{host:'127.0.0.1',port:labPort,strictPort:true},define:{'process.env.NODE_ENV':'"development"'}});
let browser;
const errors = [];
const network=[];
try {
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}/.runtime/inventory-independent-ui/index.html`;
  if (process.argv.includes('--serve')) {
    console.log('Synthetic isolated inventory preview: '+base);
    // Native API middleware is read-only. Its fixture markers are explicitly synthetic.
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else {
    browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    for (const implementation of (process.env.INVENTORY_UI_IMPLEMENTATIONS||'baseline,candidate').split(',')) {
      const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      const page = await context.newPage();
      page.on('request',request=>network.push({implementation,path:new URL(request.url()).pathname,state:'pending'}));
      page.on('response',response=>{const p=new URL(response.url()).pathname;const item=network.findLast(n=>n.implementation===implementation&&n.path===p&&n.state==='pending');if(item){item.state='response';item.status=response.status();}});
      page.on('requestfailed',request=>{const p=new URL(request.url()).pathname;const item=network.findLast(n=>n.implementation===implementation&&n.path===p&&n.state==='pending');if(item){item.state='failed';item.error=request.failure()?.errorText;}});
      page.on('pageerror', error=>errors.push({implementation,error:error.message}));
      await page.route('**/*', route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort();});
      await page.exposeBinding('labFetch', async(_, target, method, impl, actor, requestBody)=>{
        if(method!=='GET'){
          const body=JSON.parse(requestBody);
          assert.equal(method,'POST');assert.equal(target,'/api/inventory/replenishment/dingtalk/group');assert.equal(body.action,'preview','Message sends and all mutations remain blocked');
          await new Promise(r=>setTimeout(r,180));
          requests.push({id:++sequence,implementation:impl,path:target,method,simulatedReadOnlyAction:'preview',status:200});
          return {status:200,body:{ok:true,status:'preview',planIds:body.planIds,planCount:body.planIds.length,targetGroupName:'Synthetic preview group',robotName:'Synthetic preview robot',message:'仅隔离夹具预览，不发送消息。',buyerNames:['Synthetic buyer'],previewToken:'a'.repeat(64)}};
        }
        const url=new URL(target,'http://127.0.0.1');
        const id=++sequence, start=performance.now(), selectedSection=url.searchParams.get('section')||'';
        const race=retryRace?.query===url.searchParams.get('q')?retryRace:null;
        const raceAttempt=race&&selectedSection?++race.calls[selectedSection]:0;
        const heldSibling=race&&selectedSection!==race.failed&&raceAttempt===1;
        const fail=(race&&selectedSection===race.failed&&raceAttempt===1)||(failBothQuery&&url.searchParams.get('q')===failBothQuery)||(failNext&&(!failSection||selectedSection===failSection));if(fail&&failNext){failNext=false;failSection='';}
        let body=fail?{error:'隔离实验读取失败'}:answer(url,actor);
        if(heldSibling){body=JSON.parse(JSON.stringify(body).replaceAll(`UI-${race.query}-`,`UI-STALE-${race.query}-`));body.readSnapshot='c'.repeat(64);}
        const delay=url.searchParams.get('q')==='LATE'||(url.searchParams.get('q')==='DETAILSLOW'&&selectedSection==='detail')||(url.searchParams.get('q')==='SUMMARYSLOW'&&selectedSection==='summary')?900:180;
        if(heldSibling)await new Promise(resolve=>{race.release=resolve;});
        else await new Promise(r=>setTimeout(r,delay));
        requests.push({id,implementation:impl,path:url.pathname,query:url.search,ms:performance.now()-start,status:fail?503:200,bytes:Buffer.byteLength(JSON.stringify(body)),ignoredAbort:true});
        return {status:fail?503:200,body};
      });
      async function painted(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
      async function idle(){await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[aria-busy]')).some(e=>e.getAttribute('aria-busy')==='true'),null,{timeout:10000});await painted();}
      async function measure(tab, action, operation, marker, completion){
        const before=sequence,start=performance.now();
        let firstContent;
        const first=(action==='first-open'||action==='reentry')?page.waitForSelector('[aria-label="库存健康状态分布"],.inventory-kpi-grid,.inventory-workflow-rail,progress',{timeout:10000}).then(async()=>{await painted();firstContent=performance.now()-start;}):null;
        await operation();await painted();
        const feedback=performance.now()-start;
        if(marker)await page.getByText(marker,{exact:false}).first().waitFor({timeout:10000});
        if(completion)await completion();
        await idle();if(first)await first;measures.push({implementation,tab,action,feedbackMs:feedback,firstContentMs:firstContent,completeMs:performance.now()-start,requests:sequence-before});
      }
      await page.goto(base+'?implementation='+implementation,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'打开库存',exact:true}).waitFor();
      for(const [tab,label] of tabs){
        await page.getByLabel('实验入口').selectOption(tab);
        await measure(tab,'first-open',async()=>{
          if(await page.getByRole('button',{name:'打开库存',exact:true}).count())await page.getByRole('button',{name:'打开库存',exact:true}).click();
          if(tab!=='overview')await page.getByRole('tab',{name:label,exact:true}).click();
        },'UI-ALL-P1');
        if(implementation==='candidate'){
          await page.getByLabel('实验身份').selectOption('B');await painted();assert.equal(await page.getByText('UI-ALL-P1-AA',{exact:false}).count(),0);
          await page.getByRole('button',{name:'库存公共品牌',exact:true}).click();assert.equal(await page.getByRole('option',{name:'ACCOUNT-A',exact:true}).count(),0);await page.getByRole('button',{name:'库存公共品牌',exact:true}).click();
          await page.getByText('UI-ALL-P1-AB',{exact:false}).first().waitFor();await idle();
          await page.getByRole('button',{name:'库存公共品牌',exact:true}).click();await page.getByRole('option',{name:'ACCOUNT-B',exact:true}).waitFor();await page.getByRole('button',{name:'库存公共品牌',exact:true}).click();
          await page.getByLabel('实验身份').selectOption('A');await page.getByText('UI-ALL-P1-AA',{exact:false}).first().waitFor();await idle();checks.push({implementation,tab,check:'same-role-account-change-hides-previous-account'});
        }
        if(tab==='plan'){
          const draftRow=page.locator('tbody tr').filter({has:page.locator('input.plan-quantity-input')}).first();
          const quantity=draftRow.locator('input.plan-quantity-input');await quantity.fill('57');assert.equal(await quantity.inputValue(),'57');
          const draftSelection=draftRow.getByRole('checkbox');await draftSelection.check();assert(await draftSelection.isChecked());assert.equal(await quantity.inputValue(),'57');
          const confirmedRow=page.locator('tbody tr').filter({has:page.getByRole('button',{name:'生成采购任务',exact:true})}).first();await confirmedRow.getByRole('checkbox').check();
          const all=page.getByRole('checkbox',{name:'全选本页草稿和已确认备货计划',exact:true});await all.check();assert(await all.isChecked());await all.uncheck();assert.equal(await page.locator('tbody input[type="checkbox"]:checked').count(),0);
          assert(await draftRow.getByRole('button',{name:'确认并提交钉钉',exact:true}).isEnabled());assert(await confirmedRow.getByRole('button',{name:'生成采购任务',exact:true}).isEnabled());
          checks.push({implementation,tab,check:'draft-quantity-mixed-selection-all-selection-and-state-buttons'});
          await confirmedRow.getByRole('checkbox').check();
          await measure(tab,'group-message-preview-detail',()=>page.getByRole('button',{name:/^发送钉钉群（1）$/}).click(),null,()=>page.getByRole('dialog',{name:'钉钉备货群消息'}).waitFor());
          await page.getByRole('dialog',{name:'钉钉备货群消息'}).getByText('仅隔离夹具预览，不发送消息。',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await confirmedRow.getByRole('checkbox').uncheck();
          checks.push({implementation,tab,check:'group-preview-detail-open-close-without-send'});
        }
        if(process.env.INVENTORY_UI_ACCOUNT_ONLY==='1'){
          await page.getByLabel('库存公共货品搜索').fill('EMPTY');
          const emptyText=tab==='guangdong'?'还没有启用的监控型号':tab==='age'||tab==='stale'?'还没有可分析的库存快照':tab==='inbound'?'暂无京东入仓库存':'还没有库存快照';
          await page.getByText(emptyText,{exact:true}).waitFor();await idle();checks.push({implementation,tab,check:'empty-authoritative-data-does-not-show-prior-range'});
          await page.getByRole('button',{name:'离开库存',exact:true}).click();
          await page.getByRole('button',{name:'打开库存',exact:true}).click();await page.getByText(emptyText,{exact:true}).waitFor();await idle();
          await page.getByLabel('库存公共货品搜索').fill('');await page.getByText('UI-ALL-P1-AA',{exact:false}).first().waitFor();await idle();checks.push({implementation,tab,check:'empty-range-refresh-reentry-and-recovery'});
          await page.getByRole('button',{name:'离开库存',exact:true}).click();console.log(`completed account-only ${implementation}/${tab}`);continue;
        }
        await page.screenshot({path:path.join(out,`${implementation}-${tab}-desktop.png`),fullPage:true});
        const requestsBeforeDate=sequence;await page.getByLabel('实验日期').fill('2026-08-01');await page.waitForTimeout(350);assert.equal(sequence,requestsBeforeDate,'Inventory fixed sales window must ignore global date');
        checks.push({implementation,tab,check:'global-date-does-not-change-fixed-inventory-window'});
        const selectorCases=[['库存公共品牌','brand'],['库存公共品类','category'],...(tab==='guangdong'?[]:[['库存公共仓库','warehouse']]),...(tab==='overview'?[['库存类型','warehouseType'],['健康状态','status']]:[]),...(tab==='age'||tab==='stale'?[['库龄风险状态','status']]:[]),...(tab==='plan'?[['备货计划状态','planStatus']]:[]),...(tab==='inbound'?[['京东入仓供应商','supplier']]:[]),...(tab==='guangdong'?[['广东入仓供应商','supplier']]:[])];
        for(const [aria,param] of selectorCases){
          const trigger=page.getByRole('button',{name:aria,exact:true});await trigger.click();
          const options=page.getByRole('listbox',{name:aria+'选项'}).getByRole('option');
          if(await options.count()>1){
            const before=sequence;
            await measure(tab,'filter-'+param,()=>options.nth(1).click(),null);
            if(await page.getByRole('listbox',{name:aria+'选项'}).count())await trigger.click();
            assert(requests.some(r=>r.id>before&&new URLSearchParams(r.query).has(param)),`Expected ${param} query`);
            await page.getByRole('button',{name:'清空当前页筛选',exact:true}).click();await idle();
          }else {await trigger.click();checks.push({implementation,tab,check:'no-fixture-options-'+param});}
        }
        if(tab==='age'||tab==='stale'){
          await measure(tab,'age-bucket',()=>page.getByRole('group',{name:'库龄区间多选'}).getByRole('button').first().click(),null);
          await page.getByRole('button',{name:'清空当前页筛选',exact:true}).click();await idle();
        }
        await measure(tab,'search',()=>page.getByLabel('库存公共货品搜索').fill('FAST'),'UI-FAST-P1');
        await page.getByLabel('库存公共货品搜索').fill('LATE');await page.waitForTimeout(350);
        await page.getByLabel('库存公共货品搜索').fill('NEW');await page.getByText('UI-NEW-P1',{exact:false}).first().waitFor();await page.waitForTimeout(1100);
        assert.equal(await page.getByText('UI-LATE-P1',{exact:false}).count(),0);checks.push({implementation,tab,check:'ignored-abort-late-response-fenced'});
        if(implementation==='candidate'){
          await page.getByLabel('库存公共货品搜索').fill('SUMMARYSLOW');await page.getByText('UI-SUMMARYSLOW-P1',{exact:false}).first().waitFor();
          await page.getByLabel('库存公共货品搜索').fill('NEW');await page.getByText('UI-NEW-P1',{exact:false}).first().waitFor();await idle();await page.waitForTimeout(1100);
          assert.equal(await page.getByText('UI-SUMMARYSLOW-P1',{exact:false}).count(),0);checks.push({implementation,tab,check:'detail-can-render-before-summary-and-cancelled-summary-not-stuck'});
          for(const failed of ['summary','detail']){
            const query=`EARLYFAIL-${failed}`, before=sequence;
            const race={query,failed,calls:{summary:0,detail:0},release:null};retryRace=race;
            try{
              await page.getByLabel('库存公共货品搜索').fill(query);
              const retry=page.getByRole('button',{name:failed==='summary'?'重试统计与分布':'重试当前页明细',exact:true});await retry.waitFor();
              assert.equal(typeof race.release,'function','Sibling must still be in flight when retry is clicked');
              await retry.click();await idle();await page.getByText(`UI-${query}-P1`,{exact:false}).first().waitFor();
              assert.deepEqual(race.calls,{summary:2,detail:2},'Retry must replace the cancelled not-ready sibling');
              assert.equal(await page.getByRole('button',{name:/^重试(统计与分布|当前页明细)$/}).count(),0);
              assert.equal(await page.getByText(/^(统计与分布|当前页明细)正在读取$/).count(),0);
              race.release();race.release=null;await page.waitForTimeout(100);await painted();
              assert.equal(await page.getByText(`UI-STALE-${query}-P1`,{exact:false}).count(),0,'Cancelled late sibling must not replace the recovered view');
              await page.getByText(`UI-${query}-P1`,{exact:false}).first().waitFor();
              assert.equal(await page.getByText(/^(统计与分布|当前页明细)正在读取$/).count(),0);
              assert.equal(requests.filter(request=>request.id>before&&new URLSearchParams(request.query).get('q')===query).length,4);
              checks.push({implementation,tab,check:`early-${failed}-failure-retry-recovers-inflight-sibling`});
            }finally{race.release?.();retryRace=null;}
          }
          failBothQuery='DOUBLEFAIL';await page.getByLabel('库存公共货品搜索').fill('DOUBLEFAIL');await page.getByRole('button',{name:'重试统计与分布',exact:true}).waitFor();await page.getByRole('button',{name:'重试当前页明细',exact:true}).waitFor();failBothQuery='';
          await page.getByRole('button',{name:'重试统计与分布',exact:true}).click();await idle();await page.getByText('UI-DOUBLEFAIL-P1',{exact:false}).first().waitFor();assert.equal(await page.getByRole('button',{name:'重试当前页明细',exact:true}).count(),0);checks.push({implementation,tab,check:'initial-pair-failure-retry-recovers-both-not-ready-regions'});
          await page.getByLabel('库存公共货品搜索').fill('NEW');await page.getByText('UI-NEW-P1',{exact:false}).first().waitFor();await idle();
          failNext=true;failSection='detail';await page.getByLabel('库存公共货品搜索').fill('FAILSCOPE');await page.getByRole('alert').first().waitFor();
          assert.equal(await page.getByText('UI-NEW-P1',{exact:false}).count(),0,'Failed new scope must not show previous scope as current');
          await page.getByRole('button',{name:/^(重试.*|重新读取|重新加载)$/}).first().click();await page.getByText('UI-FAILSCOPE-P1',{exact:false}).first().waitFor();await idle();
          checks.push({implementation,tab,check:'new-scope-failure-hides-old-content-and-retries'});
          await page.getByLabel('库存公共货品搜索').fill('NEW');await page.getByText('UI-NEW-P1',{exact:false}).first().waitFor();await idle();
        }
        if(await page.getByRole('button',{name:'下一页',exact:true}).count())await measure(tab,'page-2',()=>page.getByRole('button',{name:'下一页',exact:true}).last().click(),'UI-NEW-P2');
        else checks.push({implementation,tab,check:'pagination-no-existing-ui'});
        const refresh=page.getByRole('button',{name:/^(刷新|刷新数据|刷新库存数据)$/}).first();
        if(await refresh.count()){
          await measure(tab,'refresh',()=>refresh.click(),null);
          const retained=await page.locator('tbody').allTextContents();failNext=true;failSection=implementation==='candidate'?'summary':'';await refresh.click();await page.getByRole('alert').first().waitFor();assert.deepEqual(await page.locator('tbody').allTextContents(),retained);
          const retry=page.getByRole('button',{name:/^(重试.*|重新读取|重新加载)$/}).first();await retry.click();await idle();checks.push({implementation,tab,check:'same-scope-refresh-failure-retains-and-retries'});
          if(implementation==='candidate'){
            failNext=true;failSection='detail';await refresh.click();await page.getByRole('alert').first().waitFor();assert.deepEqual(await page.locator('tbody').allTextContents(),retained);await retry.click();await idle();checks.push({implementation,tab,check:'independent-detail-refresh-failure-and-local-retry'});
          }
          snapshot=snapshot==='2026-10-05'?'2026-10-04':'2026-10-05';await refresh.click();await idle();await page.getByText(new RegExp(snapshot)).first().waitFor();checks.push({implementation,tab,check:'refresh-displays-new-source-snapshot-date'});
        }else checks.push({implementation,tab,check:'refresh-no-existing-read-ui'});
        await page.getByLabel('库存公共货品搜索').fill('');await page.getByText('UI-ALL-P1',{exact:false}).first().waitFor();await idle();
        await page.getByRole('button',{name:'离开库存',exact:true}).click();
        console.log(`completed ${implementation}/${tab}`);
        await measure(tab,'reentry',()=>page.getByRole('button',{name:'打开库存',exact:true}).click(),'UI-ALL-P1');
        checks.push({implementation,tab,check:'sort-no-existing-ui-authoritative-fixed-order'});
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${implementation}-${tab}-mobile.png`),fullPage:true});await page.setViewportSize({width:1440,height:1000});
        // Read-only detail opening is measured separately from save/external synchronization.
        const detailButton=tab==='overview'?page.getByRole('button',{name:'创建备货计划',exact:true}).first():tab==='plan'?page.getByRole('button',{name:'生成采购任务',exact:true}).first():tab==='stale'?page.getByRole('button',{name:'创建清理事项',exact:true}).first():null;
        if(detailButton&&await detailButton.count()){
          await measure(tab,'open-detail-dialog',()=>detailButton.click(),null);await page.getByRole('dialog').waitFor();await page.screenshot({path:path.join(out,`${implementation}-${tab}-detail.png`),fullPage:true});await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
        }
        if(tab==='guangdong'){
          for(const [button,region] of [['监控清单','监控清单管理'],['供应商备货周期','供应商周期管理']]){
            await measure(tab,button,()=>page.getByRole('button',{name:button,exact:true}).click(),null,async()=>{
              await page.getByRole('region',{name:region}).waitFor();
              const label=button==='监控清单'?`${(fixtures.watchlist?.items||fixtures.guangdong.items)[0].productCode}备注`:`${(fixtures.suppliers?.items||[{supplier:fixtures.guangdong.items[0].supplier}])[0].supplier}生产周期`;
              await page.getByLabel(label).waitFor();
            });
            if(button==='监控清单'){
              const search=page.getByLabel('筛选监控清单');await measure(tab,'清单本地搜索',()=>search.fill((fixtures.watchlist?.items||fixtures.guangdong.items)[0].productCode),null);await search.fill('');
              const regionEl=page.getByRole('region',{name:region}), next=regionEl.getByRole('button',{name:'下一页',exact:true});
              if(await next.isEnabled())await measure(tab,'清单本地分页',()=>next.click(),null);
            }
            await page.getByRole('button',{name:'收起',exact:true}).click();
          }
          const edit=page.getByRole('button',{name:/编辑型号设置$/}).first();await measure(tab,'型号设置详情',()=>edit.click(),null);await page.getByLabel('型号生产周期').waitFor();await page.screenshot({path:path.join(out,`${implementation}-guangdong-detail.png`),fullPage:true});
        }
        await page.getByRole('button',{name:'离开库存',exact:true}).click();
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);
  }
} catch(error) { failures.push(error.stack || String(error)); throw error; }
finally {
  await writeFile(path.join(out,'result.json'),JSON.stringify({status:failures.length?'failed':process.argv.includes('--serve')?'preview-only':'passed',syntheticApi:true,businessPgBenchmark:false,scope:'actual inventory component + original globals; excludes Home/shell and production authority',port:labPort,baseline,candidateHead:git('rev-parse','HEAD'),dirty:git('status','--short'),sourceHashes:hashes,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),upstreamDelayMs:180,lateResponseDelayMs:900,requests,measures,checks,errors,network,failures},null,2));
  await browser?.close();await server.close();
}
