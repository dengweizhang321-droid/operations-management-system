/** Demo 01: daily operating overview. Shared model and actions own all business facts. */
export function render(ctx) {
  const {model:m,ui,escape:e,money,percent,state:s}=ctx;
  const t=m.totals;
  const salesNote=t.sales===null?'当前范围没有可用 ERP 结果':t.change===null?(s.compare==='none'?'已关闭比较，仅展示本期经营结果':'经营结果可查看，完整比较尚不可用'):`ERP 净销售${t.change>=0?'上升':'下降'} ${percent(Math.abs(t.change))}`;
  const marginNote=t.marginPp===null?'请在数据质量中核对基期与覆盖':`毛利率${t.marginPp>=0?'提升':'下降'} ${Math.abs(t.marginPp).toFixed(1)} 个百分点`;
  const riskShops=m.shops.filter(x=>x.change!==null&&x.change<0);
  const losses=m.products.filter(x=>x.profit!==null&&x.profit<0);
  const spendNote=!t.promotionCoverage?.complete||t.spendChange===null||t.roasPp===null?'推广覆盖不完整时仅展示已覆盖值，不推断全店效率变化':t.spendChange>0&&t.roasPp<0?'花费增加且 ROAS 下降；需核对归因范围与缺失日期':'结合归因成交与花费查看投入效率，不等同于利润率';
  return `<div class="demo01 stack">
    <section class="demo01-intro panel" aria-label="日常经营阅读顺序">
      <div class="demo01-intro-copy"><span class="caption muted">Demo 01 · 均衡经营总览</span><h2>今天先看结果，再看贡献与风险</h2><p>${e(salesNote)}；${e(marginNote)}。</p><span class="caption muted">本页为合成经营数据，选择范围 ${e(s.start)} 至 ${e(s.end)}。专业详情通过演示抽屉打开。</span></div>
      <div class="demo01-reading"><span class="caption">快速阅读</span><nav aria-label="经营分区"><button data-action="section" data-value="results">结果与目标</button><button data-action="section" data-value="shops">增长来自哪里</button><button data-action="section" data-value="inventory">风险在哪里</button><button data-action="section" data-value="quality">数据是否足够</button></nav></div>
    </section>
    <section id="results" data-domain="results" class="demo01-results"><div class="demo01-section-heading"><h2>经营结果与目标</h2><span class="caption muted">ERP 净销售与综合大毛利 · 金额和比率使用一致分子</span></div>${ui.kpis()}</section>
    <section class="demo01-focus grid3" aria-label="优先关注">
      <article class="panel demo01-focus-card"><div class="demo01-focus-title"><span class="demo01-focus-index">01</span><h3>店铺变化</h3></div><p>${riskShops.length?`${riskShops.length} 家店铺在有效比较中下滑`:'检查店铺增减额及覆盖完整性'}</p><span class="caption muted">查看全部店铺的贡献与增长，长店名完整保留。</span><button class="row-action" data-action="section" data-value="shops">查看店铺排行 →</button></article>
      <article class="panel demo01-focus-card"><div class="demo01-focus-title"><span class="demo01-focus-index">02</span><h3>盈利质量</h3></div><p>${losses.length?`${losses.length} 个已覆盖商品综合大毛利为负`:'查看商品销售与综合大毛利贡献'}</p><span class="caption muted">毛利额与毛利率匹配口径，低毛利不等同于亏损。</span><button class="row-action" data-action="section" data-value="products">查看商品贡献 →</button></article>
      <article class="panel demo01-focus-card"><div class="demo01-focus-title"><span class="demo01-focus-index">03</span><h3>供货证据</h3></div><p>库存快照 ${e(m.inventory.snapshot)}${m.inventory.stale?' · 已过期':''}</p><span class="caption muted">当前公司库存独立于所选店铺；销量需求窗口另外标注。</span><button class="row-action" data-action="section" data-value="inventory">核对库存风险 →</button></article>
    </section>
    <div class="demo01-pair demo01-trend-shops"><section>${ui.section('trend')}</section><section>${ui.section('shops')}</section></div>
    <div class="demo01-pair"><section>${ui.section('products')}</section><section>${ui.section('promotion')}<p class="demo01-context caption">${e(spendNote)}</p></section></div>
    <div class="demo01-pair"><section>${ui.section('inventory')}</section><section>${ui.section('finance')}</section></div>
    <section>${ui.section('quality')}</section>
    <section class="demo01-next panel"><div><h3>把问题交给已有专业模块</h3><p class="caption muted">本页保持公司经营总览。进入详情会说明演示身份与未来目标，关闭后保留本页筛选。</p></div><div class="chips"><button data-action="module" data-value="?module=sales&view=overview">销售分析</button><button data-action="module" data-value="?module=shop&view=analysis">店铺全景</button><button data-action="module" data-value="?module=inventory&view=overview">库存管理</button><button data-action="module" data-value="?module=sales&view=finance">月度财报</button></div></section>
  </div>`;
}
