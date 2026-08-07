import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  finishOperationRun,
  finishOperationStep,
  getOperationMetrics,
  getOperationRunDetails,
  heartbeatOperation,
  listOperationRuns,
  operationRunStatuses,
  recordOperationEvent,
  startOperationRun,
  startOperationStep,
  type OperationEventLevel,
  type OperationRunStatus,
} from "@/lib/operations/runtime";
import { getSalesDatabase } from "@/lib/sales/database";

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const db = getSalesDatabase();
    const params = new URL(request.url).searchParams;
    const view = params.get("view") ?? "runs";
    if (view === "details") {
      const runId = params.get("runId") ?? "";
      if (!runId) return response({ error: "runId 不能为空" }, 400);
      return response(await getOperationRunDetails(db, runId));
    }
    if (view === "metrics") {
      return response(await getOperationMetrics(db, {
        runType: optionalText(params.get("runType"), 160),
        since: optionalText(params.get("since"), 80),
      }));
    }
    if (view !== "runs") return response({ error: "不支持的 view" }, 400);
    const status = optionalText(params.get("status"), 20);
    if (status && !operationRunStatuses.includes(status as OperationRunStatus)) {
      return response({ error: "运行状态无效" }, 400);
    }
    return response(await listOperationRuns(db, {
      runType: optionalText(params.get("runType"), 160),
      status: status as OperationRunStatus | undefined,
      platform: optionalText(params.get("platform"), 80),
      shopName: optionalText(params.get("shopName"), 160),
      dataset: optionalText(params.get("dataset"), 120),
      limit: integer(params.get("limit"), 50, 1, 100),
    }));
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return response({ error: publicError(error, "读取运行账本失败") }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload) return response({ error: "请求正文必须是 JSON 对象" }, 400);
    const db = getSalesDatabase();
    const action = text(payload.action, 40);
    if (action === "start") {
      const runType = text(payload.runType, 160);
      if (!runType) return response({ error: "runType 不能为空" }, 400);
      const externalRunId = text(payload.externalRunId, 160);
      const run = await startOperationRun(db, {
        traceId: text(payload.traceId, 160) || undefined,
        parentRunId: text(payload.parentRunId, 160) || undefined,
        runType,
        surface: text(payload.surface, 80) || "automation_api",
        actorEmail: principal.email,
        actorRole: principal.role,
        platform: text(payload.platform, 80),
        shopName: text(payload.shopName, 160),
        dataset: text(payload.dataset, 120),
        scope: payload.scope,
        idempotencyKey: text(payload.idempotencyKey, 160) || externalRunId,
      });
      return response({ ok: true, run }, 201);
    }
    const runId = text(payload.runId, 160);
    if (!runId) return response({ error: "runId 不能为空" }, 400);
    if (action === "event") {
      const eventType = text(payload.eventType, 160);
      if (!eventType) return response({ error: "eventType 不能为空" }, 400);
      await recordOperationEvent(db, {
        runId,
        stepId: text(payload.stepId, 160) || undefined,
        traceId: text(payload.traceId, 160) || runId,
        spanId: text(payload.spanId, 160) || undefined,
        parentSpanId: text(payload.parentSpanId, 160) || undefined,
        eventType,
        level: eventLevel(payload.level),
        stage: text(payload.stage, 120),
        attributes: payload.attributes,
      });
      return response({ ok: true });
    }
    if (action === "step_start") {
      const stepKey = text(payload.stepKey, 160);
      const stepType = text(payload.stepType, 160);
      if (!stepKey || !stepType) return response({ error: "stepKey 和 stepType 不能为空" }, 400);
      const step = await startOperationStep(db, {
        runId,
        traceId: text(payload.traceId, 160) || runId,
        parentSpanId: text(payload.parentSpanId, 160) || undefined,
        stepKey,
        stepType,
        attemptNo: integerValue(payload.attemptNo, 1, 1, 100),
        attributes: payload.attributes,
      });
      return response({ ok: true, step }, 201);
    }
    if (action === "step_finish") {
      const stepId = text(payload.stepId, 160);
      const status = text(payload.status, 20);
      if (!stepId || !["succeeded", "failed", "cancelled", "skipped"].includes(status)) {
        return response({ error: "stepId 或步骤终态无效" }, 400);
      }
      const step = await finishOperationStep(db, {
        stepId,
        status: status as "succeeded" | "failed" | "cancelled" | "skipped",
        errorCode: text(payload.errorCode, 120),
        result: payload.result,
      });
      return response({ ok: true, step });
    }
    if (action === "heartbeat") {
      await heartbeatOperation(db, { runId, stepId: text(payload.stepId, 160) || undefined });
      return response({ ok: true });
    }
    if (action === "finish") {
      const status = text(payload.status, 20);
      if (!["succeeded", "failed", "cancelled"].includes(status)) return response({ error: "运行终态无效" }, 400);
      const run = await finishOperationRun(db, {
        runId,
        status: status as "succeeded" | "failed" | "cancelled",
        errorCode: text(payload.errorCode, 120),
        summary: payload.summary,
      });
      return response({ ok: true, run });
    }
    return response({ error: "不支持的 action" }, 400);
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return response({ error: publicError(error, "写入运行账本失败") }, 500);
  }
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalText(value: string | null, maximum: number): string | undefined {
  const normalized = value?.trim().slice(0, maximum) ?? "";
  return normalized || undefined;
}

function integer(value: string | null, fallback: number, minimum: number, maximum: number): number {
  return integerValue(value === null ? undefined : Number(value), fallback, minimum, maximum);
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.isSafeInteger(value) ? Number(value) : fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

function eventLevel(value: unknown): OperationEventLevel {
  return ["debug", "info", "warning", "error"].includes(String(value))
    ? value as OperationEventLevel
    : "info";
}

function publicError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (/\b(SQL|D1_|constraint|UNIQUE|database|column|table)\b/i.test(error.message)) return fallback;
  return error.message.slice(0, 200) || fallback;
}
