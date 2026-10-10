// Development-only deterministic copy. Does not import or execute a release tool.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export const adopted='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9';
export const originalRoot='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const directory=path.dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
function once(s,from,to){assert.equal(s.split(from).length,2,'Unique legacy replacement');return s.replace(from,to);}
function imports(s){for(const name of ['release-impact.mjs','worker-local-release-rotation.mjs','worker-local-release.mjs','release-daily-backup.mjs'])s=s.replaceAll("'./"+name+"'",JSON.stringify(pathToFileURL(path.join(adopted,'tools',name)).href));return s;}
export async function generate({write=false}={}){
  const donor=await readFile(path.resolve(directory,'../../../tools/release-readonly-retry.mjs'),'utf8');
  const donorBlock=donor.slice(donor.indexOf('export function safeObservationError('),donor.indexOf('export async function retryReadOnlyObservation('));assert.ok(donorBlock.includes('safeReadinessFailure'));
  const files=[];for(const name of ['release-readonly-retry.mjs','release-batch.mjs','release-batch-admission.mjs','collector.mjs']){
    const originalPath=name==='collector.mjs'?path.join(originalRoot,name):path.join(adopted,'tools',name),raw=await readFile(originalPath),original=raw.toString('utf8');let s=original;
    if(name==='release-readonly-retry.mjs')s=once(s,s.slice(s.indexOf('export function safeObservationError('),s.indexOf('export async function retryReadOnlyObservation(')),donorBlock);
    if(name==='release-batch.mjs'){
      s=once(s,'assertCompleteReadiness, safeObservationError','assertCompleteReadiness, safeReadinessFailure, safeObservationError');
      s=once(s,"from './release-readonly-retry.mjs';","from './release-readonly-retry.mjs';\nimport { captureStatusResponse } from '../status-evidence.mjs';");
      s=once(s,"        const status = parseStatus(value.stdout);\n        assertCompleteReadiness(status,op.assertions.find(a=>a.path==='releaseId').equals);\n        for (const assertion of op.assertions) if (canonical(assertion.path.split('.').reduce((v,k) => v?.[k], status)) !== canonical(assertion.equals)) throw observationError('ASSERTION_FAILED');\n        return value;",
`        let status, captureAttempted=false;
        const expectedReleaseId=op.assertions.find(a=>a.path==='releaseId').equals;
        try {
          status=parseStatus(value.stdout);captureAttempted=true;
          await captureStatusResponse(value,safeReadinessFailure(status,expectedReleaseId),true,'final-readiness-status');
          assertCompleteReadiness(status,expectedReleaseId);
          for (const assertion of op.assertions) if (canonical(assertion.path.split('.').reduce((v,k) => v?.[k], status)) !== canonical(assertion.equals)) throw observationError('ASSERTION_FAILED');
          return value;
        } catch(error) {
          if(!captureAttempted)try{await captureStatusResponse(value,null,false,'final-readiness-status');}catch(captureError){captureError.processEvidence??=value.processEvidence;throw captureError;}
          error.processEvidence??=value.processEvidence;
          if(status)error.readinessEvidence=safeReadinessFailure(status,expectedReleaseId);
          throw error;
        }`);
    }
    if(name==='release-batch-admission.mjs'){
      s=once(s,'parseStatus, assertCompleteReadiness }','parseStatus, assertCompleteReadiness, safeReadinessFailure }');
      s=once(s,"from './release-readonly-retry.mjs';","from './release-readonly-retry.mjs';\nimport { captureStatusResponse } from '../status-evidence.mjs';");
      s=once(s,"        assertCompleteReadiness(parseStatus(result.stdout),plan.candidate.releaseId);\n        return {releaseId:plan.candidate.releaseId,ready:true};",
`        let status, captureAttempted=false;
        try {
          status=parseStatus(result.stdout);captureAttempted=true;
          await captureStatusResponse(result,safeReadinessFailure(status,plan.candidate.releaseId),true,'admission-status');
          assertCompleteReadiness(status,plan.candidate.releaseId);
          return {releaseId:plan.candidate.releaseId,ready:true};
        } catch(error) {
          if(!captureAttempted)try{await captureStatusResponse(result,null,false,'admission-status');}catch(captureError){captureError.processEvidence??=result.processEvidence;throw captureError;}
          error.processEvidence??=result.processEvidence;
          if(status)error.readinessEvidence=safeReadinessFailure(status,plan.candidate.releaseId);
          throw error;
        }`);
    }
    if(name==='collector.mjs'){
      s=once(s,"'./python-closure.mjs'",JSON.stringify(pathToFileURL(path.join(originalRoot,'python-closure.mjs')).href));
      s=once(s,"path.join(h.immutableCandidateRoot,'tools/release-batch-admission.mjs')","fileURLToPath(new URL('./release-batch-admission.mjs',import.meta.url))");
    }else s=imports(s);
    if(name==='release-batch-admission.mjs')s=once(s,'console.error(e.message);',"console.error(JSON.stringify({errorType:['Error','AssertionError','TypeError','SyntaxError','RangeError'].includes(e.name)?e.name:'OtherError',messageSha256:hash(String(e.message)),rawPrivateValuesLogged:false}));");
    if(name==='release-batch.mjs')s=once(s,'console.error(error.message);',"console.error(JSON.stringify({errorType:['Error','AssertionError','TypeError','SyntaxError','RangeError'].includes(error.name)?error.name:'OtherError',messageSha256:hash(String(error.message)),rawPrivateValuesLogged:false}));");
    const target=path.join(directory,'legacy',name);if(write){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,s,{flag:'wx'});}else assert.equal(await readFile(target,'utf8'),s,'Limited copy changed outside declared transformations');
    files.push({name,originalPath,originalSha256:sha(raw),copySha256:sha(s),copyPath:target});
  }
  const evidence={version:1,donorCommit:'257445088d',donorProjectionSha256:sha(donorBlock),files,allowedChanges:['fixed diagnostic projection and idempotent process retention','create-only diagnostic capture before original Status assertions','explicit imports to exact old immutable dependencies','wrapper child entrypoint only; original root/cwd/phase/Python inventory preserved','CLI error envelope hashes message without retaining arbitrary text'],originalAssertionsUnchanged:true,productionExecuted:false};
  if(write)await writeFile(path.join(directory,'LEGACY_COPY_MANIFEST.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});return evidence;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))generate({write:process.argv[2]==='--create'}).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.name);process.exitCode=1;});
