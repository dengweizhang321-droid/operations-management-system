import { abandonActiveTmallProductMasterAudit } from "./tmall-product-master-export";
import { reportAdminFailure, runAbandonAdmin } from "./tmall-admin-helper-probe";

// Usage: --action abandon-confirmed-export --store-key <k> (--dry-run | --confirm --expect-sha256 <hex> --reason <text>) [--audit-directory <dir>]
async function main() {
  const result = await runAbandonAdmin({
    argv: process.argv.slice(2),
    action: "abandon-confirmed-export",
    abandon: abandonActiveTmallProductMasterAudit,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(reportAdminFailure);
