import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export function resolveJackyunRunLockProjectRoot(input: {
  moduleUrl?: string;
  cwd?: string;
} = {}) {
  const cwd = input.cwd ?? process.cwd();
  if (typeof input.moduleUrl === "string" && input.moduleUrl.startsWith("file:")) {
    try {
      return path.resolve(path.dirname(fileURLToPath(input.moduleUrl)), "../..");
    } catch {
      // Bundled Worker runtimes may not expose a filesystem-backed module URL.
    }
  }
  return path.resolve(cwd);
}

const projectRoot = resolveJackyunRunLockProjectRoot({ moduleUrl: import.meta.url });
const staleOwnerPrefix = "stale-owner-";
const legacyOwnerMaximumAgeMs = 24 * 60 * 60 * 1_000;
const emptyLockRecoveryAgeMs = 5 * 60 * 1_000;
const execFileAsync = promisify(execFile);

export type JackyunRunLockOwner = {
  version: 1 | 2;
  ownerToken: string;
  pid: number;
  processIdentity?: string;
  runId: string;
  purpose: string;
  acquiredAt: string;
};

export type JackyunRunLock = JackyunRunLockOwner & {
  lockDirectory: string;
  release: () => Promise<void>;
};

type AcquireOptions = {
  runId: string;
  purpose: string;
  lockDirectory?: string;
};

function validOwner(value: unknown): value is JackyunRunLockOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Partial<JackyunRunLockOwner>;
  return (owner.version === 1 || owner.version === 2)
    && (owner.version !== 2 || (typeof owner.processIdentity === "string" && owner.processIdentity.length > 0))
    && typeof owner.ownerToken === "string"
    && /^[a-f0-9-]{36}$/i.test(owner.ownerToken)
    && Number.isSafeInteger(owner.pid)
    && Number(owner.pid) > 0
    && typeof owner.runId === "string"
    && /^[A-Za-z0-9._-]{1,96}$/.test(owner.runId)
    && typeof owner.purpose === "string"
    && owner.purpose.length > 0
    && Number.isFinite(Date.parse(String(owner.acquiredAt)));
}

async function readOwnerFile(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return validOwner(value) ? value : null;
  } catch {
    return null;
  }
}

function ownerPath(lockDirectory: string) {
  return path.join(lockDirectory, "owner.json");
}

async function readOwner(lockDirectory: string) {
  return readOwnerFile(ownerPath(lockDirectory));
}

function processIsAlive(pid: number) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readProcessIdentity(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "win32") {
      const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToFileTimeUtc()`;
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: 5_000, windowsHide: true },
      );
      const value = stdout.trim();
      return /^\d+$/.test(value) ? `win32:${value}` : null;
    }
    if (process.platform === "linux") {
      const raw = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : null;
    }
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5_000,
    });
    return stdout.trim() ? `${process.platform}:${stdout.trim()}` : null;
  } catch {
    return null;
  }
}

let ownProcessIdentityPromise: Promise<string | null> | undefined;

function currentProcessIdentity() {
  ownProcessIdentityPromise ??= readProcessIdentity(process.pid);
  return ownProcessIdentityPromise;
}

async function ownerIsLive(owner: JackyunRunLockOwner) {
  if (!processIsAlive(owner.pid)) return false;
  if (owner.version === 2 && owner.processIdentity) {
    const actualIdentity = owner.pid === process.pid
      ? await currentProcessIdentity()
      : await readProcessIdentity(owner.pid);
    // Failure to query the OS process identity is fail-closed. When it is
    // available, equality distinguishes the original process from PID reuse.
    return actualIdentity === null || actualIdentity === owner.processIdentity;
  }
  const acquiredAt = Date.parse(owner.acquiredAt);
  return Number.isFinite(acquiredAt) && Date.now() - acquiredAt <= legacyOwnerMaximumAgeMs;
}

async function moveCanonicalLockToQuarantine(lockDirectory: string, label: string) {
  const quarantine = `${lockDirectory}.${label}-${randomUUID()}`;
  try {
    await rename(lockDirectory, quarantine);
    return quarantine;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function recoveryMutexEndpoint(lockDirectory: string) {
  const digest = createHash("sha256")
    .update(process.platform === "win32" ? lockDirectory.toLowerCase() : lockDirectory)
    .digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\teruisi-jackyun-recovery-${digest.slice(0, 24)}`;
  return {
    host: "127.0.0.1",
    port: 40_000 + (Number.parseInt(digest.slice(0, 8), 16) % 20_000),
    exclusive: true,
  } as const;
}

async function withRecoveryMutex<T>(lockDirectory: string, operation: () => Promise<T>) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(recoveryMutexEndpoint(lockDirectory));
  }).catch((error: unknown) => {
    throw new Error("吉客云执行锁正在由另一个进程恢复，已拒绝并发接管。", { cause: error });
  });
  try {
    return await operation();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function staleOwnerMarkers(lockDirectory: string) {
  const entries = await readdir(lockDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(staleOwnerPrefix) && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
}

async function recoverClaimedStaleLock(lockDirectory: string) {
  if (!(await stat(lockDirectory).catch(() => null))) return true;
  const markers = await staleOwnerMarkers(lockDirectory);
  if (markers.length !== 1) return false;
  const markerName = markers[0]!;
  const observed = await readOwnerFile(path.join(lockDirectory, markerName));
  if (!observed || await ownerIsLive(observed)) return false;

  // Atomically move the claimed stale lock away from the canonical path. A
  // new owner may publish immediately afterwards, but cleanup only ever
  // touches this unique quarantine path, preventing ABA deletion of the new
  // live lock.
  const quarantine = await moveCanonicalLockToQuarantine(lockDirectory, `stale-${observed.ownerToken}`);
  if (!quarantine) return true;
  const movedOwner = await readOwnerFile(path.join(quarantine, markerName));
  if (!movedOwner || movedOwner.ownerToken !== observed.ownerToken || await ownerIsLive(movedOwner)) {
    throw new Error("吉客云失效执行锁隔离后证据发生变化，已保留隔离目录并拒绝删除。");
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

async function recoverOldEmptyLock(lockDirectory: string) {
  const info = await stat(lockDirectory).catch(() => null);
  if (!info) return true;
  const entries = await readdir(lockDirectory, { withFileTypes: true });
  if (entries.length > 0 || Date.now() - info.mtimeMs < emptyLockRecoveryAgeMs) return false;
  const quarantine = await moveCanonicalLockToQuarantine(lockDirectory, "empty");
  if (!quarantine) return true;
  const movedEntries = await readdir(quarantine, { withFileTypes: true });
  if (movedEntries.length > 0) {
    throw new Error("吉客云空执行锁在隔离过程中出现新证据，已保留隔离目录并拒绝删除。");
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

async function claimStaleLock(lockDirectory: string, observed: JackyunRunLockOwner) {
  const markerPath = path.join(lockDirectory, `${staleOwnerPrefix}${observed.ownerToken}.json`);
  try {
    // Keeping the canonical directory present while changing owner evidence
    // means a crash leaves a recoverable marker instead of an unlocked gap.
    await rename(ownerPath(lockDirectory), markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`吉客云失效执行锁无法安全声明：${observed.runId}。`, { cause: error });
  }
  if (!await recoverClaimedStaleLock(lockDirectory)) {
    throw new Error(`吉客云失效执行锁无法安全接管：${observed.runId}。`);
  }
}

async function recoverCanonicalLock(lockDirectory: string): Promise<{
  recovered: boolean;
  liveOwner?: JackyunRunLockOwner;
}> {
  return withRecoveryMutex(lockDirectory, async () => {
    const currentOwner = await readOwner(lockDirectory);
    if (currentOwner) {
      if (await ownerIsLive(currentOwner)) return { recovered: false, liveOwner: currentOwner };
      await claimStaleLock(lockDirectory, currentOwner);
      return { recovered: true };
    }
    if (await recoverClaimedStaleLock(lockDirectory)) return { recovered: true };
    if (await recoverOldEmptyLock(lockDirectory)) return { recovered: true };
    return { recovered: false };
  });
}

export function defaultJackyunRunLockDirectory(root = projectRoot) {
  return path.join(path.resolve(root), ".runtime", "jackyun-automation.lock");
}

export async function acquireJackyunRunLock(options: AcquireOptions): Promise<JackyunRunLock> {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(options.runId)) throw new Error("吉客云执行锁 runId 无效。");
  if (!options.purpose.trim()) throw new Error("吉客云执行锁 purpose 不能为空。");
  const lockDirectory = path.resolve(options.lockDirectory ?? defaultJackyunRunLockDirectory());
  await mkdir(path.dirname(lockDirectory), { recursive: true });
  const processIdentity = await currentProcessIdentity();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner: JackyunRunLockOwner = {
      version: processIdentity ? 2 : 1,
      ownerToken: randomUUID(),
      pid: process.pid,
      ...(processIdentity ? { processIdentity } : {}),
      runId: options.runId,
      purpose: options.purpose,
      acquiredAt: new Date().toISOString(),
    };
    const preparedDirectory = `${lockDirectory}.prepared-${owner.ownerToken}`;
    try {
      await mkdir(preparedDirectory);
      await writeFile(
        path.join(preparedDirectory, "owner.json"),
        `${JSON.stringify(owner, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await rename(preparedDirectory, lockDirectory);
      let released = false;
      return {
        ...owner,
        lockDirectory,
        release: async () => {
          if (released) return;
          const current = await readOwner(lockDirectory);
          if (!current || current.ownerToken !== owner.ownerToken) {
            throw new Error("吉客云执行锁 owner token 已变化，拒绝释放其他执行器的锁。");
          }
          const releaseDirectory = `${lockDirectory}.released-${owner.ownerToken}-${Date.now()}`;
          await rename(lockDirectory, releaseDirectory);
          released = true;
          await rm(releaseDirectory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await rm(preparedDirectory, { recursive: true, force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(String(code))) throw error;

      const existingOwner = await readOwner(lockDirectory);
      if (existingOwner && await ownerIsLive(existingOwner)) {
        throw new Error(`吉客云已有任务正在执行：runId=${existingOwner.runId}，purpose=${existingOwner.purpose}，pid=${existingOwner.pid}。`);
      }
      const recovery = await recoverCanonicalLock(lockDirectory);
      if (recovery.recovered) continue;
      if (recovery.liveOwner) {
        throw new Error(`吉客云已有任务正在执行：runId=${recovery.liveOwner.runId}，purpose=${recovery.liveOwner.purpose}，pid=${recovery.liveOwner.pid}。`);
      }
      throw new Error("吉客云执行锁损坏、仍在初始化或包含无法验证的恢复证据，已拒绝自动运行。");
    }
  }
  throw new Error("吉客云执行锁获取失败。");
}

export async function withJackyunRunLock<T>(options: AcquireOptions, operation: (lock: JackyunRunLock) => Promise<T>) {
  const lock = await acquireJackyunRunLock(options);
  try {
    return await operation(lock);
  } finally {
    await lock.release();
  }
}
