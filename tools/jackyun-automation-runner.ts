import path from "node:path";
import { fileURLToPath } from "node:url";
import { runController } from "./jackyun-browser-controller";
import { JackyunDailyRunError, preflightJackyunResume, runJackyunDaily } from "./jackyun-daily-runner";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";

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

export function assertJackyunDailyDatePolicy(snapshotDate: string, asOfDate: string) {
  const yesterday = shanghaiYesterday();
  if (snapshotDate !== yesterday || asOfDate !== yesterday) {
    throw new JackyunDailyRunError(
      "FIELD_MISMATCH",
      "validate_daily_date_policy",
      `每日自动化的 snapshotDate 与 asOfDate 必须同时等于北京时间昨天 ${yesterday}；历史补跑必须使用独立人工取证流程。`,
    );
  }
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

function resultStatus(value: unknown) {
  return value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string"
    ? (value as { status: string }).status
    : "";
}

function structuredFailure(reason: unknown) {
  return reason && typeof reason === "object" && typeof (reason as { failureCode?: unknown }).failureCode === "string";
}

export function settleJackyunAutomationResults(input: {
  dryRun: boolean;
  runId: string;
  browserSettled: PromiseSettledResult<unknown>;
  dailySettled: PromiseSettledResult<unknown>;
}) {
  if (input.dryRun
    && input.dailySettled.status === "fulfilled"
    && resultStatus(input.dailySettled.value) === "prepared") {
    if (input.browserSettled.status === "rejected") {
      const message = input.browserSettled.reason instanceof Error
        ? input.browserSettled.reason.message
        : String(input.browserSettled.reason);
      if (!/下载后处理未完成/.test(message)) throw input.browserSettled.reason;
    } else if (resultStatus(input.browserSettled.value) === "completed") {
      throw new JackyunDailyRunError(
        "BATCH_VERIFY_FAILED",
        "settle_dry_run",
        "dry-run 的浏览器流程不得报告 completed。",
      );
    }
    return {
      browserResult: {
        status: "prepared" as const,
        runId: input.runId,
        stoppedAfterPreparedModule: true,
      },
      dailyResult: input.dailySettled.value,
    };
  }

  if (input.browserSettled.status === "rejected" || input.dailySettled.status === "rejected") {
    const browserReason = input.browserSettled.status === "rejected" ? input.browserSettled.reason : null;
    const dailyReason = input.dailySettled.status === "rejected" ? input.dailySettled.reason : null;
    if (structuredFailure(dailyReason)) throw dailyReason;
    if (structuredFailure(browserReason)) throw browserReason;
    throw browserReason ?? dailyReason;
  }
  if (resultStatus(input.browserSettled.value) !== "completed"
    || resultStatus(input.dailySettled.value) !== "completed") {
    throw new JackyunDailyRunError(
      "BATCH_VERIFY_FAILED",
      "settle_formal_run",
      `正式自动化只能汇总 completed：browser=${resultStatus(input.browserSettled.value) || "unknown"}，daily=${resultStatus(input.dailySettled.value) || "unknown"}。`,
    );
  }
  return { browserResult: input.browserSettled.value, dailyResult: input.dailySettled.value };
}

type JackyunAutomationDependencies = {
  preflightResume?: typeof preflightJackyunResume;
  runBrowser?: typeof runController;
  runDaily?: typeof runJackyunDaily;
};

export async function runJackyunAutomationUnderLock(
  options: JackyunAutomationOptions,
  dependencies: JackyunAutomationDependencies = {},
) {
  await (dependencies.preflightResume ?? preflightJackyunResume)(options);
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(options.signal?.reason ?? new Error("吉客云 n8n 任务已取消。"));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const cancelPeerOnFailure = <T>(promise: Promise<T>) => promise.catch((error: unknown) => {
    abortController.abort(error);
    throw error;
  });
  const browser = cancelPeerOnFailure((dependencies.runBrowser ?? runController)({
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
      throw new JackyunDailyRunError(
        result.status === "login_required" || result.status === "login_unknown" ? "AUTH_REQUIRED" : "PIPELINE_FAILED",
        "browser_session_precheck",
        result.status === "login_required"
          ? "吉客云专用 Chrome 登录态已失效，请先执行 npm run jackyun:login 完成人工登录。"
          : `吉客云浏览器流程未完成：${result.status}`,
      );
    }
    return result;
  }));
  const daily = cancelPeerOnFailure((dependencies.runDaily ?? runJackyunDaily)({
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
    const [browserSettled, dailySettled] = await Promise.allSettled([browser, daily]);
    return settleJackyunAutomationResults({
      dryRun: options.dryRun,
      runId: options.runId,
      browserSettled,
      dailySettled,
    });
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function runJackyunAutomation(options: JackyunAutomationOptions) {
  assertJackyunDailyDatePolicy(options.snapshotDate, options.asOfDate);
  return withJackyunRunLock(
    { runId: options.runId, purpose: "five_dataset_automation" },
    () => runJackyunAutomationUnderLock(options),
  );
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runJackyunAutomation(parseArgs())
    .then(({ browserResult, dailyResult }) => {
      console.log(JSON.stringify({
        type: resultStatus(dailyResult) === "completed" ? "jackyun_automation_completed" : "jackyun_automation_prepared",
        browserResult,
        dailyResult,
      }));
    })
    .catch((error: unknown) => {
      const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
      console.error(JSON.stringify({
        status: "failed",
        failureCode: record?.failureCode ?? "PIPELINE_FAILED",
        stage: record?.stage ?? "automation",
        message: error instanceof Error ? error.message : String(error),
      }));
      // A failed CDP/Playwright connection can keep a socket alive even after the
      // peer task has been aborted. Exit the CLI immediately so a blocked module
      // never leaves the daily runner hanging in the background.
      process.exit(1);
    });
}
