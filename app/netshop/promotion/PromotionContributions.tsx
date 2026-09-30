import { useState } from "react";
import type { PromotionInsightsResponse, PromotionObjectRow } from "@/lib/netshop/promotion-insights-contract";
import { CapabilityGap, MetricCell } from "./presentation";

const options = [
  ["spendIncrease", "花费增加"], ["spendDecrease", "花费减少"],
  ["attributedPaymentIncrease", "归因成交增加"], ["attributedPaymentDecrease", "归因成交减少"],
] as const;
export default function PromotionContributions({ data, showPrevious, onChoose }: {
  data: PromotionInsightsResponse; showPrevious: boolean; onChoose: (item: PromotionObjectRow) => void;
}) {
  const [selection, setSelection] = useState<typeof options[number][0]>("spendIncrease");
  const c = data.sections.contributions, rows = c.previous[selection];
  const capability = data.sections.objectCapabilities[data.sections.listScope.objectKind];
  if (capability.status !== "available") return <details className="promotion-contributions"><summary>可比对象增减贡献</summary><CapabilityGap reason={capability.message}/></details>;
  return <details className="promotion-contributions"><summary>可比对象增减贡献</summary>
    <p className="promotion-caption">按当前对象视角的可比全集先配对再取前 10 位，表内搜索和分页不裁剪这个集合。已配对 {c.comparedObjectCount} 个对象，排除 {c.excludedObjectCount} 个不可比对象；各视角同批事实不能相加，不作因果解释。</p>
    <p className="promotion-caption">对象期间 {data.sections.listScope.objectStartDate}—{data.sections.listScope.objectEndDate}，基期按共享日历映射。已核对完整来源而未报告某对象时，只表示已导入集合中的缺席，不能断言平台真实零投放。</p>
    {!showPrevious ? <p className="promotion-caption">开启环比查看本期与基期的对象差额。</p> : <>
      <div className="promotion-trend-tabs">{options.map(([key, label]) => <button type="button" key={key} aria-pressed={selection === key} onClick={() => setSelection(key)}>{label}</button>)}</div>
      {rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>对象 / ID</th><th>店铺</th><th>本期花费</th><th>花费差额</th><th>本期归因成交</th><th>归因成交差额</th></tr></thead><tbody>{rows.map(row => <tr key={row.rowKey}><td>{row.id !== null ? <button type="button" className="row-action" onClick={() => onChoose(row)}>{row.title || row.id}</button> : <strong>{row.title || "来源未提供名称"}</strong>}<small>{row.id ?? "来源未提供 ID"}</small></td><td>{row.platform} · {row.shopName}</td><td><MetricCell metric={row.metrics.spend}/></td><td><MetricCell metric={row.changes.spend.previous}/></td><td><MetricCell metric={row.metrics.attributedPayment}/></td><td><MetricCell metric={row.changes.attributedPayment.previous}/></td></tr>)}</tbody></table></div> : <p className="promotion-caption">当前没有可靠的{options.find(option => option[0] === selection)?.[1]}对象；不把不可比对象归入零变化。</p>}
    </>}
  </details>;
}
