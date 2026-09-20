import { createHash } from "node:crypto";

export const annotationJobStatuses = ["queued", "running", "review_ready", "committing", "committed", "failed", "cancelled"] as const;
export type AnnotationJobStatus = (typeof annotationJobStatuses)[number];
export const annotationItemStatuses = ["queued", "claimed", "inferencing", "review_pending", "approved", "rejected", "committed", "failed"] as const;
export type AnnotationItemStatus = (typeof annotationItemStatuses)[number];
export type AnnotationExecutor = "cloud" | "local";

const jobTransitions: Record<AnnotationJobStatus, readonly AnnotationJobStatus[]> = {
  queued: ["running", "cancelled"], running: ["review_ready", "failed", "cancelled"], review_ready: ["committing", "cancelled"],
  committing: ["committed", "review_ready", "failed"], committed: [], failed: ["queued", "cancelled"], cancelled: ["queued"],
};
const itemTransitions: Record<AnnotationItemStatus, readonly AnnotationItemStatus[]> = {
  queued: ["claimed", "failed"], claimed: ["inferencing", "queued", "failed"], inferencing: ["review_pending", "failed"],
  review_pending: ["approved", "rejected", "failed"], approved: ["review_pending", "committed", "rejected"], rejected: ["review_pending"], committed: [], failed: ["queued", "claimed"],
};

export function canTransitionJob(from: AnnotationJobStatus, to: AnnotationJobStatus) { return jobTransitions[from].includes(to); }
export function canTransitionItem(from: AnnotationItemStatus, to: AnnotationItemStatus) { return itemTransitions[from].includes(to); }

export function normalizeSegments(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("细分品类必须是数组");
  const segments = [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
  if (segments.length < 2 || segments.length > 80) throw new Error("细分品类数量必须在 2 到 80 之间");
  if (segments.some((item) => item.length > 40)) throw new Error("细分品类名称不能超过 40 个字符");
  return segments;
}

export function normalizeImagePriceCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100_000_000) throw new Error("主图价格必须是 0 到 100 万元之间的整数分");
  return number;
}

export function normalizeImagePriceYuan(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error("主图价格必须是 0 到 100 万元之间的数字");
  return Math.round(number * 100);
}

export const marketAiPriceTypes = ["标准售价", "到手价", "券后价", "起售价", "价格区间", "定金", "分期金额", "最低规格价格", "无法判断"] as const;
export type MarketAiPriceType = (typeof marketAiPriceTypes)[number];

function normalizePriceType(value: unknown): MarketAiPriceType {
  const text = typeof value === "string" ? value.trim() : "";
  if ((marketAiPriceTypes as readonly string[]).includes(text)) return text as MarketAiPriceType;
  return "无法判断";
}

export type VisionAnnotation = {
  segment: string;
  imagePriceCents: number | null;
  priceLowCents: number | null;
  priceHighCents: number | null;
  priceType: MarketAiPriceType;
  confidenceBps: number;
  reason: string;
  rawText: string;
};

export function parseVisionAnnotation(value: unknown, segments: readonly string[]): VisionAnnotation {
  const rawText = typeof value === "string" ? value.trim() : JSON.stringify(value);
  let parsed: unknown = value;
  if (typeof value === "string") {
    const unfenced = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try { parsed = JSON.parse(unfenced); } catch { throw new Error("视觉模型没有返回有效 JSON"); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("视觉模型结果必须是 JSON 对象");
  const record = parsed as Record<string, unknown>;
  const segment = typeof record.segment === "string" ? record.segment.trim() : "";
  if (!segments.includes(segment)) throw new Error(`视觉模型返回了品类枚举之外的结果：${segment || "空"}`);
  const imagePriceCents = record.image_price_yuan !== undefined || record.imagePriceYuan !== undefined
    ? normalizeImagePriceYuan(record.image_price_yuan ?? record.imagePriceYuan)
    : normalizeImagePriceCents(record.image_price_cents ?? record.imagePriceCents);
  const priceLowCents = record.price_low_yuan !== undefined || record.priceLowYuan !== undefined
    ? normalizeImagePriceYuan(record.price_low_yuan ?? record.priceLowYuan)
    : normalizeImagePriceCents(record.price_low_cents ?? record.priceLowCents);
  const priceHighCents = record.price_high_yuan !== undefined || record.priceHighYuan !== undefined
    ? normalizeImagePriceYuan(record.price_high_yuan ?? record.priceHighYuan)
    : normalizeImagePriceCents(record.price_high_cents ?? record.priceHighCents);
  const priceType = normalizePriceType(record.price_type ?? record.priceType);
  const confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("视觉模型 confidence 必须在 0 到 1 之间");
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 600) : "";
  return { segment, imagePriceCents, priceLowCents, priceHighCents, priceType, confidenceBps: Math.round(confidence * 10_000), reason, rawText };
}

export type ValidationMetricInput = { goldSegment: string; predictedSegment: string; goldImagePriceCents: number | null; predictedImagePriceCents: number | null };

export function validationMetrics(rows: readonly ValidationMetricInput[]) {
  const labels = [...new Set(rows.map((row) => row.goldSegment))].sort();
  const perClass = labels.map((label) => {
    const classRows = rows.filter((row) => row.goldSegment === label);
    const correct = classRows.filter((row) => row.predictedSegment === label).length;
    return { label, total: classRows.length, correct, accuracyBps: classRows.length ? Math.round(correct / classRows.length * 10_000) : 0 };
  });
  const correct = rows.filter((row) => row.goldSegment === row.predictedSegment).length;
  const failed = rows.filter((row) => !row.predictedSegment).length;
  const priceGoldRows = rows.filter((row) => row.goldImagePriceCents !== null);
  const priceRows = rows.filter((row) => row.goldImagePriceCents !== null && row.predictedImagePriceCents !== null);
  const priceMaeCents = priceRows.length ? Math.round(priceRows.reduce((sum, row) => sum + Math.abs((row.goldImagePriceCents ?? 0) - (row.predictedImagePriceCents ?? 0)), 0) / priceRows.length) : null;
  return {
    sampleCount: rows.length, correctCount: correct, failureCount: failed,
    failureRateBps: rows.length ? Math.round(failed / rows.length * 10_000) : 10_000,
    accuracyBps: rows.length ? Math.round(correct / rows.length * 10_000) : 0,
    macroAccuracyBps: perClass.length ? Math.round(perClass.reduce((sum, item) => sum + item.accuracyBps, 0) / perClass.length) : 0,
    priceGoldCount: priceGoldRows.length, priceComparedCount: priceRows.length,
    priceCoverageBps: priceGoldRows.length ? Math.round(priceRows.length / priceGoldRows.length * 10_000) : 0,
    priceMaeCents, perClass,
  };
}

export function activationGate(baseline: ReturnType<typeof validationMetrics> | null, candidate: ReturnType<typeof validationMetrics>, minimumSamples = 50) {
  const reasons: string[] = [];
  if (candidate.sampleCount < minimumSamples) reasons.push(`冻结样本不足 ${minimumSamples} 条`);
  if (candidate.accuracyBps < 8_000) reasons.push("整体准确率低于 80%");
  if (candidate.macroAccuracyBps < 7_000) reasons.push("宏平均准确率低于 70%");
  if (candidate.failureRateBps > 500) reasons.push("推理失败率高于 5%");
  if (candidate.priceGoldCount === 0) reasons.push("冻结样本缺少价格金标");
  else {
    if (candidate.priceCoverageBps < 8_000) reasons.push("价格识别覆盖率低于 80%");
    if (candidate.priceMaeCents === null || candidate.priceMaeCents > 2_000) reasons.push("价格 MAE 高于 20 元");
  }
  if (baseline && candidate.accuracyBps < baseline.accuracyBps) reasons.push("整体准确率退化");
  if (baseline && candidate.macroAccuracyBps < baseline.macroAccuracyBps) reasons.push("类别宏平均准确率退化");
  if (baseline && candidate.failureRateBps > baseline.failureRateBps) reasons.push("推理失败率退化");
  if (baseline && candidate.priceCoverageBps < baseline.priceCoverageBps) reasons.push("价格识别覆盖率退化");
  if (baseline && baseline.priceMaeCents !== null && (candidate.priceMaeCents === null || candidate.priceMaeCents > baseline.priceMaeCents)) reasons.push("价格 MAE 退化");
  if (baseline) {
    const before = new Map(baseline.perClass.map((item) => [item.label, item.accuracyBps]));
    for (const item of candidate.perClass) if (item.total >= 3 && item.accuracyBps < (before.get(item.label) ?? 0)) reasons.push(`关键品类“${item.label}”退化`);
  }
  return { passed: reasons.length === 0, reasons };
}

export function stableStratifiedSample<T extends { id: string; goldSegment: string }>(rows: readonly T[], count: number, seed: string): T[] {
  const target = Math.max(1, Math.min(500, Math.trunc(count)));
  const ranked = [...rows].sort((a, b) => score(`${seed}:${a.goldSegment}:${a.id}`).localeCompare(score(`${seed}:${b.goldSegment}:${b.id}`)));
  const groups = new Map<string, T[]>();
  for (const row of ranked) groups.set(row.goldSegment, [...(groups.get(row.goldSegment) ?? []), row]);
  const selected: T[] = [];
  while (selected.length < target) {
    let added = false;
    for (const label of [...groups.keys()].sort()) {
      const row = groups.get(label)?.shift();
      if (row) { selected.push(row); added = true; if (selected.length === target) break; }
    }
    if (!added) break;
  }
  return selected;
}

export function digest(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }

function score(value: string) { return digest(value); }
