import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isBoundDownloadResumeFailure } from "../lib/jackyun/download-failure";

import {
  attachHourlyRetryTarget,
  buildHourlyRetryErrorWorkflow,
  classifyHourlyRetryFailure,
  hourlyRetryDelayMinutes,
  hourlyRetryErrorWorkflowId,
  hourlyRetryTargets,
  hourlyRetryTriggerName,
  hourlyRetryWebhookPath,
} from "../tools/n8n-hourly-retry-policy.mjs";

const workflowDirectory = new URL("../automation/n8n/", import.meta.url);

test("bound inventory download recovery agrees with emitted n8n code and never overrides terminal failures", () => {
  const code = buildHourlyRetryErrorWorkflow().nodes.find(node => node.type === "n8n-nodes-base.code")!.parameters.jsCode;
  assert.equal(typeof code, "string");
  const execute = new Function("$input", code!);
  const payload = (description: string, message = "HTTP 500", node = "B·接口校验与五表下载") => ({
    workflow: { id: "J8kY2mQ5vR7sT4pN" }, execution: { id: "7380", mode: "trigger", lastNodeExecuted: node, error: { description, message } },
  });
  for (const cause of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "HTTP_408", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504"]) {
    const description = `JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=${cause} attempts=3`;
    assert.equal(isBoundDownloadResumeFailure(description), true);
    const p = payload(description);
    assert.equal(classifyHourlyRetryFailure(p).reason, "bound_download_resume_required");
    assert.equal(execute({ all: () => [{ json: p }] }).length, 1);
  }
  for (const p of [payload("fetch failed"), payload("JACKYUN_OSS_DOWNLOAD_RETRYABLE code=ECONNRESET attempts=3"),
    payload("JACKYUN_API_RESUME_MANUAL_ACTION"), payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=SECRET attempts=3"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=4"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "challenge_present"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "export_submitting"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "HTTP 500", "D·导入")]) {
    assert.equal(classifyHourlyRetryFailure(p).retry, false);
    assert.deepEqual(execute({ all: () => [{ json: p }] }), []);
  }
});

test("all registered data workflows route hourly retries through a new full execution", async () => {
  const paths = new Set<string>();
  for (const target of hourlyRetryTargets) {
    const workflow = JSON.parse(await readFile(new URL(target.fileName, workflowDirectory), "utf8")) as {
      id: string;
      active: boolean;
      settings?: { errorWorkflow?: string };
      meta?: { hourlyRetryPolicy?: { delayMinutes?: number; webhookPath?: string } };
      nodes: Array<{ name: string; type: string; parameters?: { path?: string; responseMode?: string } }>;
      connections: Record<string, { main?: Array<Array<{ node?: string }>> }>;
    };
    assert.equal(workflow.id, target.workflowId, target.fileName);
    assert.equal(workflow.active, false, target.fileName);
    assert.equal(workflow.settings?.errorWorkflow, hourlyRetryErrorWorkflowId, target.fileName);
    assert.equal(workflow.meta?.hourlyRetryPolicy?.delayMinutes, hourlyRetryDelayMinutes, target.fileName);
    const triggers = workflow.nodes.filter((node) => node.name === hourlyRetryTriggerName);
    assert.equal(triggers.length, 1, target.fileName);
    assert.equal(triggers[0]?.type, "n8n-nodes-base.webhook", target.fileName);
    assert.equal(triggers[0]?.parameters?.responseMode, "onReceived", target.fileName);
    const webhookPath = triggers[0]?.parameters?.path;
    assert.equal(webhookPath, hourlyRetryWebhookPath(target.workflowId), target.fileName);
    assert.equal(paths.has(webhookPath!), false, target.fileName);
    paths.add(webhookPath!);
    assert.equal(workflow.connections[hourlyRetryTriggerName]?.main?.[0]?.[0]?.node, "领取共享 helper", target.fileName);
    assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger"), false, target.fileName);
  }
  assert.equal(paths.size, hourlyRetryTargets.length);
});

test("the shared error workflow waits exactly one hour and dispatches only to loopback", async () => {
  const workflow = JSON.parse(await readFile(new URL("data-import-hourly-safe-retry.workflow.json", workflowDirectory), "utf8")) as ReturnType<typeof buildHourlyRetryErrorWorkflow>;
  assert.equal(workflow.id, hourlyRetryErrorWorkflowId);
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.equal(workflow.settings.errorWorkflow, undefined);
  assert.deepEqual(workflow.meta.hourlyRetryPolicy.targetWorkflowIds, hourlyRetryTargets.map((target) => target.workflowId));
  assert.equal(workflow.nodes.filter((node) => node.type === "n8n-nodes-base.errorTrigger").length, 1);
  const wait = workflow.nodes.find((node) => node.name === "等待一小时");
  assert.deepEqual(wait?.parameters, { resume: "timeInterval", amount: 1, unit: "hours" });
  const dispatch = workflow.nodes.find((node) => node.name === "启动新的完整工作流 execution");
  assert.equal(dispatch?.type, "n8n-nodes-base.httpRequest");
  assert.equal(dispatch?.parameters.url, "={{ $json.retryPolicy.retryUrl }}");
  assert.equal(dispatch?.retryOnFail, false);
  assert.equal(dispatch?.maxTries, undefined);
  assert.equal(dispatch?.onError, "continueErrorOutput");
  assert.equal(workflow.connections["启动新的完整工作流 execution"]?.main?.[1]?.[0]?.node, "重试派发结果未知转人工");
  assert.equal(workflow.nodes.find(node => node.name === "重试派发结果未知转人工")?.type, "n8n-nodes-base.stopAndError");
  const generated = buildHourlyRetryErrorWorkflow();
  assert.deepEqual(generated, workflow);
  const source = await readFile(new URL("data-import-hourly-safe-retry.workflow.json", workflowDirectory), "utf8");
  assert.match(source, /http:\/\/127\.0\.0\.1:5678\/webhook\//);
  assert.doesNotMatch(source, /(?:password|cookie|token|session|credential)\s*[:=]/i);
});

test("retry classification permits transient failures and stops unsafe or human-owned states", () => {
  const workflowId = hourlyRetryTargets[0]!.workflowId;
  const payload = (message: string, mode = "trigger", id = workflowId) => ({
    workflow: { id },
    execution: { id: "123", mode, lastNodeExecuted: "B", error: { message } },
  });
  for (const message of [
    "ETIMEDOUT while reading the local import verification API",
    "HTTP 503 service unavailable",
    "browser page load timed out before any business action",
    "migration-guide-modal intercepts pointer events before selecting the report",
  ]) {
    const result = classifyHourlyRetryFailure(payload(message));
    assert.equal(result.retry, true, message);
    assert.match(result.retryUrl!, /^http:\/\/127\.0\.0\.1:5678\/webhook\/teruisi-hourly-retry-/);
  }
  for (const message of [
    "coordination_wait_expired",
    "需要验证码或安全验证",
    "店铺身份 identity mismatch",
    "DPAPI 凭据损坏",
    "authentication failed at passport.jd.com",
    "发现多个候选下载任务，任务歧义",
    "page_export_submitting 点击结果未决",
    "source_not_ready: 日期 disabled",
    "browser owner conflict",
    "唯一商品数少于出售中总数，内容完整性错误需要人工确认",
    "逐页货品文件合计 118 个唯一商品，与出售中总数 119 不一致",
    "市场榜单导入响应与签收文件、身份、日期或行数不一致",
    "工作簿内容校验失败，日期覆盖缺失",
  ]) {
    assert.deepEqual(classifyHourlyRetryFailure(payload(message)), {
      retry: false,
      reason: "manual_intervention_required",
    }, message);
  }
  assert.deepEqual(classifyHourlyRetryFailure(payload("timeout", "manual")), {
    retry: false,
    reason: "execution_mode_not_automatic",
  });
  assert.deepEqual(classifyHourlyRetryFailure(payload("timeout", "trigger", "unknown")), {
    retry: false,
    reason: "workflow_not_allowed",
  });
});

test("only an exact verified Jackyun preflight closure reaches the hourly retry", () => {
  const workflowId = hourlyRetryTargets[0]!.workflowId;
  const payload = { workflow: { id: workflowId }, execution: { id: "8800", mode: "trigger", lastNodeExecuted: "B·接口校验与五表下载",
    error: { message: "The service was not able to process your request", description: "JACKYUN_PREFLIGHT_RETRY_READY" } } };
  assert.equal(classifyHourlyRetryFailure(payload).reason, "verified_preflight_retry");
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, lastNodeExecuted: "A·固定采集日和销售日期" } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, workflow: { id: hourlyRetryTargets[1]!.workflowId } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, message: "credential rejected" } } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, description: "JACKYUN_PREFLIGHT_RETRY_READY but uncertain" } } }).retry, false);
});

test("live market receipt and pagewise completeness errors stop in the emitted n8n classifier", () => {
  const code = buildHourlyRetryErrorWorkflow().nodes.find(node => node.type === "n8n-nodes-base.code")!.parameters.jsCode;
  const execute = new Function("$input", code);
  for (const [workflowId, description] of [
    ["TmallMasituDaily2026", "逐页货品文件合计 118 个唯一商品，与出售中总数 119 不一致"],
    ["JdMarketSilentCopy2026", "市场榜单导入响应与签收文件、身份、日期或行数不一致"],
  ]) {
    const json = { workflow: { id: workflowId }, execution: { id: "6992", mode: "webhook",
      error: { message: "The service was not able to process your request", description } } };
    assert.equal(classifyHourlyRetryFailure(json).retry, false);
    assert.deepEqual(execute({ all: () => [{ json }] }), []);
    const transient = { ...json, execution: { ...json.execution, error: { description: "HTTP 503 service unavailable" } } };
    assert.equal(execute({ all: () => [{ json: transient }] }).length, 1);
  }
});

test("live 4605 login challenge and other waiting-login failures never dispatch a retry", () => {
  const workflowId = hourlyRetryTargets[0]!.workflowId;
  const code = buildHourlyRetryErrorWorkflow().nodes.find(node => node.type === "n8n-nodes-base.code")!.parameters.jsCode;
  const execute = new Function("$input", code);
  for (const mode of ["trigger", "webhook"]) {
    for (const description of [
      "waiting_login：吉客云登录已停止（challenge_present）。",
      "challenge_present",
      "waiting_login：吉客云登录已停止（form_ambiguous）。",
      "waiting_login：吉客云登录已停止（origin_mismatch）。",
      "waiting_login：吉客云登录已停止（tenant_mismatch）。",
    ]) {
      const payload = { workflow: { id: workflowId }, execution: { id: "4605", mode,
        lastNodeExecuted: "B·接口校验与五表下载",
        error: { message: "The service was not able to process your request", description, httpCode: "500" } } };
      assert.equal(classifyHourlyRetryFailure(payload).retry, false, description);
      assert.deepEqual(execute({ all: () => [{ json: payload }] }), [], description);
      // An exact closure marker must not override a simultaneous unsafe login error.
      payload.execution.error = { message: description, description: "JACKYUN_PREFLIGHT_RETRY_READY", httpCode: "500" };
      assert.equal(classifyHourlyRetryFailure(payload).retry, false, description);
      assert.deepEqual(execute({ all: () => [{ json: payload }] }), [], description);
    }
    for (const description of ["JACKYUN_PREFLIGHT_RETRY_READY", "HTTP 503 service unavailable"]) {
      const payload = { workflow: { id: workflowId }, execution: { mode,
        lastNodeExecuted: "B·接口校验与五表下载", error: { description } } };
      assert.equal(classifyHourlyRetryFailure(payload).retry, true);
      assert.equal(execute({ all: () => [{ json: payload }] }).length, 1);
    }
  }
});

test("target attachment is deterministic and idempotent", () => {
  const workflow = {
    id: hourlyRetryTargets[0]!.workflowId,
    nodes: [{ name: "领取共享 helper", type: "n8n-nodes-base.httpRequest", position: [0, 0] }],
    connections: {},
    settings: {},
    meta: {},
  };
  attachHourlyRetryTarget(workflow);
  attachHourlyRetryTarget(workflow);
  assert.equal(workflow.nodes.filter((node) => node.name === hourlyRetryTriggerName).length, 1);
  assert.equal(workflow.settings.errorWorkflow, hourlyRetryErrorWorkflowId);
  assert.equal(workflow.connections[hourlyRetryTriggerName]?.main[0]?.[0]?.node, "领取共享 helper");
});

test("the local n8n launcher binds retry webhooks to loopback", async () => {
  const source = await readFile(new URL("../tools/start-n8n-service.ps1", import.meta.url), "utf8");
  const bind = source.indexOf('$env:N8N_LISTEN_ADDRESS = "127.0.0.1"');
  const nodePolicy = source.indexOf('$env:NODES_EXCLUDE = \'["n8n-nodes-base.localFileTrigger"]\'');
  const start = source.indexOf("Invoke-N8nNativeProcess -NodePath $nodeCommand -EntryPath $n8nEntry");
  assert.ok(bind >= 0 && nodePolicy > bind && start > nodePolicy);
  assert.match(source, /non-loopback address/);
  assert.match(source, /LocalAddress -notin @\("127\.0\.0\.1", "::1"\)/);
});
