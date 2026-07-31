export function marketRankingPricePresentation(input: {
  officialMarketPriceCents: number | null;
  calculatedAverageTransactionPriceCents: number | null;
  calculatedDiscountBps: number | null;
  calculatedDiscountReference: boolean;
}) {
  if (input.officialMarketPriceCents !== null) {
    return {
      averageTransactionPriceCents: input.officialMarketPriceCents,
      discountBps: 0,
      discountReference: false,
    };
  }
  return {
    averageTransactionPriceCents: input.calculatedAverageTransactionPriceCents,
    discountBps: input.calculatedDiscountBps,
    discountReference: input.calculatedDiscountReference,
  };
}
