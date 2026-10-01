import type { ComponentType } from "react";
import type { CurrentUser } from "../../module-view-shared";
import type { ImportSourceKey, ModuleKey } from "../../shell/navigation-catalog";
import type { ShopLocationContext, ShopDrillScope } from "../../shell/shop-context";
import type { NetshopView } from "./navigation";
import type { ProductIdentity } from "@/lib/netshop/insights-contract";
import PromotionInsightsView from "../promotion/PromotionInsightsView";
import ProductsColumn from "../products/ProductsColumn";
import ComparisonColumn from "../comparison/ComparisonColumn";
import StorePanoramaView from "../panorama/StorePanoramaView";

export type NetshopColumnProps = {
  startDate: string; endDate: string; periodKind: string;
  context: ShopLocationContext; currentUser: CurrentUser | null;
  onContextChange: (next: Partial<ShopLocationContext>) => void;
  onModuleViewChange: (view: NetshopView) => void;
  onDrill: (view: NetshopView, product: ProductIdentity | null, section?: string, scopePatch?: ShopDrillScope) => void;
  onReturn: () => void;
  onApplyPeriod?: (startDate: string, endDate: string, intent?: "rolling" | "quarter") => void;
  onNavigate: (key: ModuleKey, source?: ImportSourceKey) => void;
  /** Enabled by I only after the actual promotion exact-product reader/UI pair is verified. */
  supportsPromotionProductDrill?: boolean;
};
/** I's single registration point after each real column and its API are merged.
 * Only implemented columns with their reader API are registered. O keeps the
 * separate classic/balanced path, so outlets cannot be replaced here.
 */
export const netshopColumnModules: Partial<Record<Exclude<NetshopView, "outlets">, ComponentType<NetshopColumnProps>>> = {
  products: ProductsColumn,
  promotion: PromotionInsightsView,
  platforms: ComparisonColumn,
  analysis: StorePanoramaView,
};
// The candidate contains A's exact productIdentity reader and its real UI.
// I publishes this capability only together with the independently verified M4 combination.
export const netshopColumnCapabilities = { supportsPromotionProductDrill: true };
