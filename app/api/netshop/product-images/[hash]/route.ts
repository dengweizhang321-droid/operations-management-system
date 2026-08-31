import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductImageMetadata,
} from "@/lib/netshop/database";
import { readNetshopProductImageObject } from "@/lib/netshop/product-image-assets";

type RouteContext = { params: Promise<{ hash: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal();
    const platforms = netshopPlatformsForPrincipal(principal, ["天猫"]);
    const { hash } = await context.params;
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const metadata = await getNetshopProductImageMetadata(db, hash, platforms);
    if (!metadata) return new Response("Not found", { status: 404 });
    const stored = await readNetshopProductImageObject(metadata);
    if (!stored) return new Response("Not found", { status: 404 });
    return new Response(stored.object.body, { headers: {
      "content-type": stored.mimeType,
      "content-length": String(stored.sizeBytes),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: stored.object.httpEtag,
    } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return new Response("Image unavailable", { status: 500 });
  }
}
