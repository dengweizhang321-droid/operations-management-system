import {
  BOOTSTRAP_ADMIN_EMAIL,
  ensureAuthorizationSchema,
} from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";

export async function recordMcpToolAudit(input: {
  requestId: string;
  toolName: string;
  arguments: unknown;
  status: "succeeded" | "failed";
  durationMs: number;
  result?: Record<string, unknown>;
  errorCode?: string;
}) {
  try {
    const db = getSalesDatabase();
    await ensureAuthorizationSchema(db);
    const resultJson = input.result ? JSON.stringify(input.result) : "";
    const responseDigest = resultJson ? await sha256Hex(resultJson) : null;
    await db.prepare(
      `INSERT INTO ai_tool_audit_logs (
        id, request_id, actor_email, actor_role, surface, tool_name,
        arguments_json, status, row_count, duration_ms, response_digest, error_code
      ) VALUES (?, ?, ?, 'admin', 'codex_mcp', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.requestId,
      BOOTSTRAP_ADMIN_EMAIL,
      input.toolName,
      safeJson(input.arguments, 4_000),
      input.status,
      inferRowCount(input.result),
      Math.max(0, Math.trunc(input.durationMs)),
      responseDigest,
      input.errorCode ?? null,
    ).run();
  } catch {
    // Audit failures must not replace a valid read-only tool result.
  }
}

function inferRowCount(result: Record<string, unknown> | undefined): number | null {
  if (!result) return null;
  if (typeof result.returned === "number") return Math.max(0, Math.trunc(result.returned));
  if (Array.isArray(result.items)) return result.items.length;
  if (Array.isArray(result.daily)) return result.daily.length;
  return null;
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
