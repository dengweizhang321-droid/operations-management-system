// Read-only qualification of the external metadata guard, never executeBatch.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {runLiveReferenceAudit} from './live-reference-audit.mjs';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const raw=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs');
assert.equal(createHash('sha256').update(raw).digest('hex'),'eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd');
const source=raw.toString('utf8'),start=source.indexOf('  const isReference='),end=source.indexOf('  async function visitValue(');
assert.ok(start>0&&end>start);
const context=vm.createContext({path,realpath,target:path.resolve('D:/teruisi-runtime/django-sales/app.previous').toLowerCase()});
new vm.Script(source.slice(start,end)+'\nglobalThis.predicates={inspectReferences,inspectProcessReference};').runInContext(context);
const startedAt=new Date().toISOString();
try{
 const audit=await runLiveReferenceAudit({...context.predicates,sourceRoot:path.dirname(fileURLToPath(import.meta.url))});
 const result={version:'primary-live-reference-qualification-v1',startedAt,finishedAt:new Date().toISOString(),status:audit.status,
   audit,originalPredicateSha256:createHash('sha256').update(raw).digest('hex'),productionActions:0,
   scope:'Real external guard metadata/predicate qualification only. No Worker apply, DDeploy, maintenance, service action, backup/restore or production acceptance.'};
 await writeFile(root+'/PRIMARY_LIVE_REFERENCE_QUALIFICATION_V4.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:audit.status,unknown:audit.unknown,references:audit.references,runId:audit.runId}));
 if(audit.status!=='passed')process.exitCode=2;
}catch(error){
 await writeFile(root+'/PRIMARY_LIVE_REFERENCE_QUALIFICATION_FAILURE_V4.json',JSON.stringify({version:'primary-live-reference-qualification-failure-v1',startedAt,finishedAt:new Date().toISOString(),message:error.message,liveAudit:error.liveAudit??null,productionActions:0},null,2)+'\n',{flag:'wx'});
 throw error;
}
