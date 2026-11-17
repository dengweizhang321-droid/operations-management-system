import { abandonInvalidDownloadedTmallPagewiseAudit } from "./tmall-pagewise-product-master-export";
import { reportAdminFailure, runAbandonAdmin } from "./tmall-admin-helper-probe";

// Usage: --action abandon-invalid-downloaded --store-key <k> (--dry-run | --confirm --expect-sha256 <hex> --reason <text>)
async function main() {
  const result = await runAbandonAdmin({
    argv: process.argv.slice(2),
    action: "abandon-invalid-downloaded",
    abandon: abandonInvalidDownloadedTmallPagewiseAudit,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(reportAdminFailure);
