import assert from "node:assert/strict";
import type { AiToolEntry } from "../../lib/ai/tool-registry-contract";

/** Keep historical fixture bytes while checking the two reviewed integration changes.
 * Production catalogs and policy digests must always use the unprojected registry.
 */
export function preIntegrationCatalog(entries: AiToolEntry[]): AiToolEntry[] {
  return entries.filter(entry => entry.name !== "get_jd_promotion_diagnostic")
    .map(entry => {
      if (entry.name !== "describe_system_datasets") return entry;
      assert.equal(entry.execution.maxCallsPerRequest, 24,
        "Only the reviewed 4 -> 24 dataset discovery limit may be projected");
      return { ...entry, execution: { ...entry.execution, maxCallsPerRequest: 4 } };
    });
}
