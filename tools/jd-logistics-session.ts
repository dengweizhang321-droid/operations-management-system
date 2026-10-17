import type { Frame, Page } from "playwright-core";
import type { JdStore } from "../lib/jd/store-registry";
import { jdLogisticsSourceUrls } from "../lib/jd/logistics-policy";
import type { JdLogisticsSource } from "../lib/inventory/jd-logistics-contract";
import { autoLoginJdWithWindowsDpapiCredential, inspectJdLoginPageState } from "./jd-saved-login";
import { readJdRuntimeCredential } from "./jd-secure-credential";

const businessFrames: Record<JdLogisticsSource, RegExp> = {
  flow: /^https:\/\/scsw\.jdl\.com\/stockBusiness\/warehouseInventoryRunningQuery(?:New)?(?:$|[/?#])/,
  shop_products: /^https:\/\/scsw\.jdl\.com\/storeGoods\/list(?:$|[/?#])/,
  realtime_inventory: /^https:\/\/kadashboard\.jdl\.com\/Storage\/RealInventory(?:$|[/?#])/,
  inventory_snapshot: /^https:\/\/kadashboard\.jdl\.com\/Storage\/OfflineInventorySmall(?:$|[/?#])/,
};
// Existing JD passport origins only. An unobserved logistics password form
// must be reviewed before it can receive the merchant account's credentials.
const loginOrigins = new Set(["https://passport.jd.com", "https://passport.shop.jd.com"]);
function origin(url: string) { try { return new URL(url).origin; } catch { return ""; } }
function fail(code: string): never { throw new Error(`JD_LOGISTICS_${code}`); }

export function isJdLogisticsLoginOrigin(url: string) {
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && loginOrigins.has(parsed.origin);
  } catch { return false; }
}

/** One browser operation, one credential attempt. Never retries an export or
 * treats the generic merchant shell as logistics authentication evidence. */
export function createJdLogisticsSessionGuard(
  store: Pick<JdStore, "storeKey" | "enabled" | "loginMode">,
  assertOwner: () => Promise<void>,
  dependencies = { login: autoLoginJdWithWindowsDpapiCredential, inspect: inspectJdLoginPageState, load: readJdRuntimeCredential },
) {
  let attempted = false;
  return async (page: Page, kind: JdLogisticsSource): Promise<Frame> => {
    await assertOwner();
    const expectedPortal = origin(jdLogisticsSourceUrls[kind]);
    let restoredTarget = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await dependencies.inspect(page);
      if (state.challengePresent) fail("LOGIN_CHALLENGE_MANUAL_ACTION");
      if (state.credentialRejected) fail("LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION");
      if (state.temporarilyLocked) fail("LOGIN_LOCKED_MANUAL_ACTION");
      const frames = page.frames();
      const logins = frames.filter(frame => isJdLogisticsLoginOrigin(frame.url()));
      const businesses = frames.filter(frame => businessFrames[kind].test(frame.url()));
      if (logins.length > 1) fail("LOGIN_CONTROL_AMBIGUOUS");
      if (businesses.length > 1) fail("BUSINESS_FRAME_AMBIGUOUS");
      if (logins.length) {
        if (!attempted) {
          if (!store.enabled || store.loginMode !== "windows_dpapi_credentials") fail("LOGIN_REQUIRED");
          attempted = true; // Includes missing/rejected/unknown submission: never resubmit.
          const authorize = async (frame: Frame) => {
            await assertOwner();
            const current = await dependencies.inspect(page);
            if (current.challengePresent) fail("LOGIN_CHALLENGE_MANUAL_ACTION");
            if (current.credentialRejected) fail("LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION");
            if (current.temporarilyLocked) fail("LOGIN_LOCKED_MANUAL_ACTION");
            if (!isJdLogisticsLoginOrigin(frame.url()) || !page.frames().includes(frame)
              || ![expectedPortal, ...loginOrigins].includes(origin(page.url()))) fail("LOGIN_ORIGIN_REJECTED");
          };
          let result;
          try { result = await dependencies.login(page, store.storeKey, async key => {
            if (key !== store.storeKey) fail("LOGIN_STORE_MISMATCH");
            await authorize(logins[0]);
            try { return await dependencies.load(key); } catch { return fail("LOGIN_CREDENTIAL_UNAVAILABLE_MANUAL_ACTION"); }
          }, 20_000, authorize); }
          catch (error) {
            if (error instanceof Error && /^JD_LOGISTICS_[A-Z_]+$/.test(error.message)) throw error;
            return fail("LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION");
          }
          if (!result.submitted) {
            if (result.reason === "challenge_present") fail("LOGIN_CHALLENGE_MANUAL_ACTION");
            if (result.reason === "login_control_ambiguous") fail("LOGIN_CONTROL_AMBIGUOUS");
            fail("LOGIN_FORM_NOT_READY_MANUAL_ACTION");
          }
        }
      } else {
        const text = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
        if (/验证码|扫码登录|短信验证|安全验证|密码登录/.test(text)) fail("LOGIN_REQUIRED");
        if (origin(page.url()) !== expectedPortal) fail("LOGIN_ORIGIN_REJECTED");
        if (businesses.length === 1 && await businesses[0].locator("body").isVisible().catch(() => false)) {
          // Existing precise department identity verification still follows.
          await assertOwner();
          return businesses[0];
        }
        if (attempted && !restoredTarget && text.trim() && page.url() !== jdLogisticsSourceUrls[kind]) {
          await assertOwner(); restoredTarget = true;
          await page.goto(jdLogisticsSourceUrls[kind], { waitUntil: "domcontentloaded", timeout: 60000 });
        }
      }
      await page.waitForTimeout(400);
    }
    return fail(attempted ? "LOGIN_NOT_COMPLETED_MANUAL_ACTION" : "BUSINESS_FRAME_NOT_READY");
  };
}
