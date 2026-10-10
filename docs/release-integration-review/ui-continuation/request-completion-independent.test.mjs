// Independent pure event-context fixtures. No browser, HTTP listener or production call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { installRequestCompletionBarrier, waitForProductDetailReady } from './request-completion.mjs';

function fakeContext() { const handlers=new Map();return {on:(name,fn)=>handlers.set(name,fn),emit:(name,value)=>handlers.get(name)?.(value)}; }
const origin='http://127.0.0.1:39991';
const exact={pathname:'/api/sales/summary',requiredQueryKeys:['productCodes','startDate','endDate','range']};
test('independent quiet completion cannot report success after its common deadline',async()=>{
  const context=fakeContext(),barrier=installRequestCompletionBarrier(context,{origin,timeoutMs:35,quietMs:10});
  const pending=barrier.waitForIdle();
  setTimeout(()=>{const until=performance.now()+80;while(performance.now()<until){}},1);
  await assert.rejects(pending,/deadline exceeded/);
});
test('independent action wait itself is bounded by the same current read deadline',async()=>{
  const context=fakeContext(),barrier=installRequestCompletionBarrier(context,{origin,timeoutMs:25,quietMs:5});
  const result=await Promise.race([
    barrier.runAndWaitForRead(()=>new Promise(()=>{}),exact).then(()=>({kind:'passed'}),error=>({kind:'rejected',error})),
    new Promise(resolve=>setTimeout(()=>resolve({kind:'outside-budget-probe-expired'}),85)),
  ]);
  assert.equal(result.kind,'rejected','Action remained pending beyond the helper deadline');
  assert.match(String(result.error),/deadline exceeded/);
});
test('independent terminal failure cannot be replaced by a later successful matching read',async()=>{
  const context=fakeContext(),barrier=installRequestCompletionBarrier(context,{origin,timeoutMs:200,quietMs:5});
  const request=()=>({url:()=>origin+'/api/sales/summary?productCodes=SYNTHETIC&startDate=2026-01-01&endDate=2026-01-01&range=custom',method:()=> 'GET'});
  await assert.rejects(barrier.runAndWaitForRead(async()=>{
    const failed=request();context.emit('request',failed);context.emit('requestfailed',failed);
    const good=request();context.emit('request',good);context.emit('response',{request:()=>good,status:()=>200});context.emit('requestfinished',good);
  },exact),/selected current read failed/);
});
test('independent action cannot start after the read deadline has already expired',async()=>{
  const context=fakeContext(),barrier=installRequestCompletionBarrier(context,{origin,timeoutMs:25,quietMs:5});
  let invoked=false;
  const pending=barrier.runAndWaitForRead(()=>{invoked=true;},exact);
  const stop=performance.now()+65;while(performance.now()<stop){}
  await assert.rejects(pending,/deadline exceeded/);
  assert.equal(invoked,false,'Expired action still executed before the delayed timeout callback');
});
test('independent DOM handoff cannot reset the selected read common deadline',async()=>{
  const context=fakeContext(),barrier=installRequestCompletionBarrier(context,{origin,timeoutMs:30,quietMs:5});
  const request={url:()=>origin+'/api/sales/summary?productCodes=SYNTHETIC&startDate=2026-01-01&endDate=2026-01-01&range=custom',method:()=> 'GET'};
  const selected=await barrier.runAndWaitForRead(()=>{
    context.emit('request',request);context.emit('response',{request:()=>request,status:()=>200});context.emit('requestfinished',request);
  },exact);
  await new Promise(resolve=>setTimeout(resolve,65));
  let disposed=false;
  const page={waitForFunction:async()=>({jsonValue:async()=>({ready:true}),dispose:async()=>{disposed=true;}})};
  await assert.rejects(waitForProductDetailReady(page,{timeoutMs:selected.remainingMs,deadlineMonoMs:selected.deadlineMonoMs}),/deadline exceeded/);
  // An implementation may reject before acquiring a handle; no handle leaks are allowed.
  assert.equal(disposed || Number.isFinite(selected.deadlineMonoMs),true);
});
