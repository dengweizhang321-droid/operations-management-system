import test from 'node:test';
import assert from 'node:assert/strict';
import {pandasRuntimeChanged,verifyPandasCompletion} from '../tools/publish-main-pandas.mjs';
import {finishMainPublication} from '../tools/publish-main-tail.mjs';

test('Pandas source add/delete and both rename ends require its own rotation; tests do not',()=>{
 for(const change of [{path:'backend/pandas_runner/new.py'}, {path:'backend/pandas_runner/server.py',status:'D'},
  {path:'elsewhere/server.py',before:'backend/pandas_runner/server.py'},
  {path:'backend/pandas_runner/server.py',before:'elsewhere/server.py'}])
  assert.equal(pandasRuntimeChanged({releasePlan:{changes:[change]}}),true);
 assert.equal(pandasRuntimeChanged({releasePlan:{changes:[{path:'backend/pandas_runner/test_server.py'}]}}),false);
});

test('native tail refuses missing Pandas bindings before any lifecycle action',async()=>{
 await assert.rejects(finishMainPublication({request:{releasePlan:{changes:[{path:'backend/pandas_runner/server.py'}]}}}),/Pandas/);
});

test('CAS alone and mismatched original startup proof are not Pandas completion',()=>{
 const prepared={configured:true,registeredPlanSha256:'1'.repeat(64),sourceSha256:'2'.repeat(64),predecessorSourceSha256:'3'.repeat(64),image:'sha256:'+'4'.repeat(64),preparedAppId:'5'.repeat(32),preparedAppSha256:'6'.repeat(64),sourceCommit:'7'.repeat(40)};
 const switched={...prepared,maintenanceId:'8'.repeat(32),publicationOwnerPid:123,intentSha256:'9'.repeat(64),status:'switched_stopped'};
 assert.throws(()=>verifyPandasCompletion(switched,prepared,switched));
 const complete={...switched,status:'ready_verified',completed:true,postconditionsVerified:true,startupReceiptSha256:'a'.repeat(64)};
 assert.equal(verifyPandasCompletion(complete,prepared,switched),complete);
 assert.throws(()=>verifyPandasCompletion({...complete,intentSha256:'b'.repeat(64)},prepared,switched));
 assert.throws(()=>verifyPandasCompletion({...complete,startupReceiptSha256:null},prepared,switched));
});
