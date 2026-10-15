/** Lossless data decoding only. Inventory calculations stay in the producer's domain service. */
export type NumericSeries =
  | { kind: "constant"; value: number | null }
  | { kind: "phase-delta"; length: number; stride: number; phases: { first: number; runs: [number, number][] }[] };

export type HealthProjection = {
  inventoryHealthState: string; inventoryHealthReasons: string[]; healthCounts: Record<string, number>;
  hasStockout: boolean; hasReplenishmentNeed: boolean;
};
export type CyclePreview = HealthProjection & { quantity: number | null; days: number | null; cycles: number[]; reasons: string[] };
export type ArbitraryCycleData = {
  min: number; max: number; default: number;
  groups: Record<string, { quantitySeries: NumericSeries; reasons: string[]; hasMembers: boolean; healthEvents: { from: number; projection: HealthProjection }[] }>;
  masks: Record<string, { from: number; values: Record<string, string> }[]>;
};

export function validCycleDay(value: number, data?: Pick<ArbitraryCycleData, "min" | "max">): boolean {
  return Number.isSafeInteger(value) && value >= (data?.min ?? 1) && value <= (data?.max ?? 3650);
}

export function eventAt<T extends { from: number }>(events: readonly T[] | undefined, day: number): T | undefined {
  if (!events?.length) return undefined;
  let low = 0, high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (events[middle].from <= day) low = middle + 1; else high = middle;
  }
  return events[low - 1];
}

export function seriesAt(series: NumericSeries, index: number): number | null {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("离线数列索引无效");
  if (series.kind === "constant") {
    if (series.value !== null && !Number.isSafeInteger(series.value)) throw new Error("离线数列数值无效");
    return series.value;
  }
  if (index >= series.length || !Number.isSafeInteger(series.stride) || series.stride < 1) throw new Error("离线数列范围无效");
  const phase = series.phases[index % series.stride];
  if (!phase || !Number.isSafeInteger(phase.first)) throw new Error("离线数列缺少分段");
  let remaining = Math.floor(index / series.stride), value = phase.first;
  for (const [count, delta] of phase.runs) {
    if (!remaining) break;
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(delta)) throw new Error("离线数列编码无效");
    const used = Math.min(remaining, count); value += used * delta; remaining -= used;
    if (!Number.isSafeInteger(value)) throw new Error("离线数列超出精度范围");
  }
  if (remaining) throw new Error("离线数列长度不足");
  return value;
}

export function cyclePreviewAt(data: ArbitraryCycleData, key: string, day: number): CyclePreview | undefined {
  if (!validCycleDay(day, data)) return undefined;
  const group = data.groups[key], health = eventAt(group?.healthEvents, day)?.projection;
  if (!group || !health) return undefined;
  return { ...health, quantity: seriesAt(group.quantitySeries, day - data.min), days: group.hasMembers ? day : null, cycles: group.hasMembers ? [day] : [], reasons: group.reasons };
}
