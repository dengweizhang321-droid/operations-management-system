type PromotionDay = { date: string; spendCents: number; netTransactionAmountCents: number; platformPaymentAmountCents: number | null; clicks: number; spendRate: number | null; promotionTransactionShare: number | null };
/** A null daily fee cannot be turned back into a primary aggregate ratio. */
export function mergePromotionDisplayRows<T extends { key: string }>(rows: T[], daily: PromotionDay[], keyForDate: (date: string) => string, completeScope: boolean) {
  const buckets = new Map<string, { spend: number; net: number; payment: number; clicks: number; complete: boolean }>();
  for (const item of daily) {
    const key = keyForDate(item.date), b = buckets.get(key) ?? { spend: 0, net: 0, payment: 0, clicks: 0, complete: completeScope };
    b.spend += item.spendCents; b.net += item.netTransactionAmountCents; b.clicks += item.clicks;
    b.complete = b.complete && item.platformPaymentAmountCents !== null && item.spendRate !== null && item.promotionTransactionShare !== null;
    if (item.platformPaymentAmountCents !== null) b.payment += item.platformPaymentAmountCents;
    buckets.set(key, b);
  }
  return rows.map(row => {
    const b = buckets.get(row.key); if (!b) return row;
    return { ...row, promotionSpendCents: b.spend, promotionNetTransactionCents: b.net, platformPaymentCents: b.complete ? b.payment : undefined, promotionClicks: b.clicks,
      promotionSpendRate: b.complete && b.payment > 0 ? b.spend/b.payment : null, promotionTransactionShare: b.complete && b.payment > 0 ? b.net/b.payment : null };
  });
}
