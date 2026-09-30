"use client";
import type { InsightsContext, SourceRevision } from "@/lib/netshop/insights-contract";
import { InsightSourceCoverage } from "../shared/components";

export function ProductsCoverage({ context, revisions }: { context: InsightsContext; revisions: SourceRevision[] }) {
  return <details className="np-note np-coverage"><summary>来源截止、覆盖与统计口径</summary><p>所选平台：{context.effectiveScope.platforms.join(" / ")}；实际店铺 {context.effectiveScope.shopKeys.map(key => key.replace("\u001f", " · ")).join("、") || "没有有效店铺"}。</p><ul>{context.freshness.map(source => <li key={source.sourceId}>{source.sourceId}：截止 {source.dataThrough || "未导入记录"}</li>)}</ul>{Object.entries(context.coverageBySource).map(([key, coverage]) => <InsightSourceCoverage key={key} coverage={coverage} label={key} />)}<ul>{context.limitations.map(text => <li key={text}>{text}</li>)}</ul><details><summary>本次参与来源版本</summary><ul>{revisions.map(revision => <li key={`${revision.domain}:${revision.kind}:${revision.scopeKey}`}>{revision.domain} / {revision.kind}：{revision.revision}</li>)}</ul><p>已复核参与来源修订向量；跨领域读取不声明分布式原子快照。</p></details></details>;
}
