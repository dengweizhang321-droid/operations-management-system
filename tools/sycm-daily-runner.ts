import { readdir, stat, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { getTmallStore, loadTmallStores, type TmallStore } from "../lib/netshop/tmall-store-registry";
import { runSycmController } from "./sycm-browser-controller";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditDirectory = path.join(projectRoot, "outputs", "sycm-daily-runs");

type CliOptions = {
  storeKey?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  dryRun: boolean;
  downloadOnly: boolean;
  importOnly: boolean;
  headless: boolean;
};

type SycmRunAuditItem = {
  storeKey: string;
  shopName: string;
  businessDate: string;
  status: "planned" | "downloading" | "downloaded" | "importing" | "imported" | "duplicate" | "failed" | "waiting_download";
  filePath?: string;
  receiptPath?: string;
  batchId?: string;
  rowCount?: number;
  error?: string;
};

type SycmRunAudit = {
  version: 1;
  startedAt: string;
  updatedAt: string;
  dryRun: boolean;
  items: SycmRunAuditItem[];
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datesInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) dates.push(current);
  return dates;
}

function parseCli(): CliOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  let downloadOnly = false;
  let importOnly = false;
  let headless = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dry-run") { dryRun = true; continue; }
    if (args[index] === "--download-only") { downloadOnly = true; continue; }
    if (args[index] === "--import-only") { importOnly = true; continue; }
    if (args[index] === "--headless") { headless = true; continue; }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`参数 ${args[index]} 缺少取值。`);
    values.set(args[index], next);
    index += 1;
  }
  return {
    storeKey: values.get("--store-key"),
    date: values.get("--date"),
    startDate: values.get("--start-date"),
    endDate: values.get("--end-date"),
    dryRun,
    downloadOnly,
    importOnly,
    headless,
  };
}

// 查询运营系统已覆盖的日期
async function getActualDates(baseUrl: string, store: TmallStore, startDate: string, endDate: string): Promise<string[]> {
  const params = new URLSearchParams({
    dimension: "spu",
    platform: "天猫",
    shop: store.shopName,
    startDate,
    endDate,
    page: "1",
    pageSize: "1",
  });
  const response = await fetch(`${baseUrl}/api/netshop/product-performance?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { coverage?: { actualDates?: unknown } } | null;
  const actualDates = payload?.coverage?.actualDates;
  if (!response.ok || !Array.isArray(actualDates)) {
    throw new Error(`无法读取 ${store.shopName} 的 SPU 日期覆盖 (HTTP ${response.status})`);
  }
  return actualDates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

// 调用签收命令
async function createReceipt(storeKey: string, businessDate: string, filePath: string): Promise<string> {
  const { createTmallDownloadReceipt } = await import("./tmall-download-receipt");
  const result = await createTmallDownloadReceipt({ storeKey, businessDate, filePath });
  return result.receiptPath;
}

// 调用导入 API
async function importFile(baseUrl: string, store: TmallStore, businessDate: string, filePath: string): Promise<{ batchId: string; rowCount: number; status: string }> {
  const bytes = new Uint8Array(await readFile(filePath));
  const fileName = path.basename(filePath);

  const form = new FormData();
  form.set("source", "tmall_product_daily");
  form.set("platform", "天猫");
  form.set("shopName", store.shopName);
  form.set("expectedDataset", "spu_daily");
  form.set("expectedStartDate", businessDate);
  form.set("expectedEndDate", businessDate);
  const fileBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([fileBuffer], fileName, { type: "application/vnd.ms-excel" }));

  const response = await fetch(`${baseUrl}/api/netshop/import`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    status?: string;
    batch?: { id?: string; rowCount?: number };
    message?: string;
  } | null;

  if (!payload?.ok || !payload.batch?.id) {
    throw new Error(payload?.message ?? `导入失败 (HTTP ${response.status})`);
  }

  return {
    batchId: payload.batch.id,
    rowCount: payload.batch.rowCount ?? 0,
    status: payload.status ?? "unknown",
  };
}

// 查找已下载的文件
async function findDownloadedFile(downloadDir: string, businessDate: string): Promise<string | null> {
  const files = await readdir(downloadDir).catch(() => [] as string[]);
  // 匹配 .xls 文件，且文件名或修改日期匹配目标日期
  const candidates: Array<{ name: string; mtime: number }> = [];
  for (const file of files) {
    if (!file.endsWith(".xls") || file.endsWith(".crdownload")) continue;
    const filePath = path.join(downloadDir, file);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) continue;
    // 文件名包含日期，或者文件修改日期是目标日期
    if (file.includes(businessDate) || info.mtimeMs >= Date.parse(`${businessDate}T00:00:00Z`)) {
      candidates.push({ name: file, mtime: info.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? path.join(downloadDir, candidates[0].name) : null;
}

async function runSycmDaily(options: CliOptions) {
  const baseUrl = (process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const stores = await loadTmallStores();
  const enabledStores = stores.filter((s) => s.enabled);
  const selectedStores = options.storeKey
    ? enabledStores.filter((s) => s.storeKey === options.storeKey)
    : enabledStores;

  if (selectedStores.length === 0) {
    throw new Error(options.storeKey ? `未找到启用的店铺: ${options.storeKey}` : "没有已启用的店铺");
  }

  // 确定日期范围
  const endDate = options.endDate ?? options.date ?? shanghaiDate(-1);
  const startDate = options.startDate ?? options.date ?? endDate;
  const dates = datesInRange(startDate, endDate);

  await readdir(auditDirectory).catch(() => mkdir(auditDirectory, { recursive: true }));
  const auditPath = path.join(auditDirectory, `run-${Date.now()}.json`);
  let audit: SycmRunAudit = {
    version: 1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    items: [],
  };
  const persist = async () => {
    audit = { ...audit, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(auditPath, audit);
  };
  await persist();

  // 为每个店铺每个日期生成计划
  for (const store of selectedStores) {
    for (const businessDate of dates) {
      // 检查是否已覆盖
      let actualDates: string[] = [];
      try {
        actualDates = await getActualDates(baseUrl, store, businessDate, businessDate);
      } catch (error) {
        console.log(`查询 ${store.shopName} ${businessDate} 覆盖失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (actualDates.includes(businessDate)) {
        audit.items.push({
          storeKey: store.storeKey,
          shopName: store.shopName,
          businessDate,
          status: "duplicate",
        });
      } else {
        audit.items.push({
          storeKey: store.storeKey,
          shopName: store.shopName,
          businessDate,
          status: "planned",
        });
      }
    }
  }
  await persist();

  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, auditPath, planned: audit.items.filter((i) => i.status === "planned").length }, null, 2));
    return { ok: true, auditPath, audit };
  }

  // 执行下载和导入
  for (const item of audit.items) {
    if (item.status !== "planned") continue;

    const store = selectedStores.find((s) => s.storeKey === item.storeKey);
    if (!store) continue;

    try {
      // 步骤 1: 下载
      if (!options.importOnly) {
        item.status = "downloading";
        await persist();

        // 检查是否已有下载文件
        let filePath = await findDownloadedFile(store.browser.downloadDir, item.businessDate);

        if (!filePath) {
          // 运行浏览器下载
          const result = await runSycmController({
            storeKey: store.storeKey,
            date: item.businessDate,
            headless: options.headless,
            launchOnly: false,
            downloadOnly: true,
          });

          if (result.status !== "download_completed" || !("filePath" in result)) {
            throw new Error("下载未完成");
          }
          filePath = result.filePath as string;
        }

        item.filePath = filePath;
        item.status = "downloaded";
        await persist();
      }

      // 步骤 2: 签收
      if (!item.filePath) {
        item.status = "waiting_download";
        item.error = "缺少下载文件";
        await persist();
        continue;
      }

      if (!options.downloadOnly) {
        // 创建签收单
        const receiptPath = await createReceipt(store.storeKey, item.businessDate, item.filePath);
        item.receiptPath = receiptPath;

        // 步骤 3: 导入
        item.status = "importing";
        await persist();

        const importResult = await importFile(baseUrl, store, item.businessDate, item.filePath);
        item.batchId = importResult.batchId;
        item.rowCount = importResult.rowCount;
        item.status = importResult.status === "duplicate" ? "duplicate" : "imported";
        await persist();
      }
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
      await persist();
    }
  }

  const ok = audit.items.every((item) =>
    item.status === "imported" || item.status === "duplicate" || item.status === "waiting_download"
  );
  console.log(JSON.stringify({
    ok,
    auditPath,
    counts: {
      planned: audit.items.filter((i) => i.status === "planned").length,
      downloaded: audit.items.filter((i) => i.status === "downloaded").length,
      imported: audit.items.filter((i) => i.status === "imported").length,
      duplicate: audit.items.filter((i) => i.status === "duplicate").length,
      failed: audit.items.filter((i) => i.status === "failed").length,
    },
  }, null, 2));

  return { ok, auditPath, audit };
}

// CLI 入口
if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runSycmDaily(parseCli())
    .then((result) => {
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

export { runSycmDaily };
