import { addIsoDays, selectedMonthPeriod, shanghaiIsoToday } from "../module-view-shared";
import { parseShellLocation, serializeShellLocation } from "./navigation-contract";
import { defaultShopLocationContext, type ShopLocationContext } from "./shop-context";

const namespace = "teruisi.shop.presentation.v1";
type Binding = { schemaVersion: "shop-presentation-binding-v1"; principalKey: string; location: string; scopeKey: string };
function relative(input: string | URL) { const u = new URL(String(input), "https://teruisi-shell.invalid"); return `${u.pathname}${u.search}${u.hash}`; }
export function shopPresentationWindow(input: string | URL, today = shanghaiIsoToday()) {
  const state = parseShellLocation(input), context = state.shop ?? defaultShopLocationContext, p = state.period;
  let startDate: string, endDate: string;
  if (p.kind === "custom" || p.kind === "previous_year") { startDate = p.from; endDate = p.to; }
  else if (p.kind === "calendar_month") { const window = selectedMonthPeriod(p.month); startDate = window.startDate; endDate = window.endDate > today ? today : window.endDate; }
  else if (p.kind === "yesterday") startDate = endDate = addIsoDays(today, -1);
  else { endDate = today; startDate = p.kind === "today" ? today : p.kind === "last7" ? addIsoDays(today, -6) : p.kind === "last15" ? addIsoDays(today, -14) : p.kind === "last30" ? addIsoDays(today, -29) : `${today.slice(0, 7)}-01`; }
  return { startDate, endDate, period: p, context };
}
export function shopPresentationScopeKey(input: string | URL, today = shanghaiIsoToday()) {
  const { startDate, endDate, period, context } = shopPresentationWindow(input, today);
  return JSON.stringify([startDate, endDate, period, context.platforms, context.outlets, context.dimension]);
}
/** The existing browser history is the only route owner. This binding is a
 * presentation hint, not an authentication receipt or a source revision. */
export function bindShopPresentationHistory(previous: unknown, input: string | URL, principalKey: string | null, today = shanghaiIsoToday()): Record<string, unknown> {
  const state = previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous as Record<string, unknown> } : {};
  delete state[namespace];
  if (principalKey && parseShellLocation(input).module === "shop") state[namespace] = { schemaVersion: "shop-presentation-binding-v1", principalKey, location: relative(input), scopeKey: shopPresentationScopeKey(input, today) } satisfies Binding;
  return state;
}
export function shopPresentationHistoryMatches(history: unknown, input: string | URL, principalKey: string | null, today = shanghaiIsoToday()): boolean {
  if (!principalKey || !history || typeof history !== "object" || Array.isArray(history)) return false;
  const b = (history as Record<string, unknown>)[namespace];
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const v = b as Partial<Binding>;
  return v.schemaVersion === "shop-presentation-binding-v1" && v.principalKey === principalKey && v.location === relative(input) && v.scopeKey === shopPresentationScopeKey(input, today);
}
export function readBoundShopLocationContext(input: string | URL, history: unknown, principalKey: string | null, today = shanghaiIsoToday()): ShopLocationContext {
  const context = parseShellLocation(input).shop ?? defaultShopLocationContext;
  if (shopPresentationHistoryMatches(history, input, principalKey, today)) {
    const focus = context.promotionPrefs?.objectDateFocus;
    const window = shopPresentationWindow(input, today);
    return focus && (focus.startDate < window.startDate || focus.endDate > window.endDate) ? { ...context, promotionPrefs: { ...context.promotionPrefs!, objectDateFocus: null } } : context;
  }
  let returnTo = context.returnTo;
  if (returnTo) {
    const target = parseShellLocation(returnTo);
    if (target.shop) returnTo = serializeShellLocation({ ...target, shop: { ...target.shop, productsPrefs: null, promotionPrefs: null, returnOrigin: null } }, returnTo);
  }
  // Old single return bookmarks retain their existing meaning. New flat origins
  // and shared preferences are restored only in an account-bound history entry.
  return { ...context, productsPrefs: null, promotionPrefs: null, returnOrigin: null, returnTo: context.returnOrigin ? null : returnTo };
}
