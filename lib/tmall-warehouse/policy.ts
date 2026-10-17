import { createHash } from "node:crypto";
import path from "node:path";
import { lstat } from "node:fs/promises";

export const tmallWarehouseProtocol = "tmall-warehouse-realtime-v1";
export const tmallWarehouseSource = "https://scp.tmall.com/pages/sdigit/fulfillment_realtime_inventory_good_s_ptdjd";
export const tmallWarehouseApiPath = "/api/inventory/tmall-warehouse";
export const tmallWarehouseWorkflowId = "TmallWarehouseDaily2026";
export const tmallWarehouseMaxBytes = 20 * 1024 * 1024;
export type WarehouseConfig = { enabled: boolean; owner: string; executablePath: string; userDataDir: string; profileName: string; baseUrl: string };
export function warehouseHash(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
export function warehouseDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function warehouseConfig(value: unknown, root: string): WarehouseConfig {
  const c = value as WarehouseConfig;
  if (!c || typeof c !== "object" || Array.isArray(c) || c.enabled !== true) throw new Error("TMALL_WAREHOUSE_DISABLED_MANUAL_ACTION");
  if (typeof c.owner !== "string" || !c.owner.trim() || c.owner.length > 120) throw new Error("TMALL_WAREHOUSE_OWNER_REQUIRED_MANUAL_ACTION");
  const controlledRoot = path.join(root, ".runtime", "tmall-warehouse-browser");
  if (!path.isAbsolute(c.executablePath ?? "") || !path.isAbsolute(c.userDataDir ?? "") || path.resolve(c.userDataDir) !== controlledRoot || c.profileName !== "Default") throw new Error("TMALL_WAREHOUSE_DEDICATED_PROFILE_REQUIRED_MANUAL_ACTION");
  const u = new URL(c.baseUrl);
  if (u.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(u.hostname) || u.pathname !== "/" || u.username || u.password || u.search || u.hash) throw new Error("TMALL_WAREHOUSE_LOCAL_API_REQUIRED");
  return { ...c, owner: c.owner.trim(), baseUrl: u.origin };
}
/** Pure login maintenance may inspect a disabled registered configuration;
 * all business callers continue to require warehouseConfig's enabled=true. */
export function warehouseLoginConfig(value: unknown, root: string): WarehouseConfig {
  const c = value as WarehouseConfig;
  if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.enabled !== "boolean") throw new Error("TMALL_WAREHOUSE_LOGIN_CONFIG_INVALID");
  const validated = warehouseConfig({ ...c, enabled: true }, root);
  return { ...validated, enabled: c.enabled };
}
export async function assertWarehouseBrowserDirectory(config: WarehouseConfig, root: string) {
  for (const directory of [path.join(root, ".runtime"), config.userDataDir, path.join(config.userDataDir, config.profileName)]) {
    const info = await lstat(directory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("TMALL_WAREHOUSE_DEDICATED_PROFILE_REQUIRED_MANUAL_ACTION");
  }
}
export function warehouseHelperError(stage: string, busy: boolean, route: string, executionId: string | null, owner: string | null) {
  if (!executionId || !/^[A-Za-z0-9._:-]{1,128}$/.test(executionId)) return { error: "missing_or_invalid_execution_id" };
  if (!owner) return { error: "execution_not_claimed" };
  if (owner !== executionId) return { error: "execution_mismatch" };
  if (busy) return { error: "pipeline_busy" };
  if (route === "/tmall-warehouse/release") return null;
  if (route === "/tmall-warehouse/plan" && stage === "ready" || route === "/tmall-warehouse/run" && stage === "planned" || route === "/tmall-warehouse/verify" && ["executed", "completed"].includes(stage)) return null;
  return { error: "tmall_warehouse_stage_mismatch" };
}
