/**
 * Operator-only shared support for the Tmall audit abandon CLIs
 * (tmall-pagewise-audit-admin.ts, tmall-product-master-admin.ts).
 * Deliberately NOT imported by the helper bundle closure and uses no module-URL metadata.
 */
export class TmallAdminRefusal extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}
function refuse(reason: string, message: string): never { throw new TmallAdminRefusal(reason, message); }

/** Best-effort guard against a running helper slot for this store: GET /health only (read-only). */
export async function probeHelperIdleForStore(storeKey: string, fetcher: typeof fetch = fetch, port = 5791) {
  let response: Response;
  try {
    response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return "helper_not_running" as const;
    refuse("helper_probe_failed", `无法确认 helper 是否空闲（${code ?? (error as Error).message}），拒绝作废`);
  }
  if (!response.ok) refuse("helper_probe_failed", `helper /health 返回 HTTP ${response.status}，拒绝作废`);
  let health: { storeExecutions?: Array<{ storeKey?: string | null; workflow?: string }> };
  try {
    health = await response.json() as typeof health;
  } catch {
    refuse("helper_probe_failed", "helper /health 响应不是有效 JSON，无法确认空闲");
  }
  const executions = Array.isArray(health?.storeExecutions) ? health.storeExecutions : null;
  if (!executions) refuse("helper_probe_failed", "helper /health 未返回 storeExecutions，无法确认空闲");
  if (executions.some(slot => slot?.workflow === "tmall" && slot.storeKey === storeKey)) {
    refuse("helper_store_active", `helper 正在运行 ${storeKey} 的天猫执行，拒绝作废`);
  }
  return "helper_store_idle" as const;
}

export type AbandonCliArgs =
  | { mode: "dry-run"; storeKey: string; reason?: string; auditDirectory?: string }
  | { mode: "confirm"; storeKey: string; reason: string; expectSha256: string; auditDirectory?: string };

const valueFlags = new Set(["--action", "--store-key", "--reason", "--expect-sha256", "--audit-directory"]);
const boolFlags = new Set(["--dry-run", "--confirm"]);

export function parseAbandonArgs(argv: readonly string[], expectedAction: string): AbandonCliArgs {
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (boolFlags.has(flag)) { bools.add(flag); continue; }
    if (!valueFlags.has(flag)) refuse("bad_arguments", `未知参数 ${flag}`);
    if (values.has(flag)) refuse("bad_arguments", `${flag} 重复出现`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) refuse("bad_arguments", `${flag} 缺少参数值`);
    values.set(flag, value);
    i += 1;
  }
  if (values.get("--action") !== expectedAction) refuse("bad_arguments", `仅支持 --action ${expectedAction}`);
  const storeKey = values.get("--store-key");
  if (!storeKey) refuse("bad_arguments", "必须提供 --store-key");
  const dryRun = bools.has("--dry-run");
  const confirm = bools.has("--confirm");
  if (dryRun === confirm) refuse("bad_arguments", "必须且只能选择 --dry-run 或 --confirm 之一");
  const auditDirectory = values.get("--audit-directory");
  const reason = values.get("--reason");
  const expectSha256 = values.get("--expect-sha256");
  if (dryRun) {
    if (expectSha256 !== undefined) refuse("bad_arguments", "--dry-run 不接受 --expect-sha256");
    return { mode: "dry-run", storeKey, reason, auditDirectory };
  }
  if (!expectSha256 || !/^[a-f0-9]{64}$/.test(expectSha256)) refuse("bad_arguments", "--confirm 必须提供 dry-run 输出的 64 位小写十六进制 --expect-sha256");
  const normalized = (reason ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length < 4 || normalized.length > 300) refuse("bad_arguments", "--confirm 必须提供 4 至 300 个字符的 --reason");
  return { mode: "confirm", storeKey, reason: normalized, expectSha256, auditDirectory };
}

export type AbandonFn = (options: {
  storeKey: string; reason: string; operatorConfirmed: boolean; auditDirectory?: string; dryRun?: boolean; expectSha256?: string;
}) => Promise<unknown>;

/** Shared CLI body: parse, (confirm only) probe helper idle, then call the abandon function. */
export async function runAbandonAdmin(input: {
  argv: readonly string[];
  action: string;
  abandon: AbandonFn;
  probe?: (storeKey: string) => Promise<unknown>;
}) {
  const args = parseAbandonArgs(input.argv, input.action);
  if (args.mode === "dry-run") {
    return input.abandon({
      storeKey: args.storeKey, reason: args.reason ?? "", operatorConfirmed: false, dryRun: true, auditDirectory: args.auditDirectory,
    });
  }
  await (input.probe ?? ((key: string) => probeHelperIdleForStore(key)))(args.storeKey);
  return input.abandon({
    storeKey: args.storeKey, reason: args.reason, operatorConfirmed: true, expectSha256: args.expectSha256, auditDirectory: args.auditDirectory,
  });
}

export function reportAdminFailure(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);
  const reason = (error as { reason?: unknown })?.reason;
  process.stderr.write(`${JSON.stringify({ ok: false, reason: typeof reason === "string" ? reason : "error", error: message })}\n`);
  process.exitCode = 1;
}
