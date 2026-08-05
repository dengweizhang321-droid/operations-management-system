import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  closeChromeBrowser,
  launchDedicatedChrome,
  listChromeTargets,
} from "../lib/jackyun/cdp-client";
import { readJsonFile } from "../lib/jackyun/json-file";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(projectRoot, "config", "jackyun-daily-policy.json");

type LoginPolicy = {
  browser: {
    controller?: {
      chromePath?: string;
      profileDirectory?: string;
      debuggingPort?: number;
      startUrl?: string;
    };
  };
};

async function assertHelperIsIdle() {
  const response = await fetch("http://127.0.0.1:5791/health", {
    signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
  if (!response?.ok) return;
  const health = await response.json().catch(() => null) as { busy?: boolean } | null;
  if (health?.busy) throw new Error("吉客云/天猫辅助服务正在执行任务，不能关闭专用浏览器；请等待当前串行链路结束。");
}

async function main() {
  const policy = await readJsonFile<LoginPolicy>(policyPath);
  const chromePath = policy.browser.controller?.chromePath ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profileDirectory = path.resolve(
    policy.browser.controller?.profileDirectory ?? path.join(projectRoot, ".runtime", "jackyun-chrome-profile"),
  );
  const port = policy.browser.controller?.debuggingPort ?? 9223;
  const startUrl = policy.browser.controller?.startUrl ?? "https://web.jackyun.com/home/mainframe_web_horizontal.html";

  await assertHelperIsIdle();
  const targets = await listChromeTargets(port).catch(() => []);
  if (targets.length && !targets.some((target) => /(?:^|\.)jackyun\.com/i.test(new URL(target.url).hostname))) {
    throw new Error(`调试端口 ${port} 已被非吉客云浏览器占用，已拒绝关闭。`);
  }
  if (targets.length) await closeChromeBrowser(port);
  await launchDedicatedChrome({
    executablePath: chromePath,
    profileDirectory,
    port,
    startUrl,
    headless: false,
    visible: true,
  });
  console.log(JSON.stringify({
    status: "chrome_ready_for_manual_login",
    port,
    instruction: "请在专用 Chrome 中完成人工验证，并在 Chrome 提示时保存密码；程序不会读取或保存明文凭证。",
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
