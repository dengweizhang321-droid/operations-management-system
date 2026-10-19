import { aiConsumer } from "@/lib/django/ai-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";

/** This bridge only persists intent. Django owns authorization and dispatch. */
export async function preparePiBusinessAction(toolName: string, args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_business" || !context.persistentPiGateway
    || !/^[A-Za-z0-9_-]{1,128}$/.test(context.requestId) || !context.providerCallId) {
    throw new RegistryToolError("forbidden", "业务动作只能由本轮获准的 Pi 持久任务入口提交。");
  }
  const { userIntentId, ...parameters } = args;
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "pi-business-prepare", surface: "pi_business", parentOperationId: context.requestId,
    userIntentId, toolName, parameters, invocationId: context.providerCallId,
  }, { signal: context.signal });
}

export async function getPiBusinessAction(args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_business" || !context.persistentPiGateway) {
    throw new RegistryToolError("forbidden", "仅获准的 Pi 业务入口可读取动作回执。");
  }
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "pi-business-status", surface: "pi_business", parentOperationId: context.requestId, ...args,
  }, { signal: context.signal });
}

export async function getPiBusinessOptions(_args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_business" || !context.persistentPiGateway) throw new RegistryToolError("forbidden", "仅本轮 Pi 业务入口可读取执行选项。");
  return aiConsumer<Record<string, unknown>>(context.principal, { operation: "pi-business-options", surface: "pi_business", parentOperationId: context.requestId }, { signal: context.signal });
}
