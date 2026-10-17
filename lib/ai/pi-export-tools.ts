import { aiConsumer } from "@/lib/django/ai-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";

function exportRequest(operation: string, args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_agent") throw new RegistryToolError("forbidden", "仅 Pi 运行可使用异步导出。");
  return aiConsumer<Record<string, unknown>>(context.principal, { operation, ...args, surface: "pi_agent" }, {
    signal: context.signal, requestId: context.requestId,
  });
}
export function startPiDatasetExport(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return exportRequest("pi-export-start", { ...args, operationId: context.requestId }, context);
}
export function getPiDatasetExport(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return exportRequest("pi-export-status", args, context);
}
