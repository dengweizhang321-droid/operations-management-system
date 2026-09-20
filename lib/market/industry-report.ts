export const COMMERCIAL_DIRECT_DRINKING_PROFILE = {
  category: "商用净饮水设备",
  coreSubcategories: [
    "商用直饮机",
    "净饮一体机",
    "校园饮水机",
    "工厂饮水机",
    "幼儿园饮水机",
    "商用管线机",
  ],
  adjacentSubcategories: ["桶装水饮水机", "商用咖啡机", "商用饮料机", "滤芯及饮水配件", "其他"],
  adjacentCategories: ["商用净水设备", "商用开水器蒸气奶泡机"],
} as const;

export type IndustryTrendPoint = {
  period: string;
  gmvCents: number;
  quantity: number;
  visitors: number;
  productCount: number;
  brandCount: number;
};

export type IndustryLifecyclePoint = {
  period: string;
  entryCount: number | null;
  exitCount: number | null;
};

export type IndustryMonthlyDimensionPoint = {
  period: string;
  value: string;
  gmvCents: number;
  quantity: number;
  skuCount: number;
};

export type IndustryOpportunityCellInput = {
  subcategory: string;
  priceBand: string;
  gmvCents: number;
  quantity: number;
  skuCount: number;
  visitors: number;
  conversionBps: number | null;
  selfGmvCents: number;
  brandCount: number;
  latestGmvCents: number;
  previousGmvCents: number;
  pendingPriceCount: number;
};

export type IndustryProductSignalInput = {
  category: string;
  scope: string;
  rankingDimension: string;
  skuCode: string;
  productName: string;
  subcategory: string;
  periodEnd: string;
  gmvCents: number;
  quantity: number;
  visitors: number;
  conversionBps: number | null;
};

export type IndustryTrafficQuadrantInput = {
  quadrant: "high_traffic_high_conversion" | "high_traffic_low_conversion" | "low_traffic_high_conversion" | "low_traffic_low_conversion";
  productCount: number;
  gmvCents: number;
  quantity: number;
  visitors: number;
  conversionBps: number | null;
  visitorThreshold: number;
  conversionThresholdBps: number;
};

export function marketGrowthBps(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round((current - previous) / previous * 10_000);
}

function shiftMonth(period: string, offset: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildIndustryPeriodHighlights(
  trend: IndustryTrendPoint[],
  lifecycle: IndustryLifecyclePoint[],
) {
  const ordered = [...trend].sort((left, right) => left.period.localeCompare(right.period));
  const latest = ordered.at(-1) ?? null;
  const previous = latest ? ordered.find((row) => row.period === shiftMonth(latest.period, -1)) ?? null : null;
  const yearAgo = latest ? ordered.find((row) => row.period === shiftMonth(latest.period, -12)) ?? null : null;
  const peak = ordered.reduce<IndustryTrendPoint | null>((best, row) => !best || row.gmvCents > best.gmvCents ? row : best, null);
  const trough = ordered.reduce<IndustryTrendPoint | null>((best, row) => !best || row.gmvCents < best.gmvCents ? row : best, null);
  const lifecycleByPeriod = new Map(lifecycle.map((row) => [row.period, row]));
  const latestLifecycle = latest ? lifecycleByPeriod.get(latest.period) ?? null : null;
  const latestComparableExit = [...lifecycle]
    .sort((left, right) => right.period.localeCompare(left.period))
    .find((row) => row.exitCount !== null) ?? null;
  return {
    coverageMonths: ordered.length,
    latestPeriod: latest?.period ?? null,
    latestGmvCents: latest?.gmvCents ?? 0,
    monthOverMonthBps: latest && previous ? marketGrowthBps(latest.gmvCents, previous.gmvCents) : null,
    yearOverYearBps: latest && yearAgo ? marketGrowthBps(latest.gmvCents, yearAgo.gmvCents) : null,
    peak: peak ? { period: peak.period, gmvCents: peak.gmvCents } : null,
    trough: trough ? { period: trough.period, gmvCents: trough.gmvCents } : null,
    latestEntryCount: latestLifecycle?.entryCount ?? null,
    latestExitCount: latestComparableExit?.exitCount ?? null,
    latestExitPeriod: latestComparableExit?.period ?? null,
  };
}

export function monthlyGrowthByValue(rows: IndustryMonthlyDimensionPoint[]) {
  const periods = [...new Set(rows.map((row) => row.period))].sort((left, right) => left.localeCompare(right));
  const latestPeriod = periods.at(-1) ?? "";
  const previousPeriod = shiftMonth(latestPeriod, -1);
  const yearAgoPeriod = shiftMonth(latestPeriod, -12);
  const byValue = new Map<string, Map<string, IndustryMonthlyDimensionPoint>>();
  for (const row of rows) {
    const monthly = byValue.get(row.value) ?? new Map<string, IndustryMonthlyDimensionPoint>();
    monthly.set(row.period, row);
    byValue.set(row.value, monthly);
  }
  return new Map([...byValue].map(([value, monthly]) => {
    const latest = monthly.get(latestPeriod);
    const previous = monthly.get(previousPeriod);
    const yearAgo = monthly.get(yearAgoPeriod);
    return [value, {
      latestPeriod: latestPeriod || null,
      latestGmvCents: latest?.gmvCents ?? 0,
      monthOverMonthBps: latest && previous ? marketGrowthBps(latest.gmvCents, previous.gmvCents) : null,
      yearOverYearBps: latest && yearAgo ? marketGrowthBps(latest.gmvCents, yearAgo.gmvCents) : null,
    }];
  }));
}

export function buildIndustryBrandConcentrationTrend(rows: IndustryMonthlyDimensionPoint[]) {
  const byPeriod = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const brands = byPeriod.get(row.period) ?? new Map<string, number>();
    brands.set(row.value, (brands.get(row.value) ?? 0) + row.gmvCents);
    byPeriod.set(row.period, brands);
  }
  return [...byPeriod].sort(([left], [right]) => left.localeCompare(right)).map(([period, brands]) => {
    const values = [...brands.values()].sort((left, right) => right - left);
    const totalGmvCents = values.reduce((sum, value) => sum + value, 0);
    const concentration = (limit: number) => totalGmvCents > 0
      ? Math.round(values.slice(0, limit).reduce((sum, value) => sum + value, 0) / totalGmvCents * 10_000)
      : 0;
    return {
      period,
      gmvCents: totalGmvCents,
      brandCount: brands.size,
      cr3Bps: concentration(3),
      cr5Bps: concentration(5),
    };
  });
}

export function commercialDirectDrinkingScenario(subcategory: string) {
  if (/校园|学校/.test(subcategory)) return "校园";
  if (/幼儿园/.test(subcategory)) return "幼儿园";
  if (/工厂|车间/.test(subcategory)) return "工厂";
  if (/管线/.test(subcategory)) return "办公/餐饮";
  if (/桶装水/.test(subcategory)) return "桶装水";
  if (/配件|滤芯/.test(subcategory)) return "配件耗材";
  if (/直饮|净饮/.test(subcategory)) return "通用商用";
  return "其他/待确认";
}

function percentileRank(value: number, values: number[]) {
  if (!values.length) return 0;
  const belowOrEqual = values.filter((candidate) => candidate <= value).length;
  return Math.round(belowOrEqual / values.length * 10_000);
}

function opportunityReason(input: {
  shareBps: number;
  growthBps: number | null;
  conversionPercentile: number;
  selfShareBps: number;
  pendingShareBps: number;
}) {
  const reasons: string[] = [];
  if (input.shareBps >= 1_500) reasons.push("规模占比较高");
  if (input.growthBps !== null && input.growthBps >= 1_000) reasons.push("最新月增长较快");
  if (input.growthBps !== null && input.growthBps < 0) reasons.push("最新月销售回落");
  if (input.conversionPercentile >= 6_700) reasons.push("转化效率位于前列");
  if (input.selfShareBps >= 7_000) reasons.push("自营占比较高，平台信用门槛需验证");
  if (input.pendingShareBps >= 3_000) reasons.push("未确认价格较多，结论需复核");
  return reasons.slice(0, 3);
}

export function buildIndustryOpportunityMatrix(
  cells: IndustryOpportunityCellInput[],
  totalGmvCents: number,
  options: { identityReady?: boolean } = {},
) {
  const identityReady = options.identityReady !== false;
  const usable = cells.filter((cell) => cell.subcategory && cell.priceBand);
  const scaleValues = usable.map((cell) => cell.gmvCents);
  const growthValues = usable.map((cell) => marketGrowthBps(cell.latestGmvCents, cell.previousGmvCents)).filter((value): value is number => value !== null);
  const efficiencyValues = usable.map((cell) => cell.skuCount > 0 ? cell.gmvCents / cell.skuCount : 0);
  const conversionValues = usable.map((cell) => cell.conversionBps ?? 0);
  return usable.map((cell) => {
    const growthBps = marketGrowthBps(cell.latestGmvCents, cell.previousGmvCents);
    const shareBps = totalGmvCents > 0 ? Math.round(cell.gmvCents / totalGmvCents * 10_000) : 0;
    const selfShareBps = cell.gmvCents > 0 ? Math.round(cell.selfGmvCents / cell.gmvCents * 10_000) : 0;
    const pendingShareBps = cell.skuCount > 0 ? Math.round(cell.pendingPriceCount / cell.skuCount * 10_000) : 0;
    const scalePercentile = percentileRank(cell.gmvCents, scaleValues);
    const growthPercentile = growthBps === null ? 5_000 : percentileRank(growthBps, growthValues);
    const efficiencyPercentile = percentileRank(cell.skuCount > 0 ? cell.gmvCents / cell.skuCount : 0, efficiencyValues);
    const conversionPercentile = percentileRank(cell.conversionBps ?? 0, conversionValues);
    const openness = Math.max(0, 10_000 - selfShareBps);
    const dataPenalty = Math.round(pendingShareBps / 10_000 * 20);
    const score = Math.max(0, Math.min(100, Math.round(
      (scalePercentile * 30 + growthPercentile * 25 + efficiencyPercentile * 20
        + conversionPercentile * 15 + openness * 10) / 10_000 - dataPenalty,
    )));
    const comparisonReady = growthBps !== null;
    const priceReady = cell.priceBand !== "未确认价格" && pendingShareBps === 0;
    const decisionReady = comparisonReady && priceReady && identityReady;
    const recommendation = !decisionReady
      ? "持续观察"
      : score >= 68 && growthBps >= 0
      ? "建议进入"
      : score < 35 && growthBps < 0
        ? "谨慎回避"
        : "持续观察";
    const reasons = opportunityReason({ shareBps, growthBps, conversionPercentile, selfShareBps, pendingShareBps });
    if (!identityReady) reasons.unshift("分析身份未锁定");
    return {
      ...cell,
      scenario: commercialDirectDrinkingScenario(cell.subcategory),
      gmvShareBps: shareBps,
      growthBps,
      selfOperatedShareBps: selfShareBps,
      pendingPriceShareBps: pendingShareBps,
      score,
      recommendation,
      reasons: reasons.slice(0, 3),
      decisionReady,
    };
  }).sort((left, right) => right.score - left.score || right.gmvCents - left.gmvCents).slice(0, 60);
}

type SignalRule = { group: string; label: string; pattern: RegExp };

const productSignalRules: SignalRule[] = [
  { group: "使用场景", label: "校园", pattern: /校园|学校|学生/ },
  { group: "使用场景", label: "幼儿园", pattern: /幼儿园|幼教/ },
  { group: "使用场景", label: "工厂", pattern: /工厂|车间|工地/ },
  { group: "使用场景", label: "办公", pattern: /办公|办公室|企业|公司/ },
  { group: "使用场景", label: "餐饮", pattern: /餐饮|饭店|酒店|食堂/ },
  { group: "过滤方案", label: "RO反渗透", pattern: /反渗透|\bRO\b/i },
  { group: "过滤方案", label: "超滤", pattern: /超滤/ },
  { group: "过滤方案", label: "紫外抑菌", pattern: /紫外|\bUV\b/i },
  { group: "产品形态", label: "立式/柜式", pattern: /立式|柜式/ },
  { group: "产品形态", label: "台式", pattern: /台式/ },
  { group: "产品形态", label: "壁挂式", pattern: /壁挂/ },
  { group: "供水与温控", label: "管线供水", pattern: /管线|自来水|市政水/ },
  { group: "供水与温控", label: "桶装水", pattern: /桶装水|水桶/ },
  { group: "供水与温控", label: "即热/步进", pattern: /即热|步进/ },
  { group: "供水与温控", label: "制冷/冰水", pattern: /制冷|冰水|冰温热/ },
  { group: "供水与温控", label: "开水/热水", pattern: /开水|热水|一开|二开|三开/ },
  { group: "供水与温控", label: "温水", pattern: /温水|一温|二温|三温/ },
  { group: "服务承诺", label: "安装服务", pattern: /安装|上门/ },
  { group: "服务承诺", label: "质保/保修", pattern: /质保|保修|联保/ },
  { group: "服务承诺", label: "滤芯供应", pattern: /滤芯|耗材/ },
];

function capacitySignal(value: string) {
  const matches = [...value.matchAll(/(\d{1,4})\s*人/g)].map((match) => Number(match[1])).filter((count) => count > 0);
  const maximum = matches.length ? Math.max(...matches) : 0;
  if (!maximum) return null;
  if (maximum <= 50) return "≤50人";
  if (maximum <= 100) return "51–100人";
  if (maximum <= 300) return "101–300人";
  return "300人以上";
}

function productIdentity(item: IndustryProductSignalInput) {
  return JSON.stringify([item.category, item.scope, item.rankingDimension, item.skuCode]);
}

export function buildIndustryProductSignals(items: IndustryProductSignalInput[]) {
  const latestByIdentity = new Map<string, IndustryProductSignalInput>();
  for (const item of items) {
    const key = productIdentity(item);
    const current = latestByIdentity.get(key);
    if (!current || item.periodEnd > current.periodEnd || (item.periodEnd === current.periodEnd && item.gmvCents > current.gmvCents)) {
      latestByIdentity.set(key, item);
    }
  }
  const products = [...latestByIdentity.values()];
  const counts = new Map<string, { group: string; label: string; count: number; examples: string[] }>();
  for (const item of products) {
    const text = `${item.productName} ${item.subcategory}`;
    const matched = productSignalRules.filter((rule) => rule.pattern.test(text));
    const capacity = capacitySignal(text);
    if (capacity) matched.push({ group: "供水能力", label: capacity, pattern: /./ });
    for (const rule of matched) {
      const key = `${rule.group}\u0000${rule.label}`;
      const current = counts.get(key) ?? { group: rule.group, label: rule.label, count: 0, examples: [] };
      current.count += 1;
      if (current.examples.length < 3 && item.productName) current.examples.push(item.productName);
      counts.set(key, current);
    }
  }
  return {
    sampleSize: products.length,
    source: "商品标题与已确认细分类目",
    signals: [...counts.values()].map((signal) => ({
      ...signal,
      shareBps: products.length ? Math.round(signal.count / products.length * 10_000) : 0,
    })).sort((left, right) => right.count - left.count || left.group.localeCompare(right.group)).slice(0, 20),
  };
}

export function attachTrafficQuadrantExamples(
  quadrants: IndustryTrafficQuadrantInput[],
  items: IndustryProductSignalInput[],
) {
  const threshold = quadrants[0] ?? null;
  const totalsByIdentity = new Map<string, IndustryProductSignalInput>();
  for (const item of items) {
    const key = productIdentity(item);
    const current = totalsByIdentity.get(key);
    if (!current) {
      totalsByIdentity.set(key, { ...item });
      continue;
    }
    const latest = item.periodEnd > current.periodEnd ? item : current;
    const quantity = current.quantity + item.quantity;
    const visitors = current.visitors + item.visitors;
    totalsByIdentity.set(key, {
      ...latest,
      gmvCents: current.gmvCents + item.gmvCents,
      quantity,
      visitors,
      conversionBps: visitors > 0 ? Math.min(10_000, Math.max(0, Math.round(quantity * 10_000 / visitors))) : null,
    });
  }
  const itemQuadrant = (item: IndustryProductSignalInput): IndustryTrafficQuadrantInput["quadrant"] => {
    const highTraffic = item.visitors >= (threshold?.visitorThreshold ?? 0);
    const highConversion = (item.conversionBps ?? 0) >= (threshold?.conversionThresholdBps ?? 0);
    if (highTraffic && highConversion) return "high_traffic_high_conversion";
    if (highTraffic) return "high_traffic_low_conversion";
    if (highConversion) return "low_traffic_high_conversion";
    return "low_traffic_low_conversion";
  };
  return quadrants.map((quadrant) => ({
    ...quadrant,
    examples: [...totalsByIdentity.values()]
      .filter((item) => itemQuadrant(item) === quadrant.quadrant)
      .sort((left, right) => right.gmvCents - left.gmvCents)
      .slice(0, 3)
      .map((item) => ({ skuCode: item.skuCode, productName: item.productName, gmvCents: item.gmvCents })),
  }));
}
