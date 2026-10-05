export function createPanels(ctx) {
  const { state, model, action, heading, amt, wan, pct, num, delta, money, esc, table, empty, metric } = ctx;
  const name = shop => shop.compactName || shop.name;
  const changeText = value => value == null ? '<span class="muted">暂无可比数据</span>' : `<span class="${value < 0 ? 'down' : value > 0 ? 'up' : 'muted'}">${value > 0 ? '+' : value < 0 ? '−' : ''}${num(Math.abs(value) * 100, 1)}%</span>`;
  const intro = '<p class="small muted">设计预览 · 合成数据。指标与明细均按当前所示范围展示。</p>';
  const typeLabel = type => type === 'plan' ? '工作计划' : '新品上架';
  const riskLabels = { no_stock: '无可用库存', urgent: '紧急补货', warning: '补货预警', stale: '低周转', unknown: '数据待校验', healthy: '正常' };

  function goalBlock(goal, annual) {
    const label = annual ? `${goal.year} 年目标` : `${goal.month.slice(5)} 月目标`;
    const paceGap = goal.completion == null ? null : goal.completion - goal.pace;
    return `<section class="goal-block" aria-label="${annual ? '项目年目标' : '项目月目标'}">
      <div class="goal-block-head"><h3>${label}</h3><span class="badge">${annual ? '年累计' : '月累计'}</span></div>
      <span class="metric-label">已完成净销售</span><strong class="goal-actual">${amt(goal.actual)}</strong>
      <div class="goal-target"><span>${annual ? '年' : '月'}目标 ${wan(goal.target)}</span><strong>完成 ${pct(goal.completion)}</strong></div>
      <div class="progress-track" role="img" aria-label="完成${pct(goal.completion)}，时间进度${pct(goal.pace)}">
        <i class="progress-fill ${paceGap < 0 ? 'behind' : ''}" style="width:${Math.max(0, Math.min(100, (goal.completion || 0) * 100))}%"></i>
        <i class="time-marker" style="left:${goal.pace * 100}%"></i>
      </div>
      <div class="goal-pace"><span>时间进度 ${pct(goal.pace)}</span><span class="${paceGap == null ? 'muted' : paceGap >= 0 ? 'good' : 'warn'}">${paceGap == null ? '实际待校验' : `${paceGap >= 0 ? '领先' : '落后'} ${num(Math.abs(paceGap) * 100, 1)}pt`}</span></div>
      <div class="goal-comparisons">${annual ? `<div><span>进度环比（上月末）</span><strong>${goal.progressChangePp == null ? '—' : (goal.progressChangePp > 0 ? '+' : '') + num(goal.progressChangePp, 1) + 'pt'}</strong></div><div><span>年度净销售同比</span><strong>${changeText(goal.yoy)}</strong></div>` : `<div><span>净销售环比</span><strong>${changeText(goal.mom)}</strong></div><div><span>净销售同比</span><strong>${changeText(goal.yoy)}</strong></div>`}</div>
      <p class="goal-period">${goal.start.slice(5)} — ${goal.end.slice(5)}${annual ? ' · 同比去年同日累计' : ' · 环比上月同日累计'}</p>
    </section>`;
  }

  function goalCard() {
    const goals = model.goals;
    return `<article class="card span2 target-card goals-card" data-section="targets">${heading('项目目标进度', 'ERP 净销售 · 年 / 月累计', 'targets', '查看目标明细')}
      <div class="goal-grid">${goalBlock(goals.annual, true)}${goalBlock(goals.monthly, false)}</div>
      <p class="target-note">${goals.monthly.targetedCount} 家已设目标店铺 · ${goals.monthly.untargetedCount} 家未设目标不参与完成率</p>
    </article>`;
  }

  function todosCard() {
    const operations = model.operations;
    return `<article class="card todo-card" data-section="todos"><div class="card-head"><div class="card-title"><h2>运营事务待处理</h2><small>工作计划 / 新品上架</small></div>
      <div class="segmented compact" role="group" aria-label="待处理范围">${action('todo-scope', '我的', 'mine', state.mine ? 'active' : '')}${action('todo-scope', '全部', 'all', !state.mine ? 'active' : '')}</div></div>
      <div class="todo-list">${operations.rows.map(row => `<button class="todo-row" data-action="todo" data-value="${row.id}"><span class="todo-dot ${row.tone === 'danger' ? 'urgent' : row.tone}"></span><span><span class="todo-name">${row.title}</span><span class="todo-desc">${row.bucket === 'overdue' ? '到期未完成' : row.bucket === 'upcoming' ? '今日至 ' + operations.dueEnd.slice(5) : '最后进展 ≤ ' + operations.staleThrough.slice(5)}</span></span><strong class="todo-number ${row.tone === 'danger' && row.count ? 'up' : ''}">${row.count}</strong><span class="chevron">›</span></button>`).join('')}</div>
      <div class="todo-foot"><span>${operations.uniqueAttention} 项需关注 · 同一事项可命中多组</span>${action('detail', '查看明细 ›', 'todos')}</div></article>`;
  }

  function shopCard() {
    const rows = model.shopPerformance;
    const comparable = rows.filter(row => row.yoy !== null);
    const unknownCount = rows.length - comparable.length;
    const declines = rows.filter(row => row.yoy !== null && row.yoy < 0);
    const shown = state.shopMode === 'all' ? rows : declines;
    const loss = declines.reduce((total, row) => total + Math.abs(row.deltaYoy), 0);
    return `<article class="card anomaly-card" data-section="shops">${heading('店铺同比下滑', 'ERP 净销售 · 去年同期', 'shopPerformance', '查看全部店铺')}
      <div class="anomaly-summary"><div><span>同比下滑</span><strong>${comparable.length ? declines.length : '—'}<small> 家</small></strong></div><div><span>下滑金额</span><strong>${declines.length ? wan(loss) : '—'}</strong></div><div><span>严重下滑</span><strong class="${declines.some(r => r.severity === 'severe') ? 'up' : ''}">${comparable.length ? declines.filter(r => r.severity === 'severe').length : '—'}<small> 家</small></strong></div></div>
      <div class="anomaly-tools"><span class="small muted">净销售同比</span><div class="segmented compact">${action('shop-mode', '下滑店铺', 'declines', state.shopMode !== 'all' ? 'active' : '')}${action('shop-mode', '全部', 'all', state.shopMode === 'all' ? 'active' : '')}</div></div>
      ${shown.length ? `<div class="table-wrap"><table class="compact-table"><thead><tr><th>店铺</th><th>本期净销售</th><th>同比</th></tr></thead><tbody>${shown.map(row => `<tr><td>${action('shop', esc(name(row)), row.id)}${['warning', 'severe'].includes(row.severity) ? `<small class="warn">${row.severity === 'severe' ? '严重下滑' : '重点关注'}</small>` : ''}</td><td>${wan(row.sales)}</td><td>${changeText(row.yoy)}</td></tr>`).join('')}</tbody></table></div>` : empty(rows.some(r => r.yoy === null) ? '同比来源不足，暂不能判断异常' : '当前范围没有同比下滑店铺')}
      <p class="card-note inline">${unknownCount ? `${unknownCount} 家暂不可比。` : ''}同比 ≤ −10% 重点关注，≤ −20% 严重下滑。${action('help', '口径', '店铺同比下滑')}</p></article>`;
  }

  function categoriesCard() {
    return `<article class="card span3 category-card" data-section="categories">${heading('类目经营表现', '吉客云货品分类 · ERP 净销售', 'categories', '查看类目明细')}
      <div class="table-wrap"><table class="category-table"><thead><tr><th>类目</th><th>本期净销售</th><th>销售占比</th><th>同比增减额</th><th>同比</th><th>环比</th></tr></thead><tbody>${model.categories.map(row => `<tr><td>${action('category', esc(row.category), row.category)}</td><td>${wan(row.sales)}</td><td>${pct(row.share)}</td><td>${row.deltaYoy == null ? '—' : (row.deltaYoy > 0 ? '+' : '') + wan(row.deltaYoy)}</td><td>${changeText(row.yoy)}</td><td>${changeText(row.mom)}</td></tr>`).join('')}</tbody></table></div>
      <p class="card-note inline">按吉客云货品档案“分类”归组。同比：去年同日期；环比：前一个等长周期。${model.range.start.slice(5)} — ${model.range.end.slice(5)}</p></article>`;
  }

  function trafficCard() {
    const flow = model.flow, traffic = flow.current, previous = flow.previous;
    const byPlatform = flow.selection.dimension === 'platform';
    return `<article class="card span3 flow-card" data-section="traffic">${heading('网店流量与转化', '平台成交口径 · 同一经营周期', 'traffic', '查看店铺明细')}
      <div class="flow-controls" aria-label="流量转化范围与维度">
        <label>平台<select data-flow-field="platform" aria-label="流量平台"><option value="">全部平台</option>${flow.platforms.map(platform => `<option value="${esc(platform)}" ${flow.selection.platform === platform ? 'selected' : ''}>${esc(platform)}</option>`).join('')}</select></label>
        <label>店铺<select data-flow-field="shop" aria-label="流量店铺"><option value="">全部店铺</option>${flow.shopOptions.map(shop => `<option value="${shop.id}" ${flow.selection.shop === shop.id ? 'selected' : ''}>${esc(name(shop))}</option>`).join('')}</select></label>
        <div class="segmented compact" role="group" aria-label="流量表格维度">${action('flow-dimension', '按平台', 'platform', byPlatform ? 'active' : '', `aria-pressed="${byPlatform}"`)}${action('flow-dimension', '按店铺', 'shop', !byPlatform ? 'active' : '', `aria-pressed="${!byPlatform}"`)}</div>
        ${flow.selection.platform || flow.selection.shop ? action('flow-reset', '重置', '', 'text-btn') : ''}
      </div>
      <div class="flow-layout"><div class="metrics two">
        ${metric('访客累计', num(traffic.visitors), traffic.visitors, previous.visitors)}
        ${metric('累计成交转化率', pct(traffic.conversion, 2), traffic.conversion, previous.conversion, 'pp')}
        ${metric('平台成交额', amt(traffic.gmv), traffic.gmv, previous.gmv)}
        ${metric('推广占比', pct(traffic.adRate, 2), traffic.adRate, previous.adRate, 'pp')}
      </div><div class="table-wrap"><table class="flow-table"><thead><tr><th>${byPlatform ? '平台' : '店铺'}</th><th>访客累计</th><th>转化率</th><th>推广 ROI</th></tr></thead><tbody>${flow.rows.map(row => `<tr class="${!byPlatform && flow.selection.shop === row.id ? 'selected' : ''}"><td>${action(byPlatform ? 'flow-platform' : 'flow-shop', esc(name(row)), row.id)}${byPlatform ? `<small class="muted">${row.shopCount} 家店</small>` : ''}</td><td>${num(row.visitors)}</td><td>${pct(row.conversion, 2)}</td><td>${num(row.roas, 2)}</td></tr>`).join('')}</tbody></table></div></div>
      <p class="card-note inline">${traffic.coverage.complete ? '访客按商品×日累计，平台成交与 ERP 净销售分别查看。' : '平台来源缺失或覆盖不足，当前指标保持未知。'}${action('help', '口径说明', '流量与转化')}</p></article>`;
  }

  function guangdongSummary() {
    const gd = model.guangdong;
    const groups = [['no_stock', '无可用库存', gd.noStock], ['urgent', '紧急补货', gd.urgent], ['warning', '补货预警', gd.warning], ['stale', '低周转', gd.stale], ['pending', '数据待校验', gd.pending]];
    return `<div class="gd-section"><div class="gd-heading"><h3>广东仓异常</h3><small>监控 ${gd.watchCount} 个型号 · 快照 ${gd.snapshot.slice(5)}</small>${action('detail', '查看广东仓 ›', 'guangdong')}</div><div class="gd-metrics">${groups.map(([key, label, count]) => `<button data-action="gd-risk" data-value="${key}" class="gd-metric"><span>${label}</span><strong class="${count && key === 'no_stock' ? 'up' : count && key !== 'pending' ? 'warn' : ''}">${count}<small> 个</small></strong><span class="chevron">›</span></button>`).join('')}</div><p class="small muted">补货按生产周期＋安全天数判断；数据待校验单列。</p></div>`;
  }

  function taskTable(tasks) {
    return tasks.length ? table(['事项', '类型 / 店铺', '到期日', '最后进展'], tasks.map(task => [esc(task.title), typeLabel(task.type) + '<small>' + esc(task.shop) + '</small>', task.due || '待排期', task.lastProgress || task.created])) : empty('当前分组没有待处理事项');
  }

  function detail(key, value = '') {
    if (key === 'targets') return { title: '项目年 / 月目标进度', body: `${intro}<p>年度累计：2026-01-01 — ${model.goals.annual.end}；月累计：${model.goals.monthly.start} — ${model.goals.monthly.end}。年、月目标不随下方经营选期变化。</p>${table(['期间', '目标', '已完成', '完成率'], [['2026 年', money(model.goals.annual.target), money(model.goals.annual.actual), pct(model.goals.annual.completion)], ['2026-10 月', money(model.goals.monthly.target), money(model.goals.monthly.actual), pct(model.goals.monthly.completion)]] )}<h3>月目标店铺明细</h3>${table(['店铺', '月目标', '月累计', '完成率', '环比', '同比'], model.goals.rows.map(row => [esc(name(row)), money(row.target), money(row.sales), pct(row.completion), changeText(row.mom), changeText(row.yoy)]))}<p class="card-note">年度同比为去年同日累计；年度进度环比显示较上月末增加的百分点。月累计环比对上月同日，避免与整月比较。</p>` };
    if (key === 'todos') return { title: state.mine ? '我的运营事务' : '全部运营事务', body: `${intro}<p>已逾期：到期日早于 ${model.operations.dueStart}；准备到期：${model.operations.dueStart} — ${model.operations.dueEnd}；周未动：截至今天连续 7 天没有有效进展。</p>${model.operations.rows.map(row => `<h3>${row.title} · ${row.count} 项</h3>${taskTable(row.tasks)}`).join('')}<p class="card-note">工作计划与新品上架分别统计；已完成、已取消事项排除。进展包含状态、阶段、协作记录等业务更新。同一事项可同时命中逾期和周未动。</p>` };
    if (key === 'todoGroup') { const row = model.operations.rows.find(row => row.id === value); return { title: row?.title || '运营事务', body: `${intro}${row ? taskTable(row.tasks) : empty('未找到事项')}<p class="small muted">关闭后保留看板筛选，不修改事项状态。</p>` }; }
    if (key === 'shopPerformance') return { title: '各店铺净销售同比', body: `${intro}<p>${model.range.start} — ${model.range.end}，与去年同日期比较。</p>${table(['店铺', '本期净销售', '去年同期', '同比增减额', '同比'], model.shopPerformance.map(row => [esc(name(row)), money(row.sales), money(row.yearAgo), money(row.deltaYoy), changeText(row.yoy)]))}<p class="card-note">来源完整且去年同期净销售为正，才计算同比幅度。未覆盖、零或负基期不按“下滑”或“新增”处理。</p>` };
    if (key === 'categories' || key === 'category') { const rows = key === 'category' ? model.categories.filter(row => row.category === value) : model.categories; return { title: key === 'category' ? esc(value) + ' · 净销售对比' : '各类目净销售对比', body: `${intro}<p>${model.range.start} — ${model.range.end}；环比基期 ${model.range.previousStart} — ${model.range.previousEnd}。</p>${table(['吉客云分类', '本期', '去年同期', '前期', '同比', '环比'], rows.map(row => [esc(row.category), money(row.sales), money(row.yearAgo), money(row.previous), changeText(row.yoy), changeText(row.mom)]))}<p class="card-note">分类名称以吉客云货品档案的“分类”列为准，通过货品编码关联；无分类归入“未分类”。当前示例货品采用其中5个分类，金额为合成演示。同一货品只归属一个类目，合计与销售总览一致。</p>` }; }
    if (key === 'traffic') return { title: '网店流量与转化', body: `${intro}<p>${model.range.start} — ${model.range.end}，${esc(model.flow.selection.shop ? name(model.flow.members[0]) : model.flow.selection.platform || '当前全部平台')}。</p>${table(['店铺', '访客累计', '成交客户累计', '累计转化率', '平台成交额', '推广花费', 'ROI'], model.flow.members.map(row => [esc(name(row)), num(row.visitors), num(row.buyers), pct(row.conversion, 2), money(row.gmv), money(row.adSpend), num(row.roas, 2)]))}<p class="card-note">成交客户和访客采用同一商品×日累计粒度求比率，不等同店铺去重人数。平台成交与ERP净销售不相加；推广ROI为归因成交÷花费。</p>` };
    if (key === 'guangdong') { const gd = model.guangdong; const rows = value ? gd.items.filter(item => value === 'pending' ? item.pending : item.risk === value) : gd.items;
      return { title: '广东仓 · ' + (value === 'pending' ? '数据待校验' : riskLabels[value] || '异常监控'), body: `${intro}<p>监控清单 ${gd.watchCount} 个型号；快照 ${gd.snapshot}，销量窗口 ${gd.demandStart} — ${gd.demandEnd}。</p>${table(['型号', '可用库存', '近30天销量', '覆盖天数', '生产 / 安全天数', '状态'], rows.map(item => [esc(item.name), num(item.available), num(item.sales30), item.coverageDays == null ? '待校验' : num(item.coverageDays, 1), `${num(item.lead)} / ${num(item.buffer)}`, riskLabels[item.risk]]))}<p class="card-note">无可用库存优先提示；覆盖天数不超过生产周期为紧急，低于生产周期＋安全天数为预警；超过 180 天为低周转。缺销量或生产周期保持待校验，不视为正常或无销量。</p>` };
    }
    return { title: '经营详情', body: intro };
  }

  return { goalCard, todosCard, shopCard, categoriesCard, trafficCard, guangdongSummary, detail };
}
