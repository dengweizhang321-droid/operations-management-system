import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {probeRotationLock} from '../tools/publish-latest-main.mjs';
import {verifyPreconditions} from '../tools/manual-pandas-startup-reconcile.mjs';

// Binds the driver's reading of probeRotationLock to the REAL publisher probe:
// true means the pipe could be taken now (lock free). A mocked boolean cannot
// catch an inverted reading; this test drives a real named pipe both ways.
async function lockProblem(probe){
  const runtimeRoot=await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-lock-polarity-'));
  try{
    const result=await verifyPreconditions({runtimeRoot,installedToolsRoot:path.join(runtimeRoot,'app/tools'),probeRotationLock:probe});
    return {held:result.rotationLockHeld,listed:result.problems.some(p=>p.includes('Worker rotation lock 仍被持有'))};
  }finally{await fs.rm(runtimeRoot,{recursive:true,force:true});}
}

test('free real pipe is not reported as held; a held real pipe is',async()=>{
  const pipe='\\\\.\\pipe\\TERUISI.Test.LockPolarity.'+randomUUID();
  assert.equal(pipe.startsWith('\\\\.\\pipe\\'),true);
  assert.deepEqual(await lockProblem(()=>probeRotationLock(pipe)),{held:false,listed:false});
  const holder=createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{holder.once('error',reject);holder.listen(pipe,resolve);});
  try{assert.deepEqual(await lockProblem(()=>probeRotationLock(pipe)),{held:true,listed:true});}
  finally{await new Promise(resolve=>holder.close(resolve));}
});
