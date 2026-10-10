import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { scheduledBackup, readScheduledBackupStatus } from '../tools/release-daily-backup.mjs';

// Independent synthetic probes: all operators and the rotation lease are
// injected; no runtime paths, credentials, or production collection are read.
const receipt = { status:'completed', serviceStateChanged:false,
  retention:{status:'completed'}, backupId:'fixture-point',
  manifestSha256:'1'.repeat(64) };
const fakeOperation = {stdout:JSON.stringify(receipt)};
const directLease = async action => action({});
async function fixture(action) {
  const root = await mkdtemp(path.join(tmpdir(),'teruisi-d-independent-'));
  const proof = path.join(root,'proof'), schedule = path.join(root,'automation.toml');
  await mkdir(proof);
  await writeFile(schedule,'status = "ACTIVE"\n');
  // Each fixture is small and retained as original independent evidence;
  // there are no subprocesses, database payloads, or linked dependencies.
  return action({root:proof,schedule,fixtureRoot:root});
}
async function withParentDeadline(deadline,action) {
  const old=process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS;
  try {process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(deadline);return await action();}
  finally {if(old===undefined)delete process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS;else process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=old;}
}

test('D independent: scheduled mutation uses direct-exit file evidence and preserves lifecycle descendants',async()=>fixture(async f=>{
  let options;
  await scheduledBackup({...f,lock:directLease,run:async(_exe,_args,value)=>{options=value;return fakeOperation;}});
  assert.equal(options.outputProtocol,'direct-exit-files');
  assert.equal(options.cleanup,'preserve');
  assert.ok(Number.isSafeInteger(options.deadlineUnixMs));
}));

test('D independent: pause while acquiring the lock prevents any Backup invocation',async()=>fixture(async f=>{
  let calls=0;
  await assert.rejects(scheduledBackup({...f,
    lock:async action=>{await writeFile(f.schedule,'status = "PAUSED"\n');return action({});},
    run:async()=>{calls++;return fakeOperation;}}));
  assert.equal(calls,0,'an ACTIVE observation before the lock cannot authorize Backup after PAUSED');
}));

test('D independent: a newer lock failure cannot leave only an old successful daily proof',async()=>fixture(async f=>{
  await scheduledBackup({...f,lock:directLease,run:async()=>fakeOperation});
  const before=await readdir(f.root);
  await assert.rejects(scheduledBackup({...f,lock:async()=>{throw new Error('isolated lock denied');},run:async()=>{throw new Error('Backup must never run');}}));
  const after=await readdir(f.root);
  assert.notDeepEqual(after,before,'the latest failed attempt needs durable coverage before trusting an older success');
}));

test('D independent: exhausted inherited deadline prevents a new scheduled mutation',async()=>fixture(async f=>{
  let calls=0;
  await withParentDeadline(Date.now()-1,async()=>{
    await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{calls++;return fakeOperation;}}));
  });
  assert.equal(calls,0);
}));

test('D independent: late direct success cannot become a successful daily receipt',async()=>fixture(async f=>{
  await withParentDeadline(Date.now()+25,async()=>{
    await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{
      await new Promise(resolve=>setTimeout(resolve,70));return fakeOperation;
    }}));
  });
  const records=[];
  for(const name of await readdir(f.root)) {
    if(name==='active.json')continue;
    try {records.push(JSON.parse(await readFile(path.join(f.root,name,'result.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  assert.ok(records.length>0);
  assert.equal(records.some(record=>record.status==='success'),false);
}));

test('D independent: retained late-failure marker blocks the next scheduled mutation',async()=>fixture(async f=>{
  const completed=await scheduledBackup({...f,lock:directLease,run:async()=>fakeOperation});
  await writeFile(path.join(f.root,completed.id,'failure.json'),JSON.stringify({id:completed.id,status:'unknown'}));
  let calls=0;
  await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{calls++;return fakeOperation;}}));
  assert.equal(calls,0);
  const status=await readScheduledBackupStatus(f);
  assert.equal(status.schedule.lastResult,'unknown');
}));

test('D independent: newer failed lock observation rejects an older successful daily result',async()=>fixture(async f=>{
  await scheduledBackup({...f,lock:directLease,run:async()=>fakeOperation});
  await new Promise(resolve=>setTimeout(resolve,2));
  await assert.rejects(scheduledBackup({...f,lock:async()=>{throw new Error('isolated denied lock');}}));
  const status=await readScheduledBackupStatus(f);
  assert.equal(status.schedule.lastResult,'unknown');
  assert.equal(status.schedule.lastSuccessAt,null);
}));

test('D independent: exact ownership mismatch retains original success bytes plus an unknown marker',async()=>fixture(async f=>{
  let calls=0;
  await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{
    calls++;await writeFile(path.join(f.root,'active.json'),JSON.stringify({id:'different-owner',scheduleSha256:'2'.repeat(64)}));
    return fakeOperation;
  }}));
  const own=JSON.parse(await readFile(path.join(f.root,'active.json'),'utf8'));
  assert.equal(own.id,'different-owner');assert.equal(calls,1);
  const name=(await readdir(f.root)).find(name=>name!=='active.json');
  assert.equal(JSON.parse(await readFile(path.join(f.root,name,'result.json'),'utf8')).status,'success');
  assert.equal(JSON.parse(await readFile(path.join(f.root,name,'failure.json'),'utf8')).status,'unknown');
  await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{calls++;return fakeOperation;}}));
  assert.equal(calls,1);
}));

test('D independent: operator failure retains fixed process evidence and never its raw diagnostic',async()=>fixture(async f=>{
  let calls=0;
  const run=async()=>{
    calls++;const error=Error('secret diagnostic marker');
    error.processEvidence={version:1,code:'nonzero_exit',stage:'direct-exit',exitCode:9,processId:12345,cleanup:'preserve',outputProtocol:'direct-exit-files',stdout:'secret diagnostic marker'};
    throw error;
  };
  await assert.rejects(scheduledBackup({...f,lock:directLease,run}));
  const name=(await readdir(f.root)).find(name=>name!=='active.json');
  const raw=await readFile(path.join(f.root,name,'result.json'),'utf8'),value=JSON.parse(raw);
  assert.equal(value.status,'unknown');assert.equal(value.processEvidence.exitCode,9);
  assert.doesNotMatch(raw,/secret diagnostic marker/);
  await assert.rejects(scheduledBackup({...f,lock:directLease,run}));assert.equal(calls,1);
}));

test('D independent: result persistence failure cannot release ownership or replay the unknown mutation',async()=>fixture(async f=>{
  let calls=0;
  await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{
    calls++;const name=(await readdir(f.root)).find(name=>name!=='active.json');
    await mkdir(path.join(f.root,name,'result.json'));return fakeOperation;
  }}));
  assert.ok(JSON.parse(await readFile(path.join(f.root,'active.json'),'utf8')).id);
  await assert.rejects(scheduledBackup({...f,lock:directLease,run:async()=>{calls++;return fakeOperation;}}));
  assert.equal(calls,1);
}));

test('D independent: wrapper success alone cannot establish latest native schedule coverage',async()=>fixture(async f=>{
  await scheduledBackup({...f,lock:directLease,run:async()=>fakeOperation});
  const status=await readScheduledBackupStatus(f);
  assert.equal(status.schedule.wrapperLastResult,'success');
  assert.equal(status.schedule.lastResult,'unknown');assert.equal(status.schedule.lastSuccessAt,null);
  assert.equal(status.schedule.latestAttemptCoverageVerified,false);
}));
