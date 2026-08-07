import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type BrowserAutomationClient,
  connectChromeBrowser,
  evaluateValue,
  launchDedicatedChrome,
  listChromeTargets,
} from "../lib/jackyun/cdp-client";
import { PlaywrightPageClient, connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { readJsonFile, readJsonFileOr, writeJsonAtomic } from "../lib/jackyun/json-file";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type SycmPolicy = {
  version: string;
  browser: {
    pageTimeoutMs: number;
    pollIntervalMs: number;
    fastPollIntervalMs?: number;
    actionTimeoutMs?: number;
    downloadTimeoutMs?: number;
    stableSamples: number;
    eventTimeoutMs: number;
  };
};

type CliOptions = {
  storeKey: string;
  date?: string;
  headless: boolean;
  launchOnly: boolean;
  downloadOnly: boolean;
  username?: string;
  password?: string;
  signal?: AbortSignal;
};

type DownloadReceipt = {
  version: 1;
  storeKey: string;
  shopName: string;
  businessDate: string;
  fileName: string;
  filePath: string;
  downloadedAt: string;
};

function shanghaiDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const value = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function parseCli(): CliOptions {
  const values = new Map<string, string>();
  let headless = false; // 默认有头模式，方便调试和人工干预
  let launchOnly = false;
  let downloadOnly = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--headless") { headless = true; continue; }
    if (args[index] === "--headed") { headless = false; continue; }
    if (args[index] === "--launch-only") { launchOnly = true; continue; }
    if (args[index] === "--download-only") { downloadOnly = true; continue; }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`参数 ${args[index]} 缺少取值。`);
    values.set(args[index], next);
    index += 1;
  }
  const storeKey = values.get("--store-key");
  if (!storeKey) throw new Error("必须提供 --store-key 参数");
  return {
    storeKey,
    date: values.get("--date"),
    headless,
    launchOnly,
    downloadOnly,
    username: values.get("--username") ?? process.env.TMALL_USERNAME,
    password: values.get("--password") ?? process.env.TMALL_PASSWORD,
  };
}

// 生意参谋页面文本提取（支持多层 iframe）
function jsDocumentsPrelude(urlHints: string[] = []) {
  return `
    const urlHints = ${JSON.stringify(urlHints)};
    const documents = [];
    const visit = (doc, include) => {
      if (include) documents.push(doc);
      for (const frame of doc.querySelectorAll('iframe,frame')) {
        const rect = frame.getBoundingClientRect();
        const style = frame.ownerDocument.defaultView.getComputedStyle(frame);
        if (rect.width <= 100 || rect.height <= 100 || style.visibility === 'hidden' || style.display === 'none') continue;
        const nextInclude = include || urlHints.some((hint) => (frame.src || '').includes(hint));
        try { if (frame.contentDocument) visit(frame.contentDocument, nextInclude); } catch {}
      }
    };
    visit(document, urlHints.length === 0);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/[（）]/g, (c) => c === '（' ? '(' : ')').replace(/\\s+/g, '').trim();
  `;
}

async function pageText(client: BrowserAutomationClient) {
  return evaluateValue<string>(client, `(() => { ${jsDocumentsPrelude()} return documents.map((doc) => doc.body?.innerText || '').join(String.fromCharCode(10)); })()`);
}

async function currentUrl(client: BrowserAutomationClient) {
  return evaluateValue<string>(client, "location.href");
}

// 点击文本元素（支持跨 iframe）
async function clickText(client: BrowserAutomationClient, text: string) {
  const result = await evaluateValue<{ clicked: boolean; actual?: string; x?: number; y?: number }>(client, `(() => {
    ${jsDocumentsPrelude()}
    const wanted = normalize(${JSON.stringify(text)});
    const candidates = documents.flatMap((doc) => Array.from(doc.querySelectorAll('button,a,li,span,div,[role="button"],[role="menuitem"],[role="tab"]')))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent) === wanted)
      .sort((a, b) => {
        const rank = (el) => {
          const cls = String(el.className || '');
          const rect = el.getBoundingClientRect();
          if (/btn|button|menu-item|tab/i.test(cls)) return 0;
          if (/download|export/i.test(cls)) return 1;
          return 5;
        };
        const rankDelta = rank(a) - rank(b);
        if (rankDelta) return rankDelta;
        return a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      });
    const el = candidates[0];
    if (!el) return { clicked: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const point = (node) => {
      let rect = node.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      let win = node.ownerDocument.defaultView;
      while (win && win.frameElement) {
        const frameRect = win.frameElement.getBoundingClientRect();
        x += frameRect.left;
        y += frameRect.top;
        win = win.parent;
      }
      return { x, y };
    };
    return { clicked: true, actual: (el.innerText || el.textContent || '').trim(), ...point(el) };
  })()`);
  if (!result.clicked) {
    const body = await pageText(client).catch(() => "");
    throw new Error(`clickable text not found: ${text}; pageText=${body.slice(0, 500)}`);
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: result.x, y: result.y, button: "none" });
  await new Promise((r) => setTimeout(r, 100));
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: result.x, y: result.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: result.x, y: result.y, button: "left", clickCount: 1 });
  return result.actual ?? text;
}

async function clickAnyText(client: BrowserAutomationClient, texts: string[]) {
  let lastError: unknown;
  for (const text of texts) {
    try { return await clickText(client, text); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`页面未找到：${texts.join(" / ")}`);
}

async function clickAnyTextEventually(
  client: BrowserAutomationClient,
  texts: string[],
  timeoutMs: number,
  pollIntervalMs = 200,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await clickAnyText(client, texts);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`页面未找到：${texts.join(" / ")}`);
}

// 等待页面出现指定文本
async function waitForPageText(client: BrowserAutomationClient, text: string, timeoutMs: number, pollIntervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await pageText(client);
    if (body.includes(text)) return body;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`页面未在规定时间内进入：${text}`);
}

// 检查是否登录页
function isLikelyLoginPage(body: string) {
  return /登录|密码|验证码|扫码|账号/i.test(body)
    && !/生意参谋|商品|数据|报表|下载|工作台|卖家中心/i.test(body);
}

// 尝试自动登录（通过 Playwright 操作 iframe 中的表单）
async function attemptAutoLogin(page: import("playwright-core").Page, username: string, password: string): Promise<{ success: boolean; message: string }> {
  try {
    // 等待页面完全加载
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 等待登录 iframe 加载
    const iframeElement = await page.waitForSelector('iframe#alibaba-login-box, iframe[src*="login"], iframe[src*="havanalogin"]', { timeout: 15000 }).catch(() => null);
    if (!iframeElement) {
      return { success: false, message: "未找到登录 iframe 元素" };
    }

    // 获取 iframe 的 content frame
    const frame = await iframeElement.contentFrame();
    if (!frame) {
      return { success: false, message: "无法获取登录 iframe 的 content frame" };
    }

    // 等待 iframe 内容加载
    await frame.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await frame.waitForTimeout(2000); // 额外等待 JS 渲染

    // 填写用户名 - 使用多种选择器尝试
    const usernameSelectors = ['#fm-login-id', 'input[name="fm-login-id"]', 'input[placeholder*="账号"]', 'input[placeholder*="邮箱"]', 'input[type="text"]'];
    let usernameInput = null;
    for (const selector of usernameSelectors) {
      usernameInput = await frame.waitForSelector(selector, { timeout: 3000 }).catch(() => null);
      if (usernameInput) break;
    }
    if (!usernameInput) {
      // 打印 iframe 内容帮助调试
      const iframeHtml = await frame.evaluate(() => document.body?.innerHTML?.slice(0, 2000) || 'empty');
      console.log('iframe HTML preview:', iframeHtml);
      return { success: false, message: "未找到用户名输入框" };
    }
    await usernameInput.fill(username);

    // 填写密码
    const passwordSelectors = ['#fm-login-password', 'input[name="fm-login-password"]', 'input[type="password"]'];
    let passwordInput = null;
    for (const selector of passwordSelectors) {
      passwordInput = await frame.waitForSelector(selector, { timeout: 3000 }).catch(() => null);
      if (passwordInput) break;
    }
    if (!passwordInput) {
      return { success: false, message: "未找到密码输入框" };
    }
    await passwordInput.fill(password);

    // 点击登录按钮
    const submitSelectors = ['.fm-submit', '.fm-btn', 'button[type="submit"]', 'input[type="submit"]', '.password-login'];
    let submitButton = null;
    for (const selector of submitSelectors) {
      submitButton = await frame.waitForSelector(selector, { timeout: 3000 }).catch(() => null);
      if (submitButton) break;
    }
    if (!submitButton) {
      return { success: false, message: "未找到登录按钮" };
    }
    await submitButton.click();

    // 等待登录结果
    await page.waitForTimeout(5000);

    // 检查是否出现验证码
    const captchaInput = await frame.$('#nc_1_captcha_input, [class*="captcha"], [class*="verify"], [id*="captcha"]');
    if (captchaInput) {
      return { success: false, message: "出现验证码，需要人工处理" };
    }

    // 检查是否登录成功（页面跳转或出现工作台内容）
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (currentUrl.includes('myseller.taobao.com') || /工作台|卖家中心|生意参谋|商品管理/.test(bodyText)) {
      return { success: true, message: "登录成功" };
    }

    // 检查是否有错误提示
    const errorText = await frame.evaluate(() => {
      const errorEl = document.querySelector('.error-msg, .login-error, [class*="error"], [class*="tip"]');
      return errorEl?.textContent?.trim() || "";
    });
    if (errorText) {
      return { success: false, message: `登录失败: ${errorText}` };
    }

    return { success: false, message: "登录状态未知，请检查" };
  } catch (error) {
    return { success: false, message: `登录异常: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// 检查是否已登录（在生意参谋或卖家中心）
function isLoggedIn(body: string) {
  return /生意参谋|商品|数据|报表|下载|卖家中心|工作台/i.test(body);
}

// 等待登录完成
async function waitForLogin(client: BrowserAutomationClient, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await pageText(client);
    const url = await currentUrl(client);
    if (isLikelyLoginPage(body)) {
      // 还在登录页，继续等待
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (isLoggedIn(body) || /myseller\.taobao\.com|sycm\.taobao\.com/i.test(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("登录等待超时，请检查是否需要人工登录");
}

// 导航到生意参谋商品页面
async function navigateToSycmProduct(client: BrowserAutomationClient, page: import("playwright-core").Page, timeoutMs: number) {
  // 先检查当前页面状态
  const url = await currentUrl(client);
  const body = await pageText(client);

  // 如果已经在生意参谋商品页面，直接返回
  if (/sycm\.taobao\.com/i.test(url) && /商品|排行|SPU/i.test(body)) {
    console.log("已在生意参谋商品页面");
    return;
  }

  // 直接导航到生意参谋商品效果排行页面
  console.log("直接导航到生意参谋商品页面...");
  await page.goto("https://sycm.taobao.com/portal/item/itemlive/list.htm", { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));

  // 检查是否成功进入生意参谋
  const newUrl = await currentUrl(client).catch(() => "");
  const newBody = await pageText(client).catch(() => "");
  if (/sycm\.taobao\.com/i.test(newUrl)) {
    console.log("已进入生意参谋");
    return;
  }

  // 如果直接导航失败，回退到从卖家中心点击进入
  if (!/myseller\.taobao\.com/i.test(newUrl)) {
    console.log("导航到卖家中心...");
    await page.goto("https://myseller.taobao.com/home.htm/QnworkbenchHome/", { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 等待页面加载
  await waitForPageText(client, "商品", timeoutMs);

  // 点击"商品"菜单
  console.log("点击商品菜单...");
  await clickAnyText(client, ["商品", "商品管理", "宝贝管理"]);
  await new Promise((r) => setTimeout(r, 2000));

  // 等待生意参谋页面加载
  await new Promise((r) => setTimeout(r, 3000));

  // 检查是否进入生意参谋
  const finalUrl = await currentUrl(client);
  const finalBody = await pageText(client);
  if (!/sycm\.taobao\.com|生意参谋|商品排行/i.test(finalUrl + finalBody)) {
    try {
      await clickAnyText(client, ["生意参谋", "数据", "经营分析"]);
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      // 忽略
    }
  }
}

// 选择日期
async function selectDate(client: BrowserAutomationClient, targetDate: string, timeoutMs: number) {
  console.log(`选择日期: ${targetDate}`);

  // 先点击"日"图标或日期选择器
  const dateSelectors = ["日", "日期", "选择日期", "按日"];
  let dateClicked = false;
  for (const selector of dateSelectors) {
    try {
      await clickText(client, selector);
      dateClicked = true;
      break;
    } catch {
      // 继续尝试下一个
    }
  }

  if (!dateClicked) {
    // 尝试通过类名或 ID 查找日期选择器
    const found = await evaluateValue<boolean>(client, `(() => {
      ${jsDocumentsPrelude()}
      // 查找日期选择器图标或按钮
      const dateIcons = documents.flatMap((doc) => Array.from(doc.querySelectorAll('[class*="date"],[class*="day"],[class*="calendar"],[id*="date"],[id*="day"]')))
        .filter((el) => visible(el));
      if (dateIcons.length > 0) {
        dateIcons[0].click();
        return true;
      }
      return false;
    })()`);
    if (!found) {
      console.log("警告：未找到日期选择器，尝试直接操作日期输入框");
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  // 在日期选择面板中选择目标日期
  // 生意参谋的日期选择器通常是 antd 或类似组件
  const [year, month, day] = targetDate.split("-").map(Number);
  const dateText = `${month}月${day}日`;

  // 尝试点击具体日期
  const dateSelected = await evaluateValue<boolean>(client, `(() => {
    ${jsDocumentsPrelude()}
    const targetDay = ${day};
    const targetMonth = ${month};
    const targetYear = ${year};

    // 查找日期单元格
    const cells = documents.flatMap((doc) => Array.from(doc.querySelectorAll('td,[role="gridcell"],.ant-picker-cell,.calendar-day')))
      .filter((el) => visible(el));

    for (const cell of cells) {
      const text = (cell.innerText || cell.textContent || '').trim();
      const cellDay = parseInt(text, 10);
      if (cellDay === targetDay) {
        // 检查是否是当前月份（不是灰色禁用状态）
        const cls = String(cell.className || '');
        if (!/disabled|gray|other-month|prev|next/i.test(cls)) {
          cell.click();
          return true;
        }
      }
    }

    // 如果没找到，尝试通过 title 或 aria-label 属性
    const titledCells = documents.flatMap((doc) => Array.from(doc.querySelectorAll('[title*="日"],[aria-label*="日"]')))
      .filter((el) => visible(el));
    for (const cell of titledCells) {
      const title = cell.getAttribute('title') || cell.getAttribute('aria-label') || '';
      if (title.includes(String(targetDay)) && title.includes(String(targetMonth))) {
        cell.click();
        return true;
      }
    }

    return false;
  })()`);

  if (!dateSelected) {
    // 尝试直接输入日期
    await evaluateValue<boolean>(client, `(() => {
      ${jsDocumentsPrelude()}
      const inputs = documents.flatMap((doc) => Array.from(doc.querySelectorAll('input[placeholder*="日期"],input[placeholder*="date"],input[type="date"]')))
        .filter((el) => visible(el));
      if (inputs.length > 0) {
        const input = inputs[0];
        const setter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(input, ${JSON.stringify(targetDate)}) : input.value = ${JSON.stringify(targetDate)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()`);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // 确认日期选择（可能需要点击"确定"或"查询"按钮）
  try {
    await clickAnyText(client, ["确定", "查询", "确认", "应用"]);
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    // 可能不需要确认按钮
  }

  // 验证日期是否选中
  const body = await pageText(client);
  if (!body.includes(String(day)) && !body.includes(dateText)) {
    console.log(`警告：日期选择可能未生效，页面内容: ${body.slice(0, 300)}`);
  }
}

// 触发下载
async function triggerDownload(client: BrowserAutomationClient, downloadDir: string, timeoutMs: number) {
  console.log("触发下载...");

  // 记录下载前的文件列表
  const beforeFiles = new Set(await readdir(downloadDir).catch(() => [] as string[]));

  // 点击下载按钮
  const downloadTexts = ["下载", "导出", "下载数据", "导出数据", "下载报表"];
  let downloadClicked = false;
  for (const text of downloadTexts) {
    try {
      await clickText(client, text);
      downloadClicked = true;
      break;
    } catch {
      // 继续尝试
    }
  }

  if (!downloadClicked) {
    // 尝试通过类名查找下载按钮
    const found = await evaluateValue<boolean>(client, `(() => {
      ${jsDocumentsPrelude()}
      const buttons = documents.flatMap((doc) => Array.from(doc.querySelectorAll('[class*="download"],[class*="export"],[id*="download"],[id*="export"]')))
        .filter((el) => visible(el));
      if (buttons.length > 0) {
        buttons[0].click();
        return true;
      }
      return false;
    })()`);
    if (!found) {
      throw new Error("未找到下载按钮");
    }
  }

  // 等待下载完成（监控下载目录）
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const currentFiles = await readdir(downloadDir).catch(() => [] as string[]);
    const newFiles = currentFiles.filter((f) => !beforeFiles.has(f) && !f.endsWith(".crdownload") && !f.endsWith(".tmp"));

    if (newFiles.length > 0) {
      // 找到新文件，等待文件大小稳定
      const fileName = newFiles[0];
      const filePath = path.join(downloadDir, fileName);
      let lastSize = 0;
      let stableCount = 0;

      while (stableCount < 3 && Date.now() < deadline) {
        const info = await stat(filePath).catch(() => null);
        if (!info) break;
        if (info.size === lastSize && info.size > 0) {
          stableCount += 1;
        } else {
          stableCount = 0;
          lastSize = info.size;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (stableCount >= 3) {
        console.log(`下载完成: ${fileName}`);
        return { fileName, filePath };
      }
    }
  }

  throw new Error("下载超时，未检测到新文件");
}

// 风控弹窗自动监控：通过 Playwright context 监听新标签页，自动关闭风控弹窗
function startPunishGuardWithPlaywright(context: import("playwright-core").BrowserContext) {
  const handler = (page: import("playwright-core").Page) => {
    const url = page.url();
    if (/bixi\.alicdn\.com\/punish/i.test(url) || /punish:resource:template/i.test(url)) {
      console.log(`[风控守卫] 检测到风控弹窗，正在关闭: ${url.slice(0, 80)}`);
      page.close().catch(() => {});
    }
  };
  context.on("page", handler);
  // 也检查已有页面
  for (const p of context.pages()) {
    handler(p);
  }
  return () => context.off("page", handler);
}

// 主运行函数
async function runSycmController(options: CliOptions) {
  const store = await getTmallStore(options.storeKey);
  const targetDate = options.date ?? shanghaiDate(-1); // 默认昨天

  console.log(JSON.stringify({
    type: "sycm_start",
    storeKey: store.storeKey,
    shopName: store.shopName,
    targetDate,
    downloadDir: store.browser.downloadDir,
  }));

  // 启动 Chrome
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profileDir = path.resolve(projectRoot, store.browser.profileDir);
  const port = store.browser.debugPort;

  await launchDedicatedChrome({
    executablePath: chromePath,
    profileDirectory: profileDir,
    port,
    startUrl: "https://myseller.taobao.com/home.htm/QnworkbenchHome/",
    headless: options.headless,
    visible: !options.headless,
  });

  if (options.launchOnly) {
    console.log(JSON.stringify({ status: "chrome_ready", profileDir, port }));
    return { status: "chrome_ready", profileDir, port };
  }

  // 连接浏览器
  const browser = await connectPlaywrightBrowser(port);
  const context = browser.contexts()[0] ?? await browser.newContext();

  // 启动风控守卫（通过 Playwright 监听新标签页）
  const stopGuard = startPunishGuardWithPlaywright(context);

  let page = context.pages()[0] ?? await context.newPage();
  let client = new PlaywrightPageClient(page, await context.newCDPSession(page));

  try {
    // 启用 CDP 域
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");

    // 设置下载行为
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: store.browser.downloadDir,
      eventsEnabled: true,
    });

    // 等待登录
    console.log("检查登录状态...");
    const loginBody = await pageText(client);
    if (isLikelyLoginPage(loginBody)) {
      console.log("检测到登录页");
      if (options.username && options.password) {
        console.log("尝试自动登录...");
        const loginResult = await attemptAutoLogin(page, options.username, options.password);
        console.log(`自动登录结果: ${loginResult.message}`);
        if (!loginResult.success) {
          console.log("自动登录失败，等待人工登录...");
          await waitForLogin(client, 120000); // 给人工登录更多时间
        }
      } else {
        console.log("未提供用户名密码，等待人工登录...");
        console.log("提示: 可通过 --username 和 --password 参数或 TMALL_USERNAME/TMALL_PASSWORD 环境变量提供");
        await waitForLogin(client, 120000);
      }
    }
    console.log("登录成功");

    // 验证店铺身份
    const body = await pageText(client);
    const shopNameShort = store.shopName.replace("天猫-", "");
    if (!body.includes(shopNameShort)) {
      console.log(`警告：页面未显示店铺名 "${shopNameShort}"，当前内容: ${body.slice(0, 200)}`);
    }

    // 导航到生意参谋商品页面（带重试，风控弹窗可能打断）
    let navOk = false;
    for (let attempt = 1; attempt <= 3 && !navOk; attempt += 1) {
      try {
        console.log(`导航到生意参谋商品页面 (尝试 ${attempt}/3)...`);
        await navigateToSycmProduct(client, page, 30000);
        navOk = true;
      } catch (error) {
        console.log(`导航失败 (尝试 ${attempt}/3): ${error instanceof Error ? error.message : String(error)}`);
        // 等待风控守卫关闭弹窗后重试
        await new Promise((r) => setTimeout(r, 5000));
        // 检查 page 是否还有效，如果无效则使用 context 的第一个页面
        if (page.isClosed()) {
          console.log("页面已失效，尝试切换到可用页面...");
          const replacement = context.pages().find((candidate) => (
            !candidate.isClosed() && /sycm|myseller|taobao/i.test(candidate.url())
          ));
          if (replacement) {
            const replacementClient = new PlaywrightPageClient(
              replacement,
              await context.newCDPSession(replacement),
            );
            await replacementClient.send("Page.enable");
            await replacementClient.send("Runtime.enable");
            await replacementClient.send("Network.enable");
            client.close();
            page = replacement;
            client = replacementClient;
            console.log(`切换到页面: ${page.url().slice(0, 80)}`);
          }
        }
      }
    }
    if (!navOk) throw new Error("导航到生意参谋商品页面失败，已重试 3 次");

    // 等待页面稳定（风控弹窗可能刚被关闭）
    await new Promise((r) => setTimeout(r, 3000));

    // 选择日期（带重试）
    let dateOk = false;
    for (let attempt = 1; attempt <= 3 && !dateOk; attempt += 1) {
      try {
        console.log(`选择日期 (尝试 ${attempt}/3)...`);
        await selectDate(client, targetDate, 30000);
        dateOk = true;
      } catch (error) {
        console.log(`日期选择失败 (尝试 ${attempt}/3): ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    if (!dateOk) throw new Error("日期选择失败，已重试 3 次");

    // 等待页面数据加载
    await new Promise((r) => setTimeout(r, 3000));

    // 触发下载（带重试）
    let downloadResult: { fileName: string; filePath: string } | null = null;
    for (let attempt = 1; attempt <= 3 && !downloadResult; attempt += 1) {
      try {
        console.log(`触发下载 (尝试 ${attempt}/3)...`);
        downloadResult = await triggerDownload(client, store.browser.downloadDir, 90000);
      } catch (error) {
        console.log(`下载失败 (尝试 ${attempt}/3): ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    if (!downloadResult) throw new Error("下载失败，已重试 3 次");

    // 生成签收单
    const receipt: DownloadReceipt = {
      version: 1,
      storeKey: store.storeKey,
      shopName: store.shopName,
      businessDate: targetDate,
      fileName: downloadResult.fileName,
      filePath: downloadResult.filePath,
      downloadedAt: new Date().toISOString(),
    };

    const receiptPath = path.join(store.browser.downloadDir, `${downloadResult.fileName}.sycm-receipt.json`);
    await writeJsonAtomic(receiptPath, receipt);

    console.log(JSON.stringify({
      status: "download_completed",
      storeKey: store.storeKey,
      businessDate: targetDate,
      fileName: downloadResult.fileName,
      filePath: downloadResult.filePath,
      receiptPath,
    }));

    return {
      status: "download_completed",
      storeKey: store.storeKey,
      businessDate: targetDate,
      fileName: downloadResult.fileName,
      filePath: downloadResult.filePath,
      receiptPath,
    };
  } finally {
    stopGuard();
    client.close();
    await browser.close();
  }
}

// CLI 入口
if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runSycmController(parseCli())
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

export { runSycmController };
