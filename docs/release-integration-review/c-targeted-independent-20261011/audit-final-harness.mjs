// Reconstruct only documented test path substitutions. No test execution.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=x=>createHash('sha256').update(x).digest('hex');
const evidence='E:/codex-artifacts/release-first-adoption-targeted-20261011',sourceCommit=execFileSync('git',['rev-parse','4697f674'],{cwd:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')}).toString().trim();
const raw=fs.readFileSync(path.join(evidence,'CANDIDATE_REGRESSION_HARNESS_V4.json')),harness=JSON.parse(raw);
if(harness.candidateManifestSha256!=='6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4')throw Error('Wrong harness candidate');
const tools=path.join(harness.candidateRoot,'tools'),href=pathToFileURL(tools+path.sep).href;
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),results=[];
for(const pin of harness.pins){
  const gitRaw=execFileSync('git',['show',sourceCommit+':tests/'+pin.name],{cwd:repo});
  const candidates=[{kind:'exact-git-bytes',raw:gitRaw},{kind:'CRLF-checkout-materialization-for-test-source-only',raw:Buffer.from(gitRaw.toString().replace(/\r?\n/g,'\r\n'))}];
  const original=candidates.find(v=>hash(v.raw)===pin.originalSha256);if(!original)throw Error('Original test differs from declared source: '+pin.name);
  let content=original.raw.toString();
  if(pin.name.endsWith('.mjs')){
    content=content.replaceAll("'../tools/","'"+href).replaceAll("new URL('../tools/","new URL('"+href);
    if(['release-no-data-policy.test.mjs','release-tools-no-migration.test.mjs','release-first-adoption-targeted.test.mjs'].includes(pin.name))content=content.replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools')",JSON.stringify(tools));
    if(pin.name==='release-first-adoption-targeted.test.mjs')content=content.replace('hash(readFileSync(path.join(tools,name)))','hash(readFileSync(path.join('+JSON.stringify(path.join(harness.candidateRoot,'source-snapshot/tools'))+',name)))');
    if(pin.name==='release-no-data-observation.test.mjs')content=content.replace("'playwright-core'",JSON.stringify(pathToFileURL(path.join(harness.candidateRoot,'node_modules/playwright-core/index.mjs')).href));
    if(pin.name==='release-source-binding.test.mjs')content=content.replace("'tools/worker-local-release-rotation.mjs'",JSON.stringify(path.join(tools,'worker-local-release-rotation.mjs')));
    if(pin.name==='release-no-data-backend-start.test.mjs')content=content.replace("'tests/release-no-data-backend-start.test.ps1'",JSON.stringify(path.join(harness.root,'release-no-data-backend-start.test.ps1')));
  }else if(pin.name==='release-no-data-backend-start.test.ps1'){
    for(const [variable,name]of [['worker','worker-local-service.ps1'],['adapter','release-lifecycle-step.ps1']])content=content.replace(`$${variable}=Join-Path $PSScriptRoot '..\\tools\\${name}'`,`$${variable}='${path.join(tools,name).replaceAll("'","''")}'`);
    content=content.replaceAll("(Join-Path $PSScriptRoot '..\\tools\\process-deadline.ps1')",`'${path.join(tools,'process-deadline.ps1')}'`);
  }else throw Error('Unexpected harness file');
  const rebuilt=Buffer.from(content),actual=fs.readFileSync(path.join(harness.root,pin.name));
  if(hash(rebuilt)!==pin.harnessSha256||!actual.equals(rebuilt))throw Error('Unreviewed assertion/fixture edit: '+pin.name);
  results.push({name:pin.name,originalSha256:pin.originalSha256,harnessSha256:pin.harnessSha256,gitSourceMaterialization:original.kind,onlyExactDocumentedPathSubstitutions:true});
}
const out={version:'teruisi-c-targeted-harness-preservation-audit-v1',at:new Date().toISOString(),sourceCommit,candidateManifestSha256:harness.candidateManifestSha256,harnessSha256:hash(raw),testsExpected:215,files:results,assertionsAndFixtureActionsPreserved:true,testsRerun:false,productionOperations:0};
fs.writeFileSync(new URL('./FINAL_HARNESS_AUDIT.json',import.meta.url),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:results.length,pathOnly:true}));
