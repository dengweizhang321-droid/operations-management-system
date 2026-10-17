import { chromium, type Page } from "playwright-core";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { readJsonDurableOr, writeJsonDurable } from "../lib/jackyun/json-file";
import { assertWarehouseBrowserDirectory, tmallWarehouseSource, warehouseLoginConfig } from "../lib/tmall-warehouse/policy";
import { workerProtectedSourceRoot } from "./worker-local-release.mjs";

export function warehouseLoginCliPaths(args: string[] = [], moduleUrl = import.meta.url) {
  // CLI never derives mutable state from the worktree/frozen source location.
  // The helper builder uses this same controlled root for mutable resources.
  if (args.length) throw new Error("TMALL_WAREHOUSE_LOGIN_ARGUMENTS_REJECTED");
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
  return { root: workerProtectedSourceRoot, templatePath: path.join(sourceRoot, "automation", "n8n", "tmall-warehouse.config.example.json") };
}

export async function assertWarehouseLoginIdentity(page: Pick<Page, "url" | "locator">, owner: string) {
  if (new URL(page.url()).origin !== "https://scp.tmall.com") throw new Error("TMALL_WAREHOUSE_LOGIN_NOT_COMPLETED_MANUAL_ACTION");
  const text = await page.locator("body").innerText();
  if (/验证码|安全验证|扫码登录|密码登录/.test(text)) throw new Error("TMALL_WAREHOUSE_LOGIN_NOT_COMPLETED_MANUAL_ACTION");
  const identity = page.locator('[data-spm-click="gostr=/ascp;locaid=header-right-account-name"]');
  if (await identity.count() !== 1 || (await identity.textContent())?.trim() !== owner) throw new Error("TMALL_WAREHOUSE_OWNER_MISMATCH_MANUAL_ACTION");
}

/** Interactive maintenance only: never calls an exporter, importer or n8n. */
export async function loginTmallWarehouse(root: string, options: { templatePath?: string } = {}) {
  if (!stdin.isTTY) throw new Error("TMALL_WAREHOUSE_INTERACTIVE_TERMINAL_REQUIRED");
  const configPath = path.join(root, ".runtime", "tmall-warehouse.json");
  return withJdChromiumRunLock("tmall-warehouse-interactive-login", async () => {
    let raw = await readJsonDurableOr<unknown>(configPath, null);
    if (!raw) {
      const templatePath = options.templatePath ?? warehouseLoginCliPaths().templatePath;
      raw = JSON.parse(await readFile(templatePath, "utf8"));
      (raw as { userDataDir: string }).userDataDir = path.join(root, ".runtime", "tmall-warehouse-browser");
      warehouseLoginConfig(raw, root);
      await writeJsonDurable(configPath, raw, true);
    }
    const config = warehouseLoginConfig(raw, root), exe = await lstat(config.executablePath);
    await assertWarehouseBrowserDirectory(config, root);
    if (!exe.isFile() || exe.isSymbolicLink()) throw new Error("TMALL_WAREHOUSE_BROWSER_IDENTITY_REJECTED");
    const context = await chromium.launchPersistentContext(config.userDataDir, { executablePath: config.executablePath, headless: false, args: [`--profile-directory=${config.profileName}`] });
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(`https://scp.tmall.com/?frameUrl=${encodeURIComponent(tmallWarehouseSource)}#380972.682131.682503`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      console.log(`请在专用浏览器人工登录，并确认企业为：${config.owner}。此入口不会导出、导入或启动工作流。`);
      await terminal.question("完成登录后回到此窗口按 Enter 核验身份；未完成请关闭此窗口。 ");
      await assertWarehouseLoginIdentity(page, config.owner);
      console.log("专用会话身份核验通过，登录状态由该专用 Profile 保存。n8n 工作流仍保持原启停状态。");
      if (!config.enabled) {
        const answer = await terminal.question("是否启用本地天猫入仓采集配置？这不会激活 n8n 定时。[y/N] ");
        if (answer.trim().toLowerCase() === "y") {
          await assertWarehouseLoginIdentity(page, config.owner);
          if (JSON.stringify(await readJsonDurableOr(configPath, null)) !== JSON.stringify(raw)) throw new Error("TMALL_WAREHOUSE_POLICY_CHANGED_MANUAL_ACTION");
          await writeJsonDurable(configPath, { ...config, enabled: true });
          console.log("本地采集配置已启用。工作流实际运行与定时启用仍须按采用步骤处理。");
        } else console.log("本地采集配置继续停用。");
      }
    } finally {
      terminal.close();
      try { await context.close(); } catch { throw new Error("TMALL_WAREHOUSE_BROWSER_CLEANUP_FAILED"); }
    }
  }, path.join(root, ".runtime", "jd-chromium-global.lock"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    const paths = warehouseLoginCliPaths(process.argv.slice(2));
    console.log(`正式 helper 数据根目录：${paths.root}`);
    console.log(`配置文件：${path.join(paths.root, ".runtime", "tmall-warehouse.json")}`);
    return loginTmallWarehouse(paths.root, { templatePath: paths.templatePath });
  }).catch(error => {
    console.error(error instanceof Error && /^TMALL_WAREHOUSE_[A-Z_]+$/.test(error.message) ? error.message : "TMALL_WAREHOUSE_LOGIN_FAILED_MANUAL_ACTION");
    process.exitCode = 1;
  });
}
