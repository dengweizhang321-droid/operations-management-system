import {
  executeToolCallWithRegistry,
  normalizeAiToolCallName,
  RegistryToolError,
  type AiToolEntry,
  type AiToolExecutionContext,
  type AiToolExecutionResult,
  type RegistryAuditInput,
} from "@/lib/ai/tool-registry-contract";

export const AI_TOOL_RUNTIME_LIMITS = {
  maxTotalCalls: { minimum: 1, maximum: 24, default: 12 },
  maxCumulativeDurationMs: { minimum: 100, maximum: 120_000, default: 30_000 },
} as const;

export type AiToolRuntimeLimits = {
  maxTotalCalls: number;
  maxCumulativeDurationMs: number;
};

export type AiToolCallMetadata = {
  providerCallId?: string;
};

export type AiToolRuntimeSnapshot = {
  totalCalls: number;
  callsByTool: Readonly<Record<string, number>>;
  cumulativeDurationMs: number;
  active: boolean;
  terminalErrorCode: string | null;
};

export function createAiToolExecutionRuntime(input: {
  context: AiToolExecutionContext;
  entries: readonly AiToolEntry[];
  audit: (audit: RegistryAuditInput) => Promise<void>;
  summarizeArguments?: (value: unknown) => unknown;
  limits?: Partial<AiToolRuntimeLimits>;
}) {
  const limits = normalizeRuntimeLimits(input.limits);
  const callsByTool = new Map<string, number>();
  let totalCalls = 0;
  let cumulativeDurationMs = 0;
  let active = false;
  let terminalError: RegistryToolError | null = null;

  const execute = async (
    name: string,
    rawArguments: unknown,
    metadata: AiToolCallMetadata = {},
  ): Promise<AiToolExecutionResult> => {
    name = normalizeAiToolCallName(name);
    const invocationId = crypto.randomUUID();
    const entry = input.entries.find((candidate) => candidate.name === name);
    totalCalls += 1;
    callsByTool.set(name, (callsByTool.get(name) ?? 0) + 1);

    const rejection = runtimeRejection({
      active,
      terminalError,
      totalCalls,
      toolCalls: callsByTool.get(name) ?? 0,
      cumulativeDurationMs,
      entry,
      limits,
    });
    if (rejection) {
      const result = await executeRejectedCall(name, rawArguments, rejection, invocationId, metadata.providerCallId);
      if (isTerminalErrorCode(rejection.code)) terminalError = rejection;
      return result;
    }

    const remainingMs = Math.max(1, limits.maxCumulativeDurationMs - cumulativeDurationMs);
    const timeoutMs = Math.min(entry?.execution.timeoutMs ?? remainingMs, remainingMs);
    const executionSignal = createExecutionSignal(input.context.signal, timeoutMs);
    const startedAt = performance.now();
    active = true;
    try {
      const result = await executeToolCallWithRegistry(name, rawArguments, {
        ...input.context,
        invocationId,
        providerCallId: metadata.providerCallId,
        signal: executionSignal.signal,
      }, registryOptions(executionSignal.complete));
      if (!result.ok && isTerminalErrorCode(result.error.code)) {
        terminalError = new RegistryToolError(
          "tool_runtime_terminated",
          "本次请求的工具执行环境已在超时或取消后终止",
        );
      }
      return result;
    } finally {
      cumulativeDurationMs += Math.max(0, performance.now() - startedAt);
      active = false;
      executionSignal.cleanup();
    }
  };

  const executeRejectedCall = (
    name: string,
    rawArguments: unknown,
    rejection: RegistryToolError,
    invocationId: string,
    providerCallId?: string,
  ) => {
    const controller = new AbortController();
    controller.abort(rejection);
    return executeToolCallWithRegistry(name, rawArguments, {
      ...input.context,
      invocationId,
      providerCallId,
      signal: controller.signal,
    }, registryOptions());
  };

  const registryOptions = (completeExecution?: () => void) => ({
    entries: input.entries,
    audit: input.audit,
    summarizeArguments: input.summarizeArguments,
    completeExecution,
  });

  return {
    execute,
    snapshot(): AiToolRuntimeSnapshot {
      return {
        totalCalls,
        callsByTool: Object.fromEntries(callsByTool),
        cumulativeDurationMs: Math.trunc(cumulativeDurationMs),
        active,
        terminalErrorCode: terminalError?.code ?? null,
      };
    },
  };
}

function runtimeRejection(input: {
  active: boolean;
  terminalError: RegistryToolError | null;
  totalCalls: number;
  toolCalls: number;
  cumulativeDurationMs: number;
  entry: AiToolEntry | undefined;
  limits: AiToolRuntimeLimits;
}): RegistryToolError | null {
  if (input.terminalError) return input.terminalError;
  if (input.active) return new RegistryToolError("tool_runtime_busy", "当前执行环境只允许顺序工具调用");
  if (input.totalCalls > input.limits.maxTotalCalls) {
    return new RegistryToolError("tool_call_budget_exceeded", "工具调用总数达到执行环境上限");
  }
  if (input.entry && input.toolCalls > input.entry.execution.maxCallsPerRequest) {
    return new RegistryToolError("tool_call_budget_exceeded", "该工具在本次请求中的调用次数达到上限");
  }
  if (input.cumulativeDurationMs >= input.limits.maxCumulativeDurationMs) {
    return new RegistryToolError("tool_time_budget_exceeded", "工具累计执行时间达到上限");
  }
  return null;
}

function isTerminalErrorCode(code: string) {
  return code === "tool_timeout"
    || code === "tool_cancelled"
    || code === "tool_time_budget_exceeded"
    || code === "tool_runtime_terminated";
}

function normalizeRuntimeLimits(input: Partial<AiToolRuntimeLimits> | undefined): AiToolRuntimeLimits {
  return {
    maxTotalCalls: boundedInteger(
      input?.maxTotalCalls,
      AI_TOOL_RUNTIME_LIMITS.maxTotalCalls,
    ),
    maxCumulativeDurationMs: boundedInteger(
      input?.maxCumulativeDurationMs,
      AI_TOOL_RUNTIME_LIMITS.maxCumulativeDurationMs,
    ),
  };
}

function boundedInteger(
  value: number | undefined,
  range: { minimum: number; maximum: number; default: number },
) {
  const candidate = Number.isSafeInteger(value) ? Number(value) : range.default;
  return Math.min(range.maximum, Math.max(range.minimum, candidate));
}

function createExecutionSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const cancel = () => {
    if (!controller.signal.aborted) controller.abort(new RegistryToolError("tool_cancelled", "工具调用已取消"));
  };
  if (external?.aborted) cancel();
  else external?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new RegistryToolError("tool_timeout", "工具调用达到执行时间上限"));
  }, Math.max(1, timeoutMs));
  let deadlineActive = true;
  return {
    signal: controller.signal,
    complete() {
      if (!deadlineActive) return;
      deadlineActive = false;
      clearTimeout(timer);
    },
    cleanup() {
      deadlineActive = false;
      clearTimeout(timer);
      external?.removeEventListener("abort", cancel);
    },
  };
}
