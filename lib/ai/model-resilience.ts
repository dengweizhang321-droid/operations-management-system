import type { AiTextModelRuntimeConfig, ModelAttemptObserver, ModelAttemptResult } from "@/lib/ai/model-gateway";
import {
  ensureOperationRuntimeSchema,
  finishOperationStep,
  recordOperationEvent,
  startOperationStep,
  type OperationDatabase,
  type OperationStepRecord,
} from "@/lib/operations/runtime";

export const AI_MODEL_RESILIENCE_LIMITS = {
  failureThreshold: 3,
  circuitCooldownSeconds: 60,
} as const;

type HealthRow = {
  consecutive_failures: number;
  circuit_open_until: string | null;
};

export function createD1ModelAttemptObserver(input: {
  db: OperationDatabase;
  runId: string;
  traceId: string;
}): ModelAttemptObserver {
  let sequence = 0;
  return {
    async beforeAttempt(model, attempt, fallbackIndex) {
      await ensureOperationRuntimeSchema(input.db);
      const health = await input.db.prepare(`SELECT consecutive_failures, circuit_open_until
        FROM ai_model_runtime_health WHERE model_id=? LIMIT 1`).bind(model.id).first<HealthRow>();
      if (health?.circuit_open_until && Date.parse(health.circuit_open_until) > Date.now()) {
        await recordOperationEvent(input.db, {
          runId: input.runId,
          traceId: input.traceId,
          eventType: "model.circuit_open",
          level: "warning",
          stage: "model_call",
          attributes: {
            modelId: model.id,
            attempt,
            fallbackIndex,
            consecutiveFailures: Number(health.consecutive_failures),
            circuitOpenUntil: health.circuit_open_until,
          },
        });
        return { allowed: false, reason: "model_circuit_open" };
      }
      sequence += 1;
      const step = await startOperationStep(input.db, {
        runId: input.runId,
        traceId: input.traceId,
        stepType: "model_call",
        stepKey: `model_call_${sequence}_${safeIdentifier(model.id)}`,
        attemptNo: attempt,
        attributes: {
          modelId: model.id,
          protocol: model.protocol,
          fallbackIndex,
          attempt,
        },
      });
      return { allowed: true, context: step };
    },
    async afterAttempt(model, result, context) {
      const step = context as OperationStepRecord | undefined;
      if (result.outcome === "succeeded") await recordModelSuccess(input.db, model.id);
      else await recordModelFailure(input.db, model.id, result.errorCode ?? "model_request_failed");
      if (step) {
        await finishOperationStep(input.db, {
          stepId: step.id,
          status: result.outcome === "succeeded" ? "succeeded" : result.outcome === "cancelled" ? "cancelled" : "failed",
          errorCode: result.errorCode,
          result: attemptResultSummary(result),
        });
      } else {
        await recordOperationEvent(input.db, {
          runId: input.runId,
          traceId: input.traceId,
          eventType: `model.attempt.${result.outcome}`,
          level: result.outcome === "succeeded" ? "info" : result.outcome === "cancelled" ? "warning" : "error",
          stage: "model_call",
          attributes: { modelId: model.id, ...attemptResultSummary(result) },
        });
      }
    },
  };
}

async function recordModelSuccess(db: OperationDatabase, modelId: string) {
  await db.prepare(`INSERT INTO ai_model_runtime_health (
    model_id, consecutive_failures, circuit_open_until, last_failure_code, last_success_at, updated_at
  ) VALUES (?, 0, NULL, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(model_id) DO UPDATE SET
    consecutive_failures=0, circuit_open_until=NULL, last_failure_code='',
    last_success_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`).bind(modelId).run();
}

async function recordModelFailure(db: OperationDatabase, modelId: string, errorCode: string) {
  const threshold = AI_MODEL_RESILIENCE_LIMITS.failureThreshold;
  const cooldown = AI_MODEL_RESILIENCE_LIMITS.circuitCooldownSeconds;
  await db.prepare(`INSERT INTO ai_model_runtime_health (
    model_id, consecutive_failures, circuit_open_until, last_failure_code, last_failure_at, updated_at
  ) VALUES (?, 1, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(model_id) DO UPDATE SET
    consecutive_failures=ai_model_runtime_health.consecutive_failures+1,
    circuit_open_until=CASE
      WHEN ai_model_runtime_health.consecutive_failures+1>=?
      THEN datetime('now', '+' || ? || ' seconds')
      ELSE ai_model_runtime_health.circuit_open_until
    END,
    last_failure_code=excluded.last_failure_code,
    last_failure_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP`).bind(modelId, errorCode.slice(0, 120), threshold, cooldown).run();
}

function attemptResultSummary(result: ModelAttemptResult) {
  return {
    attempt: result.attempt,
    fallbackIndex: result.fallbackIndex,
    durationMs: result.durationMs,
    retryable: result.retryable,
    retryDelayMs: result.retryDelayMs,
    errorCode: result.errorCode,
  };
}

function safeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "model";
}

export function compatibleFallbackModels(
  primary: AiTextModelRuntimeConfig,
  candidates: readonly AiTextModelRuntimeConfig[] | undefined,
): AiTextModelRuntimeConfig[] {
  const seen = new Set([primary.id]);
  const result: AiTextModelRuntimeConfig[] = [];
  for (const candidate of candidates ?? []) {
    if (candidate.protocol !== primary.protocol || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push(candidate);
    if (result.length >= 2) break;
  }
  return result;
}
