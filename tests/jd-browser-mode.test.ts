import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasJdInteractivePageGate,
  isJdInteractiveBrowserFailure,
  jdBrowserLaunchMode,
  revealJdBrowserForInteractiveFailure,
} from "../lib/jd/browser-mode";

test("JD n8n launches headless by default and explicit login is visible", () => {
  assert.deepEqual(jdBrowserLaunchMode(false), { headless: true, visible: false });
  assert.deepEqual(jdBrowserLaunchMode(true), { headless: false, visible: true });
});

test("only interactive JD failures request a visible browser", () => {
  for (const message of [
    "京东商家后台尚未登录。请在专用浏览器中完成登录后重新运行。",
    "京东商智登录状态无效",
    "请完成滑块验证",
    "当前登录身份与受控店铺不一致",
  ]) assert.equal(isJdInteractiveBrowserFailure(new Error(message)), true, message);

  for (const message of [
    "等待新的京东导出任务完成超时",
    "导入批次身份不匹配",
    "下载任务存在多个候选",
    "运营管理系统 HTTP 500",
  ]) assert.equal(isJdInteractiveBrowserFailure(new Error(message)), false, message);

  assert.equal(hasJdInteractivePageGate("请完成滑块验证后继续"), true);
  assert.equal(hasJdInteractivePageGate("商品明细 查询 下载数据"), false);
});

test("interactive recovery closes headless Chrome before opening one visible process", async () => {
  const calls: string[] = [];
  await revealJdBrowserForInteractiveFailure({
    executablePath: "chrome.exe",
    profileDirectory: "D:\\profiles\\jd-store",
    port: 9224,
    startUrl: "https://example.test/jd",
  }, {
    closeChromeBrowser: async (port) => { calls.push(`close:${port}`); return true; },
    launchDedicatedChrome: async (options) => {
      calls.push(`launch:${options.headless}:${options.visible}:${options.port}`);
      return {};
    },
    waitForChrome: async (port) => { calls.push(`wait:${port}`); },
  });
  assert.deepEqual(calls, ["close:9224", "launch:false:true:9224", "wait:9224"]);

  await assert.rejects(
    revealJdBrowserForInteractiveFailure({
      executablePath: "chrome.exe",
      profileDirectory: "D:\\profiles\\jd-store",
      port: 9224,
      startUrl: "https://example.test/jd",
    }, {
      closeChromeBrowser: async () => true,
      launchDedicatedChrome: async () => null,
      waitForChrome: async () => undefined,
    }),
    /并发进程占用/,
  );
});

test("both JD export programs use the shared background browser mode", async () => {
  const master = await readFile("tools/jackyun-ware-export.ts", "utf8");
  const daily = await readFile("tools/jdsz-product-detail-export.ts", "utf8");
  assert.match(master, /jdBrowserLaunchMode\(options\.interactiveLogin\)/);
  assert.match(daily, /jdBrowserLaunchMode\(options\.interactiveLogin\)/);
  assert.doesNotMatch(master, /startUrl:\s*targetUrl,\s*headless:\s*false/);
  assert.doesNotMatch(daily, /startUrl:\s*targetUrl,\s*headless:\s*false/);
});
