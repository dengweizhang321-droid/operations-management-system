import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../jackyun/cdp-client";

export type JdBrowserLaunchMode = { headless: boolean; visible: boolean };

export function jdBrowserLaunchMode(interactiveLogin: boolean): JdBrowserLaunchMode {
  return interactiveLogin
    ? { headless: false, visible: true }
    : { headless: true, visible: false };
}

export function isJdInteractiveBrowserFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /尚未登录|登录状态无效|请.{0,20}登录|验证码|人机验证|安全验证|安全校验|滑块验证|访问验证|访问受限|账号异常|店铺身份.{0,12}不一致|登录身份.{0,12}不一致/.test(message);
}

export function hasJdInteractivePageGate(pageText: string) {
  return /验证码|人机验证|安全验证|安全校验|滑块验证|访问验证/.test(pageText);
}

export type JdInteractiveBrowserOptions = {
  executablePath: string;
  profileDirectory: string;
  port: number;
  startUrl: string;
};

type JdBrowserLifecycleDependencies = {
  closeChromeBrowser: typeof closeChromeBrowser;
  launchDedicatedChrome: (options: Parameters<typeof launchDedicatedChrome>[0]) => Promise<unknown | null>;
  waitForChrome: typeof waitForChrome;
};

const defaultLifecycleDependencies: JdBrowserLifecycleDependencies = {
  closeChromeBrowser,
  launchDedicatedChrome,
  waitForChrome,
};

export async function revealJdBrowserForInteractiveFailure(
  options: JdInteractiveBrowserOptions,
  dependencies: JdBrowserLifecycleDependencies = defaultLifecycleDependencies,
) {
  // Close the headless process first: Chrome cannot safely open the same
  // persistent profile in a second process. A fresh visible process is the
  // only successful outcome; attaching to a concurrent process fails closed.
  await dependencies.closeChromeBrowser(options.port);
  const launched = await dependencies.launchDedicatedChrome({
    ...options,
    headless: false,
    visible: true,
  });
  if (!launched) throw new Error("京东交互浏览器端口被并发进程占用，未打开新的可见窗口。");
  await dependencies.waitForChrome(options.port);
}
