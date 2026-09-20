export type RangeBounds = { low: number | null; high: number | null };

export type MarketEstimateInput = {
  id: string | number;
  category: string;
  periodStart: string;
  periodEnd: string;
  scope: string;
  priceBandFilter?: string;
  rankingDimension?: string;
  rank: number | null;
  gmvMidCents: number;
  gmvLowCents?: number | null;
  gmvHighCents?: number | null;
  realGmvCents?: number | null;
  priceMidCents?: number | null;
  priceLowCents?: number | null;
  priceHighCents?: number | null;
  quantityMid?: number | null;
  quantityLow?: number | null;
  quantityHigh?: number | null;
  visitorsMid?: number | null;
  conversionLowBps?: number | null;
  conversionHighBps?: number | null;
};

export type MarketEstimate = MarketEstimateInput & {
  effectiveGmvCents: number;
  estimatedQuantity: number;
  averageTransactionPriceCents: number | null;
  conversionBps: number | null;
  gmvOutOfBand: boolean;
  isRealAnchor: boolean;
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value: number | null | undefined) => finite(value) ? Math.max(0, value) : null;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function groupKey(row: MarketEstimateInput) {
  return [row.category, row.periodStart, row.periodEnd, row.scope, row.priceBandFilter?.trim() || "全部", row.rankingDimension || "SKU"].join("\u0000");
}

function normalizedBounds(low: number | null | undefined, high: number | null | undefined): [number, number] {
  const normalizedLow = nonNegative(low);
  const normalizedHigh = nonNegative(high);
  if (normalizedLow === null && normalizedHigh === null) return [0, Number.POSITIVE_INFINITY];
  if (normalizedLow === null) return [0, normalizedHigh!];
  if (normalizedHigh === null) return [normalizedLow, Number.POSITIVE_INFINITY];
  return [Math.min(normalizedLow, normalizedHigh), Math.max(normalizedLow, normalizedHigh)];
}

function boundedMidpoint(low: number, high: number, fallback: number) {
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  return Math.max(low, fallback);
}

function refine(row: MarketEstimateInput, effectiveGmvCents: number, outOfBand: boolean, isAnchor: boolean): MarketEstimate {
  const rangePrice = nonNegative(row.priceMidCents);
  const quantityMid = nonNegative(row.quantityMid);
  const ratioPrice = quantityMid && quantityMid > 0 ? effectiveGmvCents / quantityMid : null;
  const price0 = (rangePrice && rangePrice > 0 ? rangePrice : null)
    ?? (ratioPrice && ratioPrice > 0 ? ratioPrice : null);
  let quantity = price0 && price0 > 0
    ? Math.max(1, Math.round(effectiveGmvCents / price0))
    : Math.max(1, Math.round(quantityMid ?? 1));
  if (!outOfBand) {
    const [quantityLow, quantityHigh] = normalizedBounds(row.quantityLow, row.quantityHigh);
    quantity = Math.max(1, Math.round(clamp(quantity, quantityLow, quantityHigh)));
  }
  let averagePrice = quantity > 0 ? effectiveGmvCents / quantity : null;
  if (averagePrice !== null && !outOfBand) {
    const [priceLow, priceHigh] = normalizedBounds(row.priceLowCents, row.priceHighCents);
    averagePrice = clamp(averagePrice, priceLow, priceHigh);
  }
  const visitors = nonNegative(row.visitorsMid);
  let conversionBps = visitors && visitors > 0 ? Math.round(quantity / visitors * 10_000) : null;
  if (conversionBps !== null) {
    if (!outOfBand) {
      const low = nonNegative(row.conversionLowBps) ?? 0;
      const high = nonNegative(row.conversionHighBps) ?? 10_000;
      conversionBps = Math.round(clamp(conversionBps, Math.min(low, high), Math.max(low, high)));
    }
    conversionBps = Math.min(10_000, Math.max(0, conversionBps));
  }
  return {
    ...row,
    effectiveGmvCents: Math.max(0, Math.round(effectiveGmvCents)),
    estimatedQuantity: quantity,
    averageTransactionPriceCents: averagePrice === null ? null : Math.max(0, Math.round(averagePrice)),
    conversionBps,
    gmvOutOfBand: outOfBand,
    isRealAnchor: isAnchor,
  };
}

/**
 * Applies JD ranking monotonicity and own-SKU real-GMV anchors without mutating
 * the imported midpoint facts. Results are intentionally returned in memory.
 */
export function annotateRankBounds(rows: MarketEstimateInput[]): MarketEstimate[] {
  const groups = new Map<string, MarketEstimateInput[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const result = new Map<MarketEstimateInput["id"], MarketEstimate>();
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => {
      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || String(left.id).localeCompare(String(right.id));
    });
    const working = ordered.map((row) => {
      const real = nonNegative(row.realGmvCents);
      const isAnchor = real !== null && real > 0;
      const [rawLow, rawHigh] = normalizedBounds(row.gmvLowCents, row.gmvHighCents);
      return {
        row,
        isAnchor,
        real,
        rawLow,
        rawHigh,
        low: isAnchor ? real! : rawLow,
        high: isAnchor ? real! : rawHigh,
        outOfBand: isAnchor && (real! < rawLow || real! > rawHigh),
      };
    });
    for (let index = 1; index < working.length; index += 1) {
      working[index]!.high = Math.min(working[index]!.high, working[index - 1]!.high);
    }
    for (let index = working.length - 2; index >= 0; index -= 1) {
      working[index]!.low = Math.max(working[index]!.low, working[index + 1]!.low);
    }
    let previousEffective = Number.POSITIVE_INFINITY;
    for (let index = 0; index < working.length; index += 1) {
      const current = working[index]!;
      let effective: number;
      if (current.isAnchor) effective = current.real!;
      else {
        let left = index - 1;
        while (left >= 0 && !working[left]!.isAnchor) left -= 1;
        let right = index + 1;
        while (right < working.length && !working[right]!.isAnchor) right += 1;
        if (left >= 0 && right < working.length && current.row.rank !== null && working[left]!.row.rank !== null && working[right]!.row.rank !== null) {
          const leftRank = working[left]!.row.rank!;
          const rightRank = working[right]!.row.rank!;
          const position = rightRank === leftRank ? 0 : clamp((current.row.rank - leftRank) / (rightRank - leftRank), 0, 1);
          const leftValue = Math.max(1, working[left]!.real!);
          const rightValue = Math.max(1, working[right]!.real!);
          effective = Math.exp(Math.log(leftValue) + position * (Math.log(rightValue) - Math.log(leftValue)));
        } else effective = boundedMidpoint(current.low, current.high, current.row.gmvMidCents);
        const feasibleLow = Math.min(current.low, current.high);
        const feasibleHigh = Math.max(current.low, current.high);
        effective = clamp(effective, feasibleLow, feasibleHigh);
        effective = Math.min(effective, previousEffective);
      }
      previousEffective = effective;
      result.set(current.row.id, refine(current.row, effective, current.outOfBand, current.isAnchor));
    }
  }
  return rows.map((row) => result.get(row.id)!);
}

export function aggregateMarketEstimates(rows: MarketEstimate[], periods = 1) {
  const effectiveGmvCents = rows.reduce((sum, row) => sum + row.effectiveGmvCents, 0);
  const quantity = rows.reduce((sum, row) => sum + row.estimatedQuantity, 0);
  return {
    periods: Math.max(1, Math.trunc(periods)),
    effectiveGmvCents,
    quantity,
    averageTransactionPriceCents: quantity > 0 ? Math.round(effectiveGmvCents / quantity) : null,
  };
}
