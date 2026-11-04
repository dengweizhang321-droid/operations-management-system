/** Bounded source/import checks; no application server, database or production observation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {controlFiles} from '../tools/install-main-prebuild.mjs';
import {readinessStabilityFiles} from '../tools/verify-release-candidate.mjs';

const read=file=>fs.readFile(file,'utf8');
function relativeModules(file,source){
 return [...source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)]
  .map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(file),m[2])))
  .filter(p=>p.endsWith('.mjs'));
}
test('readiness entry modified JavaScript parses without executing a CLI',()=>{
 for(const file of [...readinessStabilityFiles,'tools/verify-release-candidate.mjs'].filter(p=>p.endsWith('.mjs'))){
  execFileSync(process.execPath,['--check',file],{windowsHide:true,stdio:'pipe'});
 }
});
test('readiness entry TypeScript program checks the aggregate and its budget fixtures only',()=>{
 const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);assert.equal(config.error,undefined);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
 const program=ts.createProgram(['lib/django/backend-readiness.ts','tests/readiness-probe-budgets.test.ts'],{...parsed.options,noEmit:true,incremental:false});
 const diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
});
test('readiness entry fixed control bundle contains every relative JavaScript import including the new helper',async()=>{
 const members=new Set(controlFiles.map(name=>'tools/'+name));
 assert.ok(members.has('tools/publication-readiness.mjs'));
 for(const file of members){
  for(const dependency of relativeModules(file,await read(file))){
   assert.ok(members.has(dependency),`${file} imports absent control bundle member ${dependency}`);
  }
 }
});
test('readiness entry installed Django publisher retains its required static import closure',async()=>{
 const inventory=new Set([...(await read('tools/django-local-service.ps1')).matchAll(/"(tools\\[^"\r\n]+)"/g)].map(m=>m[1].replaceAll('\\','/')));
 const pending=['tools/publish-prepared-main.mjs'],seen=new Set();
 while(pending.length){
  const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  assert.ok(inventory.has(file),`Missing required installed static module: ${file}`);
  // Optional diagnostic import() remains the unchanged Pi-specific contract;
  // this task adds only a mandatory static helper, not a new installed CLI.
  for(const m of (await read(file)).matchAll(/(?:from\s*|\bimport\s*)(['"])(\.[^'"]+)\1/g)){
   const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[2]));
   if(dependency.endsWith('.mjs'))pending.push(dependency);
  }
 }
 assert.ok(seen.has('tools/publication-readiness.mjs'));assert.ok(seen.has('tools/publish-main-tail.mjs'));
});
test('readiness entry frozen publisher import closure exists independently of the installed Django app',async()=>{
 const pending=['tools/publish-main.mjs','tools/publish-main-status.mjs'],seen=new Set();
 while(pending.length){
  const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  assert.ok(file.startsWith('tools/')&&!file.includes('..'));
  for(const dependency of relativeModules(file,await read(file)))pending.push(dependency);
 }
 assert.ok(seen.has('tools/publication-readiness.mjs'));assert.ok(seen.has('tools/publish-prepared-main.mjs'));assert.ok(seen.has('tools/publish-main-tail.mjs'));
 const latest=await read('tools/publish-latest-main.mjs');
 assert.ok(latest.includes("path.join(source,'tools/publish-main.mjs')"));
 const supervisor=await read('tools/worker-local-runtime-supervisor.mjs');
 assert.ok(supervisor.includes('"./start-local-worker.mjs"'));
 const release=await read('tools/worker-local-release.mjs');
 assert.ok(release.includes('"tools/start-local-worker.mjs"'));
});
