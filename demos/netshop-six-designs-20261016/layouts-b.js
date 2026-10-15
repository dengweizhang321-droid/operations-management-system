function layout5(p) {
  return `<div class="v5-layout">
    <header class="v5-heading"><div><span class="v5-eyebrow">诊断优先 · 经营核查视角</span><h2>${p.sectionTitle}</h2></div><p class="small-muted">先读观察与证据，再对照趋势、结构和明细。</p></header>
    <div class="v5-workspace">
      <aside class="v5-evidence stack" aria-label="诊断与证据">
        <section class="panel v5-diagnostic"><div class="v5-section-head"><span class="v5-mark" aria-hidden="true"></span><div><h3>观察与核查线索</h3><p class="small-muted">观察用于定位证据，结论仍需结合业务核验。</p></div></div><div class="v5-insights">${p.insights}</div></section>
        <section class="panel v5-comparison"><div class="v5-section-head"><h3>比较依据</h3></div>${p.compare}</section>
        <div class="v5-notes">${p.notes}</div>
      </aside>
      <main class="v5-main stack">
        <section class="panel v5-result"><div class="v5-section-head"><div><span class="v5-eyebrow">当前范围</span><h3>核心结果</h3></div><span class="small-muted">保留指标原口径</span></div>${p.kpis}</section>
        <section class="panel v5-trend"><div class="v5-section-head"><div><span class="v5-eyebrow">对照走势</span><h3>趋势与变化</h3></div></div>${p.chart}</section>
        <section class="panel v5-data"><div class="v5-section-head"><h3>明细核查</h3><a href="#v5-detail" class="v5-text-link">查看详情 ↓</a></div>${p.table}</section>
      </main>
    </div>
    <section class="v5-bottom"><div class="panel v5-structure"><div class="v5-section-head"><h3>结构与贡献</h3></div>${p.structure}</div><div class="panel v5-objects"><div class="v5-section-head"><h3>对象与关联</h3></div>${p.objects}</div></section>
    <section id="v5-detail" class="panel v5-detail"><div class="v5-section-head"><h3>对象详情与证据</h3><span class="small-muted">沿用同一筛选范围</span></div>${p.detail}</section>
  </div>`;
}

function layout6(p) {
  return `<div class="v6-layout">
    <header class="v6-heading"><div><span class="v6-eyebrow">章节复盘 · 从结果到证据</span><h2>${p.sectionTitle}</h2></div><p class="small-muted">顺序阅读，也可直接定位到需要复盘的章节。</p></header>
    <nav class="v6-chapter-nav" aria-label="复盘章节"><a href="#review-result"><span>结果</span><small>核心表现与比较</small></a><a href="#review-trend"><span>趋势</span><small>走势与观察</small></a><a href="#review-structure"><span>结构</span><small>贡献与对象</small></a><a href="#review-detail"><span>明细</span><small>数据与证据</small></a></nav>
    <main class="v6-chapters">
      <section id="review-result" class="v6-chapter"><header class="v6-chapter-heading"><span class="v6-chapter-symbol" aria-hidden="true">◎</span><div><span class="v6-eyebrow">经营结果</span><h3>先看本期表现</h3></div></header><div class="panel v6-result">${p.kpis}</div><details class="panel v6-fold" open><summary>本期与基期比较<span class="small-muted">展开 / 收起</span></summary><div class="v6-fold-body">${p.compare}</div></details></section>
      <section id="review-trend" class="v6-chapter"><header class="v6-chapter-heading"><span class="v6-chapter-symbol" aria-hidden="true">↗</span><div><span class="v6-eyebrow">时间变化</span><h3>沿着趋势寻找变化</h3></div></header><div class="panel v6-chart">${p.chart}</div><details class="panel v6-fold" open><summary>观察与核查证据<span class="small-muted">展开 / 收起</span></summary><div class="v6-fold-body v6-insights">${p.insights}</div></details></section>
      <section id="review-structure" class="v6-chapter"><header class="v6-chapter-heading"><span class="v6-chapter-symbol" aria-hidden="true">▦</span><div><span class="v6-eyebrow">结构拆解</span><h3>理解贡献与对象关系</h3></div></header><div class="v6-structure-grid"><div class="panel">${p.structure}</div><div class="panel">${p.objects}</div></div></section>
      <section id="review-detail" class="v6-chapter"><header class="v6-chapter-heading"><span class="v6-chapter-symbol" aria-hidden="true">≡</span><div><span class="v6-eyebrow">回到原始证据</span><h3>逐项核对明细</h3></div></header><div class="panel v6-table">${p.table}</div><details class="panel v6-fold" open><summary>对象详情与证据<span class="small-muted">展开 / 收起</span></summary><div class="v6-fold-body">${p.detail}</div></details><div class="v6-notes">${p.notes}</div></section>
    </main>
  </div>`;
}

const extraCssB = `
.v5-layout,.v6-layout,.v5-layout *,.v6-layout *{box-sizing:border-box;min-width:0}
.v5-layout,.v6-layout{--review-line:var(--border,#e3e8ef);--review-ink:var(--text,#1e293b);--review-muted:var(--muted,#64748b);--review-accent:var(--primary,#2563eb);color:var(--review-ink)}
.v5-heading,.v6-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:22px}
.v5-heading h2,.v6-heading h2{margin:7px 0 0;font-size:25px;letter-spacing:-.5px;line-height:1.3}
.v5-heading>p,.v6-heading>p{max-width:360px;margin:0;line-height:1.7}
.v5-eyebrow,.v6-eyebrow{font-size:11px;font-weight:650;letter-spacing:1.1px;color:var(--review-muted)}
.v5-workspace{display:grid;grid-template-columns:minmax(280px,.34fr) minmax(0,1fr);gap:20px;align-items:start}
.v5-evidence,.v5-main{display:flex;flex-direction:column;gap:18px}
.v5-evidence{position:sticky;top:18px}
.v5-layout .panel,.v6-layout .panel{margin:0}
.v5-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:17px}
.v5-section-head h3{font-size:15px;font-weight:650;margin:0;line-height:1.45}
.v5-section-head p{margin:6px 0 0;line-height:1.6}
.v5-section-head>.small-muted{font-size:11px;text-align:right}
.v5-diagnostic{border-top:3px solid var(--review-accent)!important;background:linear-gradient(135deg,#f7faff 0%,#fff 65%)}
.v5-diagnostic>.v5-section-head{justify-content:flex-start;align-items:flex-start}
.v5-mark{display:block;width:9px;height:9px;flex:0 0 9px;margin-top:7px;background:var(--review-accent);border-radius:50%;box-shadow:0 0 0 4px #e8efff}
.v5-insights{display:flex;flex-direction:column;gap:11px}
.v5-insights>*{width:100%;margin:0!important}
.v5-result{overflow:hidden}
.v5-result .kpi-strip{grid-template-columns:repeat(auto-fit,minmax(138px,1fr))}
.v5-text-link{font-size:12px;color:var(--review-accent);text-decoration:none;white-space:nowrap}
.v5-text-link:hover{text-decoration:underline}
.v5-bottom{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-top:20px}
.v5-detail{margin-top:20px!important;scroll-margin-top:24px}
.v5-data,.v5-trend,.v5-structure,.v5-objects,.v5-detail{overflow:hidden}
.v5-notes{font-size:12px;line-height:1.7;color:var(--review-muted)}
.v6-layout{max-width:1420px;margin:0 auto}
.v6-heading{padding-bottom:20px;border-bottom:1px solid var(--review-line);margin-bottom:0}
.v6-chapter-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border-bottom:1px solid var(--review-line);margin-bottom:32px}
.v6-chapter-nav a{position:relative;display:flex;flex-direction:column;gap:5px;padding:17px 20px;text-decoration:none;color:var(--review-ink);transition:background .15s}
.v6-chapter-nav a+a{border-left:1px solid var(--review-line)}
.v6-chapter-nav a:hover,.v6-chapter-nav a:focus-visible{background:#eff5ff;color:var(--review-accent)}
.v6-chapter-nav span{font-size:14px;font-weight:650}
.v6-chapter-nav small{font-size:11px;color:var(--review-muted)}
.v6-chapters{display:flex;flex-direction:column;gap:38px}
.v6-chapter{display:flex;flex-direction:column;gap:14px;scroll-margin-top:24px}
.v6-chapter-heading{display:flex;align-items:center;gap:13px;padding:0 2px}
.v6-chapter-symbol{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border:1px solid #dbe6f6;border-radius:11px;background:#f0f5fd;color:var(--review-accent);font-size:21px}
.v6-chapter-heading h3{font-size:18px;letter-spacing:-.25px;line-height:1.5;margin:3px 0 0}
.v6-result{border-top:2px solid var(--review-accent)!important}
.v6-fold{padding:0!important;overflow:hidden}
.v6-fold>summary{display:flex;align-items:center;gap:10px;list-style:none;padding:17px 20px;cursor:pointer;font-size:13px;font-weight:650;background:#fafbfd}
.v6-fold>summary::-webkit-details-marker{display:none}
.v6-fold>summary:before{content:'›';display:inline-block;color:var(--review-muted);font-size:20px;line-height:1;transition:transform .15s}
.v6-fold[open]>summary:before{transform:rotate(90deg)}
.v6-fold>summary .small-muted{margin-left:auto;font-size:11px;font-weight:400}
.v6-fold[open]>summary{border-bottom:1px solid var(--review-line)}
.v6-fold-body{padding:20px;overflow:hidden}
.v6-insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.v6-insights>*{margin:0!important}
.v6-structure-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
.v6-chart,.v6-table,.v6-structure-grid>.panel{overflow:hidden}
.v6-notes{padding:3px 2px;font-size:12px;line-height:1.7;color:var(--review-muted)}
@media(max-width:1100px){.v5-workspace{grid-template-columns:minmax(255px,.36fr) minmax(0,1fr);gap:16px}.v5-heading,.v6-heading{align-items:flex-start}.v5-result .kpi-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:899px){.v5-workspace,.v5-bottom,.v6-structure-grid{grid-template-columns:minmax(0,1fr)}.v5-evidence{position:static}.v5-heading,.v6-heading{display:flex;flex-direction:column;gap:12px}.v5-heading>p,.v6-heading>p{max-width:none}.v5-bottom{gap:16px}.v6-chapter-nav{grid-template-columns:minmax(0,1fr);margin-bottom:26px}.v6-chapter-nav a{padding:11px 14px;flex-direction:row;align-items:center;gap:14px}.v6-chapter-nav a+a{border-left:0;border-top:1px solid var(--review-line)}.v6-chapters{gap:28px}.v6-insights{grid-template-columns:minmax(0,1fr)}}
@media(max-width:480px){.v5-heading h2,.v6-heading h2{font-size:22px}.v5-section-head{align-items:flex-start}.v5-result .kpi-strip{grid-template-columns:minmax(0,1fr)}.v6-chapter-heading h3{font-size:16px}.v6-fold>summary{padding:14px}.v6-fold-body{padding:14px}.v6-fold>summary .small-muted{font-size:10px}}
`;
