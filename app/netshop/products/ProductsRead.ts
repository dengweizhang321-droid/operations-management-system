"use client";

import { useCallback, useRef } from "react";
import { encodeProductIdentity, insightBudget, type InsightsContext } from "@/lib/netshop/insights-contract";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { loadProductDetail, loadProductInsights } from "./data";
import type { ProductDetailResponse, ProductInsightsResponse, ProductSection, ProductSource, ProductSort } from "./contract";

export function productsQuery(props: Pick<NetshopColumnProps, "context" | "startDate" | "endDate" | "periodKind">, sort: ProductSort, detail?: { section: ProductSection; source: ProductSource; page: number }) {
  const { context, startDate, endDate, periodKind } = props;
  const query = new URLSearchParams({ startDate, endDate, periodKind, dimension: context.dimension, page: String(detail?.page ?? context.page), pageSize: String(context.pageSize), sort, q: context.q, category: context.category });
  (context.platforms.length ? context.platforms : ["京东", "天猫"]).forEach(platform => query.append("platform", platform));
  context.outlets.forEach(outlet => query.append("outlet", outlet));
  if (detail && context.product) {
    query.set("productIdentity", encodeProductIdentity(context.product)); query.set("section", detail.section);
    if (detail.section === "daily" || detail.section === "trends") query.set("source", detail.source);
  }
  return query;
}
export function productPrincipalKey(props: Pick<NetshopColumnProps, "currentUser">) {
  return JSON.stringify([props.currentUser?.email ?? "edge-local", props.currentUser?.role ?? "edge-local", props.currentUser?.scopeRestricted ?? false]);
}
type ProductEnvelope = { context: InsightsContext; sectionToken: string };
/** A complete response replaces all sections on version recovery. The UI never
 * patches a new page into a summary from a different source vector. */
export function useProductRead<T extends ProductEnvelope>(query: URLSearchParams, principal: string, load: (query: URLSearchParams, signal: AbortSignal) => Promise<T>) {
  const token = useRef<{ key: string; snapshotToken: string; sectionToken: string } | null>(null);
  const serialized = query.toString();
  const family = new URLSearchParams(serialized); family.delete("page");
  const familyKey = `${principal}:${family}`;
  const scope = `${principal}:${serialized}`;
  const request = useCallback(async (signal: AbortSignal) => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(insightBudget.requestDeadlineMs)]);
    for (let attempt = 0; attempt < insightBudget.attempts; attempt++) {
      const next = new URLSearchParams(serialized);
      if (token.current?.key === familyKey) { next.set("snapshotToken", token.current.snapshotToken); next.set("sectionToken", token.current.sectionToken); }
      try {
        const response = await load(next, bounded);
        if (!bounded.aborted) token.current = { key: familyKey, snapshotToken: response.context.snapshotToken, sectionToken: response.sectionToken };
        return response;
      } catch (error) {
        if (signal.aborted || bounded.aborted) throw error;
        if (error instanceof InsightReadError && error.code.endsWith("revision_changed") && attempt + 1 < insightBudget.attempts) { token.current = null; continue; }
        token.current = null;
        throw error;
      }
    }
    throw new InsightReadError("insights_revision_changed", "来源版本持续变化，请重新读取");
  }, [familyKey, load, serialized]);
  return useScopedRead<T>(scope, request);
}
export const readInsights = (query: URLSearchParams, signal: AbortSignal): Promise<ProductInsightsResponse> => loadProductInsights(query, signal);
export const readDetail = (query: URLSearchParams, signal: AbortSignal): Promise<ProductDetailResponse> => loadProductDetail(query, signal);
