// Read-only operator CLI. Must NOT be imported by any file in the helper bundle closure:
// it uses import.meta, which tools/build-worker-helper.mjs rejects outside reviewed entries.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectJdLogisticsZeroEffect } from "./jd-logistics-zero-effect-closure";

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [command, root] = process.argv.slice(2);
  if (command !== "inspect" || !root || process.argv.length !== 4) { console.error("usage: jd-logistics-zero-effect-inspect.ts inspect <absolute-root>"); process.exitCode = 2; }
  else inspectJdLogisticsZeroEffect(root).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : "JD_LOGISTICS_ZERO_EFFECT_INSPECT_FAILED"); process.exitCode = 1; });
}
