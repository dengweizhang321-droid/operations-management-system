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
  terminalAlertReason,
} from "../tools/n8n-hourly-retry-policy.mjs";

const workflowDirectory = new URL("../automation/n8n/", import.meta.url);

const c1TerminalFailures = [
  "京东物流流程未完成；原计划与未决任务已保留，禁止自动重发导出或导入。请核验原 execution、manifest 与源任务。",
  "文件校验未通过，未写入任何库存数据",
  "文件校验未通过，未创建规范化导入会话",
  "导入未全部完成或覆盖回查未命中，详见结果清单",
  "API_SERVER_CLOCK_UNVERIFIED",
];
const c1TransientFailures = [
  "The connection was aborted, perhaps the server is offline",
  "The service refused the connection - perhaps it is offline",
  "Your Code node task was not matched to a runner within the timeout period",
  "Django 销售服务暂时不可用，请稍后重试。",
  "helper_slot_unavailable",
];
const f2StructuralFailures = [400, 413, 415, 422].map(status => `京准通推广导入失败 (HTTP ${status})`);
const f2TransientFailures = [
  ...[429, 500, 502, 503, 504, 408].map(status => `京准通推广导入失败 (HTTP ${status})`),
  ...c1TransientFailures,
];
const f2ExistingTerminalFailures = [
  "京东物流流程未完成；原计划与未决任务已保留，禁止自动重发导出或导入。",
  "文件校验未通过，未创建规范化导入会话",
  "导入未全部完成或覆盖回查未命中，详见结果清单",
  "API_SERVER_CLOCK_UNVERIFIED",
  "创建阿里妈妈商品报表失败（HTTP 403，响应为空或状态异常）",
  "PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION",
];

async function c1Classifiers() {
  const artifact = JSON.parse(await readFile(new URL("data-import-hourly-safe-retry.workflow.json", workflowDirectory), "utf8"));
  return [buildHourlyRetryErrorWorkflow(), artifact].map(workflow => {
    const code = workflow.nodes.find((node: { name: string }) => node.name === "仅保留可安全自动重试的失败").parameters.jsCode;
    return new Function("$input", code);
  });
}

for (const [suite, workflowId, retry, messages] of [
  ["C1", "JdLogisticsDaily2026", false, c1TerminalFailures],
  ["C1", "JdLogisticsDaily2026", true, c1TransientFailures],
  ["F2 structural", "JdPromotionDaily2026", false, f2StructuralFailures],
  ["F2 transient", "JdPromotionDaily2026", true, f2TransientFailures],
  ["F2 regression", "JdPromotionDaily2026", false, f2ExistingTerminalFailures],
  ["F2 format", "JdPromotionCutMeat2026", false, ["导入失败（http 413）", "导入失败 (HtTp\t415)", "导入失败 HTTP  422", "HTTP 400"]],
  ["F2 boundary", "JdPromotionCutMeat2026", true, ["HTTP 4130", "HTTP 4000", "HTTP 415x", "XHTTP 422"]],
] as const) {
  for (const message of messages) {
    test(`${suite} ${retry ? "transient" : "terminal"}: ${message}`, async () => {
      const classifiers = await c1Classifiers();
      for (const mode of ["trigger", "webhook"]) {
        for (const field of ["message", "description"]) {
          const payload = { workflow: { id: workflowId },
            execution: { id: "123", mode, error: { [field]: message } } };
          const result = classifyHourlyRetryFailure(payload);
          assert.equal(result.retry, retry);
          assert.equal(result.reason, retry ? "retryable_failure" : "manual_intervention_required");
          for (const execute of classifiers) {
            const emitted = execute({ all: () => [{ json: payload }] });
            assert.equal(emitted.length, 1);
            if (retry) {
              assert.equal(emitted[0].json.retryPolicy.workflowId, payload.workflow.id);
              assert.equal(emitted[0].json.retryPolicy.retryUrl, result.retryUrl);
              assert.equal(emitted[0].json.noRetryTarget, undefined);
              assert.equal(emitted[0].json.droppedFailures, undefined);
            } else {
              assert.equal(emitted[0].json.retryPolicy, undefined);
              assert.equal(emitted[0].json.noRetryTarget, true);
              assert.equal(emitted[0].json.droppedFailures.length, 1);
              assert.equal(emitted[0].json.droppedFailures[0].reason, "终局失败，不会自动重试");
              assert.equal(emitted[0].json.droppedFailures[0].failedExecutionId, "123");
            }
          }
        }
      }
    });
  }
}

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
  // "fetch failed" on the Jackyun download node is an unverified, not a terminal, failure:
  // the emitted code just continues without recording a droppedFailures entry.
  assert.equal(classifyHourlyRetryFailure(payload("fetch failed")).retry, false);
  assert.deepEqual(execute({ all: () => [{ json: payload("fetch failed") }] }), []);
  // Everything else below matches a terminal failure pattern, which the emitted code now
  // reports through droppedFailures/noRetryTarget for the 转人工发钉钉提醒 alert branch
  // instead of silently dropping the item (see f2bbbc0b).
  for (const p of [payload("JACKYUN_OSS_DOWNLOAD_RETRYABLE code=ECONNRESET attempts=3"),
    payload("JACKYUN_API_RESUME_MANUAL_ACTION"), payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=SECRET attempts=3"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=4"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "challenge_present"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "HTTP 413"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "export_submitting"),
    payload("JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=ECONNRESET attempts=3", "HTTP 500", "D·导入")]) {
    assert.equal(classifyHourlyRetryFailure(p).retry, false);
    const [emitted] = execute({ all: () => [{ json: p }] });
    assert.equal(emitted?.json?.noRetryTarget, true);
    assert.equal(emitted?.json?.droppedFailures?.[0]?.reason, "终局失败，不会自动重试");
    assert.equal(emitted?.json?.droppedFailures?.[0]?.failedExecutionId, p.execution.id);
  }
});

test("all registered data workflows route hourly retries through a new full execution", async () => {
  for (const retiredId of ["JdN8nM3uL7tI2026", "JdMarketDaily2026", "cF7wN8k2pQ5sR1vX", "20ZtTLAAbsx5KvTp"]) {
    assert.equal(hourlyRetryTargets.some(target => target.workflowId === retiredId), false);
    assert.equal(classifyHourlyRetryFailure({ workflow: { id: retiredId }, execution: { mode: "trigger", error: { message: "ECONNRESET" } } }).reason, "workflow_not_allowed");
  }
  for (const adoptedId of ["JdN8nSilentCopy2026", "JdMarketSilentCopy2026"]) {
    assert.ok(hourlyRetryTargets.some(target => target.workflowId === adoptedId));
  }
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
    const boundJackyun = target.workflowId === "J8kY2mQ5vR7sT4pN" && (workflow.meta as Record<string, unknown>)?.jackyunRecovery === "jackyun-recovery-control-v1";
    assert.equal(workflow.connections[hourlyRetryTriggerName]?.main?.[0]?.[0]?.node, boundJackyun ? "固定原执行计划时间" : "领取共享 helper", target.fileName);
    if (boundJackyun) assert.equal(workflow.connections["固定原执行计划时间"]?.main?.[0]?.[0]?.node, "领取共享 helper", target.fileName);
    assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger"), false, target.fileName);
  }
  assert.equal(paths.size, hourlyRetryTargets.length);
});

test("the shared error workflow waits exactly one hour and dispatches only to loopback", async () => {
  const workflow = JSON.parse(await readFile(new URL("data-import-hourly-safe-retry.workflow.json", workflowDirectory), "utf8")) as ReturnType<typeof buildHourlyRetryErrorWorkflow>;
  assert.equal(workflow.id, hourlyRetryErrorWorkflowId);
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, undefined);
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
  // Both alert paths validate and encode the payload before invoking the shared sender.
  assert.equal(workflow.connections["启动新的完整工作流 execution"]?.main?.[1]?.[0]?.node, "告警-派发未知");
  assert.equal(workflow.connections["告警-派发未知"]?.main?.[0]?.[0]?.node, "准备人工提醒参数");
  assert.equal(workflow.connections["准备人工提醒参数"]?.main?.[0]?.[0]?.node, "转人工发钉钉提醒");
  assert.equal(workflow.connections["转人工发钉钉提醒"]?.main?.[0]?.[0]?.node, "重试派发结果未知转人工");
  const retryBranchName = "本次可安全自动重试？";
  const retryBranch = workflow.nodes.find(node => node.name === retryBranchName);
  assert.equal(workflow.nodes.length, 16);
  assert.equal(retryBranch?.type, "n8n-nodes-base.if");
  assert.equal(retryBranch?.parameters.conditions.conditions[0].leftValue, "={{ !!$json.retryPolicy && $json.noRetryTarget !== true }}");
  assert.deepEqual(workflow.connections["仅保留可安全自动重试的失败"]?.main, [[{ node: retryBranchName, type: "main", index: 0 }]]);
  assert.deepEqual(workflow.connections[retryBranchName]?.main, [
    [{ node: "等待一小时", type: "main", index: 0 }],
    [{ node: "收集被丢弃的终局失败", type: "main", index: 0 }],
  ]);
  assert.equal(workflow.connections["收集被丢弃的终局失败"]?.main?.[0]?.[0]?.node, "准备人工提醒参数");
  assert.equal(workflow.nodes.find(node => node.name === "重试派发结果未知转人工")?.type, "n8n-nodes-base.stopAndError");
  assert.equal(workflow.nodes.find(node => node.name === "转人工发钉钉提醒")?.type, "n8n-nodes-base.executeCommand");
  assert.equal(workflow.nodes.find(node => node.name === "告警-派发未知")?.type, "n8n-nodes-base.code");
  assert.equal(workflow.nodes.find(node => node.name === "收集被丢弃的终局失败")?.type, "n8n-nodes-base.code");
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

test("only an exact verified Jackyun preflight closure reaches the hourly retry", async () => {
  const classifiers = await c1Classifiers();
  const workflowId = hourlyRetryTargets[0]!.workflowId;
  const payload = { workflow: { id: workflowId }, execution: { id: "8800", mode: "trigger", lastNodeExecuted: "B·接口校验与五表下载",
    error: { message: "The service was not able to process your request", description: "JACKYUN_PREFLIGHT_RETRY_READY" } } };
  assert.equal(classifyHourlyRetryFailure(payload).reason, "verified_preflight_retry");
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, lastNodeExecuted: "A·固定采集日和销售日期" } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, workflow: { id: hourlyRetryTargets[1]!.workflowId } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, message: "credential rejected" } } }).retry, false);
  assert.equal(classifyHourlyRetryFailure({ ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, description: "JACKYUN_PREFLIGHT_RETRY_READY but uncertain" } } }).retry, false);
  for (const mode of ["trigger", "webhook"]) {
    const cases = [
      { json: payload, retry: true },
      { json: { ...payload, execution: { ...payload.execution, lastNodeExecuted: "A·固定采集日和销售日期" } }, retry: false },
      { json: { ...payload, workflow: { id: hourlyRetryTargets[1]!.workflowId } }, retry: false },
      { json: { ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, message: "credential rejected" } } }, retry: false },
      { json: { ...payload, execution: { ...payload.execution, error: { ...payload.execution.error, description: "JACKYUN_PREFLIGHT_RETRY_READY but uncertain" } } }, retry: false },
      ...[...c1TerminalFailures, ...f2StructuralFailures].map(message => ({ json: { ...payload, execution: { ...payload.execution,
        error: { ...payload.execution.error, message } } }, retry: false })),
    ];
    for (const entry of cases) {
      const json = { ...entry.json, execution: { ...entry.json.execution, mode } };
      const result = classifyHourlyRetryFailure(json);
      assert.equal(result.retry, entry.retry);
      assert.equal(result.reason, entry.retry ? "verified_preflight_retry" : "manual_intervention_required");
      for (const execute of classifiers) {
        const emitted = execute({ all: () => [{ json }] });
        assert.equal(emitted.length, 1);
        assert.equal(Boolean(emitted[0].json.retryPolicy), entry.retry);
        assert.equal(emitted[0].json.noRetryTarget, entry.retry ? undefined : true);
      }
    }
  }
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
    // Terminal pattern match: the emitted code now reports this through droppedFailures
    // for the 转人工发钉钉提醒 alert branch instead of silently dropping the item.
    const [emitted] = execute({ all: () => [{ json }] });
    assert.equal(emitted?.json?.noRetryTarget, true);
    assert.equal(emitted?.json?.droppedFailures?.[0]?.reason, "终局失败，不会自动重试");
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
      // Terminal pattern match on a whitelisted workflow: the emitted code now reports
      // this through droppedFailures for the 转人工发钉钉提醒 alert branch.
      const assertDropped = (result: unknown) => {
        const [emitted] = result as Array<{ json?: { noRetryTarget?: boolean; droppedFailures?: Array<{ reason?: string }> } }>;
        assert.equal(emitted?.json?.noRetryTarget, true, description);
        assert.equal(emitted?.json?.droppedFailures?.[0]?.reason, "终局失败，不会自动重试", description);
      };
      assertDropped(execute({ all: () => [{ json: payload }] }));
      // An exact closure marker must not override a simultaneous unsafe login error.
      payload.execution.error = { message: description, description: "JACKYUN_PREFLIGHT_RETRY_READY", httpCode: "500" };
      assert.equal(classifyHourlyRetryFailure(payload).retry, false, description);
      assertDropped(execute({ all: () => [{ json: payload }] }));
    }
    for (const description of ["JACKYUN_PREFLIGHT_RETRY_READY", "HTTP 503 service unavailable"]) {
      const payload = { workflow: { id: workflowId }, execution: { mode,
        lastNodeExecuted: "B·接口校验与五表下载", error: { description } } };
      assert.equal(classifyHourlyRetryFailure(payload).retry, true);
      assert.equal(execute({ all: () => [{ json: payload }] }).length, 1);
    }
  }
});

// The alert script rejects any code outside its $hints table as
// invalid_payload, and that rejection happens upstream of the sender: one
// unknown code means the operator is told nothing at all. Both lists are hand
// maintained in different languages, so pin them to each other.
test("every alert code the classifier can emit has wording in the alert script", async () => {
  const script = await readFile(new URL("../tools/n8n-manual-action-alert.ps1", import.meta.url), "utf8");
  const hints = script.slice(script.indexOf("$hints=@{"), script.indexOf("\n  }", script.indexOf("$hints=@{")));
  const scripted = new Set([...hints.matchAll(/([a-z_]+)=@\(/g)].map(match => match[1]!));
  assert.ok(scripted.size >= 9, `expected the hint table to be found, saw ${scripted.size}`);

  const emitted = new Set<string>();
  const workflow = buildHourlyRetryErrorWorkflow();
  const prepare = JSON.stringify(workflow.nodes.find(node => /准备人工提醒参数/.test(node.name)));
  for (const code of scripted) {
    // Mirrors the validator's own allowlist: a code it does not list is dropped
    // before the alert is ever built.
    if (prepare?.includes(`'${code}'`)) emitted.add(code);
  }
  for (const text of ["出现验证码或安全验证", "凭据缺失", "操作受限或过于频繁", "店铺身份不符",
    "提交结果未决", "来源数据未就绪", "尚未登录", "登录状态加载超时", "内容完整性错误"]) {
    emitted.add(terminalAlertReason(text));
  }
  const missing = [...emitted].filter(code => !scripted.has(code));
  assert.deepEqual(missing, [], `codes without operator wording: ${missing.join(",")}`);
});

// The point of this split is that a human reads a different sentence per cause.
// Collapsing two of these back together would silently restore the old
// "go and handle the login" advice for failures no login can fix.
test("login-gate causes map to distinct operator instructions", () => {
  const distinct = new Map([
    ["waiting_login：某店 出现验证码或安全验证，需要人工处理", "manual_action_challenge"],
    ["waiting_login：某店 本机加密凭据未被平台接受，请重新配置并人工核验", "manual_action_credential"],
    ["waiting_login：某店 登录操作受限或过于频繁，需要稍后人工检查", "manual_action_locked"],
    ["waiting_login：某店 独立 Chromium 尚未登录，请先人工登录", "manual_action_session_absent"],
    ["waiting_login：某店 登录状态在有界等待后仍无法确认，需要人工检查", "manual_action_login_pending"],
  ]);
  for (const [text, code] of distinct) assert.equal(terminalAlertReason(text), code, text);
  assert.equal(new Set(distinct.values()).size, distinct.size);

  // The helper's fixed reason token wins over the collapsed code, including
  // through the escaped JSON body that n8n actually stores (exec 11229).
  assert.equal(terminalAlertReason(
    'LOGIN_GATE_MANUAL_ACTION 500 - "{\\"error\\":\\"LOGIN_GATE_MANUAL_ACTION\\",\\"failureReason\\":\\"challenge_present\\"}"'),
    "manual_action_challenge");
  // Without a reason token there is nothing to tell the nine causes apart, so
  // the generic wording is correct rather than a guess.
  assert.equal(terminalAlertReason("B·双视图导出按日导入 LOGIN_GATE_MANUAL_ACTION"), "terminal_manual_action");

  // `failureText` is a join(" ") of error fields and the node name: a pattern
  // that spans whitespace would let this real node name borrow an unrelated
  // tail and mislabel the cause.
  assert.equal(terminalAlertReason("B·共用登录态：顺序导出五表 下载失败（网络）"), "terminal_manual_action");
});

test("wording selection never changes whether a failure is retried", () => {
  // Each of these is terminal for an independent reason; classifying the
  // wording must not move any of them back into the retry path. These are the
  // real repository messages, not fragments: a bare fragment such as
  // "过于频繁" is retryable by design, because no throw site emits it alone.
  for (const text of ["waiting_login：某店 出现验证码或安全验证，需要人工处理",
    "waiting_login：某店 本机加密凭据未被平台接受，请重新配置并人工核验",
    "waiting_login：某店 登录操作受限或过于频繁，需要稍后人工检查",
    "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION 店铺身份不符",
    "提交结果未决", "来源数据未就绪",
    "waiting_login：某店 独立 Chromium 尚未登录，请先人工登录",
    "登录状态加载超时"]) {
    const verdict = classifyHourlyRetryFailure({
      workflow: { id: hourlyRetryTargets[0]!.workflowId },
      execution: { id: "1", mode: "trigger", error: { description: text } },
    });
    assert.equal(verdict.retry, false, text);
    assert.notEqual(terminalAlertReason(text), "terminal_manual_action");
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
