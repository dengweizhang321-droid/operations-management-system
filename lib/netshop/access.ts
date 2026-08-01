import { AuthorizationError, type AppPrincipal } from "@/lib/auth/authorization";

export function netshopPlatformsForPrincipal(principal: AppPrincipal, requestedValues: readonly string[]) {
  const requested = [...new Set(requestedValues.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  if (principal.scope === null) return requested;
  const allowed = new Set(principal.scope.platforms.map((value) => value.trim()).filter(Boolean));
  if (allowed.size === 0) {
    throw new AuthorizationError(403, "access_denied", "当前账号没有可读取的网店平台范围");
  }
  if (requested.some((platform) => !allowed.has(platform))) {
    throw new AuthorizationError(403, "access_denied", "请求包含当前账号无权读取的网店平台");
  }
  return requested.length > 0 ? requested : [...allowed];
}
