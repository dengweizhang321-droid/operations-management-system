import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const files=['execute-exact-closeout.mjs','seal-exact-scope.mjs'];
async function handlerOnly(file,error){
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  const at=source.lastIndexOf('\nmain().catch(');assert.ok(at>=0,'Missing public privacy boundary');
  const logs=[],processStub={exitCode:0};
  const script=new vm.Script(source.slice(at+1));
  await script.runInNewContext({main:async()=>{throw error;},console:{error:v=>logs.push(String(v))},process:processStub,createHash,Buffer});
  return {logs,exitCode:processStub.exitCode};
}
for(const file of files){
  test(file+' normal deep assertion private values only produce a digest',async()=>{
    let error;try{assert.deepEqual({title:'synthetic-private-title',actor:'synthetic-private-actor'},{title:'other',actor:'other'});}catch(e){error=e;}
    const result=await handlerOnly(file,error);assert.equal(result.exitCode,1);assert.equal(result.logs.length,1);
    const output=result.logs[0];assert.ok(!output.includes('synthetic-private-title'));assert.ok(!output.includes('synthetic-private-actor'));
    const parsed=JSON.parse(output);assert.match(parsed.messageSha256,/^[a-f0-9]{64}$/);assert.equal(parsed.rawPrivateValuesLogged,false);
  });
  test(file+' a filename-like private assertion message cannot become sourceLocation',async()=>{
    const marker='synthetic-private-customer',error=new Error(marker+' transition-rules.mjs:111:222');
    error.stack='Error: '+error.message+'\n    at validateTransitions (file:///fixture/transition-rules.mjs:9:3)';
    const result=await handlerOnly(file,error);assert.equal(result.exitCode,1);assert.equal(result.logs.length,1);
    assert.ok(!result.logs[0].includes(marker),'Unanchored frame selector exposed a private message');
    const parsed=JSON.parse(result.logs[0]);assert.match(parsed.messageSha256,/^[a-f0-9]{64}$/);
  });
  test(file+' a private value in a deep diff line cannot imitate a real stack frame',async()=>{
    const marker='synthetic-private-card',error=new Error('deep difference');
    error.stack='Error: deep difference\n+ title: "'+marker+' exact-closeout.mjs:13:4"\n    at closeExactBatch (file:///fixture/exact-closeout.mjs:5:2)';
    const result=await handlerOnly(file,error);assert.equal(result.exitCode,1);
    assert.ok(!result.logs[0].includes(marker),'Diff text was accepted as a source frame');
  });
}
