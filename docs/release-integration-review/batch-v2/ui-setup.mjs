import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sha } from './validators.mjs';
export async function prepareUi(root,candidate) {
  const uiModule=path.resolve(candidate,'source-snapshot/tools/release-acceptance-ui.mjs');
  const {candidateResourceInventory}=await import(pathToFileURL(uiModule));
  const names=[],nonHttpMetadata=[];
  async function walk(dir,prefix='') { for(const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.name==='.dev.vars'||entry.name.startsWith('.env'))continue; // never read or expose environment material
    assert.ok(!entry.isSymbolicLink());
    if(entry.name.startsWith('.')||['_headers','_redirects','wrangler.json'].includes(entry.name)) {
      nonHttpMetadata.push(prefix+entry.name);continue;
    }
    if(entry.isDirectory())await walk(path.join(dir,entry.name),prefix+entry.name+'/');else names.push('/'+prefix+entry.name);
  } }
  await walk(path.join(candidate,'dist/client'));
  const resources=await candidateResourceInventory(path.join(candidate,'dist/client'),names);
  await writeFile(path.join(root,'resource-inventory.json'),JSON.stringify(resources,null,2)+'\n',{flag:'wx'});
  const paths=['/api/auth/me','/api/search','/api/sales/summary','/api/products/summary','/api/customer-service/conversations','/api/customer-service/analyze'];
  const htmlResponse=await fetch('http://127.0.0.1:3000/',{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(htmlResponse.status,200);
  const html=await htmlResponse.text(),icons=[...html.matchAll(/<link[^>]+href="([^"]*favicon\.svg[^"]*)"[^>]*>/g)].map(match=>match[1]);
  assert.ok(icons.length>0);assert.ok(icons.every(uri=>uri==='https://127.0.0.1:3000/favicon.svg?v=xiaote-20260922'));
  await writeFile(path.join(root,'ui-icon-witness.json'),JSON.stringify({observedAt:new Date().toISOString(),entry:'http://127.0.0.1:3000/',status:200,icons,htmlSha256:sha(Buffer.from(html)),htmlPersisted:false,scope:'Only exact unchanged SSR icon URL; no business response payload retained'},null,2)+'\n',{flag:'wx'});
  // These six GETs are declared in unchanged adopted page/sales/product/
  // customer views; analyze GET reads model configuration, POST alone executes.
  const original='E:/codex-artifacts/priority-interactions-production-20261009/production-ui.mjs';
  let script=await readFile(original,'utf8');
  assert.ok(script.includes("const root='E:/codex-artifacts/priority-interactions-production-20261009';"));
  script=script.replace("const root='E:/codex-artifacts/priority-interactions-production-20261009';",`const root=${JSON.stringify(root)};`);
  const route=/ await context\.route\('\*\*\/\*',async route=>\{[\s\S]*?\n \}\);/;
  assert.ok(route.test(script));
  await writeFile(path.join(root,'ui-audit.mjs'),await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'ui-audit.mjs')),{flag:'wx'});
  script=script.replace(route,` const {installReviewedUiAudit}=await import(pathToFileURL(root+'/ui-audit.mjs'));\n const resources=JSON.parse(await readFile(root+'/resource-inventory.json'));\n audit=await installReviewedUiAudit(context,{origin,resources,originalModule:${JSON.stringify(uiModule)},readPaths:${JSON.stringify(paths)},requiredResources:[]});`);
  script=script.replace('const blocked=[],requests=[],cases=[];','const blocked=[],requests=[],cases=[];let audit,audited;');
  script=script.replace(" await input.fill('SYNTHETIC-NO-PRODUCTION-MATCH');"," audit.beginSearchCancellation();await input.fill('SYNTHETIC-NO-PRODUCTION-MATCH');");
  script=script.replace(" await page.getByRole('button',{name:'关闭全系统搜索',exact:true}).click();", " audit.completeSearchCancellation(await page.evaluate(()=>({inputEmpty:document.querySelector('#global-search-dialog input')?.value==='',guideVisible:Boolean(document.querySelector('#global-search-dialog .search-guide')),busyCount:document.querySelectorAll('#global-search-dialog [aria-busy=true]').length})));await page.getByRole('button',{name:'关闭全系统搜索',exact:true}).click();");
  script=script.replace(" for(let i=0;i<await retained.count();i++)assert.equal(await retained.nth(i).evaluate(e=>Boolean(e.closest('[inert]'))),true);", " const retainedState=await retained.evaluateAll(elements=>({count:elements.length,allInert:elements.every(e=>Boolean(e.closest('[inert]')))}));assert.ok(retainedState.count>0,'Retained rows were not observed');assert.equal(retainedState.allInert,true);");
  // Complete all normal reads before navigating/closing. Do not whitelist
  // aborted business reads from navigation as successful API observations.
  script=script.replaceAll(' await page.goto('," await page.waitForLoadState('networkidle',{timeout:60000});await page.goto(");
  script=script.replace(" assert.equal(blocked.filter(x=>x.method!=='GET').length,0,'UI attempted a write');",
    " await page.waitForLoadState('networkidle',{timeout:60000});audited=await audit.finish();await writeFile(root+'/production-ui-audit.json',JSON.stringify(audited,null,2)+'\\n',{flag:'wx'});assert.equal(audited.status,'passed','All actual read/resource requests must pass');");
  // Original results contain only case names/counts; no customer details/IDs.
  script=script.replace("requests:requests.length,blockedGetCount:blocked.length", "requests:audited.attempts.length,blockedGetCount:audited.blockedIcons");
  script=script.replace("},null,2)+'\\n');", "},null,2)+'\\n',{flag:'wx'});");
  script=script.replace('} finally {await browser.close();}',"} finally {if(audit&&!audited){audited=await audit.finish();await writeFile(root+'/production-ui-audit.json',JSON.stringify(audited,null,2)+'\\n',{flag:'wx'});}await browser.close();}");
  await writeFile(path.join(root,'production-ui.mjs'),script,{flag:'wx'});
  await writeFile(path.join(root,'ui-scope.json'),JSON.stringify({status:'prepared-not-executed',paths,
    uiSourceSha256:sha(await readFile(original)),resourceCount:names.length,
    nonHttpMetadata,metadataValidity:'Original complete immutable payload validation; never require private/config paths to be HTTP resources',
    allPublicCandidateResourcesAreSeparateRequiredOperation:true,serviceWorkers:'block',productionBusinessWritesAllowed:false,manualExternalSendingAllowed:false},null,2)+'\n',{flag:'wx'});
  return {uiModule,paths,resources,scriptPath:path.join(root,'production-ui.mjs')};
}
