import { readJsonFile, readJsonFileOr } from "../lib/jackyun/json-file";
import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(projectRoot, "config", "jackyun-daily-policy.json");
const credentialsPath = path.join(projectRoot, "账号", "credentials.json");

type Credentials = { username: string; password: string };

async function fillAndSubmitLogin(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"], credentials: Credentials) {
  const inputs = page.locator('input');
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const type = (await input.getAttribute('type')) ?? '';
    const name = `${(await input.getAttribute('name')) ?? ''} ${(await input.getAttribute('id')) ?? ''} ${(await input.getAttribute('placeholder')) ?? ''}`.toLowerCase();
    if (type === 'password' || /pass|密码/.test(name)) {
      await input.fill(credentials.password);
      continue;
    }
    if (/user|name|账号|手机号|login|account/.test(name)) {
      await input.fill(credentials.username);
    }
  }

  const submitCandidates = ['登录', '确定', '提交', '立即登录'];
  for (const text of submitCandidates) {
    const button = page.getByText(text, { exact: true });
    if (await button.count()) {
      await button.first().click().catch(() => undefined);
      return;
    }
  }
  await page.keyboard.press('Enter').catch(() => undefined);
}

async function main() {
  const policy = await readJsonFile<{ browser: { controller?: { chromePath?: string; profileDirectory?: string; debuggingPort?: number; startUrl?: string } } }>(policyPath);
  const credentials = await readJsonFileOr<Credentials | null>(credentialsPath, null);
  if (!credentials?.username || !credentials?.password) throw new Error(`未找到有效账号配置：${credentialsPath}`);

  const chromePath = policy.browser.controller?.chromePath ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profileDirectory = path.resolve(policy.browser.controller?.profileDirectory ?? path.join(projectRoot, ".runtime", "jackyun-chrome-profile"));
  const port = policy.browser.controller?.debuggingPort ?? 9223;
  const startUrl = "https://web.jackyun.com/login/login_web.html";

  await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl, headless: false });
  await waitForChrome(port);

  const browser = await connectPlaywrightBrowser(port);
  try {
    const { page, client } = await connectPlaywrightJackyunTarget(browser, { startUrl });
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await fillAndSubmitLogin(page, credentials);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    client.close();
    console.log(JSON.stringify({ status: "login_submitted", profileDirectory, port, startUrl }));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});