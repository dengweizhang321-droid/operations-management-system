import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getCachedMarketImage } from "@/lib/market/image-cache";

type RouteContext = { params: Promise<{ hash: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAppPrincipal();
    const { hash } = await context.params;
    const cached = await getCachedMarketImage(hash.toLowerCase());
    if (!cached) return new Response("Not found", { status: 404 });
    return new Response(cached.object.body, { headers: {
      "content-type": cached.mimeType,
      "content-length": String(cached.sizeBytes),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: cached.object.httpEtag,
    } });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return new Response("Image unavailable", { status: 500 });
  }
}
