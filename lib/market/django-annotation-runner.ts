import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  MARKET_COMMANDS_PATH,
  MARKET_QUERIES_PATH,
  requestDjangoMarketService,
} from "@/lib/django/market-service";
import { PublicApiError } from "@/lib/http/api-error";
import {
  runVisionAnnotation,
  visionAnnotationTiming,
} from "@/lib/market/annotation-model";

type JsonRecord = Record<string, unknown>;

type ClaimedTask = {
  itemId: string;
  jobId: string;
  skuCode: string;
  productName: string;
  brand: string;
  sourceImageUrl: string;
  promptBody: string;
  segments: string[];
  fixedSegment: string | null;
  modelId: string;
  leaseToken: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimedTask(value: unknown): ClaimedTask | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicApiError(503, "service_unavailable", "Django 市场标注任务返回无效。");
  }
  const task = value as JsonRecord;
  const segments = Array.isArray(task.segments)
    ? task.segments.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const normalized = {
    itemId: text(task.itemId),
    jobId: text(task.jobId),
    skuCode: text(task.skuCode),
    productName: text(task.productName),
    brand: text(task.brand),
    sourceImageUrl: text(task.sourceImageUrl),
    promptBody: text(task.promptBody),
    segments,
    fixedSegment: text(task.fixedSegment) || null,
    modelId: text(task.modelId),
    leaseToken: text(task.leaseToken),
  };
  if (!normalized.itemId || !normalized.jobId || !normalized.skuCode
    || !normalized.promptBody || !normalized.segments.length
    || !normalized.modelId || !normalized.leaseToken) {
    throw new PublicApiError(503, "service_unavailable", "Django 市场标注任务返回不完整。");
  }
  return normalized;
}

async function query<T extends JsonRecord>(
  principal: AppPrincipal,
  view: string,
  params: JsonRecord,
  signal?: AbortSignal,
) {
  return requestDjangoMarketService<T>(
    principal,
    {
      path: MARKET_QUERIES_PATH,
      service: "reader",
      payload: { operation: "annotations", view, params },
    },
    { signal },
  );
}

async function command<T extends JsonRecord>(
  principal: AppPrincipal,
  value: JsonRecord,
  signal?: AbortSignal,
) {
  return requestDjangoMarketService<{ ok: boolean; result: T }>(
    principal,
    {
      path: MARKET_COMMANDS_PATH,
      service: "writer",
      payload: {
        contractVersion: "market-command-v1",
        domain: "annotations",
        command: value,
      },
    },
    { signal },
  );
}

export async function runClaimedDjangoMarketVisionTask(input: {
  principal: AppPrincipal;
  jobId?: string;
  signal?: AbortSignal;
}) {
  const claimed = await command<{ task: unknown }>(
    input.principal,
    { action: "claim_task", executor: "cloud", jobId: text(input.jobId) },
    input.signal,
  );
  const task = claimedTask(claimed.data.result.task);
  if (!task) {
    const progress = input.jobId
      ? await query<JsonRecord>(input.principal, "progress", { jobId: input.jobId }, input.signal)
      : null;
    const remaining = Number(progress?.data.remainingInferenceUnits ?? 0);
    return {
      status: 200,
      revision: progress?.revision ?? claimed.revision,
      replayed: false,
      data: {
        ok: true,
        result: {
          done: Boolean(progress) && remaining === 0,
          waiting: true,
          processedCount: 0,
          job: progress?.data.job ?? null,
        },
      },
    };
  }
  try {
    const prediction = await runVisionAnnotation({
      principal: input.principal,
      modelId: task.modelId,
      promptBody: task.promptBody,
      segments: task.segments,
      skuCode: task.skuCode,
      productName: task.productName,
      brand: task.brand,
      imageUrl: task.sourceImageUrl,
      fixedSegment: task.fixedSegment ?? undefined,
    });
    const completed = await command<JsonRecord>(
      input.principal,
      {
        action: "complete_task",
        itemId: task.itemId,
        leaseToken: task.leaseToken,
        result: {
          segment: prediction.segment,
          imagePriceCents: prediction.imagePriceCents,
          priceType: prediction.priceType,
          priceLowCents: prediction.priceLowCents,
          priceHighCents: prediction.priceHighCents,
          confidenceBps: prediction.confidenceBps,
          reason: prediction.reason,
          rawDigest: prediction.rawDigest,
          resolvedImageUrl: prediction.resolvedImageUrl,
          imageSource: prediction.imageSource,
          timing: prediction.timing,
        },
      },
      input.signal,
    );
    const progress = await query<JsonRecord>(
      input.principal,
      "progress",
      { jobId: task.jobId },
      input.signal,
    );
    return {
      status: 200,
      revision: progress.revision,
      replayed: completed.replayed,
      data: {
        ok: true,
        result: {
          ...completed.data.result,
          done: Number(progress.data.remainingInferenceUnits ?? 0) === 0,
          waiting: false,
          processedCount: 1,
          job: progress.data.job,
        },
      },
    };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "视觉识别失败").slice(0, 300);
    await command<JsonRecord>(
      input.principal,
      {
        action: "complete_task",
        itemId: task.itemId,
        leaseToken: task.leaseToken,
        error: message,
        timing: visionAnnotationTiming(error),
      },
      input.signal,
    ).catch(() => undefined);
    return {
      status: 200,
      revision: claimed.revision,
      replayed: false,
      data: {
        ok: true,
        result: {
          done: false,
          waiting: false,
          processedCount: 0,
          failedCount: 1,
          failureKind: "permanent",
          failureCode: "annotation_failed",
          failureMessage: message,
        },
      },
    };
  }
}
