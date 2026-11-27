import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeChromeBrowser, listChromeTargets, readChromeBrowserProcessId } from "../jackyun/cdp-client";

/**
 * A visible Chromium window opened only so the operator can clear a JD login
 * verification. All JD stores share one Chromium user-data root, so while the
 * window is open no automated JD stage may launch Chromium. The window is never
 * attached to, read or driven by automation; it is tracked by this marker next
 * to the global Chromium lock and released when the operator closes it or when
 * it has stayed open longer than the bounded period below.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const jdManualVerifyWindowMaxOpenMs = 30 * 60_000;
/** Deliberately free of `manual_action` / `waiting_login` wording: a run blocked
 * by an open window is an ordinary failure the hourly retry may repeat later. */
export const jdManualVerifyWindowOpenCode = "JD_VERIFY_WINDOW_OPEN";

export function jdManualVerifyWindowMarkerPath(lockDirectory?: string) {
  return lockDirectory
    ? path.join(path.dirname(lockDirectory), "jd-manual-verify-window.json")
    : path.join(projectRoot, ".runtime", "jd-manual-verify-window.json");
}

export type JdManualVerifyWindowMarker = {
  version: 1;
  storeKey?: string;
  shopName?: string;
  port: number;
  browserPid: number | null;
  openedAt: string;
};

export class JdManualVerifyWindowOpenError extends Error {
  readonly code = jdManualVerifyWindowOpenCode;
}

export function isJdManualVerifyWindowOpenError(error: unknown) {
  return error instanceof JdManualVerifyWindowOpenError
    || (error instanceof Error && error.message.startsWith(`${jdManualVerifyWindowOpenCode}：`));
}

type WindowDependencies = {
  listTargets: (port: number) => Promise<Array<{ type?: string }>>;
  readBrowserPid: (port: number) => Promise<number>;
  closeBrowser: (port: number) => Promise<boolean>;
  now: () => number;
};

const defaultDependencies: WindowDependencies = {
  listTargets: listChromeTargets,
  readBrowserPid: readChromeBrowserProcessId,
  closeBrowser: (port) => closeChromeBrowser(port),
  now: () => Date.now(),
};

function parseMarker(raw: string): JdManualVerifyWindowMarker | null {
  try {
    const value = JSON.parse(raw) as Partial<JdManualVerifyWindowMarker>;
    if (value?.version !== 1 || !Number.isSafeInteger(value.port) || Number(value.port) <= 0
      || !(value.browserPid === null || (Number.isSafeInteger(value.browserPid) && Number(value.browserPid) > 0))
      || typeof value.openedAt !== "string" || !Number.isFinite(Date.parse(value.openedAt))) return null;
    return value as JdManualVerifyWindowMarker;
  } catch {
    return null;
  }
}

/** Records the window this process just opened. Called while the caller still
 * holds the global Chromium lock, after its own automated browser was closed. */
export async function recordJdManualVerifyWindow(
  input: { port: number; storeKey?: string; shopName?: string },
  markerPath = jdManualVerifyWindowMarkerPath(),
  dependencies: Pick<WindowDependencies, "readBrowserPid" | "now"> = defaultDependencies,
) {
  const browserPid = await dependencies.readBrowserPid(input.port).catch(() => null);
  const marker: JdManualVerifyWindowMarker = {
    version: 1,
    ...(input.storeKey ? { storeKey: input.storeKey } : {}),
    ...(input.shopName ? { shopName: input.shopName } : {}),
    port: input.port,
    browserPid,
    openedAt: new Date(dependencies.now()).toISOString(),
  };
  await mkdir(path.dirname(markerPath), { recursive: true });
  const temporary = `${markerPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(marker));
  await rename(temporary, markerPath);
  return marker;
}

/**
 * Pre-launch check for every JD Chromium stage. Throws while a recorded
 * verification window is still open; clears the marker once the window is gone;
 * closes the window it opened (same port and browser PID) after the bounded
 * period. It only lists targets and reads the browser PID: no page is attached.
 *
 * `readOnly` is for early checks made without the global Chromium lock (the n8n
 * plan stage): it never removes the marker or closes a window, and leaves an
 * expired window to the locked check.
 */
export async function assertNoJdManualVerifyWindowOpen(
  markerPath = jdManualVerifyWindowMarkerPath(),
  dependencies: WindowDependencies = defaultDependencies,
  { readOnly = false }: { readOnly?: boolean } = {},
) {
  const raw = await readFile(markerPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return;
  const marker = parseMarker(raw);
  const clear = async () => { if (!readOnly) await rm(markerPath, { force: true }); };
  if (!marker) { await clear(); return; }

  const targets = await dependencies.listTargets(marker.port).catch(() => null);
  if (!targets) { await clear(); return; }
  const pid = await dependencies.readBrowserPid(marker.port).catch(() => null);
  const sameProcess = marker.browserPid !== null && pid === marker.browserPid;
  if (marker.browserPid !== null && !sameProcess) {
    // The window we opened is gone; whatever owns the port now is handled by
    // the ordinary launch checks, which refuse unknown instances.
    await clear();
    return;
  }
  const hasWindow = targets.some((target) => target.type === "page");
  if (!hasWindow && sameProcess) {
    if (readOnly) return;
    await dependencies.closeBrowser(marker.port);
    await clear();
    return;
  }
  const shop = marker.shopName ?? marker.storeKey ?? "京东店铺";
  const expired = dependencies.now() - Date.parse(marker.openedAt) >= jdManualVerifyWindowMaxOpenMs;
  if (expired && sameProcess) {
    if (readOnly) return;
    await dependencies.closeBrowser(marker.port);
    await clear();
    return;
  }
  throw new JdManualVerifyWindowOpenError(expired
    ? `${jdManualVerifyWindowOpenCode}：${shop} 的人工验证窗口已打开超过 30 分钟，无法确认归属，请手动关闭该窗口后再运行。`
    : `${jdManualVerifyWindowOpenCode}：${shop} 的人工验证窗口还开着。请完成验证后关闭该窗口，之后的重试会自动继续。`);
}
