import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "flatted";
import { decodeN8nRetryContext, retryAnchorNode } from "../lib/jackyun/n8n-retry-context";
import { buildHourlyRetryErrorWorkflow, hourlyRetrySameFailureStopThreshold as threshold } from "../tools/n8n-hourly-retry-policy.mjs";
import { reserveRetryDispatch } from "../lib/jackyun/retry-dispatch-reservation";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fixture() {
  const row = { id: "42", workflowId: "TmallLiliDaily2026", status: "error", mode: "webhook", deletedAt: null, retrySuccessId: null,
    startedAt: "2026-09-29 16:01:00.000", stoppedAt: "2026-09-29 16:02:00.000" };
  const anchor = { version: "teruisi-retry-context-v1", workflowId: row.workflowId, executionId: row.id,
    originalExecutionId: "30", scheduledAt: "2026-09-28T15:59:00.000Z" };
  const task = { executionStatus: "success", data: { main: [[{ json: anchor }]] } };
  const document = { resultData: { runData: { [retryAnchorNode]: [task], unrelated: [{ data: { secret: "never-return-this" } }] } } };
  return { row, anchor, task, document };
}

test("retry context returns only the original plan and identity across days and generations", () => {
  const f=fixture();
  const result=decodeN8nRetryContext(f.row,stringify(f.document));
  assert.deepEqual(result,{version:f.anchor.version,workflowId:f.row.workflowId,failedExecutionId:"42",originalExecutionId:"30",originalScheduledAt:f.anchor.scheduledAt});
  assert.equal(JSON.stringify(result).includes("never-return-this"),false);
});

test("retry context rejects nonterminal, deleted, resumed, manual, cross-workflow and malformed records", () => {
  for(const change of [{status:"success"},{status:"running"},{deletedAt:"now"},{retrySuccessId:"51"},{mode:"manual"},
    {workflowId:"TmallYiyongDaily2026"},{workflowId:"unknown"},{stoppedAt:"invalid"},{stoppedAt:"2026-09-28 00:00:00.000"}]){
    const f=fixture();assert.throws(()=>decodeN8nRetryContext({...f.row,...change},stringify(f.document)));
  }
  for(const change of [{executionId:"43"},{workflowId:"another"},{version:"old"},{originalExecutionId:"44"},{scheduledAt:"2026-09-30T00:00:00.000Z"}]){
    const f=fixture();Object.assign(f.anchor,change);assert.throws(()=>decodeN8nRetryContext(f.row,stringify(f.document)));
  }
  const f=fixture();f.document.resultData.runData[retryAnchorNode].push(f.task);
  assert.throws(()=>decodeN8nRetryContext(f.row,stringify(f.document)));
});

test("error workflow verifies context before dispatch and forwards exact inherited fields", async () => {
  const workflow=buildHourlyRetryErrorWorkflow();
  const code=workflow.nodes.find(n=>n.name==="读取原执行计划时间")!.parameters.jsCode;
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const execute=new AsyncFunction("$","$runIndex","$execution",code);
  const pending={failedExecutionId:"42",retryPolicy:{workflowId:"TmallLiliDaily2026",retryUrl:"http://127.0.0.1:5678/webhook/test"}};
  const lookup=()=>({first:()=>({json:pending})});
  const f=fixture();const context=decodeN8nRetryContext(f.row,stringify(f.document));
  const client={helpers:{httpRequest:async(request:{url:string}):Promise<{statusCode:number;body:Record<string,unknown>}>=>(request.url.endsWith("reserve-retry")
    ?{statusCode:200,body:{ok:true,reservationStatus:"reserved",failedExecutionId:"42",retryExecutionId:"50"}}
    :{statusCode:200,body:{ok:true,...context}})}};
  assert.equal((await execute.call(client,lookup,0,{id:"50"}))[0].json.originalExecutionId,"30");
  // 已知 manual code 不再 throw：改为产出结构化 item，经同一 sender 发钉钉后由
  // 下游 stopAndError 用原错误码终局（13eb2579 把通知移出 Code 节点所致）。
  client.helpers.httpRequest=async()=>({statusCode:409,body:{ok:false,...context}});
  const unverified=(await execute.call(client,lookup,1))[0].json;
  assert.equal(unverified.manualAction.code,"retry_context_unverified_manual_action");
  assert.equal(unverified.terminalCode,"retry_context_unverified_manual_action");
  client.helpers.httpRequest=async()=>({statusCode:503,body:{ok:false,...context}});
  assert.equal((await execute.call(client,lookup,2))[0].json.contextStatus,"waiting");
  const expired=(await execute.call(client,lookup,72))[0].json;
  assert.equal(expired.manualAction.code,"retry_context_wait_expired_manual_action");
  assert.equal(expired.terminalCode,"retry_context_wait_expired_manual_action");
  // reserve 抛出属于已知 manual code，同样走人工出口而非原样抛。
  client.helpers.httpRequest=async(request:{url:string})=>{
    if(request.url.endsWith("reserve-retry")) throw new Error("socket hang up");
    return {statusCode:200,body:{ok:true,...context}};
  };
  const unknown=(await execute.call(client,lookup,3,{id:"50"}))[0].json;
  assert.equal(unknown.manualAction.code,"retry_reservation_result_unknown_manual_action");
  assert.equal(unknown.manualAction.logicalExecutionId,"30","应沿用已核验到的原 execution");
  // 终局性由下游链路保证，而非 throw：旧的 assert.rejects 曾是「转人工不会静默
  // continue」的唯一守卫，语义改掉后无人接替，故在此固定整条拓扑。
  const main=(name:string)=>workflow.connections[name as keyof typeof workflow.connections]!.main!;
  assert.equal(main("读取原执行计划时间")[0]![0]!.node,"原计划需要人工？");
  assert.equal(main("原计划需要人工？")[0]![0]!.node,"准备人工提醒参数");
  assert.equal(main("准备人工提醒参数")[0]![0]!.node,"转人工发钉钉提醒");
  const sender=main("转人工发钉钉提醒");
  assert.equal(sender.length,2,"sender 的成功与失败两路都必须接到 stopAndError");
  for(const out of sender) assert.equal(out![0]!.node,"重试派发结果未知转人工");
  const terminal=workflow.nodes.find(n=>n.name==="重试派发结果未知转人工")!;
  assert.equal(terminal.type,"n8n-nodes-base.stopAndError");
  assert.equal(workflow.connections["重试派发结果未知转人工" as keyof typeof workflow.connections],undefined,
    "stopAndError 不得有下游，否则执行不会终止");
  const dispatch=workflow.nodes.find(n=>n.name==="启动新的完整工作流 execution")!;
  assert.equal(dispatch.retryOnFail,false);
  assert.match(dispatch.parameters.jsonBody!,/originalScheduledAt/);
  assert.equal(workflow.connections["原计划核验完成？"].main[0][0].node,dispatch.name);
});

test("retry dispatch reservation is create-only across duplicate error executions and unknown outcomes",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"optimization4-retry-intent-"));
  try {
    const f=fixture();const context=decodeN8nRetryContext(f.row,stringify(f.document));
    assert.equal(reserveRetryDispatch(root,context,"50").reservationStatus,"reserved");
    for(const owner of ["50","51"]) assert.throws(()=>reserveRetryDispatch(root,context,owner),/already_reserved/);
    const receipt=JSON.parse(readFileSync(path.join(root,"outputs/n8n-retry-dispatch/TmallLiliDaily2026-42.json"),"utf8"));
    assert.equal(receipt.retryExecutionId,"50");assert.equal(receipt.status,"reserved");
    assert.equal(reserveRetryDispatch(root,{...context,failedExecutionId:"52"},"53").reservationStatus,"reserved");
  } finally {rmSync(root,{recursive:true});}
});

test("same-failure stop routes to manual action without reserving; every streak-check problem degrades to the old flow",async()=>{
  const workflow=buildHourlyRetryErrorWorkflow();
  const code=workflow.nodes.find(n=>n.name==="读取原执行计划时间")!.parameters.jsCode;
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const execute=new AsyncFunction("$","$runIndex","$execution",code);
  const run=async(workflowId:string,streak:()=>unknown)=>{
    const pending={failedExecutionId:"42",retryPolicy:{workflowId,retryUrl:"http://127.0.0.1:5678/webhook/test"}};
    const f=fixture();f.row.workflowId=workflowId;f.anchor.workflowId=workflowId;
    const context=decodeN8nRetryContext(f.row,stringify(f.document));
    const urls:string[]=[];
    const client={helpers:{httpRequest:async(request:{url:string})=>{
      urls.push(request.url.split("/coordination/")[1]!);
      if(request.url.endsWith("retry-failure-streak")) return streak();
      return request.url.endsWith("reserve-retry")
        ?{statusCode:200,body:{ok:true,reservationStatus:"reserved",failedExecutionId:"42",retryExecutionId:"50"}}
        :{statusCode:200,body:{ok:true,...context}};
    }}};
    const out=(await execute.call(client,()=>({first:()=>({json:pending})}),0,{id:"50"}))[0].json;
    return {out,urls};
  };
  const good={version:"teruisi-retry-failure-streak-v1",workflowId:"TmallLiliDaily2026",failedExecutionId:"42",threshold,consecutive:threshold,stop:true,fingerprint:"f"};
  const stopped=await run("TmallLiliDaily2026",()=>({statusCode:200,body:{ok:true,...good}}));
  assert.equal(stopped.out.manualAction.code,"manual_action_repeated_failure");
  assert.equal(stopped.out.terminalCode,"manual_action_repeated_failure");
  assert.equal(stopped.out.manualAction.logicalExecutionId,"30");
  assert.deepEqual(stopped.urls,["retry-context","retry-failure-streak"],"reserve-retry must not be called");
  const degraded:Array<[string,()=>unknown]>=[
    ["throws",()=>{throw new Error("socket hang up");}],
    ["404",()=>({statusCode:404,body:{}})],["409",()=>({statusCode:409,body:{ok:false}})],["500",()=>({statusCode:500,body:{}})],
    ["undefined response",()=>undefined],
    ["missing fields",()=>({statusCode:200,body:{ok:true}})],
    ["stop false",()=>({statusCode:200,body:{ok:true,...good,stop:false}})],
    ["below threshold",()=>({statusCode:200,body:{ok:true,...good,consecutive:threshold-1}})],
    ["non integer",()=>({statusCode:200,body:{ok:true,...good,consecutive:"3"}})],
    ["old version",()=>({statusCode:200,body:{ok:true,...good,version:"old"}})],
    ["workflow mismatch",()=>({statusCode:200,body:{ok:true,...good,workflowId:"TmallTuofengDaily2026"}})],
    ["execution mismatch",()=>({statusCode:200,body:{ok:true,...good,failedExecutionId:"41"}})],
    ["ok false",()=>({statusCode:200,body:{...good,ok:false}})],
  ];
  for(const [label,streak] of degraded){
    const result=await run("TmallLiliDaily2026",streak);
    assert.equal(result.out.contextStatus,"verified",label);
    assert.deepEqual(result.urls,["retry-context","retry-failure-streak","reserve-retry"],label);
  }
  const jackyun=await run("J8kY2mQ5vR7sT4pN",()=>({statusCode:200,body:{ok:true,...good,workflowId:"J8kY2mQ5vR7sT4pN"}}));
  assert.equal(jackyun.out.contextStatus,"verified");
  assert.deepEqual(jackyun.urls,["retry-context","reserve-retry"],"Jackyun keeps its own budget and never asks the streak endpoint");
});
