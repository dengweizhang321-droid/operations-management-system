import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import type { AppPrincipal } from "../lib/auth/authorization";
import { getSalesCategoryAnalysis, getSalesCategoryOutletBreakdown } from "../lib/sales/category-analysis";
import type { SalesDatabase } from "../lib/sales/database";
import { routeSalesReadRequest, type SalesGatewayConfig } from "../lib/django/sales-gateway";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env={};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { getSalesSummary } = await import("../lib/sales/summary");

type SqlValue = string | number | bigint | Uint8Array | null;

function adapter(sqlite: DatabaseSync): SalesDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: SqlValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SqlValue[]; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  } as SalesDatabase;
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function jsonResponse(payload: unknown): Response {
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}

function firstDifferences(left: unknown, right: unknown, path = "$", output: string[] = []): string[] {
  if (output.length >= 12) return output;
  if (Object.is(left, right)) return output;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) output.push(`${path}.length:${left.length}!=${right.length}`);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      firstDifferences(left[index], right[index], `${path}[${index}]`, output);
      if (output.length >= 12) break;
    }
    return output;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      firstDifferences(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`,
        output,
      );
      if (output.length >= 12) break;
    }
    return output;
  }
  output.push(`${path}:${JSON.stringify(left)}!=${JSON.stringify(right)}`.slice(0, 500));
  return output;
}

async function main() {
  const source = required(process.argv[2], "D1 source path");
  const startDate = process.argv[3] ?? "2026-08-01";
  const endDate = process.argv[4] ?? "2026-08-27";
  const secret = required(process.env.TERUISI_DJANGO_INTERNAL_SECRET, "TERUISI_DJANGO_INTERNAL_SECRET");
  const djangoBaseUrl = required(process.env.TERUISI_DJANGO_SALES_BASE_URL, "TERUISI_DJANGO_SALES_BASE_URL");
  const sqlite = new DatabaseSync(source, { readOnly: true });
  const db = adapter(sqlite);
  const revisionRow = sqlite.prepare(
    "SELECT sales_revision, erp_product_revision FROM sales_overview_cache_state WHERE id = 1",
  ).get() as { sales_revision: number; erp_product_revision: number } | undefined;
  if (!revisionRow) throw new Error("source revision is missing");
  const revision = `${revisionRow.sales_revision}:${revisionRow.erp_product_revision}`;
  const unrestricted: AppPrincipal = {
    email: "system-check@example.test",
    displayName: "System Check",
    role: "admin",
    scope: null,
  };
  const scoped: AppPrincipal = {
    ...unrestricted,
    role: "analyst",
    scope: { warehouses: [], channels: [], platforms: ["京东"] },
  };
  const config: SalesGatewayConfig = {
    mode: "shadow",
    djangoBaseUrl,
    internalSecret: secret,
    timeoutMs: 30_000,
    maxResponseBytes: 8 * 1024 * 1024,
  };
  const results: Array<{ contract: string; shadow: string | null; status: number }> = [];

  async function compare(contract: string, url: string, principal: AppPrincipal, legacy: () => Promise<Response>) {
    let legacyJson: unknown = null;
    const capturedLegacy = async () => {
      const response = await legacy();
      legacyJson = await response.clone().json();
      return response;
    };
    const response = await routeSalesReadRequest({
      request: new Request(url),
      principal,
      expectedRevision: revision,
      readCurrentRevision: async () => {
        const row = sqlite.prepare(
          "SELECT sales_revision, erp_product_revision FROM sales_overview_cache_state WHERE id = 1",
        ).get() as { sales_revision: number; erp_product_revision: number };
        return `${row.sales_revision}:${row.erp_product_revision}`;
      },
      config,
      legacy: capturedLegacy,
    });
    await response.arrayBuffer();
    const shadow = response.headers.get("x-teruisi-sales-shadow-result");
    results.push({ contract, shadow, status: response.status });
    if (response.status !== 200 || shadow !== "match") {
      const django = await routeSalesReadRequest({
        request: new Request(url),
        principal,
        expectedRevision: revision,
        readCurrentRevision: async () => revision,
        config: { ...config, mode: "django" },
        legacy: async () => { throw new Error("django diagnostic must not call legacy"); },
      });
      const djangoJson = await django.json();
      const differences = firstDifferences(legacyJson, djangoJson);
      throw new Error(
        `${contract} shadow comparison failed: status=${response.status} result=${shadow} differences=${differences.join(" | ")}`,
      );
    }
  }

  const summaryInput = {
    range: "custom" as const,
    startDate,
    endDate,
    productQueries: [],
    platforms: [],
    outlets: [],
    categories: [],
  };
  for (const projection of ["dashboard", "full"] as const) {
    const query = new URLSearchParams({ range: "custom", startDate, endDate });
    if (projection === "dashboard") query.set("view", "dashboard");
    await compare(
      `summary-${projection}`,
      `http://localhost/api/sales/summary?${query}`,
      unrestricted,
      async () => {
        const payload = await getSalesSummary(db, summaryInput);
        if (projection === "full") return jsonResponse({ projection: "full", ...payload });
        return jsonResponse({
          projection: "dashboard",
          range: payload.range,
          startDate: payload.startDate,
          endDate: payload.endDate,
          requestedStartDate: payload.requestedStartDate,
          requestedEndDate: payload.requestedEndDate,
          dataCutoffDate: payload.dataCutoffDate,
          periodAdjustedToDataCutoff: payload.periodAdjustedToDataCutoff,
          comparisonDayCount: payload.comparisonDayCount,
          current: payload.current,
          previous: payload.previous,
          yearAgo: payload.yearAgo,
          outlets: payload.outlets,
          daily: payload.daily,
          latestBatch: payload.latestBatch,
        });
      },
    );
  }

  const categoryInput = { startDate, endDate, pageSize: 100 };
  const categoryPayload = await getSalesCategoryAnalysis(db, categoryInput, unrestricted);
  await compare(
    "category-unrestricted",
    `http://localhost/api/sales/category-analysis?startDate=${startDate}&endDate=${endDate}&pageSize=100`,
    unrestricted,
    async () => jsonResponse(categoryPayload),
  );
  await compare(
    "category-principal-scope",
    `http://localhost/api/sales/category-analysis?startDate=${startDate}&endDate=${endDate}&platform=${encodeURIComponent("京东")}&pageSize=100`,
    scoped,
    async () => jsonResponse(await getSalesCategoryAnalysis(db, { ...categoryInput, platforms: ["京东"] }, scoped)),
  );
  const firstCategory = categoryPayload.details.items[0]?.category;
  if (!firstCategory) throw new Error("category analysis returned no detail category");
  await compare(
    "category-detail",
    `http://localhost/api/sales/category-analysis/detail?startDate=${startDate}&endDate=${endDate}&category=${encodeURIComponent(firstCategory)}`,
    unrestricted,
    async () => jsonResponse(await getSalesCategoryOutletBreakdown(db, { startDate, endDate, category: firstCategory }, unrestricted)),
  );
  sqlite.close();
  process.stdout.write(`${JSON.stringify({ revision, startDate, endDate, results })}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
