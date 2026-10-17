import type { AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";
import { aiConsumer } from "@/lib/django/ai-service";

export function describeSystemDatasets(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "datasets-describe", ...args, surface: datasetSurface(context),
  }, { signal: context.signal, requestId: context.requestId });
}

export function querySystemDataset(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "datasets-query", ...args, surface: datasetSurface(context),
  }, { signal: context.signal, requestId: context.requestId });
}

function datasetSurface(context: AiToolExecutionContext) {
  return context.surface === "pi_agent" ? "pi_agent" : context.surface === "dingtalk_chat" ? "dingtalk_chat" : "ai_chat";
}
