export const MAX_AI_REPLY_CHARACTERS = 524288;
export const MAX_AI_STREAM_BYTES = 32 * 1024 * 1024;
export type AiGenerationOptions = {
  contextWindowTokens: number; taskTimeoutMs: number;
  outputTokenParameter: "max_tokens" | "max_completion_tokens";
  temperatureMode: "default" | "custom";
  reasoningFormat: "default" | "thinking" | "reasoning_effort" | "anthropic_budget" | "anthropic_adaptive";
  reasoningEffort: "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingBudgetTokens: number; includeStreamUsage: boolean; systemPrompt: string;
};
export const DEFAULT_AI_GENERATION: AiGenerationOptions = {
  contextWindowTokens: 128000, taskTimeoutMs: 260000, outputTokenParameter: "max_tokens",
  temperatureMode: "custom", reasoningFormat: "default", reasoningEffort: "default",
  thinkingBudgetTokens: 4096, includeStreamUsage: false, systemPrompt: "",
};
export type AiExecutionInfo = {
  inputTokens?: number | null; outputTokens?: number | null; reasoningTokens?: number | null;
  durationMs?: number; providerCalls?: number; usageReportedCalls?: number; toolCalls?: number;
  stopReason?: string; outputTruncated?: boolean;
  context?: { estimatedInputTokens?: number; contextWindowTokens?: number; droppedMessages?: number; tokenCountMethod?: string };
};
