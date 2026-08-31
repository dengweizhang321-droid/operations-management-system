import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import { getMarketDatabase } from "@/lib/market/database";
import { createOrResumeMarketImageCacheJob, getMarketImageCacheJob } from "@/lib/market/image-cache-job";
import { parseMarketImageCacheGetQuery, parseMarketImageCachePostBody } from "@/lib/market/image-cache-request";

function noStore(payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场商品图片缓存", "查看");
    const url = new URL(request.url);
    const query = parseMarketImageCacheGetQuery(url.searchParams);
    if (!query.ok) return noStore({ error: query.error }, { status: 400 });
    const job = await getMarketImageCacheJob(getMarketDatabase(), query.value);
    if (!job) return noStore({ error: "图片缓存任务不存在" }, { status: 404 });
    return noStore({ ok: true, job });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return safeApiErrorResponse(error, "市场商品图片缓存状态读取失败", { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场商品图片缓存", "修改");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore({ error: "请求正文必须是合法 JSON 对象" }, { status: 400 });
    }
    const parsed = parseMarketImageCachePostBody(body);
    if (!parsed.ok) return noStore({ error: parsed.error }, { status: 400 });
    const job = await createOrResumeMarketImageCacheJob(getMarketDatabase(), { ...parsed.value, requestedBy: principal.email });
    return noStore({ ok: true, job }, { status: job.status === "completed" ? 200 : 202 });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return safeApiErrorResponse(error, "市场商品图片缓存失败", { headers: { "cache-control": "no-store" } });
  }
}
