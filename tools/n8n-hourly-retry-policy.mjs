import { createHash } from "node:crypto";

export const hourlyRetryErrorWorkflowId = "TeruisiHourlyRetry2026";
export const hourlyRetryDelayMinutes = 60;
export const hourlyRetryTriggerName = "失败后每小时安全重试入口";

export const hourlyRetryTargets = [
  { workflowId: "J8kY2mQ5vR7sT4pN", fileName: "jackyun-five-dataset-api.workflow.json" },
  { workflowId: "JdN8nM3uL7tI2026", fileName: "jd-multi-store-daily.workflow.json" },
  { workflowId: "JdN8nSilentCopy2026", fileName: "jd-multi-store-daily.chromium-silent-copy.workflow.json" },
  { workflowId: "JdMarketDaily2026", fileName: "jd-market-ranking-daily.workflow.json" },
  { workflowId: "JdMarketSilentCopy2026", fileName: "jd-market-ranking-daily.chromium-silent-copy.workflow.json" },
  { workflowId: "JdPromotionDaily2026", fileName: "jd-promotion-daily.workflow.json" },
  { workflowId: "JdPromotionCutMeat2026", fileName: "jd-promotion-cut-meat-20260813-14.workflow.json" },
  { workflowId: "M4xY8kQ2vR6sT9pC", fileName: "tmall-yijiu-direct-pm-candidate.workflow.json" },
  { workflowId: "TmallLiliDaily2026", fileName: "tmall-lili-sycm-cookie-daily.workflow.json" },
  { workflowId: "TmallTuofengDaily2026", fileName: "tmall-tuofeng-sycm-cookie-daily.workflow.json" },
  { workflowId: "TmallCuizhiwangDaily2026", fileName: "tmall-cuizhiwang-sycm-cookie-daily.workflow.json" },
  { workflowId: "TmallMasituDaily2026", fileName: "tmall-masitu-sycm-cookie-daily.workflow.json" },
  { workflowId: "TmallYiyongDaily2026", fileName: "tmall-yiyong-direct-pm-candidate.workflow.json" },
];

const terminalFailurePatterns = [
  "JACKYUN_OSS_DOWNLOAD_|JACKYUN_API_RESUME_MANUAL_ACTION|JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED",
  "maintenance_requires_plan_anchor|execution_plan_anchor_changed|coordination_wait_expired|manual_action|maintenance_wait",
  "challenge_present|waiting_login",
  "captcha|验证码|滑块|短信验证|安全验证|security verification|risk control|风控|\\b601\\b",
  "credential|credentials|凭据|dpapi|密码.*(?:缺失|损坏|错误)|授权失效|unauthori[sz]ed|authentication failed|http 40[13]",
  "JACKYUN_PREFLIGHT_RETRY_READY",
  "API_LOGIN_PAGE_NOT_UNIQUE|原运行 n8n-export-first-[1-9]\\d{0,19} 尚未闭合",
  "店铺身份|账号身份|identity(?: mismatch| invalid)|cross[- ]store|跨店|wrong store",
  "登录失效|需要登录|登录.*(?:失败|异常|拒绝|未就绪)|login (?:required|failed|failure)|not authenticated|session invalid|cookie invalid|passport\\.jd\\.com|login\\.taobao\\.com",
  "多个候选|候选.*不唯一|任务.*歧义|ambiguous|multiple candidates",
  "点击结果未决|提交结果未决|result unknown|dispatch unknown|click unknown",
  "export_submitting|report_submitting|page_export_submitting|task_click_invoked",
  "source[_ -]?not[_ -]?ready|来源数据未就绪|数据源未就绪|日期.*disabled",
  "活动清单.*无法证明|manifest.*(?:mismatch|ambiguous|invalid)|owner.*conflict|owner.*冲突",
  "唯一商品数.*出售中总数|内容完整性错误|content completeness|内容校验失败|validation failed|日期覆盖.*(?:缺失|不一致)|date coverage.*(?:missing|mismatch)|空文件|零行业务|malformed workbook|批次.*(?:不匹配|回查失败)",
  "逐页货品文件合计 \\d+ 个唯一商品，与出售中总数 \\d+ 不一致|市场榜单导入响应与签收文件、身份、日期或行数不一致",
  "需要人工|转人工|manual action|required human",
];

const boundDownloadFailurePattern = "^JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|HTTP_408|HTTP_429|HTTP_500|HTTP_502|HTTP_503|HTTP_504) attempts=[1-3]$";

function stableUuid(seed) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hourlyRetryWebhookPath(workflowId) {
  const suffix = createHash("sha256").update(`teruisi-hourly-retry:${workflowId}`).digest("hex").slice(0, 40);
  return `teruisi-hourly-retry-${suffix}`;
}

function collectFailureText(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectFailureText(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectFailureText(item, output);
  return output.join(" ").slice(0, 32_768);
}

export function classifyHourlyRetryFailure(payload) {
  const workflowId = String(payload?.workflow?.id ?? "");
  if (!hourlyRetryTargets.some((target) => target.workflowId === workflowId)) {
    return { retry: false, reason: "workflow_not_allowed" };
  }
  const mode = String(payload?.execution?.mode ?? payload?.trigger?.mode ?? "");
  if (!new Set(["trigger", "webhook"]).has(mode)) return { retry: false, reason: "execution_mode_not_automatic" };
  const failureText = collectFailureText({
    error: payload?.execution?.error ?? payload?.trigger?.error,
    lastNodeExecuted: payload?.execution?.lastNodeExecuted,
  });
  const verifiedJackyunPreflight = workflowId === "J8kY2mQ5vR7sT4pN"
    && String(payload?.execution?.lastNodeExecuted ?? "") === "B·接口校验与五表下载"
    && String(payload?.execution?.error?.description ?? "") === "JACKYUN_PREFLIGHT_RETRY_READY"
    && !terminalFailurePatterns.some((source) => new RegExp(source, "iu").test(failureText.replaceAll("JACKYUN_PREFLIGHT_RETRY_READY", "")));
  if (verifiedJackyunPreflight) {
    return { retry: true, reason: "verified_preflight_retry", workflowId,
      retryUrl: `http://127.0.0.1:5678/webhook/${hourlyRetryWebhookPath(workflowId)}` };
  }
  const downloadDescription = String(payload?.execution?.error?.description ?? "");
  const jackyunDownloadNode = workflowId === "J8kY2mQ5vR7sT4pN" && payload?.execution?.lastNodeExecuted === "B·接口校验与五表下载";
  if (jackyunDownloadNode && new RegExp(boundDownloadFailurePattern).test(downloadDescription)
    && !terminalFailurePatterns.some(source => new RegExp(source, "iu").test(failureText.replaceAll(downloadDescription, "")))) {
    return { retry: true, reason: "bound_download_resume_required", workflowId,
      retryUrl: `http://127.0.0.1:5678/webhook/${hourlyRetryWebhookPath(workflowId)}` };
  }
  if (jackyunDownloadNode && /fetch failed/iu.test(failureText)) return { retry: false, reason: "download_stage_unverified" };
  if (terminalFailurePatterns.some((source) => new RegExp(source, "iu").test(failureText))) {
    return { retry: false, reason: "manual_intervention_required" };
  }
  return {
    retry: true,
    reason: "retryable_failure",
    workflowId,
    retryUrl: `http://127.0.0.1:5678/webhook/${hourlyRetryWebhookPath(workflowId)}`,
  };
}

function edge(node) {
  return { node, type: "main", index: 0 };
}

export function attachHourlyRetryTarget(workflow, { entryNodeName = "领取共享 helper" } = {}) {
  if (!workflow || typeof workflow !== "object" || typeof workflow.id !== "string") throw new Error("工作流定义缺少 id");
  const entryNodes = workflow.nodes?.filter((node) => node.name === entryNodeName) ?? [];
  if (entryNodes.length !== 1) throw new Error(`${workflow.id} 必须且只能包含一个重试入口节点 ${entryNodeName}`);
  const allowed = hourlyRetryTargets.some((target) => target.workflowId === workflow.id);
  if (!allowed) {
    throw new Error(`${workflow.id} 未登记为数据下载导入工作流`);
  }

  const webhookPath = hourlyRetryWebhookPath(workflow.id);
  const existingRetryNodes = workflow.nodes.filter((node) => node.name === hourlyRetryTriggerName);
  const existingConnection = workflow.connections?.[hourlyRetryTriggerName]?.main?.[0] ?? [];
  const existingPolicy = workflow.meta?.hourlyRetryPolicy;
  if (
    existingRetryNodes.length === 1
    && existingRetryNodes[0]?.type === "n8n-nodes-base.webhook"
    && existingRetryNodes[0]?.parameters?.path === webhookPath
    && existingRetryNodes[0]?.parameters?.responseMode === "onReceived"
    && existingConnection.length === 1
    && existingConnection[0]?.node === entryNodeName
    && workflow.settings?.errorWorkflow === hourlyRetryErrorWorkflowId
    && existingPolicy?.version === "2026-09-10.safe-hourly-retry.1"
    && existingPolicy?.delayMinutes === hourlyRetryDelayMinutes
    && existingPolicy?.errorWorkflowId === hourlyRetryErrorWorkflowId
    && existingPolicy?.webhookPath === webhookPath
  ) {
    return workflow;
  }

  workflow.nodes = workflow.nodes.filter((node) => node.name !== hourlyRetryTriggerName);
  delete workflow.connections?.[hourlyRetryTriggerName];
  const entryPosition = entryNodes[0].position ?? [-500, 0];
  workflow.nodes.push({
    parameters: {
      httpMethod: "POST",
      path: webhookPath,
      responseMode: "onReceived",
      options: {},
    },
    id: stableUuid(`teruisi-hourly-retry:webhook-node:${workflow.id}`),
    name: hourlyRetryTriggerName,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [entryPosition[0] - 240, entryPosition[1] + 320],
    webhookId: stableUuid(`teruisi-hourly-retry:webhook-id:${workflow.id}`),
  });
  workflow.connections ??= {};
  workflow.connections[hourlyRetryTriggerName] = { main: [[edge(entryNodeName)]] };
  workflow.settings = {
    ...(workflow.settings ?? {}),
    errorWorkflow: hourlyRetryErrorWorkflowId,
  };
  workflow.meta = {
    ...(workflow.meta ?? {}),
    hourlyRetryPolicy: {
      version: "2026-09-10.safe-hourly-retry.1",
      delayMinutes: hourlyRetryDelayMinutes,
      errorWorkflowId: hourlyRetryErrorWorkflowId,
      webhookPath,
    },
  };
  return workflow;
}

function retryClassifierCode() {
  const targets = Object.fromEntries(hourlyRetryTargets.map((target) => [
    target.workflowId,
    `http://127.0.0.1:5678/webhook/${hourlyRetryWebhookPath(target.workflowId)}`,
  ]));
  return [
    `const targets = ${JSON.stringify(targets)};`,
    `const terminalPatterns = ${JSON.stringify(terminalFailurePatterns)}.map((source) => new RegExp(source, "iu"));`,
    `const boundDownloadPattern = new RegExp(${JSON.stringify(boundDownloadFailurePattern)});`,
    "const collect = (value, output = []) => {",
    "  if (typeof value === 'string') output.push(value);",
    "  else if (Array.isArray(value)) for (const item of value) collect(item, output);",
    "  else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item, output);",
    "  return output.join(' ').slice(0, 32768);",
    "};",
    "const result = [];",
    "for (const item of $input.all()) {",
    "  const payload = item.json ?? {};",
    "  const workflowId = String(payload.workflow?.id ?? '');",
    "  const mode = String(payload.execution?.mode ?? payload.trigger?.mode ?? '');",
    "  if (!targets[workflowId] || !['trigger', 'webhook'].includes(mode)) continue;",
    "  const failureText = collect({ error: payload.execution?.error ?? payload.trigger?.error, lastNodeExecuted: payload.execution?.lastNodeExecuted });",
    "  if (workflowId === 'J8kY2mQ5vR7sT4pN' && payload.execution?.lastNodeExecuted === 'B·接口校验与五表下载' && payload.execution?.error?.description === 'JACKYUN_PREFLIGHT_RETRY_READY' && !terminalPatterns.some((pattern) => pattern.test(failureText.replaceAll('JACKYUN_PREFLIGHT_RETRY_READY', '')))) {",
    "    result.push({ json: { retryPolicy: { workflowId, retryUrl: targets[workflowId], delayMinutes: 60 }, failedExecutionId: String(payload.execution?.id ?? '') } });",
    "    continue;",
    "  }",
    "  const downloadDescription = String(payload.execution?.error?.description ?? '');",
    "  const jackyunDownloadNode = workflowId === 'J8kY2mQ5vR7sT4pN' && payload.execution?.lastNodeExecuted === 'B·接口校验与五表下载';",
    "  if (jackyunDownloadNode && boundDownloadPattern.test(downloadDescription) && !terminalPatterns.some(pattern => pattern.test(failureText.replaceAll(downloadDescription, '')))) {",
    "    result.push({ json: { retryPolicy: { workflowId, retryUrl: targets[workflowId], delayMinutes: 60, reason: 'bound_download_resume_required' }, failedExecutionId: String(payload.execution?.id ?? '') } });",
    "    continue;",
    "  }",
    "  if (jackyunDownloadNode && /fetch failed/iu.test(failureText)) continue;",
    "  if (terminalPatterns.some((pattern) => pattern.test(failureText))) continue;",
    "  result.push({ json: { retryPolicy: { workflowId, retryUrl: targets[workflowId], delayMinutes: 60 }, failedExecutionId: String(payload.execution?.id ?? '') } });",
    "}",
    "return result;",
  ].join("\n");
}

export function buildHourlyRetryErrorWorkflow() {
  const errorName = "数据下载导入工作流失败";
  const classifyName = "仅保留可安全自动重试的失败";
  const waitName = "等待一小时";
  const dispatchName = "启动新的完整工作流 execution";
  const unknownName = "重试派发结果未知转人工";
  const contextName = "读取原执行计划时间";
  const contextReadyName = "原计划核验完成？";
  const noteName = "每小时安全重试说明";
  return {
    id: hourlyRetryErrorWorkflowId,
    name: "数据下载导入工作流每小时安全重试",
    nodes: [
      {
        parameters: {},
        id: stableUuid("teruisi-hourly-retry:error-trigger"),
        name: errorName,
        type: "n8n-nodes-base.errorTrigger",
        typeVersion: 1,
        position: [-540, 0],
      },
      {
        parameters: { mode: "runOnceForAllItems", jsCode: retryClassifierCode() },
        id: stableUuid("teruisi-hourly-retry:classifier"),
        name: classifyName,
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [-300, 0],
      },
      {
        parameters: { resume: "timeInterval", amount: 1, unit: "hours" },
        id: stableUuid("teruisi-hourly-retry:wait"),
        name: waitName,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [-60, 0],
      },
      {
        parameters: { mode: "runOnceForAllItems", jsCode: `
const pending = $('${classifyName}').first().json;
if ($runIndex >= 72) throw new Error('retry_context_wait_expired_manual_action');
let response;
try {
  response = await this.helpers.httpRequest({method:'POST',url:'http://127.0.0.1:5791/coordination/retry-context',json:true,timeout:10000,returnFullResponse:true,ignoreHttpStatusErrors:true,
    headers:{'X-TERUISI-SOURCE-WORKFLOW-ID':pending.retryPolicy.workflowId,'X-TERUISI-FAILED-EXECUTION-ID':pending.failedExecutionId}});
} catch(error) {
  const status = Number(error.statusCode ?? error.response?.statusCode ?? error.httpCode ?? 0);
  if(status >= 400 && status < 500) throw new Error('retry_context_unverified_manual_action');
  return [{json:{...pending,contextStatus:'waiting'}}];
}
const status = Number(response.statusCode);
if(status >= 500) return [{json:{...pending,contextStatus:'waiting'}}];
if(status !== 200) throw new Error('retry_context_unverified_manual_action');
const context = response.body;
if(context?.ok !== true || context.version !== 'teruisi-retry-context-v1' || context.workflowId !== pending.retryPolicy.workflowId
  || context.failedExecutionId !== pending.failedExecutionId || !context.originalScheduledAt || !context.originalExecutionId) throw new Error('retry_context_unverified_manual_action');
let reservation;
try {
  reservation = await this.helpers.httpRequest({method:'POST',url:'http://127.0.0.1:5791/coordination/reserve-retry',json:true,timeout:10000,returnFullResponse:true,ignoreHttpStatusErrors:true,
    headers:{'X-TERUISI-SOURCE-WORKFLOW-ID':pending.retryPolicy.workflowId,'X-TERUISI-FAILED-EXECUTION-ID':pending.failedExecutionId,'X-TERUISI-RETRY-EXECUTION-ID':String($execution.id)}});
} catch { throw new Error('retry_reservation_result_unknown_manual_action'); }
if(reservation.statusCode !== 200 || reservation.body?.reservationStatus !== 'reserved'
  || reservation.body.failedExecutionId !== pending.failedExecutionId || reservation.body.retryExecutionId !== String($execution.id)) throw new Error('retry_already_reserved_or_unverified_manual_action');
return [{json:{...pending,...context,contextStatus:'verified'}}];` },
        id: stableUuid("teruisi-hourly-retry:original-context"), name: contextName,
        type: "n8n-nodes-base.code", typeVersion: 2, position: [160, 0],
      },
      {
        parameters: { conditions: { options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          conditions: [{ id: stableUuid("teruisi-hourly-retry:context-check"), leftValue: "={{ $json.contextStatus }}", rightValue: "verified", operator: { type: "string", operation: "equals" } }], combinator: "and" }, options: {} },
        id: stableUuid("teruisi-hourly-retry:context-ready"), name: contextReadyName,
        type: "n8n-nodes-base.if", typeVersion: 2.2, position: [380, 0],
      },
      {
        parameters: {
          method: "POST",
          url: "={{ $json.retryPolicy.retryUrl }}",
          sendBody: true, specifyBody: "json",
          jsonBody: "={{ {version:$json.version,workflowId:$json.workflowId,failedExecutionId:$json.failedExecutionId,originalScheduledAt:$json.originalScheduledAt,originalExecutionId:$json.originalExecutionId} }}",
          options: { timeout: 10000 },
        },
        id: stableUuid("teruisi-hourly-retry:dispatch"),
        name: dispatchName,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [180, 0],
        retryOnFail: false,
        onError: "continueErrorOutput",
      },
      {
        parameters: { errorMessage: "dispatch result unknown: 原重试 Webhook 可能已受理，需要人工核查 execution；禁止自动再次 POST" },
        id: stableUuid("teruisi-hourly-retry:dispatch-unknown"),
        name: unknownName,
        type: "n8n-nodes-base.stopAndError",
        typeVersion: 1,
        position: [420, 140],
      },
      {
        parameters: {
          content: "## 失败后每 60 分钟安全重跑\n仅接收已登记的数据下载/导入工作流的定时或自动重试失败。等待 1 小时后，通过 127.0.0.1:5678 的专用 Webhook 创建新的完整 execution，并重新经过共享 helper 领取门禁；新 execution 再失败会重新进入本流程，成功后不会产生下一轮。吉客云仅在 DPAPI 登录前的临时失败已由 helper 核验零业务效果并 create-only 闭合时允许重试。验证码、安全验证、密码或登录被拒、凭据读取/损坏、店铺身份不符、跨店、任务歧义、业务点击或提交结果未决、来源未就绪及需要人工确认的内容完整性错误仍停止自动重试。不得改成失败节点重试，不得绕过 A 或直接调用业务 helper。发布时先发布本错误工作流，再更新当前正式目标工作流；未采用的兼容模板继续保持未激活。",
          height: 280,
          width: 760,
          color: 3,
        },
        id: stableUuid("teruisi-hourly-retry:note"),
        name: noteName,
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [-540, -360],
      },
    ],
    connections: {
      [errorName]: { main: [[edge(classifyName)]] },
      [classifyName]: { main: [[edge(waitName)]] },
      [waitName]: { main: [[edge(contextName)]] },
      [contextName]: { main: [[edge(contextReadyName)]] },
      [contextReadyName]: { main: [[edge(dispatchName)], [edge(waitName)]] },
      [dispatchName]: { main: [[], [edge(unknownName)]] },
    },
    pinData: {},
    active: false,
    settings: {
      executionOrder: "v1",
      timezone: "Asia/Shanghai",
      callerPolicy: "workflowsFromSameOwner",
    },
    meta: {
      templateCredsSetupCompleted: true,
      hourlyRetryPolicy: {
        version: "2026-09-10.safe-hourly-retry.1",
        delayMinutes: hourlyRetryDelayMinutes,
        targetWorkflowIds: hourlyRetryTargets.map((target) => target.workflowId),
      },
    },
    tags: [],
  };
}
