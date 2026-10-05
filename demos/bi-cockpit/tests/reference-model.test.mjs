import test from 'node:test';
import assert from 'node:assert/strict';
import { AS_OF, TODAY, shops, getRange, buildModel, operationTasks, operationsModel, guangdongRisk } from '../reference/model.js';
import { aggregate, shops as originalShops } from '../shared/data.js';
import { categoryForProduct, JACKYUN_CATEGORIES, JACKYUN_CATEGORY_SOURCE } from '../reference/jackyun-categories.js';

const state = { period: 'month', start: '2026-10-01', end: AS_OF, platform: '', shop: '', scenario: 'normal' };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

test('fixed clock and periods end yesterday, with explicit comparison dates', () => {
  assert.equal(TODAY, '2026-10-05'); assert.equal(AS_OF, '2026-10-04');
  assert.deepEqual(getRange('month'), { start: '2026-10-01', end: AS_OF, previousStart: '2026-09-27', previousEnd: '2026-09-30', label: '本月' });
  assert.equal(getRange('last7').previousStart, '2026-09-21');
  assert.equal(getRange('last30').start, '2026-09-05');
  assert.equal(getRange('last30').previousEnd, '2026-09-04');
  assert.deepEqual(getRange('custom', { start: '2026-09-10', end: '2026-09-12' }), { start: '2026-09-10', end: '2026-09-12', previousStart: '2026-09-07', previousEnd: '2026-09-09', label: '自定义' });
  for (const dates of [{ start: '2026-02-30', end: AS_OF }, { start: AS_OF, end: TODAY }, { start: AS_OF, end: '2026-10-01' }, { start: '2024-01-01', end: AS_OF }]) assert.throws(() => getRange('custom', dates), RangeError);
});

test('ERP facts are reused exactly; financial rates use matching numerators and negative profit survives', () => {
  const model = buildModel(state), fact = aggregate('2026-10-01', AS_OF, originalShops.slice(0, 5));
  assert.deepEqual(shops.map(shop => shop.id), ['s1', 's2', 's3', 's4', 's5']);
  assert.equal(shops[1].name, originalShops[1].name);
  assert.equal(model.sales.current.sales, fact.sales);
  close(model.sales.current.profit, model.sales.current.sales - model.sales.current.cost);
  assert.equal(model.sales.current.margin, model.sales.current.profit / model.sales.current.sales);
  assert.equal(model.sales.current.returnRate, model.sales.current.returns / model.sales.current.positiveSales);
  close(sum(model.sales.trend, 'value'), model.sales.current.sales);
  close(sum(model.sales.trend, 'previous'), model.sales.previous.sales);
  close(sum(model.sales.trend, 'previousProfit'), model.sales.previous.profit);
  close(sum(model.products, 'sales'), model.sales.current.sales);
  assert.ok(model.products.some(product => product.profit < 0));
  assert.ok(buildModel({ ...state, shop: 's2' }).sales.trend.some(day => day.profit < 0));
});

test('month targets remain full-month facts; untargeted sales do not inflate completion', () => {
  const current = buildModel(state), rolling = buildModel({ ...state, period: 'last30' });
  assert.deepEqual(current.month, rolling.month);
  assert.equal(current.month.end, '2026-10-31'); assert.equal(current.month.pace, 4 / 31);
  assert.equal(current.month.targetedCount, 4); assert.equal(current.month.untargetedCount, 1);
  assert.equal(current.month.completion, current.month.targetedSales / current.month.target);
  assert.ok(current.month.targetedSales < current.month.sales);
  const unplanned = buildModel({ ...state, shop: 's5' }).month;
  assert.equal(unplanned.target, null); assert.equal(unplanned.completion, null);
  assert.equal(unplanned.rows[0].paceGap, null); assert.ok(unplanned.sales > 0);
  const jd = buildModel({ ...state, platform: '京东' }).month;
  assert.equal(jd.target, 1110000); close(jd.sales, sum(jd.rows, 'sales'));
});

test('traffic and promotion use a separate ledger with complete identical coverage and weighted ratios', () => {
  const model = buildModel({ ...state, period: 'last30' }), traffic = model.traffic;
  assert.equal(traffic.coverage.expected, 150); assert.equal(traffic.coverage.complete, true);
  assert.deepEqual(traffic.coverage, model.promotion.coverage);
  assert.equal(traffic.conversion, traffic.buyers / traffic.visitors);
  assert.equal(traffic.adRate, traffic.adSpend / traffic.gmv);
  assert.equal(traffic.roas, traffic.attributed / traffic.adSpend);
  assert.equal(model.promotion.spend, traffic.adSpend);
  close(sum(traffic.rows, 'gmv'), traffic.gmv); close(sum(traffic.rows, 'adSpend'), traffic.adSpend);
  assert.notEqual(traffic.gmv, model.sales.current.sales);
  assert.equal(buildModel({ ...state, shop: 's5' }).traffic.coverage.complete, true);
});

test('missing platform source stays null without contaminating ERP; empty stays distinct from zero', () => {
  const normal = buildModel(state), missing = buildModel({ ...state, scenario: 'missing' });
  assert.deepEqual(missing.sales, normal.sales);
  assert.equal(missing.traffic.gmv, null); assert.equal(missing.promotion.roas, null);
  assert.equal(missing.traffic.coverage.covered, 0);
  assert.ok(missing.month.rows.every(row => row.adRate === null && row.sales > 0));
  const empty = buildModel({ ...state, scenario: 'empty' });
  assert.equal(empty.sales.current.sales, null); assert.equal(empty.month.sales, null);
  assert.equal(empty.month.targetedSales, null); assert.equal(empty.month.completion, null);
  assert.ok(empty.month.rows.every(row => row.sales === null && row.yesterday === null && row.completion === null && row.paceGap === null));
  assert.deepEqual(empty.month.rows.map(row => row.target), normal.month.rows.map(row => row.target));
  assert.equal(empty.month.target, normal.month.target); assert.equal(empty.customer.conversations, null);
  assert.ok(empty.sales.trend.every(day => day.value === null && day.profit === null && day.previous === null && day.previousProfit === null));
  assert.deepEqual(empty.products, []); assert.deepEqual(empty.inventory, normal.inventory); assert.deepEqual(empty.finance, normal.finance);
});

test('shop/platform filters intersect without broadening and leave company snapshot/month alone', () => {
  const normal = buildModel(state), filtered = buildModel({ ...state, shop: 's1', platform: '京东', period: 'last7' });
  assert.deepEqual(filtered.month.rows.map(row => row.id), ['s1']);
  assert.deepEqual(filtered.traffic.rows.map(row => row.id), ['s1']);
  assert.deepEqual(filtered.customer.shops.map(row => row.id), ['s1']);
  assert.deepEqual(filtered.inventory, normal.inventory); assert.deepEqual(filtered.finance, normal.finance); assert.deepEqual(filtered.supply, normal.supply);
  const none = buildModel({ ...state, shop: 's1', platform: '天猫' });
  assert.equal(none.sales.current.sales, null); assert.equal(none.traffic.visitors, null); assert.equal(none.month.target, null);
  assert.deepEqual(none.traffic.rows, []); assert.deepEqual(none.products, []);
});

test('inventory risk denominator includes unmatched value in an exclusive bucket; unknown is not no-sales', () => {
  const inventory = buildModel(state).inventory;
  assert.equal(sum(inventory.items, 'value'), inventory.value);
  assert.equal(sum(inventory.buckets, 'value'), inventory.value);
  assert.equal(inventory.riskShare, inventory.riskValue / inventory.value);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '销量未匹配').value, inventory.unmatchedValue);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '近30日无销量').value, 86000);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '≤30天').value, 549000);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '31–60天').value, 300000);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '61–90天').value, 216000);
  assert.equal(inventory.buckets.find(bucket => bucket.label === '>90天').value, 426000);
  assert.equal(inventory.riskValue, 512000);
  assert.ok(inventory.items.filter(item => item.noSales).every(item => item.matched));
  assert.equal(inventory.turnoverDays, null); assert.ok(inventory.knownTurnoverDays > 0);
});

test('unsupported historical coverage suppresses partial totals and absent comparisons', () => {
  const model = buildModel({ ...state, period: 'custom', start: '2024-12-31', end: '2025-01-02' });
  assert.equal(model.sales.current.sales, null); assert.equal(model.sales.previous.sales, null);
  assert.equal(model.sales.yearAgo.sales, null); assert.equal(model.traffic.gmv, null);
  assert.equal(model.traffic.coverage.covered, 10); assert.equal(model.traffic.coverage.expected, 15);
  assert.ok(model.products.every(product => product.sales === null && product.change === null));
});

test('customer metrics are conversation quality only and supply describes company plans', () => {
  const model = buildModel(state), customer = model.customer, supply = model.supply;
  assert.equal(customer.conversations, sum(customer.shops, 'conversations'));
  assert.equal(customer.issueRate, sum(customer.shops, 'issues') / customer.conversations);
  assert.equal(customer.responseSeconds, sum(customer.shops, 'responseTotal') / customer.conversations);
  assert.equal(customer.previous.start, '2026-09-27'); assert.equal(customer.previous.end, '2026-09-30');
  assert.equal(customer.previous.conversations, sum(customer.previous.shops, 'conversations'));
  assert.equal('gmv' in customer, false);
  assert.equal(supply.inboundUnits, 110); assert.equal(supply.draft, 1); assert.equal(supply.delayed, 1);
  assert.equal(model.finance.month, '2026-09'); assert.equal(model.finance.status, '已完成');
});

test('all previous windows have equal length and customer baseline respects absent coverage', () => {
  for (const period of ['month', 'last7', 'last30', 'custom']) {
    const range = getRange(period, { start: '2026-08-30', end: '2026-09-03' });
    assert.equal(Date.parse(range.end) - Date.parse(range.start), Date.parse(range.previousEnd) - Date.parse(range.previousStart));
    assert.equal(Date.parse(range.start) - Date.parse(range.previousEnd), 86400000);
  }
  const early = buildModel({ ...state, period: 'custom', start: '2025-01-01', end: '2025-01-04' });
  assert.ok(early.customer.conversations > 0); assert.equal(early.customer.previous.conversations, null);
  assert.ok(early.sales.trend.every(day => day.previous === null && day.previousProfit === null));
});

test('todo ownership is explicit and dangerous issues precede warnings and neutral items', () => {
  const todos = buildModel(state).todos, priority = { danger: 0, warning: 1, neutral: 2 };
  assert.equal(todos.length, 6); assert.ok(todos.every(todo => typeof todo.mine === 'boolean'));
  assert.ok(buildModel({ ...state, mine: true }).todos.every(todo => todo.mine));
  assert.ok(buildModel({ ...state, mine: true }).operations.uniqueAttention < buildModel(state).operations.uniqueAttention);
  assert.ok(todos.every((todo, index) => !index || priority[todos[index - 1].tone] <= priority[todo.tone]));
});

test('annual/month goals keep fixed scope and comparable cumulative periods', () => {
  const normal = buildModel(state), rolling = buildModel({ ...state, period: 'last30' });
  assert.deepEqual(normal.goals, rolling.goals);
  const annual = normal.goals.annual, monthly = normal.goals.monthly;
  assert.equal(annual.target, 22920000); assert.equal(annual.completion, annual.actual / annual.target);
  assert.equal(annual.yoy, (annual.actual - annual.yearAgo) / annual.yearAgo);
  close(annual.progressChangePp, (annual.actual - annual.previous) / annual.target * 100);
  assert.equal(monthly.completion, normal.month.targetedSales / normal.month.target);
  assert.equal(monthly.yoy, (monthly.actual - monthly.yearAgo) / monthly.yearAgo);
  const empty = buildModel({ ...state, scenario: 'empty' });
  assert.equal(empty.goals.annual.actual, null); assert.equal(empty.goals.annual.completion, null);
  assert.equal(empty.goals.monthly.actual, null); assert.equal(empty.goals.monthly.target, monthly.target);
  const unplanned = buildModel({ ...state, shop: 's5' }).goals;
  assert.equal(unplanned.annual.target, null); assert.equal(unplanned.annual.actual, null);
  assert.equal(unplanned.monthly.completion, null);
});

test('net amount per order uses distinct scoped order identities, not SKU lines', () => {
  const all = buildModel(state);
  assert.ok(all.sales.current.orders > 0);
  close(all.sales.current.averageOrderValue, all.sales.current.sales / all.sales.current.orders);
  const one = shops.map(shop => buildModel({ ...state, shop: shop.id }).sales.current);
  assert.equal(sum(one, 'orders'), all.sales.current.orders);
  close(sum(one, 'sales') / sum(one, 'orders'), all.sales.current.averageOrderValue);
  assert.equal(buildModel({ ...state, scenario: 'empty' }).sales.current.averageOrderValue, null);
});

test('operations exclude finished/cancelled and preserve overdue/upcoming/inactivity boundaries', () => {
  const ops = operationsModel();
  const ids = bucket => new Set(ops.rows.filter(row => row.bucket === bucket).flatMap(row => row.tasks.map(task => task.id)));
  assert.equal(ops.dueStart, TODAY); assert.equal(ops.dueEnd, '2026-10-11');
  assert.equal(ops.staleThrough, '2026-09-28');
  assert.ok(ids('upcoming').has('W04') && ids('upcoming').has('N06'));
  assert.equal(ids('upcoming').has('W07'), false);
  assert.ok(ids('inactive').has('W05') && ids('inactive').has('N06'));
  assert.equal(ids('inactive').has('W07'), false);
  const all = ops.rows.flatMap(row => row.tasks);
  assert.equal(all.some(task => ['W06', 'N04'].includes(task.id)), false);
  assert.equal(ops.uniqueAttention, new Set(all.map(task => task.id)).size);
  assert.ok(ops.uniqueAttention < all.length);
  assert.ok(operationsModel(true).rows.flatMap(row => row.tasks).every(task => task.mine));
  assert.ok(operationTasks.some(task => task.due === null));
});

test('shop decline signals use the same ERP range and never turn missing baselines into healthy', () => {
  const model = buildModel(state);
  close(sum(model.shopPerformance, 'sales'), model.sales.current.sales);
  assert.ok(model.shopPerformance.some(row => row.yoy < 0));
  for (const row of model.shopPerformance) {
    close(row.yoy, (row.sales - row.yearAgo) / row.yearAgo);
    close(row.deltaYoy, row.sales - row.yearAgo);
    assert.equal(row.severity === 'healthy', row.yoy >= 0);
  }
  const missing = buildModel({ ...state, scenario: 'empty' });
  assert.ok(missing.shopPerformance.every(row => row.yoy === null && row.severity === 'unknown'));
});

test('all categories reconcile to sales in current and comparison periods', () => {
  const model = buildModel({ ...state, period: 'last30' });
  assert.equal(model.categories.length, 5);
  close(sum(model.categories, 'sales'), model.sales.current.sales);
  close(sum(model.categories, 'previous'), model.sales.previous.sales);
  close(sum(model.categories, 'yearAgo'), model.sales.yearAgo.sales);
  close(sum(model.categories, 'share'), 1);
  for (const row of model.categories) {
    close(row.mom, (row.sales - row.previous) / row.previous);
    close(row.yoy, (row.sales - row.yearAgo) / row.yearAgo);
  }
});

test('BI categories come from the Jackyun master dictionary, with unmapped products kept explicit', () => {
  const model = buildModel(state);
  assert.equal(JACKYUN_CATEGORY_SOURCE.field, '分类');
  assert.equal(JACKYUN_CATEGORY_SOURCE.column, 'F');
  assert.equal(JACKYUN_CATEGORIES.length, JACKYUN_CATEGORY_SOURCE.categoryCount);
  assert.ok(model.categories.every(row => JACKYUN_CATEGORIES.includes(row.category)));
  assert.deepEqual(new Set(model.categories.map(row => row.category)), new Set(['台式切片机', '蒸饭柜', '炉系列', '绞切一体机', '净水器']));
  assert.equal(categoryForProduct('unknown-product'), '未分类');
  assert.equal(model.products.find(product => product.id === 'K02').category, '蒸饭柜');
});

test('platform traffic grouping uses additive counts and weighted conversion/ROI', () => {
  const model = buildModel({ ...state, flowDimension: 'platform' }), flow = model.flow;
  assert.deepEqual(flow.rows.map(row => row.name), ['京东', '天猫', '企业采购']);
  assert.equal(sum(flow.rows, 'visitors'), flow.current.visitors);
  close(sum(flow.rows, 'gmv'), flow.current.gmv);
  close(sum(flow.rows, 'adSpend'), flow.current.adSpend);
  for (const row of flow.rows) {
    close(row.conversion, row.buyers / row.visitors);
    close(row.roas, row.attributed / row.adSpend);
    close(row.adRate, row.adSpend / row.gmv);
  }
  assert.equal(flow.rows[0].shopCount, 2);
});

test('flow platform/shop selection is local and never widens the global parent scope', () => {
  const normal = buildModel(state);
  const jd = buildModel({ ...state, flowPlatform: '京东' });
  assert.deepEqual(jd.flow.members.map(row => row.id), ['s1', 's2']);
  assert.deepEqual(jd.sales, normal.sales); assert.deepEqual(jd.goals, normal.goals);
  const single = buildModel({ ...state, flowPlatform: '京东', flowShop: 's2' });
  assert.deepEqual(single.flow.members.map(row => row.id), ['s2']);
  assert.equal(single.flow.current.visitors, single.flow.members[0].visitors);
  const parent = buildModel({ ...state, platform: '天猫', flowPlatform: '京东', flowShop: 's2' });
  assert.deepEqual(parent.flow.members.map(row => row.id), ['s3', 's4']);
  assert.equal(parent.flow.selection.platform, ''); assert.equal(parent.flow.selection.shop, '');
  const mismatched = buildModel({ ...state, flowPlatform: '天猫', flowShop: 's2' });
  assert.equal(mismatched.flow.selection.shop, '');
  assert.ok(mismatched.flow.members.every(row => row.platform === '天猫'));
});

test('missing platform source stays unknown in both shop and platform views', () => {
  for (const flowDimension of ['shop', 'platform']) {
    const flow = buildModel({ ...state, scenario: 'missing', flowDimension }).flow;
    assert.equal(flow.current.visitors, null); assert.equal(flow.current.conversion, null);
    assert.equal(flow.previous.roas, null);
    assert.ok(flow.rows.every(row => row.gmv === null && row.roas === null));
    assert.equal(flow.current.coverage.complete, false);
  }
});

test('Guangdong monitor uses production cycle thresholds and keeps unknown inputs pending', () => {
  const base = { available: 21, sales30: 30, lead: 21, buffer: 10 };
  assert.equal(guangdongRisk(base).risk, 'urgent');
  assert.equal(guangdongRisk({ ...base, available: 30 }).risk, 'warning');
  assert.equal(guangdongRisk({ ...base, available: 31 }).risk, 'healthy');
  assert.equal(guangdongRisk({ ...base, available: 181 }).risk, 'stale');
  assert.equal(guangdongRisk({ ...base, available: 0, sales30: null }).risk, 'no_stock');
  assert.equal(guangdongRisk({ ...base, sales30: null }).risk, 'unknown');
  assert.equal(guangdongRisk({ ...base, lead: null }).pending, true);
  const normal = buildModel(state), gd = normal.guangdong;
  assert.equal(gd.watchCount, 6);
  assert.equal(gd.noStock, 1); assert.equal(gd.urgent, 1); assert.equal(gd.warning, 1);
  assert.equal(gd.stale, 1); assert.equal(gd.pending, 1);
  assert.deepEqual(buildModel({ ...state, shop: 's1', period: 'last7' }).guangdong, gd);
});
