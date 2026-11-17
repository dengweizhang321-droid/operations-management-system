import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RETRY_RESERVATION_ARCHIVE_ACTIONS,
  archiveRetryReservations,
  inspectRetryReservations,
  type RetryReservationArchiveAction,
} from "./retry-reservation-archive-core";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
  return value;
}

async function main() {
  const action = argument("--action") as RetryReservationArchiveAction | undefined;
  if (!action || !RETRY_RESERVATION_ARCHIVE_ACTIONS.includes(action)) {
    throw new Error(`--action 必须是 ${RETRY_RESERVATION_ARCHIVE_ACTIONS.join(" | ")}`);
  }
  const directory = path.resolve(argument("--directory")
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "outputs", "n8n-retry-dispatch"));
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  let result: unknown;
  if (action === "inspect") result = await inspectRetryReservations({ directory });
  else {
    const rawDays = argument("--older-than-days");
    result = await archiveRetryReservations({
      directory, dryRun, operatorConfirmed: confirmed, reason: argument("--reason"),
      olderThanDays: rawDays === undefined ? undefined : Number(rawDays),
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
