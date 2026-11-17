import { TMALL_DIRECT_MASTER_ABANDON_ACTION, abandonTmallDirectMasterBatchContentMismatch } from "./tmall-direct-master-abandon";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
  return value;
}

async function main() {
  if (argument("--action") !== TMALL_DIRECT_MASTER_ABANDON_ACTION) {
    throw new Error(`仅支持 --action ${TMALL_DIRECT_MASTER_ABANDON_ACTION}`);
  }
  const storeKey = argument("--store-key");
  const reason = argument("--reason");
  if (!storeKey || !reason) throw new Error("必须提供 --store-key 与 --reason");
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  if (dryRun && confirmed) throw new Error("--dry-run 与 --confirm 不能同时使用");
  if (!dryRun && !confirmed) throw new Error("必须在操作者明确确认后传入 --confirm（或仅检查时传入 --dry-run）");
  const result = await abandonTmallDirectMasterBatchContentMismatch({
    storeKey, reason, operatorConfirmed: confirmed, dryRun, auditDirectory: argument("--audit-directory"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { reason?: string }).reason;
  process.stderr.write(`${JSON.stringify({ ok: false, ...(code ? { reason: code } : {}), error: message.replace(/[\r\n]+/g, " ").slice(0, 500) })}\n`);
  process.exitCode = 1;
});
