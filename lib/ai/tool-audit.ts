import {
  ensureAuthorizationSchema,
  type AppRole,
} from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";

export type AiToolAuditInput = {
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

export async function recordAiToolAudit(input: AiToolAuditInput) {
  const db = getSalesDatabase();
  await ensureAuthorizationSchema(db);
  const resultJson = input.result ? JSON.stringify(input.result) : "";
  const responseDigest = resultJson ? await sha256Hex(resultJson) : null;
  await db.prepare(
      `INSERT INTO ai_tool_audit_logs (
        id, request_id, actor_email, actor_role, surface, tool_name,
        arguments_json, status, row_count, duration_ms, response_digest, error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.requestId,
      input.actorEmail,
      input.actorRole,
      input.surface.slice(0, 80),
      input.toolName,
      safeJson(input.arguments, 4_000),
      input.status,
      inferRowCount(input.result),
      Math.max(0, Math.trunc(input.durationMs)),
      responseDigest,
      input.errorCode ?? null,
    ).run();
}

export function summarizeToolArguments(value: unknown): unknown {
  return summarize(value, 0);
}

function inferRowCount(result: Record<string, unknown> | undefined): number | null {
  if (!result) return null;
  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    return inferRowCount(result.data as Record<string, unknown>);
  }
  if (typeof result.returned === "number") return Math.max(0, Math.trunc(result.returned));
  if (Array.isArray(result.items)) return result.items.length;
  if (Array.isArray(result.daily)) return result.daily.length;
  return null;
}

function summarize(value: unknown, depth: number): unknown {
  if (depth > 3) return "[depth-limited]";
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarize(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    output[key] = /secret|password|token|api.?key|authorization/i.test(key)
      ? "[redacted]"
      : summarize(item, depth + 1);
  }
  return output;
}

function safeJson(value: unknown, limit: number) {
  try {
    return JSON.stringify(value ?? {}).slice(0, limit);
  } catch {
    return "{}";
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
