// Real synthetic leaf only. No collector, Status, operator, service or descendants.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {digest,safeProcess} from './protocol.mjs';
const {runProcess}=await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/worker-local-release.mjs'));
const leafRecords=[];
async function leaf(mode){
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-independent-native-leaf-'));
  assert.equal(path.dirname(path.resolve(cwd)),path.resolve(os.tmpdir()));assert.ok(path.basename(cwd).startsWith('teruisi-independent-native-leaf-'));
  const inherited=Date.now()+(mode==='success'?5000:500),env={TEMP:cwd,TMP:cwd,TERUISI_PROCESS_DEADLINE_UNIX_MS:String(inherited)};
  for(const k of ['SystemRoot','WINDIR'])if(typeof process.env[k]==='string')env[k]=process.env[k];
  const script=mode==='success'?'setTimeout(()=>process.stdout.write(JSON.stringify({syntheticLeaf:true,deadline:Number(process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS)})),60)':'setTimeout(()=>process.stdout.write("late-leaf-output"),5000)';
  let result,error;
  try{
    try{result=await runProcess(process.execPath,['-e',script],{cwd,env,timeoutMs:10000,deadlineUnixMs:Date.now()+10000,outputProtocol:'direct-exit-files',cleanup:'direct',maxOutputBytes:1024,label:'isolated independent synthetic node leaf'});}catch(e){error=e;}
    const evidence=result?.processEvidence??error?.processEvidence;
    assert.ok(evidence&&Number.isSafeInteger(evidence.processId)&&evidence.processId>0&&evidence.processId!==process.pid);assert.equal(evidence.deadlineUnixMs,inherited);assert.equal(evidence.cleanup,'direct');assert.equal(evidence.outputProtocol,'direct-exit-files');assert.equal(evidence.treeCleanupPending,false);
    if(mode==='success'){assert.equal(error,undefined);assert.equal(evidence.exitCode,0);assert.equal(evidence.code,'completed');assert.deepEqual(JSON.parse(result.stdout),{syntheticLeaf:true,deadline:inherited});assert.equal(evidence.stdoutSha256,digest(result.stdout));}
    else{assert.ok(error);assert.equal(evidence.code,'process_timeout');assert.equal(evidence.stdoutBytes,0);assert.equal(evidence.stdoutSha256,digest(''));assert.ok(evidence.elapsedMs<10000,'inherited deadline cannot reset to original timeout');}
    const absenceStart=Date.now(),absenceDeadline=absenceStart+5000;let absent=false;
    while(Date.now()<absenceDeadline){try{process.kill(evidence.processId,0);}catch(e){if(e.code!=='ESRCH')throw e;absent=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(absent,true,'bound synthetic child must actually be absent; pending=false alone is insufficient');
    leafRecords.push({mode,realSyntheticSubprocess:true,nodeOnly:true,childSpawnedDescendants:false,productionActions:0,businessEnvironmentKeys:0,processEvidence:safeProcess(evidence),directChildAbsence:{processId:evidence.processId,method:'process.kill(pid,0) read-only',status:'ESRCH',confirmedAbsent:true,confirmedAt:new Date().toISOString(),waitMs:Date.now()-absenceStart,maximumWaitMs:5000}});
  }finally{
    const names=await fs.readdir(cwd);assert.equal(names.length,0,'owned temp cwd should remain empty');await fs.rmdir(cwd);
  }
}
test('real synthetic Node leaf completes with exact inherited minimum deadline and direct output evidence',()=>leaf('success'));
test('real synthetic Node leaf expires on earlier inherited deadline and cleans only its direct PID',()=>leaf('timeout'));
test.after(async()=>{if(leafRecords.length===2)await fs.writeFile(new URL('./INDEPENDENT_NATIVE_LEAF.json',import.meta.url),JSON.stringify({version:'teruisi-independent-synthetic-leaf-v1',productionActions:0,records:leafRecords},null,2)+'\n',{flag:'wx'});});
