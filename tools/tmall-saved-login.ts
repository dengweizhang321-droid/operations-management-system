import type { Frame, Page } from "playwright-core";

export type TmallSavedCredentialLoginResult = {
  attempted: boolean;
  submitted: boolean;
  reason:
    | "submitted"
    | "login_form_missing"
    | "challenge_present"
    | "saved_credentials_missing"
    | "login_control_missing"
    | "login_control_ambiguous";
};

type LoginFrameProbe = {
  formFound: boolean;
  challengePresent: boolean;
  savedCredentialsReady: boolean;
  submitted: boolean;
  controlCount: number;
  passwordModeControlCount: number;
  passwordModeSwitched: boolean;
};

async function probeLoginFrame(frame: Frame, action: "probe" | "submit" | "switch_password_mode" = "probe"): Promise<LoginFrameProbe> {
  return frame.evaluate((requestedAction) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const view = element.ownerDocument.defaultView;
      const style = view?.getComputedStyle(element);
      return rect.width > 2 && rect.height > 2 && style?.visibility !== "hidden" && style?.display !== "none";
    };
    const fieldName = (input: HTMLInputElement) => [
      input.type,
      input.name,
      input.id,
      input.getAttribute("autocomplete"),
      input.getAttribute("placeholder"),
      input.getAttribute("aria-label"),
    ].filter(Boolean).join(" ");
    const bodyText = String(document.body?.innerText ?? "");
    const challengePresent = /安全验证|人机验证|短信验证码|动态验证码|滑块验证|请.{0,8}(?:滑动|拖动)/.test(bodyText)
      || Array.from(document.querySelectorAll("iframe")).some((element) => visible(element)
        && /captcha|verify|challenge|punish/i.test(element.getAttribute("src") ?? ""))
      || Array.from(document.querySelectorAll("input")).some((input) => visible(input)
        && /captcha|verify|challenge|验证码|校验码|动态码/i.test(fieldName(input)));
    const inputs = Array.from(document.querySelectorAll("input")).filter(visible);
    const password = inputs.find((input) => String(input.type).toLowerCase() === "password"
      || /pass|密码/i.test(fieldName(input)));
    const account = inputs.find((input) => input !== password
      && /user|account|login|phone|mobile|name|账号|账户|会员名|手机号/i.test(fieldName(input)))
      ?? inputs.find((input) => input !== password
        && ["text", "tel", "email"].includes(String(input.type || "text").toLowerCase()));
    const passwordModeControls = Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"]'))
      .filter(visible)
      .filter((element) => ["密码登录", "账号密码登录"].includes(String(element.textContent ?? "").replace(/\s+/g, "").trim()));
    if (requestedAction === "switch_password_mode") {
      if (passwordModeControls.length === 1) (passwordModeControls[0] as HTMLElement).click();
      return {
        formFound: Boolean(account && password),
        challengePresent,
        savedCredentialsReady: false,
        submitted: false,
        controlCount: 0,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: passwordModeControls.length === 1,
      };
    }
    if (!account || !password) {
      return {
        formFound: false,
        challengePresent,
        savedCredentialsReady: false,
        submitted: false,
        controlCount: 0,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: false,
      };
    }
    account.focus();
    password.focus();
    account.focus();
    const accountAutofilled = (() => { try { return account.matches(":-webkit-autofill"); } catch { return false; } })();
    const passwordAutofilled = (() => { try { return password.matches(":-webkit-autofill"); } catch { return false; } })();
    if (!accountAutofilled || !passwordAutofilled || challengePresent) {
      return {
        formFound: true,
        challengePresent,
        savedCredentialsReady: accountAutofilled && passwordAutofilled,
        submitted: false,
        controlCount: 0,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: false,
      };
    }
    const controls = Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"],a'))
      .filter(visible)
      .filter((element) => {
        const label = String(element.tagName === "INPUT"
          ? element.getAttribute("value") ?? ""
          : element.textContent ?? "").replace(/\s+/g, "").trim();
        return ["登录", "立即登录"].includes(label);
      })
      .filter((element, _index, candidates) => !candidates.some((other) => other !== element && element.contains(other)));
    if (controls.length !== 1) {
      return {
        formFound: true,
        challengePresent: false,
        savedCredentialsReady: true,
        submitted: false,
        controlCount: controls.length,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: false,
      };
    }
    const control = controls[0]!;
    if (control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") {
      return {
        formFound: true,
        challengePresent: false,
        savedCredentialsReady: true,
        submitted: false,
        controlCount: 0,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: false,
      };
    }
    if (requestedAction !== "submit") {
      return {
        formFound: true,
        challengePresent: false,
        savedCredentialsReady: true,
        submitted: false,
        controlCount: 1,
        passwordModeControlCount: passwordModeControls.length,
        passwordModeSwitched: false,
      };
    }
    for (const input of [account, password]) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    (control as HTMLElement).click();
    return {
      formFound: true,
      challengePresent: false,
      savedCredentialsReady: true,
      submitted: true,
      controlCount: 1,
      passwordModeControlCount: passwordModeControls.length,
      passwordModeSwitched: false,
    };
  }, action);
}

/**
 * Submit only a username and password that Chromium has already autofilled in
 * the store's dedicated profile. Field values are never read or transported.
 */
export async function autoLoginTmallWithSavedBrowserCredentials(
  page: Pick<Page, "frames">,
  waitMs = 8_000,
  wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
): Promise<TmallSavedCredentialLoginResult> {
  const deadline = Date.now() + Math.max(0, waitMs);
  let formFound = false;
  let savedCredentialsReady = false;
  let passwordModeSelected = false;
  do {
    const frameProbes = await Promise.all(page.frames().map(async (frame) => ({
      frame,
      probe: await probeLoginFrame(frame).catch(() => ({
        formFound: false,
        challengePresent: false,
        savedCredentialsReady: false,
        submitted: false,
        controlCount: 0,
        passwordModeControlCount: 0,
        passwordModeSwitched: false,
      })),
    })));
    const probes = frameProbes.map(({ probe }) => probe);
    if (probes.some((probe) => probe.challengePresent)) {
      return { attempted: false, submitted: false, reason: "challenge_present" };
    }
    if (!probes.some((probe) => probe.formFound) && !passwordModeSelected) {
      const passwordModeFrames = frameProbes.filter(({ probe }) => probe.passwordModeControlCount === 1);
      const passwordModeControlCount = probes.reduce((total, probe) => total + probe.passwordModeControlCount, 0);
      if (passwordModeControlCount > 1) {
        return { attempted: false, submitted: false, reason: "login_control_ambiguous" };
      }
      if (passwordModeFrames.length === 1) {
        const switched = await probeLoginFrame(passwordModeFrames[0]!.frame, "switch_password_mode").catch(() => null);
        passwordModeSelected = Boolean(switched?.passwordModeSwitched);
        if (passwordModeSelected) {
          if (Date.now() >= deadline) break;
          await wait(Math.min(250, Math.max(0, deadline - Date.now())));
          continue;
        }
      }
    }
    const ready = probes.filter((probe) => probe.savedCredentialsReady);
    const eligibleFrames = frameProbes.filter(({ probe }) => probe.savedCredentialsReady && probe.controlCount === 1);
    if (ready.some((probe) => probe.controlCount > 1) || eligibleFrames.length > 1) {
      return { attempted: true, submitted: false, reason: "login_control_ambiguous" };
    }
    if (eligibleFrames.length === 1) {
      const submitted = await probeLoginFrame(eligibleFrames[0]!.frame, "submit").catch(() => null);
      if (submitted?.challengePresent) {
        return { attempted: false, submitted: false, reason: "challenge_present" };
      }
      if (submitted?.submitted) return { attempted: true, submitted: true, reason: "submitted" };
    }
    savedCredentialsReady ||= ready.some((probe) => probe.controlCount === 0);
    formFound ||= probes.some((probe) => probe.formFound);
    if (Date.now() >= deadline) break;
    await wait(Math.min(250, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return {
    attempted: savedCredentialsReady,
    submitted: false,
    reason: savedCredentialsReady
      ? "login_control_missing"
      : formFound ? "saved_credentials_missing" : "login_form_missing",
  };
}
