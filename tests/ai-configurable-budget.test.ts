import assert from "node:assert/strict";
import test from "node:test";
import { scheduleDeadlineTimer } from "../lib/ai/deadline-timer";
import { BoundedFetchError, fetchBoundedJson } from "../lib/ai/bounded-fetch";
import { resolveModelToolLoopLimits } from "../lib/ai/model-gateway";
import { runOpenAiCompatibleToolLoop } from "../lib/ai/tool-loop";

test("a configured tool loop can continue beyond the former 62 rounds and 300 calls", async () => {
  let ordinal = 0, executed = 0;
  const result = await runOpenAiCompatibleToolLoop({ messages: [], tools: [{}],
    limits: resolveModelToolLoopLimits({maxToolRounds:1000,maxTotalToolCalls:10000}),
    request: async () => ++ordinal === 66 ? {choices:[{message:{content:"complete"}}]} :
      {choices:[{message:{tool_calls:Array.from({length:5},(_,i)=>({id:`${ordinal}-${i}`,function:{name:"read",arguments:"{}"}}))}}]},
    executeTool:async name=>{executed++;return {ok:true,toolName:name,data:{}};},
  });
  assert.equal(result,"complete"); assert.equal(ordinal,66); assert.equal(executed,325);
});

test("long configured timers use bounded timer segments and fire only at their deadline", t => {
  let now = 0, fired = 0;
  const queued: {callback:()=>void;delay:number}[] = [];
  t.mock.method(globalThis,"setTimeout",(callback:()=>void,delay:number)=>{
    queued.push({callback,delay}); return {fake:queued.length};
  });
  t.mock.method(globalThis,"clearTimeout",()=>undefined);
  const cancel = scheduleDeadlineTimer(()=>fired++,3_000_000_000,()=>now);
  assert.equal(queued[0].delay,2_147_483_647);
  now = queued[0].delay; queued[0].callback(); assert.equal(fired,0);
  assert.equal(queued[1].delay,852_516_353);
  now = 3_000_000_000; queued[1].callback(); assert.equal(fired,1); cancel();
});

test("cancelled segmented timer cannot rearm and unlimited relay schedules no timer", t => {
  let now = 0, calls = 0;
  let check: () => void = ()=>undefined;
  t.mock.method(globalThis,"setTimeout",(callback:()=>void)=>{calls++;check=callback;return {};});
  t.mock.method(globalThis,"clearTimeout",()=>undefined);
  const cancel = scheduleDeadlineTimer(()=>assert.fail("fired after cancellation"),3_000_000_000,()=>now);
  cancel();now=3_000_000_000;check();assert.equal(calls,1);
  scheduleDeadlineTimer(()=>assert.fail("relay timer fired"),null)();assert.equal(calls,1);
});

test("a relay without its own timeout still propagates explicit cancellation", async () => {
  const controller = new AbortController();
  const pending = fetchBoundedJson({url:"https://fixture.invalid",init:{},timeoutMs:null,signal:controller.signal,
    fetcher:async (_url,init)=>new Promise((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true});
    }),
  });
  controller.abort();
  await assert.rejects(pending,(error:unknown)=>error instanceof BoundedFetchError && error.code==="cancelled");
});
