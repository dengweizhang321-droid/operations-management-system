import { withMaintenanceCoordination, anchorNodeName } from "./n8n-maintenance-coordination.mjs";

function bindOriginalLogicalAnchor(workflow) {
  if (workflow.meta?.jackyunEntryBinding === "fixed-logical-anchor-v1") return workflow;
  const anchor = workflow.nodes.find(n => n.name === anchorNodeName);
  const oldClock = "const scheduledAt = new Date(input.body?.originalScheduledAt ?? input.timestamp ?? Date.now()).toISOString();";
  const oldId = "String(input.body?.originalExecutionId ?? $execution.id)";
  if (!anchor?.parameters.jsCode.includes(oldClock) || !anchor.parameters.jsCode.includes(oldId)) throw new Error("jackyun_logical_anchor_contract_changed");
  anchor.parameters.jsCode = anchor.parameters.jsCode.replace(oldClock, `
let inheritedAt = input.body?.originalScheduledAt ?? input.originalScheduledAt;
if (jackyunRecovery.kind === 'retry') {
  let target;
  try { target = await this.helpers.httpRequest({method:'GET',url:'http://127.0.0.1:5791/coordination/jackyun-recovery-target?logicalExecutionId='+encodeURIComponent(jackyunRecovery.logicalExecutionId),json:true,timeout:10000}); }
  catch { throw new Error('jackyun_retry_target_unverified_manual_action'); }
  if(target?.ok !== true || target.logicalExecutionId !== jackyunRecovery.logicalExecutionId || typeof target.originalScheduledAt !== 'string'
    || inheritedAt !== undefined && inheritedAt !== target.originalScheduledAt) throw new Error('jackyun_original_anchor_changed_manual_action');
  inheritedAt = target.originalScheduledAt;
}
const scheduledAt = new Date(inheritedAt ?? input.timestamp ?? Date.now()).toISOString();`)
    .replace(oldId, "String(jackyunRecovery.kind === 'retry' ? jackyunRecovery.logicalExecutionId : $execution.id)");
  workflow.meta = { ...workflow.meta, jackyunEntryBinding: "fixed-logical-anchor-v1" };
  return workflow;
}

/** Candidate only. This transformation changes no formal workflow or schedule.
 * New versus retry is explicit at the complete entry. No B-only retry route. */
export function withJackyunRecoveryContract(source) {
  if (source.id !== "J8kY2mQ5vR7sT4pN") throw new Error("jackyun_workflow_identity_required");
  const workflow = source.nodes.some(node => node.name === anchorNodeName) ? structuredClone(source) : withMaintenanceCoordination(source);
  if (workflow.meta?.jackyunRecovery === "jackyun-recovery-control-v1") return bindOriginalLogicalAnchor(workflow);
  const anchor = workflow.nodes.find(node => node.name === anchorNodeName);
  const code = anchor.parameters.jsCode;
  const marker = "const scheduledAt =";
  if (!code.includes(marker) || !code.includes("scheduledAt, originalExecutionId:")) throw new Error("jackyun_entry_anchor_contract_changed");
  anchor.parameters.jsCode = code.replace("if (input.body && (", "if (input.body && input.body.version !== 'jackyun-human-retry-authority-v1' && (")
    .replace(marker, `const humanRecovery = input.body?.version === 'jackyun-human-retry-authority-v1';
if(humanRecovery && !/^[a-f0-9-]{36}$/.test(input.body.authorizationId ?? '')) throw new Error('jackyun_human_authority_missing_manual_action');
const jackyunRecovery = humanRecovery ? input.body.jackyunRecovery : input.body ? {
  version:'jackyun-recovery-control-v1',kind:'retry',logicalExecutionId:String(input.body.originalExecutionId),failedExecutionId:String(input.body.failedExecutionId)
} : input.jackyunRecovery ?? {version:'jackyun-recovery-control-v1',kind:'new'};
if(jackyunRecovery.version !== 'jackyun-recovery-control-v1' || !['new','retry'].includes(jackyunRecovery.kind)
  || jackyunRecovery.kind === 'retry' && (!/^[1-9]\\d{0,19}$/.test(jackyunRecovery.logicalExecutionId ?? '')
    || !/^[1-9]\\d{0,19}$/.test(jackyunRecovery.failedExecutionId ?? ''))) throw new Error('jackyun_retry_target_missing_manual_action');
const scheduledAt =`).replace("scheduledAt, originalExecutionId:", "jackyunRecovery, humanAuthorizationId: humanRecovery ? input.body.authorizationId : null, retryDispatchExecutionId: input.body?.retryDispatchExecutionId ?? null, scheduledAt, originalExecutionId:");
  const claim = workflow.nodes.find(n => n.name === "领取共享 helper");
  claim.parameters.jsCode = claim.parameters.jsCode.replace("if ($runIndex >= 72) throw new Error('coordination_wait_expired_manual_action');", `
const previousQueue = $input.first().json.helperQueue;
const helperQueue = previousQueue ?? {polls:0,startedAt:new Date().toISOString()};
if(!Number.isInteger(helperQueue.polls) || helperQueue.polls < 0 || helperQueue.polls >= 72
  || !Number.isFinite(Date.parse(helperQueue.startedAt)) || Date.now() < Date.parse(helperQueue.startedAt)
  || Date.now() - Date.parse(helperQueue.startedAt) > 6*60*60*1000) throw new Error('coordination_wait_expired_manual_action');
const nextHelperQueue = {polls:helperQueue.polls+1,startedAt:helperQueue.startedAt};`)
    .replace("String($runIndex)", "String(helperQueue.polls)")
    .replaceAll("coordinationStatus:'waiting',reason:", "coordinationStatus:'waiting',helperQueue:nextHelperQueue,reason:")
    .replace("return [{json:{...result,...anchor}}];", "return [{json:{...result,...anchor,...(result.coordinationStatus === 'waiting' ? {helperQueue:nextHelperQueue} : {})}}];");
  for (const node of workflow.nodes.filter(n => n.parameters?.url?.startsWith("http://127.0.0.1:5791/jackyun/export-first/"))) {
    node.parameters.headerParameters.parameters.push({ name: "X-TERUISI-JACKYUN-RECOVERY", value: `={{ JSON.stringify($('${anchorNodeName}').first().json.jackyunRecovery) }}` });
    node.parameters.headerParameters.parameters.push({ name: "X-TERUISI-JACKYUN-HUMAN-AUTHORITY-ID", value: `={{ $('${anchorNodeName}').first().json.humanAuthorizationId ?? '' }}` });
    node.retryOnFail = false;
    if (node.parameters.url.endsWith("/verify")) continue;
    const checkName = `${node.name}·恢复等待？`, waitName = `${node.name}·等待原任务`;
    const outgoing = workflow.connections[node.name]?.main?.[0] ?? [];
    workflow.nodes.push({ id: `${node.id}-recovery-check`, name: checkName, type: "n8n-nodes-base.if", typeVersion: 2.2,
      position: [node.position[0] + 110, node.position[1] + 100], parameters: { conditions: { options: { caseSensitive: true, typeValidation: "strict", version: 2 },
        conditions: [{ id: `${node.id}-wait-condition`, leftValue: "={{ $json.recoveryDecision ?? '' }}", rightValue: "wait", operator: { type: "string", operation: "equals" } }], combinator: "and" }, options: {} } });
    workflow.nodes.push({ id: `${node.id}-recovery-wait`, name: waitName, type: "n8n-nodes-base.wait", typeVersion: 1.1,
      position: [node.position[0] + 110, node.position[1] + 240], parameters: { resume: "timeInterval", amount: "={{ $json.waitMinutes ?? 5 }}", unit: "minutes" } });
    const edge = name => ({ node: name, type: "main", index: 0 });
    workflow.connections[node.name] = { main: [[edge(checkName)]] };
    workflow.connections[checkName] = { main: [[edge(waitName)], outgoing] };
    workflow.connections[waitName] = { main: [[edge("领取共享 helper")]] };
  }
  workflow.settings = { ...workflow.settings, saveExecutionProgress: true };
  workflow.meta = { ...workflow.meta, jackyunRecovery: "jackyun-recovery-control-v1" };
  return bindOriginalLogicalAnchor(workflow);
}
