import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoWorkflowService,
  WORKFLOW_CONSUMER_QUERY_PATH,
  type DjangoWorkflowServiceConfig,
  type DjangoWorkflowServiceOptions,
} from "@/lib/django/workflow-service";
import { PublicApiError } from "@/lib/http/api-error";

export type WorkflowLaunchSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  updatedAt: string;
  amountCents: number | null;
};

export type WorkflowConsumerRequest = {
  operation: "launch_project_search";
  query: string;
  offset: number;
  limit: number;
};

export type WorkflowConsumerResponse = {
  items: WorkflowLaunchSearchItem[];
  total: number;
  truncated: boolean;
};

function unavailable(): PublicApiError {
  return new PublicApiError(503, "service_unavailable", "Django 运营事务读取服务暂时不可用，请稍后重试。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRequest(request: WorkflowConsumerRequest) {
  if (!isRecord(request) || Object.keys(request).length !== 4
    || request.operation !== "launch_project_search"
    || typeof request.query !== "string" || Array.from(request.query.trim()).length < 2
    || Array.from(request.query.trim()).length > 80
    || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > 80_000
    || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw unavailable();
}

function validateResponse(value: unknown, limit: number): value is WorkflowConsumerResponse {
  if (!isRecord(value) || !Array.isArray(value.items)
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0
    || typeof value.truncated !== "boolean" || value.items.length > limit) return false;
  return value.items.every((item) => isRecord(item)
    && typeof item.id === "string" && typeof item.title === "string"
    && typeof item.subtitle === "string" && typeof item.detail === "string"
    && typeof item.updatedAt === "string"
    && (item.amountCents === null || Number.isSafeInteger(item.amountCents)));
}

export async function readDjangoWorkflowConsumer(
  principal: AppPrincipal,
  request: WorkflowConsumerRequest,
  options: Omit<DjangoWorkflowServiceOptions, "config"> & { config?: DjangoWorkflowServiceConfig } = {},
): Promise<{ revision: string; data: WorkflowConsumerResponse }> {
  validateRequest(request);
  const { config, ...serviceOptions } = options;
  const result = await createDjangoWorkflowService(config).requestJson<Record<string, unknown>>(
    principal,
    {
      method: "POST",
      path: WORKFLOW_CONSUMER_QUERY_PATH,
      service: "reader",
      payload: request,
    },
    serviceOptions,
  );
  if (result.data.operation !== request.operation || !validateResponse(result.data.data, request.limit)) throw unavailable();
  return { revision: result.revision, data: result.data.data };
}

export type WorkflowConsumerReader = {
  read(
    principal: AppPrincipal,
    request: WorkflowConsumerRequest,
    options?: { signal?: AbortSignal },
  ): Promise<{ revision: string; data: WorkflowConsumerResponse }>;
};

export function createDjangoWorkflowConsumerReader(config?: DjangoWorkflowServiceConfig): WorkflowConsumerReader {
  return {
    read: (principal, request, options = {}) => readDjangoWorkflowConsumer(principal, request, { ...options, config }),
  };
}
