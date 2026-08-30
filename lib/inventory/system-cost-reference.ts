import { getD1Database } from "@/lib/database/d1";
import { findLatestSystemCostSnapshot } from "@/lib/inventory/database";

/**
 * Resolve the current system-cost reference through the inventory domain.
 *
 * Inventory has not migrated in this sales cutover, so its repository remains
 * responsible for the D1 binding.  Sales callers receive only the immutable
 * batch/date/cost snapshot and never acquire or query a D1 connection.
 */
export function findLatestAuthoritativeSystemCostSnapshot() {
  return findLatestSystemCostSnapshot(getD1Database());
}
