import { env } from "cloudflare:workers";

import {
  type AppDataScope,
  type AppPrincipal,
  type AppRole,
} from "@/lib/auth/authorization";
import { decideLocalDirectAccess } from "@/lib/auth/local-direct-access";
import type { D1Database } from "@/lib/database/d1";

const BACKGROUND_AGENT_ROLES = ["analyst", "operator", "admin"] as const;
const LOCAL_BACKGROUND_OWNER = "local-admin@teruisi.local";

type BackgroundUserRow = {
  email: string;
  display_name: string;
  role: string;
  status: string;
  scope_json: string | null;
};

export type AiBackgroundPrincipalResult =
  | { ok: true; principal: AppPrincipal; actorRole: AppRole; localDirect: boolean }
  | { ok: false; code: "authorization_revoked" | "scope_invalid"; message: string };

export async function resolveAiBackgroundPrincipal(
  ownerEmailInput: string,
  scopeSnapshotJson: string,
  db: D1Database,
): Promise<AiBackgroundPrincipalResult> {
  const ownerEmail = ownerEmailInput.trim().toLowerCase();
  const snapshot = parseStoredScope(scopeSnapshotJson, false);
  if (snapshot === undefined) {
    return { ok: false, code: "scope_invalid", message: "AI 任务的数据范围快照无效。" };
  }

  if (ownerEmail === LOCAL_BACKGROUND_OWNER) {
    if (snapshot !== null || !await localDirectBackgroundEnabled()) {
      return { ok: false, code: "authorization_revoked", message: "本地直连身份已失效或任务范围无效。" };
    }
    return {
      ok: true,
      principal: { email: ownerEmail, displayName: "本地管理员", role: "admin", scope: null },
      actorRole: "admin",
      localDirect: true,
    };
  }

  const row = await db.prepare(`SELECT email, display_name, role, status, scope_json
    FROM app_users WHERE email = ? COLLATE NOCASE LIMIT 1`)
    .bind(ownerEmail).first<BackgroundUserRow>();
  if (!row || row.status !== "active" || !isBackgroundRole(row.role)) {
    return { ok: false, code: "authorization_revoked", message: "任务发起账号已停用或不再具备 Agent 执行角色。" };
  }
  const currentScope = parseStoredScope(row.scope_json, true);
  if (currentScope === undefined || !scopeCoversSnapshot(currentScope, snapshot)) {
    return { ok: false, code: "authorization_revoked", message: "任务发起账号的当前数据范围不再覆盖创建快照。" };
  }
  return {
    ok: true,
    principal: {
      email: row.email.trim().toLowerCase(),
      displayName: row.display_name || row.email,
      role: row.role,
      // Expansion never broadens an existing job: tools always receive the immutable snapshot.
      scope: snapshot,
    },
    actorRole: row.role,
    localDirect: false,
  };
}

/**
 * SQL predicate proving a stored current user scope still covers an immutable
 * task scope. Both expressions must be trusted server-selected columns.
 */
export function storedScopeCoverageSql(currentScopeExpression: string, snapshotExpression: string): string {
  const current = `CASE WHEN ${currentScopeExpression} IS NOT NULL AND json_valid(${currentScopeExpression})
    THEN ${currentScopeExpression} ELSE 'null' END`;
  const snapshot = `CASE WHEN ${snapshotExpression} IS NOT NULL AND json_valid(${snapshotExpression})
    THEN ${snapshotExpression} ELSE 'null' END`;
  return `(
    ${currentScopeExpression} IS NULL
    OR (
      ${snapshotExpression} IS NOT NULL
      AND ${snapshotExpression} <> 'null'
      AND json_valid(${snapshotExpression})
      AND json_type(${snapshot}) = 'object'
      AND json_type(${snapshot}, '$.warehouses') = 'array'
      AND json_type(${snapshot}, '$.channels') = 'array'
      AND json_type(${snapshot}, '$.platforms') = 'array'
      AND ${currentScopeExpression} <> 'null'
      AND json_valid(${currentScopeExpression})
      AND json_type(${current}) = 'object'
      AND json_type(${current}, '$.warehouses') = 'array'
      AND json_type(${current}, '$.channels') = 'array'
      AND json_type(${current}, '$.platforms') = 'array'
      AND NOT EXISTS (SELECT 1 FROM json_each(${snapshot}, '$.warehouses') item
        WHERE item.type <> 'text' OR CAST(item.value AS TEXT) NOT IN (
          SELECT CAST(allowed.value AS TEXT) FROM json_each(${current}, '$.warehouses') allowed
        ))
      AND NOT EXISTS (SELECT 1 FROM json_each(${snapshot}, '$.channels') item
        WHERE item.type <> 'text' OR CAST(item.value AS TEXT) NOT IN (
          SELECT CAST(allowed.value AS TEXT) FROM json_each(${current}, '$.channels') allowed
        ))
      AND NOT EXISTS (SELECT 1 FROM json_each(${snapshot}, '$.platforms') item
        WHERE item.type <> 'text' OR CAST(item.value AS TEXT) NOT IN (
          SELECT CAST(allowed.value AS TEXT) FROM json_each(${current}, '$.platforms') allowed
        ))
    )
  )`;
}

function isBackgroundRole(value: string): value is (typeof BACKGROUND_AGENT_ROLES)[number] {
  return BACKGROUND_AGENT_ROLES.includes(value as (typeof BACKGROUND_AGENT_ROLES)[number]);
}

function parseStoredScope(value: string | null, sqlNullIsUnrestricted: boolean): AppDataScope | undefined {
  if (value === null) return sqlNullIsUnrestricted ? null : undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null) return sqlNullIsUnrestricted ? undefined : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const dimensions = [record.warehouses, record.channels, record.platforms];
    if (dimensions.some((items) => !Array.isArray(items)
      || !items.every((item) => typeof item === "string" && item.trim().length > 0))) return undefined;
    return {
      warehouses: normalizeScopeValues(record.warehouses as string[]),
      channels: normalizeScopeValues(record.channels as string[]),
      platforms: normalizeScopeValues(record.platforms as string[]),
    };
  } catch {
    return undefined;
  }
}

function normalizeScopeValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function scopeCoversSnapshot(current: AppDataScope, snapshot: AppDataScope): boolean {
  if (current === null) return true;
  if (snapshot === null) return false;
  return snapshot.warehouses.every((value) => current.warehouses.includes(value))
    && snapshot.channels.every((value) => current.channels.includes(value))
    && snapshot.platforms.every((value) => current.platforms.includes(value));
}

async function localDirectBackgroundEnabled(): Promise<boolean> {
  try {
    const viteEnvironment = (
      import.meta as ImportMeta & {
        readonly env?: {
          readonly DEV?: boolean;
          readonly PROD?: boolean;
          readonly VITE_TERUISI_LOCAL_BUILD?: string;
        };
      }
    ).env;
    return decideLocalDirectAccess(BACKGROUND_AGENT_ROLES, {
      enabled: typeof env.TERUISI_LOCAL_DIRECT_ACCESS === "string"
        ? env.TERUISI_LOCAL_DIRECT_ACCESS
        : undefined,
      runtimeEnvironment: typeof env.TERUISI_RUNTIME_ENV === "string"
        ? env.TERUISI_RUNTIME_ENV
        : undefined,
      viteDevelopment: viteEnvironment?.DEV === true,
      viteProduction: viteEnvironment?.PROD === true,
      nodeEnvironment: globalThis.process?.env?.NODE_ENV,
      localBuild: viteEnvironment?.VITE_TERUISI_LOCAL_BUILD?.trim().toLowerCase() === "true",
    }) === "allowed";
  } catch {
    return false;
  }
}
