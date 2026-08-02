import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getMarketDatabase } from "@/lib/market/database";
import {
  confirmMarketPrice,
  confirmMarketBrand,
  confirmMarketBrandSuggestionsBatch,
  createMarketBrandRecognitionJob,
  applyPublishedMarketMappings,
  createMarketPriceBandVersion,
  getMarketMasterWorkspace,
  getMarketSubcategoryWorkspace,
  getMarketBrandRecognitionJob,
  getMarketBrandSeedWorkspace,
  getMarketSkuComparison,
  getMarketSystemKpis,
  listMarketMasterData,
  listPendingMarketPrices,
  planMissingMarketDownloads,
  publishMarketPriceBandVersion,
  recordMarketDownloadAttempt,
  recognizeNextMarketBrandBatch,
  refreshMarketBrandSeeds,
  runMarketBrandRecognitionJobBatch,
  setMarketBrandRecognitionJobStatus,
  matchMarketBrandSeeds,
  suggestMarketBrand,
  rollbackMarketPriceBandVersion,
  upsertMarketDownloadConfig,
  upsertMarketBrandSeed,
  upsertMarketMapping,
  updateMarketSkuMasterData,
  saveMarketSubcategorySettings,
  type MarketComparisonSelection,
} from "@/lib/market/admin-service";
import { createPriceRecognitionJob, runCloudAnnotationBatch, runNextCloudAnnotation } from "@/lib/market/annotation-service";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (body: JsonRecord, key: string) => typeof body[key] === "string" ? body[key] as string : "";
const texts = (body: JsonRecord, key: string) => Array.isArray(body[key]) ? (body[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];
const comparisonSelection = (value: unknown): MarketComparisonSelection => {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("商品对比身份格式无效"); }
  }
  if (!record(parsed)
    || typeof parsed.skuCode !== "string"
    || typeof parsed.category !== "string"
    || typeof parsed.scope !== "string"
    || typeof parsed.rankingDimension !== "string") {
    throw new Error("商品对比身份格式无效");
  }
  return {
    skuCode: parsed.skuCode,
    category: parsed.category,
    scope: parsed.scope,
    rankingDimension: parsed.rankingDimension as MarketComparisonSelection["rankingDimension"],
  };
};
const comparisonSelections = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("商品对比身份格式无效");
  return value.map(comparisonSelection);
};
const numberParam = (params: URLSearchParams, key: string, fallback: number) => {
  const value = params.get(key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} must be an integer`);
  return parsed;
};
const pendingPriceSourceParam = (params: URLSearchParams, key: string) => {
  const value = params.get(key);
  return value === "ai" || value === "non_ai" ? value : undefined;
};
const workspaceModeParam = (params: URLSearchParams) => {
  const value = params.get("section");
  return value === "database" || value === "brand" || value === "mapping" || value === "subcategory" || value === "data" ? value : "all";
};

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const db = getMarketDatabase();
    const params = new URL(request.url).searchParams;
    const view = params.get("view") ?? "workspace";
    if (view === "system_kpis") {
      return Response.json(await getMarketSystemKpis(db), { headers: { "cache-control": "no-store" } });
    }
    if (view === "master") {
      return Response.json(await listMarketMasterData(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
        rankingDimension: params.get("rankingDimension") ?? undefined,
        operationMode: params.get("operationMode") ?? undefined,
        brand: params.get("brand") ?? undefined,
        subcategory: params.get("subcategory") ?? undefined,
        priceStatus: params.get("priceStatus") as never,
        annotationStatus: params.get("annotationStatus") as never,
        page: numberParam(params, "page", 1),
        pageSize: numberParam(params, "pageSize", 30),
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "pending_prices") {
      return Response.json(await listPendingMarketPrices(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
        candidatePriceSource: pendingPriceSourceParam(params, "priceSource"),
        page: numberParam(params, "page", 1),
        pageSize: numberParam(params, "pageSize", 30),
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "compare") {
      const selectionParams = params.getAll("selection");
      return Response.json(await getMarketSkuComparison(db, {
        skuCodes: params.getAll("skuCode"),
        selections: selectionParams.length ? selectionParams.map(comparisonSelection) : undefined,
        q: params.get("q") ?? undefined,
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
    if (view === "brand_job") {
      return Response.json(await getMarketBrandRecognitionJob(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "brand_seeds") {
      return Response.json(await getMarketBrandSeedWorkspace(db, {
        q: params.get("q") ?? undefined,
        category: params.get("category") ?? undefined,
        page: numberParam(params, "page", 1),
        pageSize: numberParam(params, "pageSize", 30),
      }), { headers: { "cache-control": "no-store" } });
    }
    if (view === "subcategories") {
      return Response.json(await getMarketSubcategoryWorkspace(db, params.get("category") ?? ""), { headers: { "cache-control": "no-store" } });
    }
    return Response.json(await getMarketMasterWorkspace(db, {
      mode: workspaceModeParam(params),
      q: params.get("q") ?? undefined,
      category: params.get("category") ?? undefined,
      rankingDimension: params.get("rankingDimension") ?? undefined,
      operationMode: params.get("operationMode") ?? undefined,
      subcategory: params.get("subcategory") ?? undefined,
      priceStatus: params.get("priceStatus") as never,
      candidatePriceSource: pendingPriceSourceParam(params, "priceSource"),
      annotationStatus: params.get("annotationStatus") as never,
      page: numberParam(params, "page", 1),
      pageSize: numberParam(params, "pageSize", 30),
      pendingPriceCategory: params.get("pendingPriceCategory") ?? undefined,
      pendingPriceSource: pendingPriceSourceParam(params, "pendingPriceSource"),
      pendingPricePage: numberParam(params, "pendingPricePage", 1),
      pendingPricePageSize: numberParam(params, "pendingPricePageSize", 20),
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
      case "update_sku_master":
        result = await updateMarketSkuMasterData(db, {
          originalCategory: text(parsed, "originalCategory"), category: text(parsed, "category"), scope: text(parsed, "scope"),
          rankingDimension: text(parsed, "rankingDimension"), skuCode: text(parsed, "skuCode"), month: text(parsed, "month"),
          productName: text(parsed, "productName"), brand: text(parsed, "brand"), operationMode: text(parsed, "operationMode"),
          subcategory: text(parsed, "subcategory"), priceCents: parsed.priceCents, priceType: text(parsed, "priceType"),
        }, principal);
        break;
      case "save_subcategory_settings":
        result = await saveMarketSubcategorySettings(db, {
          category: text(parsed, "category"),
          renames: Array.isArray(parsed.renames) ? parsed.renames.filter(record).map((item) => ({ source: text(item, "source"), target: text(item, "target") })) : [],
          additions: texts(parsed, "additions"),
        }, principal);
        break;
      case "infer_brand":
        result = await suggestMarketBrand(db, {
          modelId: text(parsed, "modelId"),
          productName: text(parsed, "productName"),
        });
        break;
      case "recognize_brand_batch":
        result = await recognizeNextMarketBrandBatch(db, {
          modelId: text(parsed, "modelId"),
          q: text(parsed, "q"),
          category: text(parsed, "category"),
          batchSize: typeof parsed.batchSize === "number" ? parsed.batchSize : undefined,
        }, principal);
        break;
      case "create_brand_recognition_job":
        result = await createMarketBrandRecognitionJob(db, {
          modelId: text(parsed, "modelId"),
          q: text(parsed, "q"),
          category: text(parsed, "category"),
          batchSize: typeof parsed.batchSize === "number" ? parsed.batchSize : undefined,
        }, principal);
        break;
      case "run_brand_recognition_job_batch":
        result = await runMarketBrandRecognitionJobBatch(db, text(parsed, "jobId"), principal);
        break;
      case "pause_brand_recognition_job":
      case "resume_brand_recognition_job":
        result = await setMarketBrandRecognitionJobStatus(db, {
          id: text(parsed, "jobId"),
          status: action === "pause_brand_recognition_job" ? "paused" : "queued",
        }, principal);
        break;
      case "confirm_brand_suggestions_batch":
        result = await confirmMarketBrandSuggestionsBatch(db, {
          q: text(parsed, "q"),
          category: text(parsed, "category"),
          batchSize: typeof parsed.batchSize === "number" ? parsed.batchSize : undefined,
        }, principal);
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
      case "refresh_brand_seeds":
        result = await refreshMarketBrandSeeds(db, principal);
        break;
      case "upsert_brand_seed":
        result = await upsertMarketBrandSeed(db, {
          canonicalBrand: text(parsed, "canonicalBrand"),
          seedText: text(parsed, "seedText"),
          category: text(parsed, "category"),
          scope: text(parsed, "scope"),
          rankingDimension: text(parsed, "rankingDimension"),
          skuCode: text(parsed, "skuCode"),
        }, principal);
        break;
      case "match_brand_seeds":
        result = await matchMarketBrandSeeds(db, { category: text(parsed, "category") || undefined }, principal);
        break;
      case "create_price_recognition_job":
        result = await createPriceRecognitionJob(db, {
          category: text(parsed, "category"),
          modelId: text(parsed, "modelId"),
          limit: typeof parsed.limit === "number" ? parsed.limit : 100,
        }, principal);
        break;
      case "run_price_recognition_next":
        result = await runNextCloudAnnotation(db, text(parsed, "jobId"));
        break;
      case "run_price_recognition_batch":
        result = await runCloudAnnotationBatch(db, text(parsed, "jobId"), Number(parsed.limit ?? 4));
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
          selections: comparisonSelections(parsed.selections),
          q: text(parsed, "q") || undefined,
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
