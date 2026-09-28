// Offline, create-only review bundle. This command cannot call n8n or publish.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMaintenanceCoordination } from "./n8n-maintenance-coordination.mjs";
import { buildHourlyRetryErrorWorkflow, hourlyRetryTargets } from "./n8n-hourly-retry-policy.mjs";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Provide an absolute new output directory");
const protectedDirectory = path.join(sourceRoot, "automation");
if (path.resolve(output).toLowerCase().startsWith(protectedDirectory.toLowerCase() + path.sep)
  || path.resolve(output).toLowerCase() === protectedDirectory.toLowerCase()) throw new Error("Cannot overwrite source workflow definitions");
await mkdir(output, { recursive: false });
const sha = value => createHash("sha256").update(value).digest("hex");
const files = [];
for (const target of hourlyRetryTargets) {
  const source = await readFile(path.join(sourceRoot, "automation/n8n", target.fileName), "utf8");
  const candidate = withMaintenanceCoordination(JSON.parse(source));
  if (candidate.id !== target.workflowId || candidate.active !== false) throw new Error("Unreviewed source identity or active template");
  const raw = JSON.stringify(candidate, null, 2) + "\n";
  await writeFile(path.join(output, target.fileName), raw, { flag: "wx" });
  files.push({ workflowId: target.workflowId, fileName: target.fileName, sourceSha256: sha(source), candidateSha256: sha(raw) });
}
const errors = buildHourlyRetryErrorWorkflow();
const raw = JSON.stringify(errors, null, 2) + "\n";
await writeFile(path.join(output, "data-import-hourly-safe-retry.workflow.json"), raw, { flag: "wx" });
files.push({ workflowId: errors.id, fileName: "data-import-hourly-safe-retry.workflow.json", candidateSha256: sha(raw) });
const manifest = { version: "maintenance-coordination-review-bundle-v2", generatedAt: new Date().toISOString(), published: false, files };
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, workflowCount: files.length, published: false }));
