import path from "node:path";
import { fileURLToPath } from "node:url";
import { runController } from "./jackyun-browser-controller";
import { runJackyunDaily } from "./jackyun-daily-runner";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type JackyunAutomationOptions = {
  runId: string;
  snapshotDate: string;
  asOfDate: string;
  eventDirectory: string;
  outputRoot: string;
  baseUrl: string;
  chromePath?: string;
  profileDirectory?: string;
  debuggingPort?: number;
  resume: boolean;
  dryRun: boolean;
  headless: boolean;
  signal?: AbortSignal;
};

function shanghaiYesterday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const today = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().slice(0, 10);
}

function defaultRunId() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date()).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{6})$/, "$1-$2");
}

function parseArgs(): JackyunAutomationOptions {
  const values = new Map<string, string>();
  let resume = false;
  let dryRun = false;
  let headless = true;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--resume") { resume = true; continue; }
    if (argument === "--dry-run") { dryRun = true; continue; }
    if (argument === "--headless") { headless = true; continue; }
    if (argument === "--headed") { headless = false; continue; }
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`参数 ${argument} 缺少取值。`);
    values.set(argument, next);
    index += 1;
  }
  const yesterday = shanghaiYesterday();
  return {
    runId: values.get("--run-id") ?? defaultRunId(),
    snapshotDate: values.get("--snapshot") ?? yesterday,
    asOfDate: values.get("--as-of") ?? yesterday,
    eventDirectory: path.resolve(values.get("--event-dir") ?? path.join(projectRoot, "outputs", "jackyun-browser-events")),
    outputRoot: path.resolve(values.get("--output-root") ?? path.join(projectRoot, "outputs", "jackyun-import-runs")),
    baseUrl: (values.get("--base-url") ?? "http://localhost:3000").replace(/\/$/, ""),
    chromePath: values.get("--chrome-path"),
    profileDirectory: values.get("--profile-dir"),
    debuggingPort: values.has("--debug-port") ? Number(values.get("--debug-port")) : undefined,
    resume,
    dryRun,
    headless,
  };
}

export async function runJackyunAutomation(options: JackyunAutomationOptions) {
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(options.signal?.reason ?? new Error("吉客云 n8n 任务已取消。"));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const cancelPeerOnFailure = <T>(promise: Promise<T>) => promise.catch((error: unknown) => {
    abortController.abort(error);
    throw error;
  });
  const browser = cancelPeerOnFailure(runController({
    runId: options.runId,
    snapshotDate: options.snapshotDate,
    asOfDate: options.asOfDate,
    eventRoot: options.eventDirectory,
    outputRoot: options.outputRoot,
    chromePath: options.chromePath,
    profileDirectory: options.profileDirectory,
    debuggingPort: options.debuggingPort,
    headless: options.headless,
    launchOnly: false,
    checkLoginOnly: false,
    signal: abortController.signal,
  }).then((result) => {
    if (result.status !== "completed") {
      throw new Error(result.status === "login_required"
        ? "吉客云专用 Chrome 登录态已失效，请先执行 npm run jackyun:login 完成人工登录。"
        : `吉客云浏览器流程未完成：${result.status}`);
    }
    return result;
  }));
  const daily = cancelPeerOnFailure(runJackyunDaily({
    runId: options.runId,
    snapshotDate: options.snapshotDate,
    asOfDate: options.asOfDate,
    eventDirectory: options.eventDirectory,
    outputRoot: options.outputRoot,
    baseUrl: options.baseUrl,
    dryRun: options.dryRun,
    resume: options.resume,
    signal: abortController.signal,
  }));
  try {
    const [browserResult, dailyResult] = await Promise.all([browser, daily]);
    return { browserResult, dailyResult };
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runJackyunAutomation(parseArgs())
    .then(({ browserResult, dailyResult }) => {
      console.log(JSON.stringify({ type: "jackyun_automation_completed", browserResult, dailyResult }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      // A failed CDP/Playwright connection can keep a socket alive even after the
      // peer task has been aborted. Exit the CLI immediately so a blocked module
      // never leaves the daily runner hanging in the background.
      process.exit(1);
    });
}
