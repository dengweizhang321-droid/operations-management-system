export const TMALL_YIJIU_STORE_KEY = "tmall-yijiu" as const;
export const TMALL_YIJIU_DIRECT_PM_PROTOCOL = "yijiu-direct-pm-v1" as const;
export const tmallDirectPmProtocolHeader = "x-teruisi-tmall-candidate-protocol" as const;
export const tmallDirectPromotionRoute = "/promotion-direct-v1" as const;
export const tmallDirectProductMasterRoute = "/product-master-direct-v1" as const;

export type TmallDirectPmRoute =
  | typeof tmallDirectPromotionRoute
  | typeof tmallDirectProductMasterRoute;

export function isTmallDirectPmRoute(value: string): value is TmallDirectPmRoute {
  return value === tmallDirectPromotionRoute || value === tmallDirectProductMasterRoute;
}

export function tmallDirectPmProtocolError(input: {
  route: string;
  storeKey: string | null;
  protocol: string | string[] | undefined;
}) {
  if (!isTmallDirectPmRoute(input.route)) return null;
  if (input.storeKey !== TMALL_YIJIU_STORE_KEY) {
    return { error: "tmall_direct_pm_store_not_allowed" as const };
  }
  if (input.protocol !== TMALL_YIJIU_DIRECT_PM_PROTOCOL) {
    return { error: "missing_or_invalid_tmall_direct_pm_protocol" as const };
  }
  return null;
}
