import { launchDedicatedChrome, waitForChrome } from "@/lib/jackyun/cdp-client";
import { withJackyunRunLock } from "@/lib/jackyun/run-lock";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import path from "node:path";

export const runtime = "nodejs";

const projectRoot = process.cwd();
const chromePath = process.env.JACKYUN_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = path.resolve(process.env.JACKYUN_PROFILE_DIR ?? path.join(projectRoot, ".runtime", "jackyun-chrome-profile"));
const port = Number(process.env.JACKYUN_DEBUG_PORT ?? 9223);
const startUrl = "https://web.jackyun.com/login/login_web.html";

export async function POST() {
  try {
    await requireAppPrincipal(["operator", "admin"]);
    await withJackyunRunLock(
      { runId: "session-open", purpose: "manual_login_browser" },
      async () => {
        await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl, headless: false });
        await waitForChrome(port);
      },
    );
    return Response.json({ ok: true, status: "login_browser_ready", url: startUrl });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "打开吉客云登录页失败" }, { status: 500 });
  }
}
