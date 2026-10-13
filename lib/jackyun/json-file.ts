import { copyFile, link, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { jackyunPublicationFence } from "./ownership-context";
import path from "node:path";
const nativePublisherScript = fileURLToPath(new URL("../../tools/jackyun-json-publish.ps1", import.meta.url));
const execFileAsync = promisify(execFile);

export function parseJsonText<T>(text: string): T {
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    return parseJsonText<T>(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`JSON 文件损坏或无法读取，已停止以免覆盖：${filePath}`, { cause: error });
  }
}

export async function readJsonFileOr<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if ((cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readJsonDurableOr<T>(filePath: string, fallback: T): Promise<T> {
  const info = await lstat(filePath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) return fallback;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new Error("关键 JSON 记录文件身份或大小无效。");
  const value = await readJsonFile<unknown>(filePath);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("关键 JSON 记录不是完整对象；保留原证据，禁止重置。");
  return value as T;
}

export async function writeJsonAtomic(filePath: string, value: unknown, pretty = true) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(tempPath, `${json}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await copyFile(tempPath, filePath);
    await rm(tempPath, { force: true });
  }
}

/** Critical recovery path: fsync the complete temporary file, then publish it
 * atomically. A rename failure preserves the old destination and the temporary
 * evidence; never copy over a live record. createOnly uses exclusive link
 * publication, followed by removal of the temporary name. A crash leaving two
 * names is an ambiguous record, not permission to replay a business action.
 * Directory fsync is supported on POSIX; Windows does not expose that contract
 * through Node. Recovery therefore revalidates the chain and business evidence.
 */
export async function writeJsonDurable(filePath: string, value: unknown, createOnly = false) {
  await mkdir(path.dirname(filePath), { recursive: true });
  for (let cursor = path.resolve(path.dirname(filePath)); ; cursor = path.dirname(cursor)) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("恢复记录目录身份异常。 ");
    if (path.dirname(cursor) === cursor) break;
  }
  const existing = await lstat(filePath).catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error("恢复记录文件身份异常。");
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await publishDurableFile(tempPath, filePath, createOnly);
}

/** Same-directory publication of a fully fsynced file. Also used to restore
 * exact original workbook bytes after preserving corruption evidence. */
export async function publishDurableFile(tempPath: string, filePath: string, createOnly = false) {
  if (path.dirname(path.resolve(tempPath)) !== path.dirname(path.resolve(filePath)) || !tempPath.startsWith(filePath + ".") || !tempPath.endsWith(".tmp")) throw new Error("原子文件发布路径不属于同一目标。");
  if (process.platform === "win32") {
    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const fence = jackyunPublicationFence.getStore();
    const encodedFence = Buffer.from(JSON.stringify(fence ? { version: fence.version, ownerToken: fence.ownerToken, pid: fence.pid,
      processIdentity: fence.processIdentity, runId: fence.runId, purpose: fence.purpose, lockDirectory: fence.lockDirectory } : null)).toString("base64");
    let result;
    try {
      result = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativePublisherScript,
        "-TemporaryPath", tempPath, "-TargetPath", filePath, "-CreateOnly", createOnly ? "true" : "false", "-FenceBase64", encodedFence],
        { windowsHide: true, timeout: 15000, maxBuffer: 8192, encoding: "utf8" });
    } catch {
      // execFile errors include argv. Never expose the fencing token or the
      // complete process command line through helper/n8n diagnostics.
      throw new Error("JACKYUN_RECORD_PUBLISH_MANUAL_ACTION：关键记录原子发布未确认，已保留旧记录及临时证据；请核查文件占用、权限和原 owner，禁止覆盖放行。");
    }
    if (JSON.parse(result.stdout.trim()).published !== true) throw new Error("Windows 原子发布结果无法确认，保留证据并停止。");
  } else if (createOnly) { await link(tempPath, filePath); await rm(tempPath); }
  else await rename(tempPath, filePath);
  const published = await open(filePath, "r+");
  try { await published.sync(); } finally { await published.close(); }
  if (process.platform !== "win32") {
    const directory = await open(path.dirname(filePath), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
