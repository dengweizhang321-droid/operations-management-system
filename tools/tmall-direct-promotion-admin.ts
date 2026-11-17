import {
  TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS,
  abandonExpiredPromotion,
  inspectPromotionAudit,
  probePromotionAudit,
  resolveSubmittingPromotion,
  type PromotionAdminAction,
} from "./tmall-direct-promotion-admin-core";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
  return value;
}

async function main() {
  const action = argument("--action") as PromotionAdminAction | undefined;
  if (!action || !TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS.includes(action)) {
    throw new Error(`--action 必须是 ${TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS.join(" | ")}`);
  }
  const storeKey = argument("--store-key");
  if (!storeKey) throw new Error("必须提供 --store-key");
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  if (dryRun && confirmed) throw new Error("--dry-run 与 --confirm 不能同时使用");
  const options = {
    storeKey, reason: argument("--reason"), expectSha256: argument("--expect-sha256"),
    operatorConfirmed: confirmed, dryRun, auditDirectory: argument("--audit-directory"),
  };
  let result: unknown;
  if (action === "inspect") result = await inspectPromotionAudit(options);
  else if (action === "probe") result = await probePromotionAudit(options);
  else {
    if (!dryRun && !confirmed) throw new Error("必须在操作者明确确认后传入 --confirm（或仅检查时传入 --dry-run）");
    result = action === "resolve-submitting" ? await resolveSubmittingPromotion(options) : await abandonExpiredPromotion(options);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { reason?: string }).reason;
  process.stderr.write(`${JSON.stringify({ ok: false, ...(code ? { reason: code } : {}), error: message.replace(/[\r\n]+/g, " ").slice(0, 500) })}\n`);
  process.exitCode = 1;
});
