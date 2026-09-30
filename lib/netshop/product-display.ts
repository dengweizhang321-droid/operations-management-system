/** Legacy product scalars alone do not prove field presence or complete days. */
type LegacySummary = { summary: { visitors: number; transactionAmount: number; transactionCustomers: number; uvValue: number | null; conversionRate: number | null }; summaryFieldAvailability?: Record<string, { complete: boolean; reasonCode: string | null }> };
export function productSummaryForDisplay(response: LegacySummary | null) {
  const complete = (...fields: string[]) => response !== null && fields.every(key => response.summaryFieldAvailability?.[key]?.complete === true);
  const summary = response?.summary;
  return {
    visitors: complete("visitors") ? summary!.visitors : null,
    transactionAmount: complete("transactionAmountCents") ? summary!.transactionAmount : null,
    averageTransactionValue: complete("transactionAmountCents", "transactionCustomers") && summary!.transactionCustomers > 0 ? summary!.transactionAmount/summary!.transactionCustomers : null,
    uvValue: complete("transactionAmountCents", "visitors") && summary!.visitors > 0 ? summary!.uvValue : null,
    conversionRate: complete("transactionCustomers", "visitors") && summary!.visitors > 0 ? summary!.conversionRate : null,
  };
}
