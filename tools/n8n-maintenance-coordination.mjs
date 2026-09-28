// Candidate transformation only. No n8n connection, publish, activation or run.
export const anchorNodeName = "固定原执行计划时间";
export function withMaintenanceCoordination(source) {
  const workflow = structuredClone(source);
  if (workflow.nodes.some(n => n.name === anchorNodeName)) throw new Error("candidate_already_transformed");
  const claims = workflow.nodes.filter(n => n.parameters?.url === "http://127.0.0.1:5791/coordination/claim");
  if (claims.length !== 1) throw new Error("unique_claim_required");
  const claim = claims[0];
  const headers = claim.parameters.headerParameters.parameters;
  const staticHeaders = Object.fromEntries(headers.filter(h => !h.value.startsWith("=")).map(h => [h.name, h.value]));
  if (!staticHeaders["X-TERUISI-WORKFLOW-KEY"]) throw new Error("static_workflow_identity_required");
  workflow.nodes.push({ name: anchorNodeName, id: `${claim.id}-anchor`, type: "n8n-nodes-base.code", typeVersion: 2,
    position: [claim.position[0] - 200, claim.position[1] - 100], parameters: { jsCode: `
const input = $input.first().json;
// Hourly descendants must carry the original anchor. Missing evidence stops;
// a new execution must not silently recompute yesterday after downtime.
if (input.body && (input.body.version !== 'teruisi-retry-context-v1' || input.body.workflowId !== ${JSON.stringify(source.id)}
  || !/^[1-9]\\d{0,19}$/.test(input.body.failedExecutionId ?? '') || !/^[1-9]\\d{0,19}$/.test(input.body.originalExecutionId ?? '')
  || !input.body.originalScheduledAt)) throw new Error('maintenance_retry_plan_anchor_missing_manual_action');
const scheduledAt = new Date(input.body?.originalScheduledAt ?? input.timestamp ?? Date.now()).toISOString();
return [{json:{version:'teruisi-retry-context-v1',workflowId:${JSON.stringify(source.id)},executionId:String($execution.id),
  scheduledAt, originalExecutionId: String(input.body?.originalExecutionId ?? $execution.id)}}];` } });
  let incoming = 0;
  for (const [name, connection] of Object.entries(workflow.connections)) {
    const node = workflow.nodes.find(n => n.name === name);
    for (const edges of connection.main ?? []) for (const edge of edges) {
      if (edge.node === claim.name && node?.type !== "n8n-nodes-base.wait") { edge.node = anchorNodeName; incoming++; }
    }
  }
  if (!incoming) throw new Error("claim_entry_required");
  workflow.connections[anchorNodeName] = { main: [[{ node: claim.name, type: "main", index: 0 }]] };
  claim.type = "n8n-nodes-base.code"; claim.typeVersion = 2;
  delete claim.retryOnFail; delete claim.maxTries; delete claim.waitBetweenTries;
  claim.parameters = { jsCode: `
const anchor = $('${anchorNodeName}').first().json;
if ($runIndex >= 72) throw new Error('coordination_wait_expired_manual_action');
let response;
try {
  response = await this.helpers.httpRequest({method:'POST',url:'http://127.0.0.1:5791/coordination/claim',json:true,timeout:10000,returnFullResponse:true,ignoreHttpStatusErrors:true,
    headers:{...${JSON.stringify(staticHeaders)},'X-TERUISI-N8N-EXECUTION-ID':String($execution.id),
      'X-TERUISI-COORDINATION-ATTEMPT':String($runIndex),'X-TERUISI-SCHEDULED-AT':anchor.scheduledAt}});
} catch (error) {
  const status = Number(error.statusCode ?? error.response?.statusCode ?? error.httpCode ?? 0);
  if (status >= 400 && status < 500) throw new Error('coordination_rejected_manual_action');
  // This node has no business effect. Retry only this same claim/execution;
  // never call A or replay any export/import/send on an uncertain response.
  return [{json:{ok:true,coordinationStatus:'waiting',reason:'helper_unavailable_wait',...anchor}}];
}
const status = Number(response.statusCode);
if (status >= 400 && status < 500) throw new Error('coordination_rejected_manual_action');
if (status >= 500) return [{json:{ok:true,coordinationStatus:'waiting',reason:'helper_unavailable_wait',...anchor}}];
if (status !== 200) throw new Error('invalid_coordination_http_status_manual_action');
const result = response.body;
if (!result || result.ok !== true || !['granted','waiting'].includes(result.coordinationStatus)) throw new Error('invalid_coordination_result_manual_action');
return [{json:{...result,...anchor}}];` };
  workflow.meta = { ...workflow.meta, maintenanceCoordination: "candidate-v1" };
  return workflow;
}
