import { aiConsumer, aiSha256 } from "@/lib/django/ai-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";

async function exportRequest(operation: string, args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_agent") throw new RegistryToolError("forbidden", "仅 Pi 运行可使用异步导出。");
  // requestId is the parent Pi operation, also used by start's operationId.
  // The signed Pi gateway supplies a stable request identity in providerCallId
  // for each individual tool dispatch. Bind both without changing the parent
  // or using the registry's fresh audit invocation ID on a replay.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(context.requestId)
    || typeof context.providerCallId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(context.providerCallId)) {
    throw new RegistryToolError("forbidden", "Pi 导出缺少受信工具调用身份。");
  }
  const requestId = `pi-tool-${await aiSha256(JSON.stringify(["pi-export-v1", context.requestId, context.providerCallId]))}`;
  return aiConsumer<Record<string, unknown>>(context.principal, { operation, ...args, surface: "pi_agent" }, {
    signal: context.signal, requestId,
  });
}
export function startPiDatasetExport(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return exportRequest("pi-export-start", { ...args, operationId: context.requestId }, context);
}
export function getPiDatasetExport(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return exportRequest("pi-export-status", args, context);
}
