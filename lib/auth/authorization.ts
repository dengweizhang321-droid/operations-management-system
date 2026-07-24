import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";
import {
  getSalesDatabase,
  type SalesDatabase,
} from "@/lib/sales/database";
import { decideLocalDirectAccess } from "@/lib/auth/local-direct-access";

export const BOOTSTRAP_ADMIN_EMAIL = "dengweizhang321@gmail.com";

const LOCAL_DIRECT_ACCESS_PRINCIPAL: AppPrincipal = {
  email: "local-admin@teruisi.local",
  displayName: "本地管理员",
  role: "admin",
  scope: null,
};

export const appRoles = ["viewer", "analyst", "operator", "admin"] as const;
export type AppRole = (typeof appRoles)[number];

export type AppDataScope = {
  warehouses: string[];
  channels: string[];
  platforms: string[];
} | null;

export type AppPrincipal = {
  email: string;
  displayName: string;
  role: AppRole;
  scope: AppDataScope;
};

type AppUserRow = {
  email: string;
  display_name: string;
  role: string;
  status: string;
  scope_json: string | null;
};

export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly code: "authentication_required" | "access_denied" | "insufficient_role";

  constructor(
    status: 401 | 403,
    code: AuthorizationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
    this.code = code;
  }
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'operator', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    scope_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS app_users_role_status_idx
    ON app_users (role, status)`,
  `CREATE TABLE IF NOT EXISTS ai_tool_audit_logs (
    id TEXT PRIMARY KEY NOT NULL,
    request_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    surface TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    row_count INTEGER,
    duration_ms INTEGER,
    response_digest TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_tool_audit_logs_actor_created_idx
    ON ai_tool_audit_logs (actor_email, created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_tool_audit_logs_tool_created_idx
    ON ai_tool_audit_logs (tool_name, created_at)`,
  `INSERT INTO app_users (email, display_name, role, status, scope_json)
    VALUES (?, '系统管理员', 'admin', 'active', NULL)
    ON CONFLICT(email) DO NOTHING`,
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export async function ensureAuthorizationSchema(
  db: SalesDatabase = getSalesDatabase(),
): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;

  const setup = db
    .batch(
      schemaStatements.map((statement, index) => {
        const prepared = db.prepare(statement);
        return index === schemaStatements.length - 1
          ? prepared.bind(BOOTSTRAP_ADMIN_EMAIL)
          : prepared;
      }),
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });

  schemaReadyByDatabase.set(key, setup);
  return setup;
}

export async function requireAppPrincipal(
  allowedRoles: readonly AppRole[] = appRoles,
): Promise<AppPrincipal> {
  const viteEnvironment = (
    import.meta as ImportMeta & {
      readonly env?: {
        readonly DEV?: boolean;
        readonly PROD?: boolean;
        readonly VITE_TERUISI_LOCAL_BUILD?: string;
      };
    }
  ).env;
  const localAccess = decideLocalDirectAccess(allowedRoles, {
    enabled:
      typeof env.TERUISI_LOCAL_DIRECT_ACCESS === "string"
        ? env.TERUISI_LOCAL_DIRECT_ACCESS
        : undefined,
    runtimeEnvironment:
      typeof env.TERUISI_RUNTIME_ENV === "string"
        ? env.TERUISI_RUNTIME_ENV
        : undefined,
    viteDevelopment: viteEnvironment?.DEV === true,
    viteProduction: viteEnvironment?.PROD === true,
    localBuild:
      viteEnvironment?.VITE_TERUISI_LOCAL_BUILD?.trim().toLowerCase() ===
      "true",
  });

  if (localAccess === "allowed") {
    return LOCAL_DIRECT_ACCESS_PRINCIPAL;
  }
  if (localAccess === "role_denied") {
    throw new AuthorizationError(
      403,
      "insufficient_role",
      "本地直连身份没有执行此操作的权限",
    );
  }

  const identity = await getChatGPTUser();
  if (!identity) {
    throw new AuthorizationError(
      401,
      "authentication_required",
      "请先使用 ChatGPT 账号登录",
    );
  }

  const db = getSalesDatabase();
  await ensureAuthorizationSchema(db);
  const normalizedEmail = identity.email.trim().toLowerCase();
  let row = await findAppUser(db, normalizedEmail);

  if (!row) {
    await db.prepare(
      `INSERT INTO app_users (email, display_name, role, status, scope_json)
       VALUES (?, ?, 'viewer', 'active', NULL)
       ON CONFLICT(email) DO NOTHING`,
    ).bind(
      normalizedEmail,
      identity.fullName ?? identity.displayName ?? normalizedEmail,
    ).run();
    row = await findAppUser(db, normalizedEmail);
  }

  if (!row || row.status !== "active" || !isAppRole(row.role)) {
    throw new AuthorizationError(
      403,
      "access_denied",
      "当前账号未获得运营管理系统访问权限",
    );
  }

  if (!allowedRoles.includes(row.role)) {
    throw new AuthorizationError(
      403,
      "insufficient_role",
      "当前账号没有执行此操作的权限",
    );
  }

  return {
    email: row.email,
    displayName: identity.fullName ?? (row.display_name || row.email),
    role: row.role,
    scope: parseScope(row.scope_json),
  };
}

export function authorizationErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AuthorizationError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}

function isAppRole(value: string): value is AppRole {
  return appRoles.includes(value as AppRole);
}

function findAppUser(db: SalesDatabase, email: string) {
  return db
    .prepare(
      `SELECT email, display_name, role, status, scope_json
       FROM app_users
       WHERE email = ? COLLATE NOCASE
       LIMIT 1`,
    )
    .bind(email)
    .first<AppUserRow>();
}

function parseScope(value: string | null): AppDataScope {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { warehouses: [], channels: [], platforms: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      warehouses: stringArray(record.warehouses),
      channels: stringArray(record.channels),
      platforms: stringArray(record.platforms),
    };
  } catch {
    return { warehouses: [], channels: [], platforms: [] };
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return [];
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
