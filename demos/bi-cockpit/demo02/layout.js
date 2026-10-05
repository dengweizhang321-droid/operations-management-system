const chapters = [
  ['results', '01', '经营结果', '目标与趋势'],
  ['growth', '02', '增长从哪里来', '店铺与商品贡献'],
  ['profitability', '03', '盈利质量', '毛利与月度财报'],
  ['promotion', '04', '投入是否有效', '推广投入与效率'],
  ['inventory', '05', '供货与资金风险', '库存与补货'],
  ['quality', '06', '结论的证据边界', '来源与经营提示'],
];

function chapter(key, body, intro) {
  const [, number, title, subtitle] = chapters.find(item => item[0] === key);
  return `<section class="report-chapter" data-domain="${key==='results'?'results':'report-chapter'}" id="d02-${key}" aria-labelledby="d02-title-${key}">
    <header class="chapter-heading"><span class="chapter-number">${number}</span><div><h2 id="d02-title-${key}">${title}</h2><p class="caption">${subtitle}</p></div></header>
    <p class="chapter-intro">${intro}</p><div class="stack">${body}</div>
  </section>`;
}

export function render(ctx) {
  const { model: m, state: s, ui, escape: e, money, percent } = ctx;
  const t = m.totals;
  const margin = t.margin === null ? '毛利率尚未覆盖' : `综合毛利率 ${percent(t.margin)}`;
  const base = m.periods.baseline;
  const comparison = base ? `${e(base.start)} — ${e(base.end)}` : '未启用比较';
  const comparable = t.comparable === true;
  let changeStory = '当前范围或基期覆盖不足，变化结论暂不成立。请先阅读来源边界。';
  if (comparable) {
    changeStory = `ERP 净销售额相对基期${t.delta < 0 ? '减少' : '增加'} ${money(Math.abs(t.delta))}，变化幅度 ${percent(t.change)}。`;
    if (t.change === null) changeStory = '基期净销售为零或不可比较，保留本期金额，不自动标为“新增”。';
    if (t.change > 0 && t.profitChange < 0) changeStory += ' 销售增长同时毛利额下降，需要继续看店铺和商品结构。';
  } else if (!base) changeStory = '本期阅读模式：关闭比较后，只讨论当前金额、贡献与覆盖，不生成增减结论。';
  const promoStory = t.spendChange !== null && t.roasPp !== null
    ? `已覆盖广告日期内，推广花费变化 ${percent(t.spendChange)}；ROAS ${t.roasPp < 0 ? '下降' : '上升'} ${Math.abs(t.roasPp).toFixed(2)} 倍。${t.spendChange > 0 && t.roasPp < 0 ? '投入增加而效率下降，建议进入推广分析核对渠道与日期。' : '先核对覆盖日期，再比较不同店铺的投入效率。'}`
    : '推广来源或比较日期未覆盖，当前不能形成效率变化结论。';
  const targetStory = t.sales !== null && t.target !== null && t.target > 0
    ? `ERP 同口径合成目标完成 ${percent(t.sales / t.target)}，${t.sales >= t.target ? '超出' : '距离'}目标 ${money(Math.abs(t.target - t.sales))}。`
    : '同口径目标或销售来源未覆盖，目标完成情况不可计算。';
  const finding = `<div class="report-observation"><h3>阅读提示</h3><p>${changeStory}</p><p>${margin}。${targetStory}</p><p class="caption">这里的判断随共同筛选变化。金额来自 ERP；广告归因与财报利润保留各自口径。</p></div>`;
  return `<div class="demo02">
    <div class="report-cover panel" id="d02-top">
      <div class="report-cover-title"><span class="caption">DEMO 02 · 合成示例 · 章节式经营报告</span><h2>先看结果，再逐章核对贡献与风险</h2><p>以经营问题串联证据，适合完整阅读与月度复盘。</p></div>
      <dl class="report-period"><div><dt>本期经营范围</dt><dd>${e(s.start)} — ${e(s.end)}</dd></div><div><dt>实际比较范围</dt><dd>${comparison}</dd></div><div><dt>报告边界</dt><dd>ERP 按筛选；库存为最新公司快照；财报为完整月</dd></div></dl>
    </div>
    <div class="report-grid">
      <aside class="report-index panel"><h3>报告目录</h3><p class="caption">从问题进入对应章节</p><nav aria-label="经营报告页内目录">${chapters.map(([key,number,title,subtitle]) => `<button data-action="section" data-value="d02-${key}"><span class="index-number">${number}</span><span>${title}<small>${subtitle}</small></span></button>`).join('')}</nav><div class="index-note"><p class="caption">目录只改变阅读位置，不改变日期或对象。店铺与商品详情关闭后保留筛选。</p><button data-action="section" data-value="d02-quality">先检查来源</button></div></aside>
      <article class="report-body" aria-label="章节式经营报告正文">
        ${finding}
        ${chapter('results', `${ui.kpis()}${ui.section('trend')}`, '这一期实现了多少经营结果，距离同口径目标还有多远？销售与毛利趋势共同展示，先确认比较窗口和数据覆盖。')}
        ${chapter('growth', `${ui.section('shops')}${ui.section('products')}`, '把公司结果拆成平台、店铺和商品贡献。增减额解释变化来自哪里；贡献不是因果证明。排行可切指标、查看全部并打开证据详情。')}
        ${chapter('profitability', `<div class="report-observation"><h3>毛利与财报利润分别阅读</h3><p>${margin}。毛利额为 ERP 净销售额减成本，毛利率按汇总分子分母计算。</p><p>销售扩张并不保证盈利改善。低毛利、负毛利和退货比例需要结合上章商品结构核对。</p><p class="caption">财报采用最近完整月，不能把月度利润拆成当前日期范围的日利润。</p></div>${ui.section('finance')}`, '经营毛利说明商品交易质量，月度财报补充费用和最终利润。二者不相加；各自目标必须保持同口径。')}
        ${chapter('promotion', `<div class="report-observation"><p>${promoStory}</p><p class="caption">推广变化只对应已覆盖广告日期，覆盖不齐时不代表全部筛选范围的变化。ROAS = 广告归因成交 ÷ 推广花费，单位为倍；不是利润率。</p></div>${ui.section('promotion')}`, '花了多少、带来多少归因成交、效率如何变化？先比较投入与效率，再进入既有推广分析核对渠道明细。')}
        ${chapter('inventory', ui.section('inventory'), '经营增长能否得到供货支持，资金是否被积压占用？使用最新库存快照和独立销量需求窗口，不随报告选期伪造历史库存。')}
        ${chapter('quality', ui.section('quality'), '最后确认哪些结论成立，哪些仍受缺失来源、延迟和身份关联限制。少量市场、客服和运营提示用于发现问题，完整日志留在详情。')}
        <footer class="report-footer"><span class="caption">报告读完后，可按证据进入已有专业模块。该页面为合成演示。</span><button data-action="section" data-value="d02-top">返回报告摘要</button></footer>
      </article>
    </div>
  </div>`;
}
