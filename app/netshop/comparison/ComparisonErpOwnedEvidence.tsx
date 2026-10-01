"use client";

import { restoreSalesPeriodSeriesPoint, type SalesObservedPeriod, type SalesPeriodsResponse } from "@/lib/netshop/sales-periods-contract";
import { formatNativeIntegerQuantityValue, erpTemporalMessage } from "./ComparisonFormatting";
import type { ErpEvidence } from "./contract";

const sourceMoney = (value: number | null) => value === null ? "—" : `${(value / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元`;
const observedOrderMean = (period: SalesObservedPeriod) => {
  const metric = period.orders.netAmountPerOrder;
  return metric.status !== "available" || metric.value === null ? "—" : `${(metric.value / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元/原始订单分组（观察）`;
};

/** Raw observations remain in a closed evidence layer, separate from primary KPIs. */
export function ComparisonErpOwnedEvidence({ response }: { response: SalesPeriodsResponse }) {
  return <details className="nc-columns nc-erp-owned-evidence"><summary>ERP 原始来源与观察证据</summary>
    <p className="nc-caption">下列数值来自当前授权范围的 ERP 已导入记录。观察日期不是连续店日或结算完整性证明；无记录日期不能直接当作零。原始订单分组均值不是付款客户客单价。</p>
    <div className="nc-trend-pair">{(["current","baseline"] as const).map(kind => {
      const period=response.periodTotals[kind], window=response.periods[kind];
      return <section key={kind}><h3>{kind === "current" ? "本期" : "基期"}原始记录</h3><p className="nc-caption">请求范围 {window.startDate} — {window.endDate}，{window.days} 天；已读 {period.rowCount} 条，观察 {period.observations.observedDateCount} 个业务日期。</p>
        <dl className="nc-erp-values"><dt>观察日期范围</dt><dd>{period.observations.observedDateRanges.length ? period.observations.observedDateRanges.map(range => `${range.startDate} — ${range.endDate}`).join("；") : "未确认已纳入业务日期"}</dd><dt>原生净数量</dt><dd>{formatNativeIntegerQuantityValue(period.values.netQuantity)}</dd><dt>原生正向数量</dt><dd>{formatNativeIntegerQuantityValue(period.values.positiveQuantity)}</dd><dt>原生退回数量</dt><dd>{formatNativeIntegerQuantityValue(period.values.returnQuantity)}</dd><dt>存储成本（未核验历史成本）</dt><dd>{sourceMoney(period.values.costCents)}</dd><dt>净额减存储成本（未核验）</dt><dd>{sourceMoney(period.values.grossProfitCents)}</dd><dt>存储毛利（未核验原历史字段）</dt><dd>{sourceMoney(period.values.reportedGrossProfitCents)}</dd><dt>可用原始订单分组</dt><dd>{period.orders.trustedOrderCount ?? "—"}</dd><dt>缺少可用订单号的记录</dt><dd>{period.orders.missingOrderNoRows ?? "—"}</dd><dt>原始订单分组净额均值（观察）</dt><dd>{observedOrderMean(period)}</dd></dl>
      </section>;
    })}</div>
    <p className="nc-caption">数量沿用 ERP 的原生整数口径，不代表已核验的物理件数。成本、净额减成本及存储毛利的原字段存在性、历史成本和历史映射证据未知；存储毛利可能经过既有写链重算，零成本也不等于已核验真实零。</p>
    <div className="nc-table-scroll" tabIndex={0} aria-label="ERP 原始平台店铺渠道身份，横向滚动"><table className="nc-table"><thead><tr><th>原始平台 / 店铺</th><th>原始渠道</th><th>本期已读记录</th><th>基期已读记录</th></tr></thead><tbody>{response.items.map(item => <tr key={item.identityKey}><td>{item.identity.platform} · {item.identity.rawShopName}</td><td>{item.identity.rawChannel}</td><td>{item.current.rowCount}</td><td>{item.baseline.rowCount}</td></tr>)}</tbody></table></div>
    <p className="nc-caption">此原始身份列表为拥有方分页：{response.candidatePagination.returned}/{response.candidatePagination.filteredCount} 条，完整授权两期候选 {response.candidatePagination.candidateCount} 条。原始身份不等于已验证的历史跨域映射。</p>
    {response.platformSeries && <div className="nc-erp-platform-evidence"><h3>平台完整原始成员与桶观察</h3><p className="nc-caption">成员来自拥有方的完整授权两期并集，不随排名页或搜索缩减。平台桶及订单分组由同次拥有方读取返回；完整日期桶不等于完整结算，均值仍只代表原始订单分组观察。</p>
      {response.platformSeries.items.map(platform => <details className="nc-columns" key={platform.identityKey}><summary>{platform.platform} · {platform.rawCandidateCount} 个原始平台/店铺/渠道身份 · {platform.availability.status === "available" ? "已有授权记录" : "已授权，当前范围无已读记录"}</summary>
        <div className="nc-table-scroll" tabIndex={0} aria-label={`${platform.platform}完整原始成员，横向滚动`}><table className="nc-table"><thead><tr><th>原始平台 / 店铺</th><th>原始渠道</th></tr></thead><tbody>{platform.rawMembers.map(member => <tr key={JSON.stringify([member.platform,member.rawShopName,member.rawChannel])}><td>{member.platform} · {member.rawShopName}</td><td>{member.rawChannel}</td></tr>)}</tbody></table></div>
        <div className="nc-trend-pair">{(["current","baseline"] as const).map(kind => <section key={kind}><h3>{kind === "current" ? "本期" : "基期"}平台原生桶</h3><div className="nc-table-scroll nc-distribution-scroll" tabIndex={0} aria-label={`${platform.platform}${kind === "current" ? "本期" : "基期"}平台原始桶，横向滚动`}><table className="nc-table"><thead><tr><th>业务日期桶</th><th>原生净数量</th><th>原始订单分组</th><th>净额均值（观察）</th><th>观察日期数</th></tr></thead><tbody>{platform[kind].map(point => {
          const decoded=restoreSalesPeriodSeriesPoint(point);
          return <tr key={decoded.window.startDate}><td>{decoded.window.startDate} — {decoded.window.endDate}</td><td>{formatNativeIntegerQuantityValue(decoded.facts.values.netQuantity)}</td><td>{decoded.facts.orders.trustedOrderCount ?? "—"}</td><td>{observedOrderMean(decoded.facts)}</td><td>{decoded.facts.observations.observedDateCount}</td></tr>;
        })}</tbody></table></div></section>)}</div>
      </details>)}
    </div>}
  </details>;
}

export function ComparisonErpEvidence({ evidence }: { evidence: ErpEvidence }) {
  return <section className="nc-erp-evidence" aria-label="ERP 来源与观察口径">
    <p className="nc-notice" role={evidence.state === "error" ? "alert" : "status"}>{evidence.state === "ready" ? "ERP 已读记录可查看；观察日期不代表完整店日结算。" : evidence.state === "error" ? "ERP 来源读取失败，当前不能确认该范围。" : "当前范围 ERP 来源不可用，不推断业务记录不存在。"} {erpTemporalMessage(evidence.temporalState)}</p>
    <details className="nc-columns"><summary>ERP 店铺关联与日期观察</summary>
      <p className="nc-caption">关联为本轮原始平台、店铺和渠道的精确别名解析，不证明历史商品关系或官方分类。</p>
      <div className="nc-table-scroll" tabIndex={0} aria-label="ERP 精确来源关联，横向滚动"><table className="nc-table"><thead><tr><th>经营店铺</th><th>关联状态</th><th>原始店铺 / 渠道</th></tr></thead><tbody>{evidence.mappings.map(mapping => <tr key={mapping.shopKey}><td>{mapping.shopKey.replace("\u001f"," · ")}</td><td>{mapping.status === "verified_alias" ? "当前精确别名已核验" : mapping.status === "ambiguous" ? "关联不唯一" : "尚未关联"}</td><td>{mapping.rawIdentity ? `${mapping.rawIdentity.platform} · ${mapping.rawIdentity.rawShopName} · ${mapping.rawIdentity.rawChannel}` : "—"}</td></tr>)}</tbody></table></div>
      <ul className="nc-source-list">{Object.entries(evidence.observations).map(([key,observation]) => <li key={key}><strong>{observation.period === "current" ? "本期" : "基期"} · {observation.objectKey === "summary" ? "当前授权范围" : observation.objectKey.replace(/^shop:/,"").replace("\u001f"," · ")}</strong><p>{observation.startDate} — {observation.endDate}；已观察 {observation.observedShopDatePairs ?? "未确认"} 店日。结算完整性未知，不等同请求范围已完整覆盖。</p>{observation.observedByShop.map(shop => <p key={shop.shopKey}>{shop.shopKey.replace("\u001f"," · ")}：{shop.dates.join("、")}</p>)}</li>)}</ul>
    </details>
    {evidence.source && <ComparisonErpOwnedEvidence response={evidence.source} />}
    {evidence.platformPeriods && <details className="nc-columns nc-erp-platform-periods"><summary>各平台整期原始来源</summary><p className="nc-caption">各平台整期数值来自拥有方对该平台完整原始身份范围的独立读取，使用本页原两期日期；不以主图日期桶或全范围总额代替。观察记录仍不证明完整结算。</p>{evidence.platformPeriods.map(item => <section key={item.platform}><h3>{item.platform}整期来源</h3><ComparisonErpOwnedEvidence response={item.source} /></section>)}</details>}
  </section>;
}
