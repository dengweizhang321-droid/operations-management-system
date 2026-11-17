import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JD_MARKET_RANKING_ADMIN_ACTIONS,
  abandonRunningJdMarketPlan,
  inspectJdMarketPlans,
  type JdMarketRankingAdminAction,
} from "./jd-market-ranking-admin-core";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
  return value;
}

async function main() {
  const action = argument("--action") as JdMarketRankingAdminAction | undefined;
  if (!action || !JD_MARKET_RANKING_ADMIN_ACTIONS.includes(action)) {
    throw new Error(`--action 必须是 ${JD_MARKET_RANKING_ADMIN_ACTIONS.join(" | ")}`);
  }
  const planDirectory = path.resolve(argument("--plan-directory")
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "outputs", "jd-market-ranking-daily"));
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  let result: unknown;
  if (action === "inspect") result = await inspectJdMarketPlans({ planDirectory });
  else {
    result = await abandonRunningJdMarketPlan({
      planDirectory, runId: argument("--run-id"), reason: argument("--reason"), expectSha256: argument("--expect-sha256"),
      operatorConfirmed: confirmed, dryRun,
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { reason?: string }).reason;
  process.stderr.write(`${JSON.stringify({ ok: false, ...(code ? { reason: code } : {}), error: message.replace(/[\r\n]+/g, " ").slice(0, 500) })}\n`);
  process.exitCode = 1;
});
