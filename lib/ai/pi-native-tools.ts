import { aiConsumer } from "@/lib/django/ai-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";

/** Django owns the root fence and each durable agent/plan/control identity. */
export async function callPiNativeTool(name: string, args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_business" || !context.persistentPiGateway || !context.providerCallId) {
    throw new RegistryToolError("forbidden", "此能力只能通过当前 Pi 持久任务入口调用。");
  }
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "pi-native-tool", parentOperationId: context.requestId, name, arguments: args,
    invocationId: context.providerCallId, surface: "pi_business",
  }, { signal: context.signal });
}
