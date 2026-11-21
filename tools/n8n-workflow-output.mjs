import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Generators write to automation/n8n/ by default. N8N_WORKFLOW_OUT_DIR redirects
// the writes (inputs are still read from the repo) so tests can compare a fresh
// generation with the committed definitions without touching them.
export function n8nWorkflowOutputUrl(fileName) {
  const override = process.env.N8N_WORKFLOW_OUT_DIR;
  const directory = override ? pathToFileURL(resolve(override) + sep) : new URL("../automation/n8n/", import.meta.url);
  return new URL(fileName, directory);
}
