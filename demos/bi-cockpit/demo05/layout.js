import { aggregate, products, promotion } from '../shared/data.js';

const levels = { platform: '平台', shop: '店铺', category: '品类', product: 'ERP SKU' };

export function render(ctx) {
  const { state: s, model: m, ui, escape: e, money, percent } = ctx;
  const level = levels[s.exploreLevel] ? s.exploreLevel : 'platform';
  const metric = s.exploreMetric === 'profit' ? 'profit' : 'sales';
  const currentShops = m.selectedShops.filter(x => (!s.explorePlatform || x.platform === s.explorePlatform) && (!s.exploreShop || x.id === s.exploreShop));
  const currentProducts = products.filter(x => !s.exploreCategory || x.category === s.exploreCategory);
  const actual = aggregate(s.start, s.end, currentShops, currentProducts);
  const local = s.status === 'empty' ? { ...actual, sales: null, profit: null, margin: null } : actual;
  const ads = s.status === 'empty' || s.status === 'missing' ? { spend: null, attributed: null, roas: null } : promotion(s.start, s.end, currentShops);
  const shop = m.selectedShops.find(x => x.id === s.exploreShop);
  const scope = [s.explorePlatform, shop?.name, s.exploreCategory].filter(Boolean).join(' / ') || '全局筛选范围';
  const crumbs = `<button data-action="explore-reset">全局筛选根节点</button>${s.explorePlatform ? `<span aria-hidden="true">›</span><button data-action="explore-platform" data-value="${e(s.explorePlatform)}">${e(s.explorePlatform)}</button>` : ''}${shop ? `<span aria-hidden="true">›</span><button data-action="explore-shop" data-value="${e(shop.id)}">${e(shop.name)}</button>` : ''}${s.exploreCategory ? `<span aria-hidden="true">›</span><button data-action="explore-category" data-value="${e(s.exploreCategory)}">${e(s.exploreCategory)}</button>` : ''}`;
  const positiveDenominator = m.totals[metric] !== null && m.totals[metric] > 0;
  const share = local[metric] !== null && positiveDenominator ? percent(local[metric] / m.totals[metric]) : '分母非正或未覆盖';
  const riskProducts = new Set(currentProducts.map(p => p.id));
  const risks = m.inventory.items.filter(i => riskProducts.has(i.id) && i.risk !== '正常');
  const related = `<aside class="explore-context panel" aria-label="相关证据与关联边界">
    <h2>相关证据</h2><p class="caption">看上下文，先检查能否关联</p>
    <div class="context-block"><h3>推广：到店铺为止</h3><p>${shop ? e(shop.name) : s.explorePlatform ? e(s.explorePlatform) + '当前店铺集合' : '全局筛选店铺集合'}</p><div class="context-pair"><span>广告花费</span><b>${money(ads.spend)}</b><span>广告归因成交</span><b>${money(ads.attributed)}</b><span>ROAS</span><b>${ads.roas === null ? '未覆盖' : ads.roas.toFixed(2) + ' 倍'}</b></div><p class="caption">没有广告商品归因身份，不分摊到品类或 SKU，不推断广告带来的净增销售。</p><button data-action="section" data-value="d05-ad">查看完整推广证据</button></div>
    <div class="context-block"><h3>库存：公司仓位</h3><p>快照 ${e(m.inventory.snapshot)}；需求 ${e(m.inventory.demandStart)} — ${e(m.inventory.demandEnd)}</p><p class="caption">当前品类对应 ${new Set(risks.map(i => i.id)).size} 个风险 SKU / ${risks.length} 个风险仓位。合成 ERP 编码关联；不按店铺分配货值。快照过期，补货暂不可采纳。</p><div class="context-risk">${risks.slice(0, 2).map(i => `<button data-action="detail-risk" data-value="${e(i.id + '|' + i.warehouse)}">${e(i.name)} · ${e(i.warehouse)} · ${e(i.risk)}</button>`).join('') || '<p class="caption">该路径未发现已知风险仓位；不等于库存完整健康。</p>'}</div><button data-action="section" data-value="d05-stock">查看公司库存证据</button></div>
    <div class="context-block"><h3>财报：公司完整月</h3><p>${e(m.finance.month)} · ${e(m.finance.status)} · 利润 ${money(m.finance.profit)}</p><p class="caption">缺失 ${e(m.finance.missing.join('、'))}。没有 SKU 费用归属，不继续向商品拆分财报利润。</p><button data-action="section" data-value="d05-finance">查看完整月度财报</button></div>
  </aside>`;
  const details = (id, label, explanation, body) => `<details class="explore-evidence" id="${id}" open><summary><span>${label}</span><small>${explanation}</small></summary><div class="evidence-content stack">${body}</div></details>`;
  return `<div class="demo05">
    <section class="explore-intro panel"><div><span class="caption">DEMO 05 · 合成示例 · 经营贡献探索</span><h2>这份经营结果由谁贡献？</h2><p>从同一份 ERP 事实逐层拆解金额，找到贡献和风险，再进入已有专业模块核对。</p></div><div class="explore-stop"><b>有身份才能继续</b><p class="caption">平台商品 SPU、广告归因、公司库存和财报各有边界。相关证据不会冒充因果。</p></div></section>
    <div class="global-result">${ui.section('results')}<p class="caption">以上为全局日期、平台、店铺筛选结果。下面的探索路径是局部范围，点击节点不会悄悄改写全局 KPI。</p></div>
    <div class="explore-workspace">
      <section class="panel explore-tree" aria-labelledby="d05-tree-title">
        <header class="section-head"><div><h2 id="d05-tree-title">经营贡献路径</h2><p class="caption">公司结果 → 平台 → 店铺 → 品类 → ERP SKU</p></div><label>拆解金额<select data-field="exploreMetric"><option value="sales" ${metric === 'sales' ? 'selected' : ''}>ERP 净销售额</option><option value="profit" ${metric === 'profit' ? 'selected' : ''}>综合大毛利额</option></select></label></header>
        <nav class="explore-breadcrumb" aria-label="当前探索路径">${crumbs}</nav>
        <div class="local-result"><div><span class="caption">当前父范围</span><h3>${e(scope)}</h3><p class="caption">${e(s.start)} — ${e(s.end)} · ${s.status === 'empty' ? 'ERP 空数据情景' : local.coverage.complete ? 'ERP 店日完整' : '来源不完整，仅已知小计'}</p></div><div><span class="caption">${metric === 'sales' ? 'ERP 净销售' : '综合大毛利'}</span><strong>${money(local[metric])}</strong><p class="caption">占全局筛选已覆盖同指标 ${share}</p></div></div>
        <div class="explore-next"><h3>按${levels[level]}看贡献</h3><div class="row">${level !== 'platform' ? '<button data-action="explore-up">返回上一级</button>' : ''}<button data-action="explore-reset">重置探索路径</button></div></div>
        ${s.status === 'empty' ? '<div class="empty">ERP 空数据情景：没有可拆解记录。库存、推广与财报保持各自独立来源。</div>' : ui.contribution(level)}
        <p class="notice">子节点金额可加总到当前父范围。毛利率、ROAS 不作为加总拆解指标；父金额为零、负数或缺失时，占比不提供有效贡献解释。负毛利保留在零线左侧。</p>
        <div class="explore-end"><p class="caption">${level === 'product' ? '点击 ERP SKU 打开商品证据。到此停止跨平台商品映射，未核验的 SPU 不参与合计。' : '点击贡献名称进入下一层；面包屑可回到任一上层。'}</p>${shop ? `<button data-action="detail-shop" data-value="${e(shop.id)}">查看当前店铺详情</button>` : ''}</div>
      </section>
      ${related}
    </div>
    <section class="explore-full" aria-label="全局经营证据区"><header class="explore-full-heading"><div><h2>完整经营证据</h2><p>以下各域保留全局筛选与各自时间口径，保证每条经营问题都能回到完整证据。</p></div><button data-action="section" data-value="d05-quality">检查数据资格</button></header>
      ${details('d05-trend', '经营趋势与实际比较范围', '全局日期、平台、店铺；不是局部路径趋势', ui.section('trend'))}
      ${details('d05-business', '店铺与商品完整贡献', '排名、增长下滑、低毛利与负毛利商品', ui.section('shops') + ui.section('products'))}
      ${details('d05-ad', '推广投入与效率', '广告归因成交与 ERP 净销售分开', ui.section('promotion'))}
      ${details('d05-stock', '库存与供货风险', '最新公司快照，独立需求窗口', ui.section('inventory'))}
      ${details('d05-finance', '月度盈利摘要', '最近完整公司财报月，独立月度目标', ui.section('finance'))}
      ${details('d05-quality', '数据质量与经营提示', '来源覆盖、可比较资格与有限市场客服证据', ui.section('quality'))}
    </section>
  </div>`;
}

export function onAction(action, value) {
  if (action !== 'section' || !value.startsWith('d05-')) return false;
  const target = document.getElementById(value);
  if (!target) return false;
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
