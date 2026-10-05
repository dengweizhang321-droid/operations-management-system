import { aggregate, shops as erpShops, products as erpProducts, inventory as erpInventory, addDays, dayCount, ratio, change } from '../shared/data.js';
import { categoryForProduct, JACKYUN_CATEGORY_SOURCE } from './jackyun-categories.js';

// Resolve category from the preview's Jackyun master, never from display names.
const classifiedProducts = erpProducts.map(product => ({ ...product, category: categoryForProduct(product.id) }));

// Isolated, deterministic demo fixtures. All amounts exposed by this model are yuan.
export const TODAY = '2026-10-05';
export const AS_OF = '2026-10-04';
const MONTH = '2026-10';
const compactNames = ['京东旗舰店', '京东商用设备店', '天猫旗舰店', '厨房生活店', '企业采购店'];
export const shops = erpShops.slice(0, 5).map((shop, index) => ({ ...shop, compactName: compactNames[index] }));
// Independent month × shop planning facts, never the old daily target accumulator.
const monthlyTargets = { '2026-10': { s1: 650000, s2: 460000, s3: 490000, s4: 310000, s5: null } };
const adTargets = { s1: .14, s2: .16, s3: .15, s4: .17, s5: .12 };
const dates = (start, end) => Array.from({ length: dayCount(start, end) }, (_, index) => addDays(start, index));
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && addDays(value, 0) === value;
const priorYear = value => {
  const year = Number(value.slice(0, 4)) - 1;
  const candidate = `${year}${value.slice(4)}`;
  return validDate(candidate) ? candidate : `${year}-02-28`;
};

export function getRange(period = 'month', custom = {}) {
  if (!['month', 'last30', 'last7', 'custom'].includes(period)) throw new RangeError('不支持的经营周期');
  const end = period === 'custom' ? custom.end : AS_OF;
  const start = period === 'custom' ? custom.start : period === 'month' ? `${MONTH}-01` : addDays(end, period === 'last7' ? -6 : -29);
  if (!validDate(start) || !validDate(end) || start > end || end > AS_OF || dayCount(start, end) > 366) {
    throw new RangeError('请选择不晚于数据截止日、最多 366 天的有效周期');
  }
  const previousStart = addDays(start, -dayCount(start, end));
  const previousEnd = addDays(start, -1);
  return { start, end, previousStart, previousEnd, label: { month: '本月', last30: '近30天', last7: '近7天', custom: '自定义' }[period] };
}

function erp(start, end, selected, scenario, products = classifiedProducts) {
  const { target: _legacyDailyTarget, ...result } = aggregate(start, end, selected, products);
  const empty = scenario === 'empty' || !selected.length;
  if (empty) result.coverage = { expected: dayCount(start, end) * selected.length, covered: 0, complete: false, missing: dates(start, end).flatMap(date => selected.map(shop => ({ date, shop: shop.id }))) };
  if (empty || !result.coverage.complete) {
    for (const key of ['sales', 'cost', 'profit', 'returns', 'positiveSales', 'margin', 'returnRate']) result[key] = null;
  }
  return { ...result, hasData: result.sales !== null, source: 'ERP 销售合成日明细' };
}

// Distinct synthetic ERP order identities, independent of line / SKU counts.
function orderCount(start, end, selected) {
  const identities = new Set();
  for (const date of dates(start, end)) for (const shop of selected) {
    const count = Math.round((10 + Number(date.slice(-2)) % 9) * shop.weight);
    for (let i = 0; i < count; i++) identities.add(`${date}|${shop.id}|ERP-${i}`);
  }
  return identities.size;
}

function salesPeriod(start, end, selected, scenario) {
  const result = erp(start, end, selected, scenario);
  const orders = result.hasData ? orderCount(start, end, selected) : null;
  return { ...result, orders, averageOrderValue: ratio(result.sales, orders), orderBasis: 'ERP净销售÷同范围可信ERP订单数；合成订单身份按店铺与日期隔离' };
}

function projectGoals(selected, scenario, month) {
  const annualTargets = { s1: 7800000, s2: 5520000, s3: 5880000, s4: 3720000, s5: null };
  const targeted = selected.filter(shop => annualTargets[shop.id] !== null);
  const total = (start, end) => erp(start, end, targeted, scenario).sales;
  const target = targeted.length ? targeted.reduce((n, shop) => n + annualTargets[shop.id], 0) : null;
  const actual = total('2026-01-01', AS_OF), previous = total('2026-01-01', '2026-09-30');
  const yearAgo = total('2025-01-01', '2025-10-04');
  const completion = ratio(actual, target), priorCompletion = ratio(previous, target);
  const monthTargeted = selected.filter(shop => monthlyTargets[MONTH][shop.id] !== null);
  const previousMonth = erp('2026-09-01', '2026-09-04', monthTargeted, scenario).sales;
  const previousYearMonth = erp('2025-10-01', '2025-10-04', monthTargeted, scenario).sales;
  return {
    annual: { year: 2026, start: '2026-01-01', end: AS_OF, target, actual, completion, gap: actual === null || target === null ? null : target - actual,
      pace: dayCount('2026-01-01', AS_OF) / 365, previous, yearAgo, yoy: change(actual, yearAgo),
      progressChangePp: completion === null || priorCompletion === null ? null : (completion - priorCompletion) * 100,
      targetedCount: targeted.length, untargetedCount: selected.length - targeted.length },
    monthly: { month: MONTH, start: month.start, end: month.cutoff, target: month.target, actual: month.targetedSales, completion: month.completion,
      gap: month.targetedSales === null || month.target === null ? null : month.target - month.targetedSales, pace: month.pace,
      previous: previousMonth, yearAgo: previousYearMonth, mom: change(month.targetedSales, previousMonth), yoy: change(month.targetedSales, previousYearMonth),
      targetedCount: month.targetedCount, untargetedCount: month.untargetedCount },
    rows: month.rows.map(shop => { const old = erp('2026-09-01', '2026-09-04', [shop], scenario).sales;
      const lastYear = erp('2025-10-01', '2025-10-04', [shop], scenario).sales;
      return { ...shop, previous: old, yearAgo: lastYear, mom: change(shop.sales, old), yoy: change(shop.sales, lastYear) }; }),
  };
}

export const operationTasks = [
  { id: 'W01', type: 'plan', title: '商用设备详情优化', shop: '京东商用设备店', status: '工作中', due: '2026-10-02', created: '2026-09-10', lastProgress: '2026-09-25', mine: true },
  { id: 'W02', type: 'plan', title: '旗舰店活动复盘', shop: '京东旗舰店', status: '待开始', due: '2026-10-07', created: '2026-09-29', lastProgress: '2026-10-02', mine: false },
  { id: 'W03', type: 'plan', title: '蒸箱主图更新', shop: '天猫旗舰店', status: '工作中', due: '2026-10-25', created: '2026-09-01', lastProgress: '2026-09-20', mine: true },
  { id: 'W04', type: 'plan', title: '厨房生活店促销配置', shop: '厨房生活店', status: '工作中', due: '2026-10-05', created: '2026-09-29', lastProgress: '2026-10-01', mine: true },
  { id: 'W05', type: 'plan', title: '企业采购商品资料', shop: '企业采购店', status: '待开始', due: '2026-10-22', created: '2026-09-20', lastProgress: '2026-09-28', mine: false },
  { id: 'W06', type: 'plan', title: '已完成的旧计划', shop: '京东旗舰店', status: '已完成', due: '2026-09-20', created: '2026-09-01', lastProgress: '2026-09-18', mine: true },
  { id: 'W07', type: 'plan', title: '新建资料整理', shop: '京东旗舰店', status: '待开始', due: '2026-10-12', created: '2026-10-03', lastProgress: '2026-10-03', mine: true },
  { id: 'N01', type: 'launch', title: '新款切肉机上架', shop: '京东旗舰店', status: '工作中', due: '2026-10-04', created: '2026-09-12', lastProgress: '2026-09-23', mine: false },
  { id: 'N02', type: 'launch', title: '节能蒸箱新品上架', shop: '天猫旗舰店', status: '工作中', due: '2026-10-10', created: '2026-09-25', lastProgress: '2026-10-01', mine: true },
  { id: 'N03', type: 'launch', title: '净水机工程款上架', shop: '企业采购店', status: '待开始', due: '2026-10-20', created: '2026-09-05', lastProgress: '2026-09-18', mine: true },
  { id: 'N04', type: 'launch', title: '已取消的旧上新', shop: '厨房生活店', status: '已取消', due: '2026-09-20', created: '2026-09-01', lastProgress: '2026-09-10', mine: false },
  { id: 'N05', type: 'launch', title: '新品资料待排期', shop: '厨房生活店', status: '待开始', due: null, created: '2026-09-10', lastProgress: '2026-09-20', mine: false },
  { id: 'N06', type: 'launch', title: '双缸炸炉上架检查', shop: '京东商用设备店', status: '工作中', due: '2026-10-11', created: '2026-09-10', lastProgress: '2026-09-28', mine: false },
];

export function operationsModel(mine = false) {
  const upcomingEnd = addDays(TODAY, 6), staleThrough = addDays(TODAY, -7);
  const active = operationTasks.filter(task => !['已完成', '已取消'].includes(task.status) && (!mine || task.mine));
  const rules = [
    ['overdue', '已逾期', 'danger', task => task.due !== null && task.due < TODAY],
    ['upcoming', '7天内到期', 'warning', task => task.due !== null && task.due >= TODAY && task.due <= upcomingEnd],
    ['inactive', '7天无进展', 'neutral', task => (task.lastProgress || task.created) <= staleThrough],
  ];
  const rows = rules.flatMap(([bucket, label, tone, test]) => ['plan', 'launch'].map(type => {
    const tasks = active.filter(task => task.type === type && test(task));
    const typeLabel = type === 'plan' ? '工作计划' : '新品上架';
    return { id: `${bucket}-${type}`, title: `${label} · ${typeLabel}`, count: tasks.length, bucket, type, tone, mine,
      domain: 'workflow', scope: mine ? '我的运营事务' : '全部运营事务', detail: `${typeLabel}：${label}`, tasks };
  }));
  return { rows, activeCount: active.length, dueStart: TODAY, dueEnd: upcomingEnd, staleThrough,
    overdue: new Set(rows.filter(r => r.bucket === 'overdue').flatMap(r => r.tasks.map(t => t.id))).size,
    upcoming: new Set(rows.filter(r => r.bucket === 'upcoming').flatMap(r => r.tasks.map(t => t.id))).size,
    inactive: new Set(rows.filter(r => r.bucket === 'inactive').flatMap(r => r.tasks.map(t => t.id))).size,
    uniqueAttention: new Set(rows.flatMap(r => r.tasks.map(t => t.id))).size };
}

export function guangdongRisk(item) {
  const coverageDays = item.available === null || item.sales30 === null || item.sales30 <= 0 ? null : Math.max(0, item.available) / (item.sales30 / 30);
  const pending = item.available === null || item.lead === null || coverageDays === null;
  const risk = item.available !== null && item.available <= 0 ? 'no_stock' : coverageDays !== null && coverageDays > 180 ? 'stale'
    : coverageDays !== null && item.lead !== null && coverageDays <= item.lead ? 'urgent'
      : coverageDays !== null && item.lead !== null && coverageDays < item.lead + item.buffer ? 'warning' : pending ? 'unknown' : 'healthy';
  return { ...item, coverageDays, pending, risk };
}

function guangdongModel() {
  const fixtures = [
    { id: 'GD01', name: '切肉机基础款', available: 0, sales30: 24, lead: 14, buffer: 7 },
    { id: 'GD02', name: '切肉机旗舰款', available: 18, sales30: 30, lead: 21, buffer: 10 },
    { id: 'GD03', name: '12层节能蒸箱', available: 28, sales30: 30, lead: 21, buffer: 10 },
    { id: 'GD04', name: '双缸电炸炉', available: 200, sales30: 20, lead: 14, buffer: 7 },
    { id: 'GD05', name: '净水机工程款', available: 50, sales30: null, lead: null, buffer: 7 },
    { id: 'GD06', name: '商用绞肉机', available: 90, sales30: 60, lead: 14, buffer: 7 },
  ];
  const items = fixtures.map(guangdongRisk);
  const count = risk => items.filter(item => item.risk === risk).length;
  return { snapshot: AS_OF, demandStart: '2026-09-05', demandEnd: AS_OF, watchCount: items.length, items,
    noStock: count('no_stock'), urgent: count('urgent'), warning: count('warning'), stale: count('stale'), pending: items.filter(item => item.pending).length,
    uniqueRisk: items.filter(item => !['unknown', 'healthy'].includes(item.risk)).length };
}

// A separate platform ledger: visitors/buyers, platform GMV and ad attribution share coverage.
function platformDaily(date, shop) {
  if (date < '2025-01-01' || date > AS_OF) return null;
  const seed = Number(date.slice(-2)) + Number(shop.id.slice(1)) * 7;
  const visitors = Math.round((780 + seed % 13 * 31) * shop.weight);
  const buyers = Math.round(visitors * (.029 + seed % 5 * .003));
  const gmv = buyers * (58000 + seed % 9 * 2100);
  const adSpend = Math.round(gmv * (.105 + seed % 7 * .011));
  const attributed = Math.round(adSpend * (shop.id === 's2' ? 2.45 : 3.6 + seed % 4 * .22));
  return { visitors, buyers, gmv, adSpend, attributed };
}

function platformPeriod(start, end, selected, scenario) {
  const totals = { visitors: 0, buyers: 0, gmv: 0, adSpend: 0, attributed: 0 };
  const missing = [];
  let covered = 0;
  for (const date of dates(start, end)) for (const shop of selected) {
    const row = scenario === 'normal' ? platformDaily(date, shop) : null;
    if (!row) { missing.push({ date, shop: shop.id }); continue; }
    covered++;
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }
  const expected = dayCount(start, end) * selected.length;
  const complete = expected > 0 && covered === expected;
  for (const key of Object.keys(totals)) totals[key] = complete ? totals[key] / (['gmv', 'adSpend', 'attributed'].includes(key) ? 100 : 1) : null;
  return { ...totals, conversion: ratio(totals.buyers, totals.visitors), adRate: ratio(totals.adSpend, totals.gmv), roas: ratio(totals.attributed, totals.adSpend), coverage: { expected, covered, complete, missing }, source: '独立平台流量与推广合成日明细' };
}

function flowModel(state, selected, range, scenario) {
  const platforms = [...new Set(selected.map(shop => shop.platform))];
  const platform = platforms.includes(state.flowPlatform) ? state.flowPlatform : '';
  const shopOptions = selected.filter(shop => !platform || shop.platform === platform);
  const shop = shopOptions.some(row => row.id === state.flowShop) ? state.flowShop : '';
  const members = shopOptions.filter(row => !shop || row.id === shop);
  const dimension = state.flowDimension === 'platform' ? 'platform' : 'shop';
  const current = platformPeriod(range.start, range.end, members, scenario);
  const previous = platformPeriod(range.previousStart, range.previousEnd, members, scenario);
  const memberRows = members.map(row => ({ ...row, ...platformPeriod(range.start, range.end, [row], scenario) }));
  const rows = dimension === 'shop' ? memberRows : [...new Set(members.map(row => row.platform))].map(name => {
    const grouped = members.filter(row => row.platform === name);
    return { id: name, name, compactName: name, dimension: 'platform', shopCount: grouped.length,
      ...platformPeriod(range.start, range.end, grouped, scenario) };
  });
  return { selection: { platform, shop, dimension }, platforms, shopOptions, members: memberRows, rows, current, previous };
}

function monthModel(selected, scenario) {
  const start = `${MONTH}-01`, end = `${MONTH}-31`, pace = 4 / 31;
  const rows = selected.map(shop => {
    const current = erp(start, AS_OF, [shop], scenario), yesterday = erp(AS_OF, AS_OF, [shop], scenario);
    const traffic = platformPeriod(start, AS_OF, [shop], scenario);
    const target = monthlyTargets[MONTH][shop.id];
    const completion = ratio(current.sales, target);
    return { ...shop, sales: current.sales, target, completion, paceGap: completion === null ? null : completion - pace, yesterday: yesterday.sales, adRate: traffic.adRate, adTarget: adTargets[shop.id], roas: traffic.roas, coverage: current.coverage };
  });
  const targeted = rows.filter(row => row.target !== null);
  const target = targeted.length ? sum(targeted, 'target') : null;
  const targetedSales = targeted.length && targeted.every(row => row.sales !== null) ? sum(targeted, 'sales') : null;
  const sales = rows.length && rows.every(row => row.sales !== null) ? sum(rows, 'sales') : null;
  return { start, end, cutoff: AS_OF, daysElapsed: 4, daysTotal: 31, pace, rows, sales, target, targetedSales, completion: ratio(targetedSales, target), targetedCount: targeted.length, untargetedCount: rows.length - targeted.length, source: '2026年10月独立合成月目标表' };
}

function inventoryModel() {
  const items = erpInventory.items.map(item => ({ ...item, noSales: false }));
  items.push({ id: 'K06', name: '保温售饭台（无销量示例）', warehouse: '华东仓', qty: 50, days: null, needed: 0, value: 86000, age: 125, risk: '无销量', matched: true, noSales: true });
  const classify = item => !item.matched ? '销量未匹配' : item.noSales ? '近30日无销量' : item.days <= 30 ? '≤30天' : item.days <= 60 ? '31–60天' : item.days <= 90 ? '61–90天' : '>90天';
  const palette = { '≤30天': '#69a99b', '31–60天': '#8db8ad', '61–90天': '#deb56b', '>90天': '#d88b78', '近30日无销量': '#a28bb0', '销量未匹配': '#c5ccd4' };
  const value = sum(items, 'value');
  const buckets = Object.entries(palette).map(([label, color]) => ({ label, color, value: sum(items.filter(item => classify(item) === label), 'value') }));
  const riskValue = sum(items.filter(item => item.matched && (item.noSales || item.days > 90)), 'value');
  const matched = items.filter(item => item.matched), demand = matched.reduce((total, item) => total + (item.days > 0 ? item.qty / item.days : 0), 0);
  return { snapshot: '2026-10-04', demandStart: '2026-09-05', demandEnd: AS_OF, value, turnoverDays: null, knownTurnoverDays: ratio(sum(matched, 'qty'), demand), buckets, riskValue, riskShare: ratio(riskValue, value), unmatchedValue: sum(items.filter(item => !item.matched), 'value'), items, scope: '公司最新库存；已匹配部分为预测覆盖天数，不是财务周转天数', source: '独立公司库存合成快照' };
}

function financeModel() {
  return { month: '2026-09', status: '已完成', revenue: 2580000, profit: 296000, previousProfit: 286000, target: 320000, missing: [],
    expenses: [{ name: '推广费用', value: 328000, previous: 312000 }, { name: '仓储物流', value: 183000, previous: 176000 }, { name: '人员费用', value: 212000, previous: 208000 }, { name: '其他费用', value: 91000, previous: 86000 }],
    scope: '公司完整财报月；不随店铺或经营周期切分', source: '2026年9月独立合成完整月财报' };
}

function customerModel(range, selected, scenario) {
  const rows = selected.map(shop => {
    let conversations = 0, issues = 0, responseTotal = 0;
    for (const date of dates(range.start, range.end)) {
      const count = Math.round((95 + Number(date.slice(-2)) % 7 * 11) * shop.weight);
      conversations += count; issues += Math.round(count * (.025 + Number(shop.id.slice(1)) * .006));
      responseTotal += count * (16 + Number(shop.id.slice(1)) * 3);
    }
    return { id: shop.id, name: shop.name, compactName: shop.compactName, conversations, issues, responseTotal, issueRate: ratio(issues, conversations), responseSeconds: ratio(responseTotal, conversations) };
  });
  const available = scenario !== 'empty' && rows.length && range.start >= '2025-01-01';
  const conversations = available ? sum(rows, 'conversations') : null;
  return { conversations, issueRate: available ? ratio(sum(rows, 'issues'), conversations) : null, responseSeconds: available ? ratio(sum(rows, 'responseTotal'), conversations) : null, shops: available ? rows : [], source: '客服会话质检合成日明细；无成交归因', start: range.start, end: range.end };
}

function supplyModel() {
  const plans = [
    { id: 'PLAN-101', status: 'draft', warehouse: '华南仓', name: '切肉机补货', units: 42, expected: '2026-10-07' },
    { id: 'PLAN-102', status: 'confirmed', warehouse: '华东仓', name: '切肉机入仓', units: 30, expected: '2026-10-04' },
    { id: 'PLAN-103', status: 'confirmed', warehouse: '华南仓', name: '蒸箱备货', units: 80, expected: '2026-10-08' },
  ];
  return { draft: plans.filter(plan => plan.status === 'draft').length, confirmed: plans.filter(plan => plan.status === 'confirmed').length, inboundUnits: sum(plans.filter(plan => plan.status === 'confirmed'), 'units'), delayed: plans.filter(plan => plan.status === 'confirmed' && plan.expected < TODAY).length, plans, asOf: TODAY, scope: '公司当前备货与入仓计划', source: '独立合成计划台账；不代表采购实收' };
}

export function buildModel(state = {}) {
  const scenario = state.scenario ?? 'normal';
  if (!['normal', 'missing', 'empty'].includes(scenario)) throw new RangeError('不支持的数据场景');
  const range = getRange(state.period ?? 'month', state);
  const selected = shops.filter(shop => (!state.platform || shop.platform === state.platform) && (!state.shop || shop.id === state.shop));
  const current = salesPeriod(range.start, range.end, selected, scenario);
  const previous = salesPeriod(range.previousStart, range.previousEnd, selected, scenario);
  const yearAgo = salesPeriod(priorYear(range.start), priorYear(range.end), selected, scenario);
  const trend = dates(range.start, range.end).map((date, index) => {
    const currentDay = erp(date, date, selected, scenario), previousDate = addDays(range.previousStart, index);
    const previousDay = erp(previousDate, previousDate, selected, scenario);
    return { date, value: currentDay.sales, profit: currentDay.profit, previous: previousDay.sales, previousProfit: previousDay.profit };
  });
  const traffic = platformPeriod(range.start, range.end, selected, scenario);
  traffic.previous = platformPeriod(range.previousStart, range.previousEnd, selected, scenario);
  traffic.rows = selected.map(shop => ({ ...shop, ...platformPeriod(range.start, range.end, [shop], scenario) }));
  const promotionOf = value => ({ spend: value.adSpend, attributed: value.attributed, roas: value.roas, adRate: value.adRate, coverage: value.coverage, source: value.source });
  const promotion = { ...promotionOf(traffic), previous: promotionOf(traffic.previous), rows: traffic.rows.map(row => ({ id: row.id, name: row.name, compactName: row.compactName, ...promotionOf(row) })) };
  const products = scenario === 'empty' || !selected.length ? [] : classifiedProducts.map(product => {
    const row = erp(range.start, range.end, selected, scenario, [product]);
    const baseline = erp(range.previousStart, range.previousEnd, selected, scenario, [product]);
    return { ...product, ...row, delta: row.sales === null || baseline.sales === null ? null : row.sales - baseline.sales, change: change(row.sales, baseline.sales), share: ratio(row.sales, current.sales) };
  });
  const month = monthModel(selected, scenario), inventory = inventoryModel(), supply = supplyModel();
  const customer = customerModel(range, selected, scenario);
  customer.previous = customerModel({ start: range.previousStart, end: range.previousEnd }, selected, scenario);
  const operations = operationsModel(!!state.mine);
  const shopPerformance = selected.map(shop => {
    const result = erp(range.start, range.end, [shop], scenario);
    const old = erp(priorYear(range.start), priorYear(range.end), [shop], scenario);
    const prior = erp(range.previousStart, range.previousEnd, [shop], scenario);
    const yoy = change(result.sales, old.sales);
    return { ...shop, ...result, yearAgo: old.sales, previous: prior.sales, yoy, mom: change(result.sales, prior.sales),
      deltaYoy: result.sales === null || old.sales === null ? null : result.sales - old.sales,
      severity: yoy === null ? 'unknown' : yoy <= -.2 ? 'severe' : yoy <= -.1 ? 'warning' : yoy < 0 ? 'decline' : 'healthy' };
  }).sort((a,b) => (a.yoy ?? Infinity) - (b.yoy ?? Infinity));
  const categories = [...new Set(classifiedProducts.map(product => product.category))].map(category => {
    const members = classifiedProducts.filter(product => product.category === category);
    const result = erp(range.start, range.end, selected, scenario, members);
    const prior = erp(range.previousStart, range.previousEnd, selected, scenario, members);
    const old = erp(priorYear(range.start), priorYear(range.end), selected, scenario, members);
    return { category, ...result, previous: prior.sales, yearAgo: old.sales, mom: change(result.sales, prior.sales), yoy: change(result.sales, old.sales),
      deltaYoy: result.sales === null || old.sales === null ? null : result.sales - old.sales, share: ratio(result.sales, current.sales) };
  }).sort((a,b) => (b.sales ?? -Infinity) - (a.sales ?? -Infinity));
  return { range, month, goals: projectGoals(selected, scenario, month), sales: { current, previous, yearAgo, trend }, traffic,
    shopPerformance, categories, categorySource: JACKYUN_CATEGORY_SOURCE, flow: flowModel(state, selected, range, scenario), inventory, guangdong: guangdongModel(), products, promotion, finance: financeModel(),
    todos: operations.rows, operations, customer, supply };
}
