import { runClosureAdmin } from "./closure-adapters";

// Unified operator CLI for the controlled closure entries. Usage:
//   node --import tsx tools/closure-admin.ts --pipeline <name> --action <action> [--store-key k]
//     [--dry-run | --confirm --expect-sha256 <hex> --reason <text>] [--root <dir>] [--audit-directory <dir>]
// Must NOT be imported by the helper bundle closure.
runClosureAdmin(process.argv.slice(2)).then(({ exitCode, output }) => {
  (exitCode === 0 ? process.stdout : process.stderr).write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = exitCode;
});
