import type { AppPrincipal, AppRole } from "@/lib/auth/authorization";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties: false;
  [key: string]: unknown;
};

export type AiToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type AiToolRisk = "read_only" | "write" | "dangerous";
export type AiToolSurface = "ai_chat" | "market_ai" | "codex_mcp" | "test";

export type AiToolExecutionContext = {
  principal: AppPrincipal;
  surface: AiToolSurface;
  requestId: string;
  /** Cooperative cancellation. Handlers using cancellable I/O should pass it through. */
  signal?: AbortSignal;
};

export type AiToolEntry = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: AiToolAnnotations;
  risk: AiToolRisk;
  allowedRoles: readonly AppRole[];
  /** False means the tool is hidden from scoped principals because its handler cannot safely apply row-level scope. */
  supportsScopedPrincipal: boolean;
  handler: (
    arguments_: Record<string, unknown>,
    context: AiToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
};

export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type AnthropicToolDefinition = {
  name: string;
  description: string;
  input_schema: JsonSchema;
};

export type AiToolExecutionResult =
  | { ok: true; toolName: string; data: Record<string, unknown> }
  | { ok: false; toolName: string; error: { code: string; message: string }; auditStatus?: "unavailable" };

export type RegistryAuditInput = {
  requestId: string;
  actorEmail: string;
  actorRole: AppRole;
  surface: string;
  toolName: string;
  arguments: unknown;
  status: "started" | "succeeded" | "failed";
  durationMs: number;
  result?: Record<string, unknown>;
  errorCode?: string;
};

export function validateToolRegistry(entries: readonly AiToolEntry[]): void {
  const names = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(entry.name)) throw new Error(`AI 工具名称无效：${entry.name}`);
    if (names.has(entry.name)) throw new Error(`AI 工具名称重复：${entry.name}`);
    names.add(entry.name);
    if (!entry.title.trim() || !entry.description.trim()) throw new Error(`AI 工具缺少标题或描述：${entry.name}`);
    if (entry.inputSchema.type !== "object" || !isRecord(entry.inputSchema.properties)) {
      throw new Error(`AI 工具 schema 必须声明 object/properties：${entry.name}`);
    }
    if (entry.inputSchema.additionalProperties !== false) throw new Error(`AI 工具 schema 必须禁止额外参数：${entry.name}`);
    for (const required of entry.inputSchema.required ?? []) {
      if (!Object.hasOwn(entry.inputSchema.properties, required)) {
        throw new Error(`AI 工具 required 字段未在 properties 中声明：${entry.name}.${required}`);
      }
    }
    if (typeof entry.handler !== "function") throw new Error(`AI 工具缺少 handler：${entry.name}`);
    if (entry.allowedRoles.length === 0) throw new Error(`AI 工具未声明角色：${entry.name}`);
    if (typeof entry.supportsScopedPrincipal !== "boolean") throw new Error(`AI 工具未声明 scope 支持：${entry.name}`);
    if (entry.risk === "read_only" && (!entry.annotations.readOnlyHint || entry.annotations.destructiveHint)) {
      throw new Error(`只读工具的风险标记不一致：${entry.name}`);
    }
    if (entry.risk === "dangerous" && !entry.annotations.destructiveHint) {
      throw new Error(`危险工具必须声明 destructiveHint：${entry.name}`);
    }
  }
}

export function getToolsForPrincipal(principal: AppPrincipal, entries: readonly AiToolEntry[]): readonly AiToolEntry[] {
  return entries.filter((entry) => entry.allowedRoles.includes(principal.role)
    && (principal.scope === null || entry.supportsScopedPrincipal));
}

export function getOpenAiTools(principal: AppPrincipal, entries: readonly AiToolEntry[]): OpenAiToolDefinition[] {
  return getToolsForPrincipal(principal, entries).map((entry) => ({
    type: "function",
    function: { name: entry.name, description: entry.description, parameters: entry.inputSchema },
  }));
}

export function getAnthropicTools(principal: AppPrincipal, entries: readonly AiToolEntry[]): AnthropicToolDefinition[] {
  return getToolsForPrincipal(principal, entries).map((entry) => ({
    name: entry.name,
    description: entry.description,
    input_schema: entry.inputSchema,
  }));
}

export function getVisibleToolCatalog(principal: AppPrincipal, entries: readonly AiToolEntry[]) {
  return getToolsForPrincipal(principal, entries).map((entry) => ({
    name: entry.name,
    title: entry.title,
    description: entry.description,
    inputSchema: entry.inputSchema,
    annotations: entry.annotations,
    risk: entry.risk,
  }));
}

export function parseToolArguments(rawArguments: unknown): Record<string, unknown> {
  let parsed = rawArguments;
  if (typeof rawArguments === "string") {
    try {
      parsed = JSON.parse(rawArguments) as unknown;
    } catch {
      throw new RegistryToolError("invalid_arguments", "工具参数不是有效 JSON");
    }
  }
  if (!isRecord(parsed)) throw new RegistryToolError("invalid_arguments", "工具参数必须是 JSON 对象");
  return parsed;
}

/** Small, deterministic JSON-Schema subset used by every registered tool. */
export function validateToolArguments(value: unknown, schema: JsonSchema): void {
  validateSchemaNode(value, schema as Record<string, unknown>, "$", true);
}

export async function executeToolCallWithRegistry(
  name: string,
  rawArguments: unknown,
  context: AiToolExecutionContext,
  options: {
    entries: readonly AiToolEntry[];
    audit: (input: RegistryAuditInput) => Promise<void>;
    summarizeArguments?: (value: unknown) => unknown;
  },
): Promise<AiToolExecutionResult> {
  const startedAt = performance.now();
  const entry = options.entries.find((candidate) => candidate.name === name);
  let parsedArguments: Record<string, unknown> = {};
  let argumentsForAudit: unknown = rawArguments;
  const summarize = options.summarizeArguments ?? ((value: unknown) => value);
  try {
    if (!entry) throw new RegistryToolError("unknown_tool", "工具不存在或未注册");
    if (!entry.allowedRoles.includes(context.principal.role)) {
      throw new RegistryToolError("forbidden", "当前账号无权调用此工具");
    }
    if (context.principal.scope !== null && !entry.supportsScopedPrincipal) {
      throw new RegistryToolError("forbidden", "此工具不能安全应用当前账号的数据范围");
    }
    throwIfAborted(context.signal);
    parsedArguments = parseToolArguments(rawArguments);
    validateToolArguments(parsedArguments, entry.inputSchema);
    argumentsForAudit = parsedArguments;
    const preflightAudited = await tryAudit(options.audit, {
      requestId: context.requestId,
      actorEmail: context.principal.email,
      actorRole: context.principal.role,
      surface: context.surface,
      toolName: name,
      arguments: summarize(argumentsForAudit),
      status: "started",
      durationMs: performance.now() - startedAt,
    });
    if (!preflightAudited) throw new RegistryToolError("audit_unavailable", "审计不可用，工具未执行");
    const data = await entry.handler(parsedArguments, context);
    throwIfAborted(context.signal);
    const audited = await tryAudit(options.audit, {
      requestId: context.requestId,
      actorEmail: context.principal.email,
      actorRole: context.principal.role,
      surface: context.surface,
      toolName: name,
      arguments: summarize(argumentsForAudit),
      status: "succeeded",
      durationMs: performance.now() - startedAt,
      result: data,
    });
    if (!audited) {
      return { ok: false, toolName: name, error: { code: "audit_unavailable", message: "审计结果写入失败" }, auditStatus: "unavailable" };
    }
    return { ok: true, toolName: name, data };
  } catch (error) {
    const code = error instanceof RegistryToolError
      ? error.code
      : error instanceof Error && error.name === "ToolInputError"
        ? "invalid_arguments"
        : "tool_execution_failed";
    const message = code === "tool_execution_failed"
      ? "工具执行失败"
      : error instanceof Error
        ? error.message.slice(0, 240)
        : "工具调用失败";
    const audited = await tryAudit(options.audit, {
      requestId: context.requestId,
      actorEmail: context.principal.email,
      actorRole: context.principal.role,
      surface: context.surface,
      toolName: name,
      arguments: summarize(argumentsForAudit),
      status: "failed",
      durationMs: performance.now() - startedAt,
      errorCode: code,
    });
    if (!audited) {
      return {
        ok: false,
        toolName: name,
        error: { code: "audit_unavailable", message: "审计不可用，工具执行未返回数据" },
        auditStatus: "unavailable",
      };
    }
    return { ok: false, toolName: name, error: { code, message } };
  }
}

export class RegistryToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RegistryToolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function tryAudit(
  audit: (input: RegistryAuditInput) => Promise<void>,
  input: RegistryAuditInput,
) {
  try {
    await audit(input);
    return true;
  } catch {
    return false;
  }
}

function validateSchemaNode(value: unknown, schema: Record<string, unknown>, path: string, root = false): void {
  const fail = (message: string): never => { throw new RegistryToolError("invalid_arguments", `${path} ${message}`); };
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) fail("不在允许值中");
  const type = schema.type;
  if (type === "object") {
    if (!isRecord(value)) fail("必须是对象");
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`缺少必填字段 ${key}`);
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
      if (unexpected.length > 0) fail(`包含未声明字段 ${unexpected.join(", ")}`);
    }
    for (const [key, item] of Object.entries(value)) {
      const child = properties[key];
      if (isRecord(child)) validateSchemaNode(item, child, `${path}.${key}`);
    }
    return;
  }
  if (type === "string") {
    if (typeof value !== "string") fail("必须是字符串");
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength) fail(`长度不能小于 ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && length > schema.maxLength) fail(`长度不能大于 ${schema.maxLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) fail("格式无效");
    return;
  }
  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isSafeInteger(value))) fail(`必须是${type === "integer" ? "整数" : "数字"}`);
    if (typeof schema.minimum === "number" && value < schema.minimum) fail(`不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) fail(`不能大于 ${schema.maximum}`);
    return;
  }
  if (type === "boolean" && typeof value !== "boolean") fail("必须是布尔值");
  if (type === "array") {
    if (!Array.isArray(value)) fail("必须是数组");
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail(`元素不能少于 ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) fail(`元素不能多于 ${schema.maxItems}`);
    if (isRecord(schema.items)) value.forEach((item, index) => validateSchemaNode(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
    return;
  }
  if (!root && typeof type !== "string") fail("schema 缺少类型声明");
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new RegistryToolError("tool_cancelled", "工具调用已超时或取消");
}
