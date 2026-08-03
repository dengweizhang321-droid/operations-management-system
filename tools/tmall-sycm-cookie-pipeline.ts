import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { inspectTmallImportBytes } from "../lib/netshop/import-service";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import { createTmallDownloadReceipt } from "./tmall-download-receipt";
import { runTmallMultiStoreImport, shanghaiYesterday } from "./tmall-multi-store-import-runner";
import { runTmallProductMasterStage } from "./tmall-product-master-export";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(projectRoot, "outputs", "tmall-sycm-cookie-pipeline");
const defaultCookiePointerFile = path.join(projectRoot, ".runtime", "tmall-yijiu-sycm-cookie-path.txt");
const maximumDownloadBytes = 25 * 1024 * 1024;
const maximumDaysPerRun = 31;
const sycmOrigin = "https://sycm.taobao.com";
const sycmExportPath = "/cc/item/view/excel/top.json";
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

type PipelineCommand = "master" | "plan" | "fetch" | "import" | "serve";
export type HelperStage = "ready" | "mastered" | "planned" | "fetched" | "completed" | "failed";
type HelperRoute = "/product-master" | "/plan" | "/fetch" | "/import";

type PipelinePlan = {
  version: 1;
  runId: string;
  generatedAt: string;
  baseUrl: string;
  storeKey: string;
  shopName: string;
  startDate: string;
  endDate: string;
  dates: string[];
  truncated: boolean;
  coverageAuditPath: string;
};

type DownloadedFile = {
  businessDate: string;
  fileName: string;
  filePath: string;
  size: number;
  sha256: string;
  rowCount: number;
  reusedExistingFile: boolean;
};

type PipelineManifest = {
  version: 1;
  runId: string;
  generatedAt: string;
  status: "downloaded" | "failed";
  baseUrl: string;
  storeKey: string;
  shopName: string;
  dates: string[];
  files: DownloadedFile[];
  errors: Array<{ businessDate: string; code: string; message: string }>;
};

type ParsedCookie = {
  header: string;
  values: Map<string, string>;
};

type CoveragePayload = {
  requestedPeriod?: { startDate?: string; endDate?: string };
  coverage?: { actualDates?: unknown };
};

function cliValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function inside(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("本工作流只允许连接本机运营系统，未授权生产或远程导入");
  }
  return url.toString().replace(/\/$/, "");
}

function canonicalDownloadName(businessDate: string) {
  return `【生意参谋平台】商品_全部_${businessDate}_${businessDate}.xls`;
}

export function encodeArtifactPath(filePath: string) {
  return Buffer.from(filePath, "utf8").toString("base64");
}

export function decodeArtifactPath(encoded: string) {
  const normalized = encoded.trim();
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("工件路径不是有效的 Base64");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== normalized) throw new Error("工件路径不是规范的 Base64");
  const decoded = bytes.toString("utf8");
  if (!decoded || Buffer.from(decoded, "utf8").compare(bytes) !== 0 || /[\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error("工件路径编码无效");
  }
  return path.resolve(decoded);
}

export function parseCookieHeader(rawValue: string): ParsedCookie {
  let header = rawValue.replace(/^\uFEFF/, "").trim();
  if (/^cookie\s*:/i.test(header)) header = header.replace(/^cookie\s*:\s*/i, "");
  if (!header || header.length > 32_768 || /[\r\n\u0000]/.test(header)) {
    throw new Error("Cookie 文件必须是单行、非空且不超过 32KB 的请求头值");
  }
  const values = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("Cookie 文件包含无效键值段");
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !value || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error("Cookie 文件包含无效键名或控制字符");
    }
    if (values.has(name)) throw new Error(`Cookie 文件包含重复键: ${name}`);
    values.set(name, value);
  }
  if (values.size < 2) throw new Error("Cookie 文件不像完整的浏览器请求头");
  return { header, values };
}

function decodedCookieValue(values: Map<string, string>, name: string) {
  const value = values.get(name);
  if (!value) return "";
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    throw new Error(`Cookie 键 ${name} 不是有效的 URL 编码`);
  }
}

export function assertCookieMatchesStore(cookie: ParsedCookie, store: Pick<TmallStore, "shopName">) {
  const required = ["_tb_token_", "cookie2", "unb", "sn"];
  const missing = required.filter((name) => !cookie.values.get(name));
  if (missing.length) throw new Error(`Cookie 缺少必要登录键: ${missing.join(", ")}`);
  const expectedShop = store.shopName.replace(/^天猫-?/, "");
  const signedInName = decodedCookieValue(cookie.values, "sn");
  if (signedInName !== expectedShop && !signedInName.startsWith(`${expectedShop}:`)) {
    throw new Error("Cookie 登录身份与注册店铺不一致，已阻止跨店下载");
  }
  return signedInName;
}

export function buildSycmExportUrl(businessDate: string, token: string) {
  if (!validDate(businessDate)) throw new Error("生意参谋导出日期必须是 YYYY-MM-DD");
  const params = new URLSearchParams({
    dateType: "day",
    pageSize: "10",
    page: "1",
    order: "desc",
    orderBy: "payAmt",
    device: "0",
    sellerType: "-1",
    indexCode: "payAmt",
    dateRange: `${businessDate}|${businessDate}`,
    token,
  });
  return `${sycmOrigin}${sycmExportPath}?${params}`;
}

export function isLegacyXls(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function safeInspectionError(errors: Array<{ code?: string }>) {
  const codes = [...new Set(errors.map((item) => item.code ?? "UNKNOWN"))].slice(0, 8);
  return `生意参谋 XLS 内容校验失败: ${codes.join(", ")}`;
}

function nonXlsError(bytes: Uint8Array, status: number) {
  let code: string | number | undefined;
  let message = "";
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { code?: unknown; msg?: unknown; message?: unknown };
    if (typeof payload.code === "string" || typeof payload.code === "number") code = payload.code;
    message = typeof payload.msg === "string" ? payload.msg : typeof payload.message === "string" ? payload.message : "";
  } catch {
    // 非 JSON 内容仍按魔数校验失败处理，不回显原文。
  }
  if (String(code) === "5810" || /login|登录/i.test(message)) return new Error("生意参谋 Cookie 登录态已失效，请更新 Cookie 文件后重跑");
  return new Error(`生意参谋返回的不是 XLS (HTTP ${status}${code === undefined ? "" : `, code=${code}`})`);
}

async function fetchSycmDay(
  store: TmallStore,
  cookie: ParsedCookie,
  businessDate: string,
  request: typeof fetch = fetch,
) {
  const token = cookie.values.get("XSRF-TOKEN") ?? cookie.values.get("_tb_token_") ?? "";
  const response = await request(buildSycmExportUrl(businessDate, token), {
    headers: {
      Cookie: cookie.header,
      "User-Agent": userAgent,
      Referer: `${sycmOrigin}/cc/item_rank?dateRange=${businessDate}%7C${businessDate}&dateType=day`,
      Origin: sycmOrigin,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "x-xsrf-token": token,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maximumDownloadBytes) throw new Error("生意参谋响应超过 25MB 上限");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !isLegacyXls(bytes)) throw nonXlsError(bytes, response.status);
  if (bytes.byteLength > maximumDownloadBytes) throw new Error("生意参谋响应超过 25MB 上限");
  // Node/undici 会把部分 Content-Disposition 中文字节按 Latin-1 暴露，直接采用受控单日命名，
  // 避免 mojibake 文件名，同时保留导入器依赖的精确起止日期。
  const fileName = canonicalDownloadName(businessDate);
  const inspection = await inspectTmallImportBytes({
    source: "tmall_product_daily",
    bytes,
    fileName,
    fileSizeBytes: bytes.byteLength,
    shopName: store.shopName,
    expectedStartDate: businessDate,
    expectedEndDate: businessDate,
  });
  if (inspection.errors.length) throw new Error(safeInspectionError(inspection.errors));
  if (inspection.totals.rowCount <= 0) throw new Error("生意参谋 XLS 没有可导入的商品行");
  return { bytes, fileName, rowCount: inspection.totals.rowCount };
}

async function saveDownload(store: TmallStore, runId: string, businessDate: string, bytes: Uint8Array, fileName: string) {
  await mkdir(store.browser.downloadDir, { recursive: true });
  const targetPath = path.resolve(store.browser.downloadDir, fileName);
  if (!inside(store.browser.downloadDir, targetPath)) throw new Error("下载文件名越过店铺独立目录");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await stat(targetPath).catch(() => null);
  if (existing) {
    if (!existing.isFile() || existing.size !== bytes.byteLength) {
      throw new Error(`日期 ${businessDate} 已存在同名不同内容文件，禁止静默覆盖`);
    }
    const existingBytes = new Uint8Array(await readFile(targetPath));
    if (createHash("sha256").update(existingBytes).digest("hex") !== sha256) {
      throw new Error(`日期 ${businessDate} 已存在同名不同内容文件，禁止静默覆盖`);
    }
    return { filePath: targetPath, sha256, reusedExistingFile: true };
  }
  const tempPath = `${targetPath}.${runId}.${process.pid}.part`;
  await writeFile(tempPath, bytes, { flag: "wx" });
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return { filePath: targetPath, sha256, reusedExistingFile: false };
}

async function artifactPathFromBase64(encoded: string, expectedPrefix: string) {
  await mkdir(artifactDirectory, { recursive: true });
  const [root, decoded] = await Promise.all([realpath(artifactDirectory), realpath(decodeArtifactPath(encoded))]);
  if (!inside(root, decoded) || !path.basename(decoded).startsWith(expectedPrefix) || !decoded.endsWith(".json")) {
    throw new Error("工件路径不属于本工作流的受控输出目录");
  }
  return decoded;
}

function validatePlan(plan: PipelinePlan) {
  if (plan.version !== 1 || !plan.runId || !plan.storeKey || !plan.shopName || !validDate(plan.startDate)
    || !validDate(plan.endDate) || !Array.isArray(plan.dates) || plan.dates.length > maximumDaysPerRun
    || plan.dates.some((date) => !validDate(date) || date < plan.startDate || date > plan.endDate)
    || new Set(plan.dates).size !== plan.dates.length) {
    throw new Error("缺口计划格式无效");
  }
  return plan;
}

function validateManifest(manifest: PipelineManifest) {
  if (manifest.version !== 1 || !manifest.runId || manifest.status !== "downloaded" || !manifest.storeKey || !manifest.shopName
    || !Array.isArray(manifest.dates) || manifest.dates.length > maximumDaysPerRun
    || manifest.dates.some((date) => !validDate(date)) || new Set(manifest.dates).size !== manifest.dates.length
    || !Array.isArray(manifest.files) || manifest.files.length !== manifest.dates.length || manifest.errors.length !== 0) {
    throw new Error("下载清单格式或状态无效");
  }
  const fileDates = manifest.files.map((item) => item.businessDate);
  if (new Set(fileDates).size !== fileDates.length || manifest.dates.some((date) => !fileDates.includes(date))) {
    throw new Error("下载清单的日期与文件不一一对应");
  }
  return manifest;
}

async function getActualDates(baseUrl: string, store: TmallStore, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    dimension: "spu",
    platform: "天猫",
    shop: store.shopName,
    startDate,
    endDate,
    page: "1",
    pageSize: "1",
  });
  const response = await fetch(`${baseUrl}/api/netshop/product-performance?${params}`, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => null) as CoveragePayload | null;
  const actualDates = payload?.coverage?.actualDates;
  if (!response.ok || payload?.requestedPeriod?.startDate !== startDate || payload.requestedPeriod.endDate !== endDate
    || !Array.isArray(actualDates) || actualDates.some((date) => typeof date !== "string" || !validDate(date))) {
    throw new Error(`无法回查 ${store.shopName} 的 SPU 日期覆盖 (HTTP ${response.status})`);
  }
  return actualDates as string[];
}

async function planCommand(argv: string[]) {
  const storeKey = cliValue(argv, "--store-key") ?? "tmall-yijiu";
  const store = await getTmallStore(storeKey);
  const endDate = cliValue(argv, "--end-date") ?? shanghaiYesterday();
  const startDate = cliValue(argv, "--start-date") ?? store.initialStartDate;
  if (!startDate || !validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > shanghaiYesterday()) {
    throw new Error("缺口计划日期必须位于店铺注册起始日至昨天之间");
  }
  const requestedMaximum = Number(cliValue(argv, "--max-days") ?? maximumDaysPerRun);
  if (!Number.isInteger(requestedMaximum) || requestedMaximum < 1 || requestedMaximum > maximumDaysPerRun) {
    throw new Error(`--max-days 必须是 1..${maximumDaysPerRun} 的整数`);
  }
  const baseUrl = normalizeLocalBaseUrl(cliValue(argv, "--base-url") ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const planned = await runTmallMultiStoreImport({ baseUrl, storeKey, startDate, endDate, dryRun: true });
  if (!planned.ok) {
    const failed = planned.audit.items.find((item) => item.status === "failed");
    throw new Error(failed?.error ?? "运营系统日期覆盖查询失败");
  }
  const allDates = planned.audit.items.filter((item) => item.status === "planned").map((item) => item.businessDate).sort();
  const dates = allDates.slice(0, requestedMaximum);
  const runId = randomUUID();
  const plan: PipelinePlan = {
    version: 1,
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl,
    storeKey: store.storeKey,
    shopName: store.shopName,
    startDate,
    endDate,
    dates,
    truncated: allDates.length > dates.length,
    coverageAuditPath: planned.auditPath,
  };
  const planPath = path.join(artifactDirectory, `plan-${runId}.json`);
  await writeJsonAtomic(planPath, plan);
  return { ok: true, stage: "plan", planPath, planPathBase64: encodeArtifactPath(planPath), dates, truncated: plan.truncated };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCommand(argv: string[]) {
  const encodedPlan = cliValue(argv, "--plan-base64");
  if (!encodedPlan) throw new Error("fetch 阶段缺少 --plan-base64");
  const planPath = await artifactPathFromBase64(encodedPlan, "plan-");
  const plan = validatePlan(JSON.parse(await readFile(planPath, "utf8")) as PipelinePlan);
  const store = await getTmallStore(plan.storeKey);
  if (plan.shopName !== store.shopName || plan.baseUrl !== normalizeLocalBaseUrl(plan.baseUrl)) throw new Error("计划店铺或系统地址与注册表不一致");
  const cookieFile = process.env.TMALL_SYCM_COOKIE_FILE
    ?? await readFile(defaultCookiePointerFile, "utf8").then((value) => value.trim()).catch(() => "");
  if (!cookieFile || !path.isAbsolute(cookieFile)) {
    throw new Error("必须通过 TMALL_SYCM_COOKIE_FILE 或本机 .runtime 指针提供绝对 Cookie 文件路径");
  }
  const cookie = parseCookieHeader(await readFile(cookieFile, "utf8"));
  assertCookieMatchesStore(cookie, store);

  const files: DownloadedFile[] = [];
  const manifestPath = path.join(artifactDirectory, `manifest-${plan.runId}.json`);
  const manifest: PipelineManifest = {
    version: 1,
    runId: plan.runId,
    generatedAt: new Date().toISOString(),
    status: "downloaded",
    baseUrl: plan.baseUrl,
    storeKey: store.storeKey,
    shopName: store.shopName,
    dates: plan.dates,
    files,
    errors: [],
  };
  try {
    for (let index = 0; index < plan.dates.length; index += 1) {
      const businessDate = plan.dates[index]!;
      const downloaded = await fetchSycmDay(store, cookie, businessDate);
      const saved = await saveDownload(store, plan.runId, businessDate, downloaded.bytes, downloaded.fileName);
      files.push({
        businessDate,
        fileName: downloaded.fileName,
        filePath: saved.filePath,
        size: downloaded.bytes.byteLength,
        sha256: saved.sha256,
        rowCount: downloaded.rowCount,
        reusedExistingFile: saved.reusedExistingFile,
      });
      if (index + 1 < plan.dates.length) await delay(1_200 + Math.floor(Math.random() * 1_201));
    }
  } catch (error) {
    manifest.status = "failed";
    const businessDate = plan.dates[files.length] ?? "unknown";
    manifest.errors.push({ businessDate, code: "DOWNLOAD_FAILED", message: error instanceof Error ? error.message : String(error) });
    await writeJsonAtomic(manifestPath, manifest);
    throw error;
  }
  await writeJsonAtomic(manifestPath, manifest);
  return {
    ok: true,
    stage: "fetch",
    manifestPath,
    manifestPathBase64: encodeArtifactPath(manifestPath),
    downloaded: files.length,
    rows: files.reduce((sum, item) => sum + item.rowCount, 0),
    reusedExistingFiles: files.filter((item) => item.reusedExistingFile).length,
  };
}

async function importCommand(argv: string[]) {
  const encodedManifest = cliValue(argv, "--manifest-base64");
  if (!encodedManifest) throw new Error("import 阶段缺少 --manifest-base64");
  const manifestPath = await artifactPathFromBase64(encodedManifest, "manifest-");
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")) as PipelineManifest);
  const store = await getTmallStore(manifest.storeKey);
  const baseUrl = normalizeLocalBaseUrl(manifest.baseUrl);
  if (manifest.shopName !== store.shopName) throw new Error("下载清单店铺与注册表不一致");

  for (const item of manifest.files) {
    const filePath = path.resolve(item.filePath);
    if (!inside(store.browser.downloadDir, filePath) || path.basename(filePath) !== item.fileName
      || item.fileName !== canonicalDownloadName(item.businessDate) || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isFinite(item.size) || item.size <= 0 || item.size > maximumDownloadBytes) {
      throw new Error(`下载清单文件身份无效: ${item.businessDate}`);
    }
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== item.size) throw new Error(`下载文件缺失或大小变化: ${item.businessDate}`);
    const bytes = new Uint8Array(await readFile(filePath));
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error(`下载文件哈希变化: ${item.businessDate}`);
    await createTmallDownloadReceipt({ storeKey: store.storeKey, businessDate: item.businessDate, filePath });
  }

  const dates = [...manifest.dates].sort();
  if (dates.length === 0) {
    const resultPath = path.join(artifactDirectory, `result-${manifest.runId}.json`);
    const summary = { ok: true, stage: "import", resultPath, dates: [], counts: {}, coverageConfirmed: true };
    await writeJsonAtomic(resultPath, summary);
    return summary;
  }
  const imported = await runTmallMultiStoreImport({
    baseUrl,
    storeKey: store.storeKey,
    endDate: dates.at(-1)!,
    dates,
    dryRun: false,
  });
  const actualDates = await getActualDates(baseUrl, store, dates[0]!, dates.at(-1)!);
  const missingAfterImport = dates.filter((date) => !actualDates.includes(date));
  const failedItems = imported.audit.items.filter((item) => !["imported", "duplicate", "completed_with_warnings"].includes(item.status));
  const counts = Object.fromEntries(["imported", "duplicate", "completed_with_warnings", "waiting_download", "failed"].map((status) => [
    status,
    imported.audit.items.filter((item) => item.status === status).length,
  ]));
  const ok = failedItems.length === 0 && missingAfterImport.length === 0;
  const resultPath = path.join(artifactDirectory, `result-${manifest.runId}.json`);
  const summary = {
    ok,
    stage: "import",
    resultPath,
    importAuditPath: imported.auditPath,
    dates,
    counts,
    alreadyCoveredBeforeImport: dates.length - imported.audit.items.length,
    coverageConfirmed: missingAfterImport.length === 0,
    missingAfterImport,
  };
  await writeJsonAtomic(resultPath, summary);
  if (!ok) throw new Error("导入未全部完成或覆盖回查未命中，详见结果清单");
  return summary;
}

function integerPort(value: string | undefined) {
  const port = Number(value ?? 5791);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("--port 必须是 1024..65535 的整数");
  return port;
}

export function helperRequestError(stage: HelperStage, busy: boolean, route: HelperRoute) {
  if (busy) return { error: "pipeline_busy" as const };
  if (route === "/product-master") {
    return stage === "ready" ? null : { error: "invalid_stage" as const, expected: "ready" as const, actual: stage };
  }
  if (route === "/plan") {
    return stage === "ready" || stage === "mastered"
      ? null
      : { error: "invalid_stage" as const, expected: "ready_or_mastered" as const, actual: stage };
  }
  const expected: HelperStage = route === "/fetch" ? "planned" : "fetched";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}

async function serveCommand(argv: string[]) {
  const port = integerPort(cliValue(argv, "--port"));
  let stage: HelperStage = "ready";
  let busy = false;
  let planPathBase64 = "";
  let manifestPathBase64 = "";
  const server = createServer(async (request, response) => {
    const reply = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
    };
    if (request.method === "GET" && request.url === "/health") {
      reply(200, { ok: true, stage, busy });
      return;
    }
    if (request.method !== "POST" || !["/product-master", "/plan", "/fetch", "/import"].includes(request.url ?? "")) {
      reply(404, { ok: false, error: "not_found" });
      return;
    }
    const route = request.url as HelperRoute;
    const stateError = helperRequestError(stage, busy, route);
    if (stateError) {
      reply(409, { ok: false, ...stateError });
      return;
    }
    busy = true;
    try {
      if (request.url === "/product-master") {
        const result = await runTmallProductMasterStage({ storeKey: "tmall-yijiu" });
        stage = "mastered";
        reply(200, result);
      } else if (request.url === "/plan") {
        const result = await planCommand(["--store-key", "tmall-yijiu", "--max-days", String(maximumDaysPerRun)]);
        planPathBase64 = result.planPathBase64;
        stage = "planned";
        reply(200, result);
      } else if (request.url === "/fetch") {
        const result = await fetchCommand(["--plan-base64", planPathBase64]);
        manifestPathBase64 = result.manifestPathBase64;
        stage = "fetched";
        reply(200, result);
      } else {
        const result = await importCommand(["--manifest-base64", manifestPathBase64]);
        stage = "completed";
        reply(200, result);
        setTimeout(() => server.close(), 500);
      }
    } catch (error) {
      stage = "failed";
      reply(500, { ok: false, stage, error: error instanceof Error ? error.message : String(error) });
      setTimeout(() => server.close(), 500);
    } finally {
      busy = false;
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return { ok: true, stage: "serve", address: "127.0.0.1", port, oneShot: true };
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] as PipelineCommand | undefined;
  if (!command || !["master", "plan", "fetch", "import", "serve"].includes(command)) {
    throw new Error("用法: tmall-sycm-cookie-pipeline.ts <master|plan|fetch|import|serve> [参数]");
  }
  const result = command === "master"
    ? await runTmallProductMasterStage({
        storeKey: cliValue(argv.slice(1), "--store-key") ?? "tmall-yijiu",
        baseUrl: cliValue(argv.slice(1), "--base-url"),
        snapshotDate: cliValue(argv.slice(1), "--snapshot-date"),
      })
    : command === "plan"
    ? await planCommand(argv.slice(1))
    : command === "fetch"
      ? await fetchCommand(argv.slice(1))
      : command === "import"
        ? await importCommand(argv.slice(1))
        : await serveCommand(argv.slice(1));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
