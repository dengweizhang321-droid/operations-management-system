import type { DiagnosticPeriod } from "./promotion-diagnostic-report";

// Add a platform nickname here only after its account-to-shop ownership is
// independently verified against the controlled JD store identity.
export const VERIFIED_PROMOTION_SOURCE_NICKNAMES: readonly string[] = [];

export function promotionSourceIdentityReady(...periods: DiagnosticPeriod[]): boolean {
  const accepted = new Set<string>(VERIFIED_PROMOTION_SOURCE_NICKNAMES);
  return periods.length > 0 && periods.every((period) => period.coverage.complete
    && period.sourceBatches.length === period.coverage.requestedDates.length
    && period.sourceBatches.every((batch) => batch.accountPresentRows === batch.rowCount
      && batch.accountNicknames.length === 1
      && accepted.has(batch.accountNicknames[0]!)));
}
