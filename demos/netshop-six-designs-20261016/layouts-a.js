function layout3(p) {
  return `<div class="v3-layout">
    <div class="v3-summary">${p.kpis || ''}</div>
    <div class="v3-workspace">
      <aside class="v3-objects">${p.objects || ''}</aside>
      <div class="v3-focus">
        <div class="v3-detail">${p.detail || ''}</div>
        <div class="v3-trend">${p.chart || ''}</div>
        <div class="v3-observations">${p.insights || ''}</div>
      </div>
    </div>
    <div class="v3-ledger">${p.table || ''}</div>
    <div class="v3-footnote">${p.notes || ''}</div>
  </div>`;
}

function layout4(p) {
  return `<div class="v4-layout">
    <div class="v4-comparison">${p.compare || ''}</div>
    <div class="v4-summary">${p.kpis || ''}</div>
    <div class="v4-analysis">
      <div class="v4-trend">${p.chart || ''}</div>
      <div class="v4-structure">${p.structure || ''}</div>
    </div>
    <div class="v4-observations">${p.insights || ''}</div>
    <div class="v4-ledger">${p.table || ''}</div>
    <div class="v4-footnote">${p.notes || ''}</div>
  </div>`;
}

const extraCssA = `
.v3-layout,.v4-layout{display:grid;gap:16px;min-width:0}
.v3-layout>*,.v4-layout>*,.v3-workspace>*,.v3-focus>*,.v4-analysis>*{min-width:0}
.v3-summary,.v4-summary{min-width:0}
.v3-workspace{display:grid;grid-template-columns:minmax(0,26fr) minmax(0,74fr);gap:18px;align-items:start;min-width:0}
.v3-objects{position:sticky;top:16px;min-width:0}
.v3-objects>.panel{overflow:hidden}
.v3-objects button{max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left}
.v3-focus{display:grid;gap:14px;min-width:0;padding-left:18px;border-left:1px solid #dce4ee}
.v3-detail{min-width:0}
.v3-detail>.panel{border-top:3px solid #5279ad;box-shadow:0 5px 18px rgba(30,58,95,.045)}
.v3-trend,.v3-observations,.v3-ledger,.v3-footnote{min-width:0}
.v3-trend>.panel{background:linear-gradient(180deg,#fff 0%,#fbfcfe 100%)}
.v3-ledger{padding-top:2px}
.v3-ledger>.panel{border-color:#d4deeb}
.v3-footnote:empty,.v3-observations:empty,.v4-footnote:empty,.v4-observations:empty{display:none}
.v4-comparison{min-width:0;position:relative}
.v4-comparison>.panel{border-top:3px solid #456da1;box-shadow:0 5px 20px rgba(35,60,92,.05)}
.v4-comparison table{font-variant-numeric:tabular-nums}
.v4-comparison thead th{background:#f3f6fb}
.v4-comparison tbody tr:nth-child(even){background:#fafbfd}
.v4-comparison td,.v4-comparison th{vertical-align:middle}
.v4-summary .kpi-strip{gap:10px}
.v4-analysis{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr);gap:16px;align-items:stretch;min-width:0}
.v4-trend,.v4-structure{min-width:0;display:grid;align-content:stretch}
.v4-trend>.panel,.v4-structure>.panel{height:100%;min-width:0;box-sizing:border-box}
.v4-structure>.panel{background:linear-gradient(135deg,#fff,#f7f9fc)}
.v4-observations,.v4-ledger,.v4-footnote{min-width:0}
.v4-ledger>.panel{border-top:2px solid #d7e1ee}
@media(max-width:1100px){
 .v3-workspace{grid-template-columns:minmax(0,29fr) minmax(0,71fr);gap:14px}
 .v3-focus{padding-left:14px}
 .v4-analysis{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:899px){
 .v3-layout,.v4-layout{gap:12px}
 .v3-workspace,.v4-analysis{grid-template-columns:minmax(0,1fr);gap:12px}
 .v3-objects{position:static}
 .v3-focus{padding-left:0;border-left:0;gap:12px}
 .v4-trend>.panel,.v4-structure>.panel{height:auto}
}
@media(max-width:520px){
 .v3-layout,.v4-layout{gap:10px}
 .v3-workspace,.v3-focus,.v4-analysis{gap:10px}
 .v3-detail>.panel,.v4-comparison>.panel{border-top-width:2px}
}
`;
