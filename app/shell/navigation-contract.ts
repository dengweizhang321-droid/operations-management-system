import {
  isImportSourceKey,
  isModuleKey,
  type ImportSourceKey,
  type ModuleKey,
} from "./navigation-catalog";

export const shellPeriodKeys = [
  "today",
  "yesterday",
  "last7",
  "last15",
  "current_month",
  "calendar_month",
  "custom",
] as const;

export type ShellPeriodKey = (typeof shellPeriodKeys)[number];

export type ShellPeriodState =
  | { kind: "today" | "yesterday" | "last7" | "last15" | "current_month" }
  | { kind: "calendar_month"; month: string }
  | { kind: "custom"; from: string; to: string };

export type ShellLocationState = {
  module: ModuleKey;
  source?: ImportSourceKey;
  period: ShellPeriodState;
};

export const shellOwnedQueryKeys = ["module", "source", "period", "month", "from", "to"] as const;

const relativeOrCurrentPeriodKeys: ReadonlySet<string> = new Set([
  "today",
  "yesterday",
  "last7",
  "last15",
  "current_month",
]);

const LOCAL_URL_ORIGIN = "https://teruisi-shell.invalid";

function toUrl(input: string | URL): URL {
  return input instanceof URL ? new URL(input.toString()) : new URL(input, LOCAL_URL_ORIGIN);
}

function toRelativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function singleQueryValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parsePeriod(params: URLSearchParams): ShellPeriodState {
  const period = singleQueryValue(params, "period");
  if (period === null || period === "current_month") return { kind: "current_month" };
  if (relativeOrCurrentPeriodKeys.has(period)) {
    return { kind: period as "today" | "yesterday" | "last7" | "last15" };
  }
  if (period === "calendar_month") {
    const month = singleQueryValue(params, "month");
    return month !== null && isIsoMonth(month)
      ? { kind: "calendar_month", month }
      : { kind: "current_month" };
  }
  if (period === "custom") {
    const from = singleQueryValue(params, "from");
    const to = singleQueryValue(params, "to");
    return from !== null && to !== null && isIsoDate(from) && isIsoDate(to) && from <= to
      ? { kind: "custom", from, to }
      : { kind: "current_month" };
  }
  return { kind: "current_month" };
}

export function parseShellLocation(input: string | URL): ShellLocationState {
  const url = toUrl(input);
  const moduleValue = singleQueryValue(url.searchParams, "module");
  const activeModule = moduleValue !== null && isModuleKey(moduleValue) ? moduleValue : "dashboard";
  const sourceValue = singleQueryValue(url.searchParams, "source");
  const source = activeModule === "import" && sourceValue !== null && isImportSourceKey(sourceValue)
    ? sourceValue
    : undefined;
  return {
    module: activeModule,
    ...(source ? { source } : {}),
    period: parsePeriod(url.searchParams),
  };
}

function writeShellState(url: URL, state: ShellLocationState): void {
  for (const key of shellOwnedQueryKeys) url.searchParams.delete(key);

  if (state.module !== "dashboard") url.searchParams.append("module", state.module);
  if (state.module === "import" && state.source && isImportSourceKey(state.source)) {
    url.searchParams.append("source", state.source);
  }

  if (state.period.kind === "current_month") return;
  url.searchParams.append("period", state.period.kind);
  if (state.period.kind === "calendar_month") url.searchParams.append("month", state.period.month);
  if (state.period.kind === "custom") {
    url.searchParams.append("from", state.period.from);
    url.searchParams.append("to", state.period.to);
  }
}

export function serializeShellLocation(
  state: ShellLocationState,
  current: string | URL = "/",
): string {
  const url = toUrl(current);
  writeShellState(url, state);
  return toRelativeUrl(url);
}

export function normalizeShellLocation(input: string | URL): string {
  const url = toUrl(input);
  writeShellState(url, parseShellLocation(url));
  return toRelativeUrl(url);
}
