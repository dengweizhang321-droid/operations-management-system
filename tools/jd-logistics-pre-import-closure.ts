// Operator CLI for the manual pre-import closure. Must NOT be imported by any file in the helper bundle closure:
// it uses import.meta, which tools/build-worker-helper.mjs rejects outside reviewed entries. The reusable logic lives
// in jd-logistics-zero-effect-closure.ts, which the helper already carries.
//
//   inspect <absolute-root>
//   close   <absolute-root> --dry-run [--expect-sha256 <hex>] [--reason <text>]
//   close   <absolute-root> --confirm --expect-sha256 <active.json sha256> --reason "<text>"
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertConfirmMode, ClosureRefusal, readControlFile, sha256 } from "../lib/closure/kernel";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { logisticsHash } from "../lib/jd/logistics-policy";
import { closeJdLogisticsPreImportPlan, inspectJdLogisticsPreImport, planJdLogisticsPreImportClose, ZeroEffectRefusal, type ZeroEffectLock } from "./jd-logistics-zero-effect-closure";

export type PreImportCliDependencies = {
  withLock?: <T>(root: string, operation: (lock: ZeroEffectLock) => Promise<T>) => Promise<T>;
  now?: () => Date;
};
const usage = "usage: jd-logistics-pre-import-closure.ts inspect <absolute-root> | close <absolute-root> (--dry-run | --confirm --expect-sha256 <hex> --reason <text>)";

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new ClosureRefusal("option_value_missing", `${name} 缺少参数值`);
  return value;
}
const defaultWithLock: NonNullable<PreImportCliDependencies["withLock"]> = (root, operation) => withJackyunRunLock({
  runId: `jdl-plan-${logisticsHash(`manual-pre-import-${Date.now()}`).slice(0, 24)}`, purpose: "jd-logistics-pre-import-closure",
  lockDirectory: path.join(root, "outputs", "jd-logistics-pipeline", "pipeline.lock") }, operation);

/** Returns the process result instead of exiting so the whole command surface is testable. */
export async function runJdLogisticsPreImportCli(argv: string[], dependencies: PreImportCliDependencies = {}) {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  try {
    const [command, root, ...rest] = argv;
    if (!root || !path.isAbsolute(root)) return { code: 2, out: "", err: `${usage}\n` };
    if (command === "inspect" && !rest.length) {
      const result = await inspectJdLogisticsPreImport(root);
      const activeSha256 = result.active ? sha256((await readControlFile(path.join(root, "outputs", "jd-logistics-pipeline", "active.json"), 4 * 1024 * 1024, reason => { throw new ZeroEffectRefusal(reason); }))!) : undefined;
      return { code: 0, out: json({ ...result, ...(activeSha256 ? { activeSha256 } : {}) }), err: "" };
    }
    if (command !== "close") return { code: 2, out: "", err: `${usage}\n` };
    const known = new Set(["--dry-run", "--confirm", "--expect-sha256", "--reason"]);
    if (rest.some(item => item.startsWith("--") && !known.has(item))) return { code: 2, out: "", err: `${usage}\n` };
    const dryRun = rest.includes("--dry-run"), confirmed = rest.includes("--confirm");
    const supplied = option(rest, "--expect-sha256");
    const mode = assertConfirmMode({ dryRun, confirmed, expectSha256: supplied, reason: option(rest, "--reason") });
    if (mode.mode === "dry-run") {
      const live = await readControlFile(path.join(root, "outputs", "jd-logistics-pipeline", "active.json"), 4 * 1024 * 1024, reason => { throw new ZeroEffectRefusal(reason); });
      const expectSha256 = supplied ?? (live ? sha256(live) : "");
      return { code: 0, out: json({ ok: true, mode: "dry-run", ...(await planJdLogisticsPreImportClose(root, { expectSha256, reason: mode.reason })) }), err: "" };
    }
    const result = await (dependencies.withLock ?? defaultWithLock)(root, lock =>
      closeJdLogisticsPreImportPlan(root, { expectSha256: mode.expectSha256, reason: mode.reason }, lock, dependencies.now?.() ?? new Date()));
    return { code: 0, out: json({ ok: true, mode: "confirm", ...result }), err: "" };
  } catch (error) {
    const reason = error instanceof ZeroEffectRefusal || error instanceof ClosureRefusal ? error.reason : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, out: "", err: `${JSON.stringify({ ok: false, ...(reason ? { reason } : {}), error: message.replace(/[\r\n]+/g, " ").slice(0, 500) })}\n` };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  runJdLogisticsPreImportCli(process.argv.slice(2)).then(result => {
    process.stdout.write(result.out); process.stderr.write(result.err); process.exitCode = result.code;
  });
}
