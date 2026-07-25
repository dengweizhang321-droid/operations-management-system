import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getMarketDatabase } from "@/lib/market/database";
import {
  confirmMarketPrice,
  confirmMarketBrand,
  applyPublishedMarketMappings,
  createMarketPriceBandVersion,
  getMarketMasterWorkspace,
  getMarketSkuComparison,
  listMarketMasterData,
  listPendingMarketPrices,
  planMissingMarketDownloads,
  publishMarketPriceBandVersion,
  recordMarketDownloadAttempt,
  suggestMarketBrand,
  rollbackMarketPriceBandVersion,
  upsertMarketDownloadConfig,
  upsertMarketMapping,
} from "@/lib/market/admin-service";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (body: JsonRecord, key: string) => typeof body[key] === "string" ? body[key] as string : "";
const texts = (body: JsonRecord, key: string) => Array.isArray(body[key]) ? (body[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];
const numberParam = (params: URLSearchParams, key: string, fallback: number) => {
  const value = params.get(key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} must be an integer`);
  return parsed;
};

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const db = getMarketDatabase();
    const params = new URL(request.url).searchParams;
    const view = params.get("view") ?? "workspace";
    if (view === "master") {
      return Response.json(await listMarketMasterData(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
        rankingDimension: params.get("rankingDimension") ?? undefined,
        operationMode: params.get("operationMode") ?? undefined,
        brand: params.get("brand") ?? undefined,
        subcategory: params.get("subcategory") ?? undefined,
        priceStatus: params.get("priceStatus") as never,
        page: numberParam(params, "page", 1),
        pageSize: numberParam(params, "pageSize", 30),
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "pending_prices") {
      return Response.json(await listPendingMarketPrices(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
        page: numberParam(params, "page", 1),
        pageSize: numberParam(params, "pageSize", 30),
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "compare") {
      return Response.json(await getMarketSkuComparison(db, {
        skuCodes: params.getAll("skuCode"),
        categories: params.getAll("category"),
        scopes: params.getAll("scope"),
        rankingDimensions: params.getAll("rankingDimension"),
        operationModes: params.getAll("operationMode"),
        brands: params.getAll("brand"),
        subcategories: params.getAll("subcategory"),
        priceBands: params.getAll("priceBand"),
        startDate: params.get("startDate") ?? undefined,
        endDate: params.get("endDate") ?? undefined,
      }), { headers: { "cache-control": "no-store" } });
    }
    return Response.json(await getMarketMasterWorkspace(db, {
      q: params.get("q") ?? undefined,
      page: numberParam(params, "page", 1),
      pageSize: numberParam(params, "pageSize", 30),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取市场主数据失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed: unknown = await request.json().catch(() => null);
    if (!record(parsed)) return Response.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
    const action = text(parsed, "action");
    const principal = await requireAppPrincipal(["admin"]);
    const db = getMarketDatabase();
    let result: unknown;
    switch (action) {
      case "confirm_price":
        result = await confirmMarketPrice(db, {
          category: text(parsed, "category"),
          scope: text(parsed, "scope"),
          skuCode: text(parsed, "skuCode"),
          rankingDimension: text(parsed, "rankingDimension"),
          month: text(parsed, "month"),
          imageContentSha256: text(parsed, "imageContentSha256"),
          priceCents: parsed.priceCents,
          priceType: text(parsed, "priceType"),
          priceLowCents: parsed.priceLowCents,
          priceHighCents: parsed.priceHighCents,
          note: text(parsed, "note"),
        }, principal);
        break;
      case "infer_brand":
        result = await suggestMarketBrand(db, {
          modelId: text(parsed, "modelId"),
          productName: text(parsed, "productName"),
        });
        break;
      case "confirm_brand":
        result = await confirmMarketBrand(db, {
          category: text(parsed, "category"),
          scope: text(parsed, "scope"),
          rankingDimension: text(parsed, "rankingDimension"),
          skuCode: text(parsed, "skuCode"),
          brand: text(parsed, "brand"),
        }, principal);
        break;
      case "apply_mappings":
        result = await applyPublishedMarketMappings(db, { category: text(parsed, "category") || undefined }, principal);
        break;
      case "upsert_mapping":
        result = await upsertMarketMapping(db, {
          id: text(parsed, "id"),
          kind: text(parsed, "kind"),
          category: text(parsed, "category"),
          sourceValue: text(parsed, "sourceValue"),
          targetValue: text(parsed, "targetValue"),
          status: text(parsed, "status"),
          effectiveFrom: text(parsed, "effectiveFrom"),
        }, principal);
        break;
      case "create_price_band_version":
        result = await createMarketPriceBandVersion(db, {
          category: text(parsed, "category"),
          effectiveFrom: text(parsed, "effectiveFrom"),
          note: text(parsed, "note"),
          items: Array.isArray(parsed.items) ? parsed.items.filter(record).map((item) => ({
            label: text(item, "label"),
            minCents: typeof item.minCents === "number" ? item.minCents : null,
            maxCents: typeof item.maxCents === "number" ? item.maxCents : null,
          })) : [],
        }, principal);
        break;
      case "publish_price_band_version":
        result = await publishMarketPriceBandVersion(db, text(parsed, "id"), principal);
        break;
      case "rollback_price_band_version":
        result = await rollbackMarketPriceBandVersion(db, { targetVersionId: text(parsed, "targetVersionId") }, principal);
        break;
      case "upsert_download_config":
        result = await upsertMarketDownloadConfig(db, {
          category: text(parsed, "category"),
          scope: text(parsed, "scope"),
          rankingDimension: text(parsed, "rankingDimension"),
          monthStart: text(parsed, "monthStart"),
          monthEnd: text(parsed, "monthEnd"),
          status: text(parsed, "status"),
        }, principal);
        break;
      case "plan_downloads":
        result = await planMissingMarketDownloads(db, {
          category: text(parsed, "category") || undefined,
          scope: text(parsed, "scope") || undefined,
          rankingDimension: text(parsed, "rankingDimension") || undefined,
        }, principal);
        break;
      case "record_download_attempt":
        result = await recordMarketDownloadAttempt(db, {
          taskId: text(parsed, "taskId"),
          status: text(parsed, "status") as never,
          errorCode: text(parsed, "errorCode"),
          errorMessage: text(parsed, "errorMessage"),
        }, principal);
        break;
      case "compare":
        result = await getMarketSkuComparison(db, {
          skuCodes: texts(parsed, "skuCodes"),
          categories: texts(parsed, "categories"),
          scopes: texts(parsed, "scopes"),
          rankingDimensions: texts(parsed, "rankingDimensions"),
          operationModes: texts(parsed, "operationModes"),
          brands: texts(parsed, "brands"),
          subcategories: texts(parsed, "subcategories"),
          priceBands: texts(parsed, "priceBands"),
          startDate: text(parsed, "startDate"),
          endDate: text(parsed, "endDate"),
        });
        break;
      default:
        return Response.json({ error: "不支持的市场主数据操作" }, { status: 400 });
    }
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "市场主数据操作失败" }, { status: 400 });
  }
}
