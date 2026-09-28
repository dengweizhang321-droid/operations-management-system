import { spawn } from "node:child_process";
import { openSync, closeSync, fstatSync, ftruncateSync, writeSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocalScheduledTriggerSupervisor,
  ensureRuntimeDevVarsLink,
  localLivenessFailureThreshold,
  monitorLocalWorkerLiveness,
  probeLocalWorkerLiveness,
  terminateOwnedProcessTree,
} from "./start-local-worker.mjs";
import { assertReleaseWorkerLaunchAllowed } from "./worker-authority-guard.mjs";
import {
  canonicalJson,
  canonicalWindowsPath,
  consumeSupervisorPrelaunchVerificationReceipt,
  hashTree,
  probeAnyLocalPort,
  assertNoReparsePoint,
  assertSupervisorPrelaunchProcessState,
  sha256Bytes,
  windowsPathSha256,
  workerHelperHost,
  workerHelperPort,
  workerHost,
  workerPort,
} from "./worker-local-release.mjs";

const modulePath = fileURLToPath(import.meta.url);
const releaseRoot = path.resolve(path.dirname(modulePath), "..");
const hex64 = /^[0-9a-f]{64}$/;
const restartWindowMs = 10 * 60_000;
const maxRestartsPerWindow = 5;
// Independent of the launcher's redirected pipes. Two fixed slots bound disk use;
// diagnostics never grant launch/stop authority and never change recovery policy.
export async function createSupervisorJournal(logRoot, identity) {
  await assertNoReparsePoint(logRoot, { label: "supervisor logs" });
  const descriptors = [];
  try {
    for (let slot = 0; slot < 2; slot += 1) {
      const target = path.join(logRoot, `supervisor-lifecycle-${slot}.jsonl`);
      await assertSafeMiniflareCacheFile(target);
      let fd;
      try { fd = openSync(target, "r+"); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        fd = openSync(target, "wx+");
      }
      descriptors.push(fd);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsafe supervisor journal");
    }
  } catch (error) {
    for (const fd of descriptors) closeSync(fd);
    throw error;
  }
  const maxBytes = 1024 * 1024;
  let slot = fstatSync(descriptors[0]).mtimeMs >= fstatSync(descriptors[1]).mtimeMs ? 0 : 1;
  let sequence = 0;
  let disabled = false;
  let closed = false;
  return {
    record(event, fields = {}) {
      if (disabled) return;
      try {
        // Explicit scalar allowlist: no error message, stack, URL, argv or env.
        const safe = {};
        for (const key of ["role", "phase", "signal", "origin", "errorCode", "errorName"])
          if (typeof fields[key] === "string" && /^[A-Za-z0-9_:-]{1,64}$/.test(fields[key])) safe[key] = fields[key];
        for (const key of ["childPid", "code", "delayMs", "consecutiveFailures"])
          if (Number.isSafeInteger(fields[key])) safe[key] = fields[key];
        const error = fields.error;
        if (error instanceof Error) {
          safe.errorName = ["Error", "TypeError", "RangeError", "SyntaxError"].includes(error.name) ? error.name : "OtherError";
          safe.errorSha256 = sha256Bytes(Buffer.from(String(error.stack ?? error.name).slice(0, 8192)));
          safe.frames = [...String(error.stack ?? "").slice(0, 8192).matchAll(/(?:worker-local-runtime-supervisor|start-local-worker|worker-authority-guard|worker-local-release)\.mjs:\d+:\d+/g)]
            .slice(0, 6).map(match => match[0]);
          if (["EPIPE", "EBADF", "EIO", "ENOENT", "EACCES", "EPERM", "ENOSPC"].includes(error.code)) safe.errorCode = error.code;
        }
        const memory = process.memoryUsage();
        const line = Buffer.from(JSON.stringify({ version: 1, at: new Date().toISOString(), sequence: ++sequence,
          pid: process.pid, ppid: process.ppid, estimatedStartedAt: identity.startedAt,
          manifestSha256: identity.manifestSha256, event, ...safe,
          uptimeMs: Math.round(process.uptime() * 1000), rss: memory.rss, heapUsed: memory.heapUsed,
          freeMemory: freemem(), totalMemory: totalmem() }) + "\n");
        if (line.length > 4096) return;
        if (fstatSync(descriptors[slot]).size + line.length > maxBytes) {
          slot = 1 - slot;
          ftruncateSync(descriptors[slot], 0);
        }
        writeSync(descriptors[slot], line, 0, line.length, fstatSync(descriptors[slot]).size);
      } catch {
        disabled = true;
        // One fixed fallback notice, never the exception body or repeated retries.
        try { writeSync(2, "supervisor_diagnostics_write_failed\n"); } catch { /* Both sinks may be unavailable. */ }
      }
    },
    close() {
      if (closed) return;
      closed = true;
      disabled = true;
      for (const fd of descriptors) { try { closeSync(fd); } catch { /* already closed */ } }
    },
  };
}

export function installSupervisorDiagnostics(journal, target = process) {
  const onFatal = (error, origin) => journal.record("uncaught_exception", { error, origin });
  const onExit = (code) => journal.record("supervisor_exit", { code });
  // A detached launcher's pipe can disappear. Losing logging is observable but
  // must not become an unhandled stream 'error' that terminates supervision.
  const onOutputError = (error) => {
    journal.record("output_error", { error });
    if (error?.code !== "EPIPE") throw error;
  };
  target.on("uncaughtExceptionMonitor", onFatal);
  target.on("exit", onExit);
  target.stdout.on("error", onOutputError);
  target.stderr.on("error", onOutputError);
  const timer = setInterval(() => journal.record("heartbeat"), 60_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    target.removeListener("uncaughtExceptionMonitor", onFatal);
    target.removeListener("exit", onExit);
    target.stdout.removeListener("error", onOutputError);
    target.stderr.removeListener("error", onOutputError);
  };
}
export const miniflareCacheRelativePath = "cache/miniflare";
export const workerdOldSpaceMiB = 3072;
export const heapPatchedMiniflareSha256 = "2b2a89fb96a270e678b4aa87e65aa1282049b18d28a1e30ff7fe7f2736b648c7";

export async function assertWorkerdHeapAdapter(root) {
  const adapter = await readFile(path.join(root, "node_modules/miniflare/dist/src/index.js"));
  if (sha256Bytes(adapter) !== heapPatchedMiniflareSha256) {
    throw new Error("workerd 3072 MiB heap adapter digest mismatch");
  }
}

export function resolveImmutableMiniflareCacheDirectory(runtimeRoot) {
  if (typeof runtimeRoot !== "string" || runtimeRoot.trim() === "") {
    throw new Error("Worker runtime root 无效，无法派生 Miniflare cache");
  }
  return path.join(path.resolve(runtimeRoot), ...miniflareCacheRelativePath.split("/"));
}

export function immutableMiniflareCacheBinding({ runtimeRoot, releaseRoot, persistRoot } = {}) {
  if (typeof releaseRoot !== "string" || releaseRoot.trim() === "") {
    throw new Error("Worker release root 无效，无法约束 Miniflare cache");
  }
  if (typeof persistRoot !== "string" || !path.isAbsolute(persistRoot)) {
    throw new Error("manifest persist root 无效，无法约束 Miniflare cache");
  }
  const absoluteRuntimeRoot = path.resolve(runtimeRoot);
  const absoluteReleaseRoot = path.resolve(releaseRoot);
  const absolutePersistRoot = path.resolve(persistRoot);
  const derivedRuntimeRoot = path.resolve(absoluteReleaseRoot, "..", "..");
  if (canonicalWindowsPath(absoluteRuntimeRoot) !== canonicalWindowsPath(derivedRuntimeRoot)) {
    throw new Error("Worker release/runtime 边界无效，拒绝派生 Miniflare cache");
  }
  const cacheRoot = resolveImmutableMiniflareCacheDirectory(absoluteRuntimeRoot);
  const relativeToRuntime = path.relative(absoluteRuntimeRoot, cacheRoot);
  const relativeToRelease = path.relative(absoluteReleaseRoot, cacheRoot);
  const cacheIdentity = canonicalWindowsPath(cacheRoot);
  const persistIdentity = canonicalWindowsPath(absolutePersistRoot);
  const normalizedRuntimeRelative = relativeToRuntime.split(path.sep).join("/").toLowerCase();
  if (normalizedRuntimeRelative !== miniflareCacheRelativePath
    || relativeToRelease === ""
    || (!relativeToRelease.startsWith(`..${path.sep}`) && relativeToRelease !== "..")) {
    throw new Error("Miniflare cache 未严格绑定到 release 外的 runtime cache 边界");
  }
  if (cacheIdentity === persistIdentity
    || cacheIdentity.startsWith(`${persistIdentity}\\`)
    || persistIdentity.startsWith(`${cacheIdentity}\\`)) {
    throw new Error("Miniflare cache 与 Wrangler persist root 不得相互包含");
  }
  return {
    relativePath: miniflareCacheRelativePath,
    cacheRoot,
    cacheRootPathSha256: windowsPathSha256(cacheRoot),
    cacheFile: path.join(cacheRoot, "cf.json"),
    cacheFilePathSha256: windowsPathSha256(path.join(cacheRoot, "cf.json")),
  };
}

export function immutableWorkerEnvironment({
  runtimeRoot,
  releaseRoot,
  persistRoot,
  inheritedEnvironment = process.env,
} = {}) {
  if (typeof persistRoot !== "string" || !path.isAbsolute(persistRoot)) {
    throw new Error("manifest persist root 无效，无法构造 immutable Worker 环境");
  }
  const environment = {};
  const controlledNames = new Set([
    "TERUISI_LOCAL_WRANGLER_STATE_DIR",
    "MINIFLARE_CACHE_DIR",
    "CLOUDFLARE_CF_FETCH_PATH",
    "CLOUDFLARE_CF_FETCH_ENABLED",
    "TERUISI_WORKERD_HEAP_MB",
  ]);
  for (const [name, value] of Object.entries(inheritedEnvironment ?? {})) {
    if (!controlledNames.has(name.toUpperCase()) && value !== undefined) environment[name] = value;
  }
  const cacheBinding = immutableMiniflareCacheBinding({ runtimeRoot, releaseRoot, persistRoot });
  environment.TERUISI_LOCAL_WRANGLER_STATE_DIR = path.resolve(persistRoot);
  environment.MINIFLARE_CACHE_DIR = cacheBinding.cacheRoot;
  // Miniflare gives this older override precedence over MINIFLARE_CACHE_DIR,
  // so bind both inputs to the same verified external cache location.
  environment.CLOUDFLARE_CF_FETCH_PATH = cacheBinding.cacheFile;
  environment.CLOUDFLARE_CF_FETCH_ENABLED = "true";
  // Consumed by the digest-pinned Miniflare config backport, not by Node.
  environment.TERUISI_WORKERD_HEAP_MB = String(workerdOldSpaceMiB);
  return environment;
}

async function ensureImmutableRuntimeCacheDirectory(target, label) {
  try {
    await mkdir(target);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
  }
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label}必须是实体目录`);
  }
  await assertNoReparsePoint(target, { label });
}

async function assertSafeMiniflareCacheFile(cacheFile) {
  let info;
  try {
    info = await lstat(cacheFile);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Miniflare cf.json 必须是普通非链接文件");
  }
  if (!Number.isSafeInteger(info.nlink) || info.nlink !== 1) {
    throw new Error("Miniflare cf.json 必须保持单链接文件身份");
  }
  await assertNoReparsePoint(cacheFile, { label: "Miniflare cf.json" });
}

export async function prepareImmutableMiniflareCacheDirectory({ runtimeRoot, releaseRoot, persistRoot } = {}) {
  const binding = immutableMiniflareCacheBinding({ runtimeRoot, releaseRoot, persistRoot });
  const absoluteRuntimeRoot = path.resolve(runtimeRoot);
  const cacheParent = path.join(absoluteRuntimeRoot, "cache");
  const cacheRoot = binding.cacheRoot;
  await assertNoReparsePoint(absoluteRuntimeRoot, { label: "Worker runtime root" });
  await ensureImmutableRuntimeCacheDirectory(cacheParent, "Worker runtime cache root");
  await ensureImmutableRuntimeCacheDirectory(cacheRoot, "Miniflare cache");
  await assertSafeMiniflareCacheFile(binding.cacheFile);
  return binding;
}

function waitForDelay(delayMs, signal) {
  return new Promise((resolveWait) => {
    if (signal?.aborted) return resolveWait(false);
    const timer = setTimeout(() => finish(true), delayMs);
    const onAbort = () => finish(false);
    const finish = (value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveWait(value);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function observeChild(child, signal, record = () => {}, role = "unknown") {
  return new Promise((resolveExit, rejectExit) => {
    const onAbort = () => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      record("child_error", { role, childPid: child.pid, error });
      rejectExit(error);
    });
    child.once("exit", (code, childSignal) => {
      signal?.removeEventListener("abort", onAbort);
      record("child_exit", { role, childPid: child.pid, code, signal: childSignal });
      resolveExit({ code, signal: childSignal });
    });
  });
}

async function waitForTerminatedChild(childExit) {
  let timeout;
  try {
    return await Promise.race([
      childExit,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("不可变 Worker 子进程未在15秒内退出，停止自动恢复")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForPortRelease(port, label, signal) {
  const started = Date.now();
  // An exact loopback connect probe is insufficient here: a wildcard,
  // IPv6, or non-loopback listener can still win the next bind.  Reuse the
  // same exclusive any-interface fence as Deploy/formal verification.
  while (await probeAnyLocalPort(port)) {
    if (Date.now() - started >= 15_000) throw new Error(`${label}退出后未在15秒内释放${port}端口`);
    if (!(await waitForDelay(250, signal))) return false;
  }
  return true;
}

async function assertHelperArtifact(releaseRoot, manifest) {
  const relativePath = manifest.processIdentity.helperEntrypoint;
  const key = manifest.artifacts.keyFiles.find((item) => item.relativePath === relativePath);
  if (!key) throw new Error("manifest 未绑定 immutable helper key file");
  const raw = await readFile(path.join(releaseRoot, ...relativePath.split("/")));
  if (sha256Bytes(raw) !== key.sha256) throw new Error("immutable helper bundle 在 restart 前发生变化");
  const helperTree = await hashTree(path.join(releaseRoot, manifest.build.helperRoot));
  if (canonicalJson(helperTree) !== canonicalJson(manifest.build.helperTree)) {
    throw new Error("immutable helper resource tree 在 restart 前发生变化");
  }
}

export async function superviseImmutableHelper({ releaseRoot, manifest, manifestPath, manifestSha256, runtimeRoot, signal, record = () => {} }) {
  let consecutiveRestarts = 0;
  while (!signal.aborted) {
    record("launch_validation", { role: "helper" });
    await assertSupervisorPrelaunchProcessState({
      manifestPath,
      releaseRoot,
      expectedSupervisorPid: process.pid,
    });
    await assertReleaseWorkerLaunchAllowed({ manifestPath, manifestSha256, runtimeRoot });
    await assertHelperArtifact(releaseRoot, manifest);
    if (await probeAnyLocalPort(workerHelperPort)) throw new Error("5791端口在 immutable helper restart 前被占用");
    const startedAt = Date.now();
    const child = spawn(process.execPath, [
      path.join(releaseRoot, ...manifest.processIdentity.helperEntrypoint.split("/")),
      ...manifest.processIdentity.fixedHelperArguments,
    ], {
      cwd: manifest.runtime.helperMutableRoot,
      env: {
        ...process.env,
        TERUISI_HELPER_MUTABLE_ROOT: manifest.runtime.helperMutableRoot,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("spawn", () => record("child_spawn", { role: "helper", childPid: child.pid }));
    const outcome = await observeChild(child, signal, record, "helper");
    if (signal.aborted) return;
    await waitForPortRelease(workerHelperPort, "immutable helper", signal);
    const lifetime = Math.max(0, Date.now() - startedAt);
    consecutiveRestarts = lifetime >= 30_000 ? 0 : consecutiveRestarts + 1;
    const reason = outcome.signal ? `signal=${outcome.signal}` : `exit=${outcome.code ?? "unknown"}`;
    const delay = Math.min(5_000, 500 * (2 ** Math.min(Math.max(0, consecutiveRestarts - 1), 4)));
    record("restart_scheduled", { role: "helper", delayMs: delay });
    process.stderr.write(`immutable helper 已退出（${reason}），${delay}ms 后受控重启\n`);
    if (!(await waitForDelay(delay, signal))) return;
  }
}

export async function superviseImmutableWorker({
  releaseRoot, manifest, manifestPath, manifestSha256, runtimeRoot, signal,
  livenessMonitor = monitorLocalWorkerLiveness,
  terminateWorkerTree = terminateOwnedProcessTree,
  record = () => {},
}) {
  let restartTimestamps = [];
  let restartCount = 0;
  while (!signal.aborted) {
    record("launch_validation", { role: "worker" });
    await assertSupervisorPrelaunchProcessState({
      manifestPath,
      releaseRoot,
      expectedSupervisorPid: process.pid,
    });
    await assertReleaseWorkerLaunchAllowed({ manifestPath, manifestSha256, runtimeRoot });
    const miniflareCache = await prepareImmutableMiniflareCacheDirectory({
      runtimeRoot,
      releaseRoot,
      persistRoot: manifest.runtime.persistRoot,
    });
    await ensureRuntimeDevVarsLink(releaseRoot);
    if (await probeAnyLocalPort(workerPort)) throw new Error("3000端口在不可变 Worker restart 前被任意接口占用");
    const workerEnvironment = immutableWorkerEnvironment({
      runtimeRoot,
      releaseRoot,
      persistRoot: manifest.runtime.persistRoot,
    });
    if (workerEnvironment.MINIFLARE_CACHE_DIR !== miniflareCache.cacheRoot
      || workerEnvironment.CLOUDFLARE_CF_FETCH_PATH !== miniflareCache.cacheFile
      || windowsPathSha256(workerEnvironment.MINIFLARE_CACHE_DIR) !== miniflareCache.cacheRootPathSha256
      || windowsPathSha256(workerEnvironment.CLOUDFLARE_CF_FETCH_PATH) !== miniflareCache.cacheFilePathSha256) {
      throw new Error("Miniflare cache 环境未绑定受控 runtime cache 目录");
    }
    await assertWorkerdHeapAdapter(releaseRoot);
    process.stdout.write(`workerd heap policy: max-old-space-size=${workerdOldSpaceMiB} MiB; adapter=${heapPatchedMiniflareSha256}\n`);
    const child = spawn(process.execPath, [
      path.join(releaseRoot, ...manifest.processIdentity.wranglerEntrypoint.split("/")),
      ...manifest.processIdentity.fixedWranglerArguments,
    ], { cwd: releaseRoot, env: workerEnvironment, stdio: "inherit", windowsHide: true });
    // Shutdown must terminate the owned Wrangler tree, not just the parent
    // process: an inner workerd can outlive Wrangler after a fatal error.
    child.once("spawn", () => record("child_spawn", { role: "worker", childPid: child.pid }));
    const childExit = observeChild(child, undefined, record, "worker");
    const monitorController = new AbortController();
    const abortMonitor = () => monitorController.abort();
    if (signal.aborted) abortMonitor();
    else signal.addEventListener("abort", abortMonitor, { once: true });
    const liveness = Promise.resolve().then(() => livenessMonitor({
      signal: monitorController.signal,
      failureThreshold: localLivenessFailureThreshold,
      probe: ({ signal: probeSignal }) => probeLocalWorkerLiveness({
        url: `http://${workerHost}:${workerPort}/_teruisi/local/health/live`,
        signal: probeSignal,
      }),
    })).catch((error) => ({ status: "unhealthy", error }));
    let first;
    try {
      first = await Promise.race([
        childExit.then((result) => ({ source: "process", result })),
        liveness.then((result) => ({ source: "liveness", result })),
      ]);
    } finally {
      monitorController.abort();
      signal.removeEventListener("abort", abortMonitor);
    }
    if (signal.aborted) {
      await terminateWorkerTree(child);
      await waitForTerminatedChild(childExit);
      await waitForPortRelease(workerPort, "不可变 Worker", signal);
      return;
    }
    if (first.source === "liveness") {
      record("liveness_termination", { role: "worker", childPid: child.pid, consecutiveFailures: first.result.consecutiveFailures });
      await terminateWorkerTree(child);
      if (first.result.status === "aborted") {
        await waitForTerminatedChild(childExit);
        await waitForPortRelease(workerPort, "不可变 Worker", signal);
        throw new Error("不可变 Worker 存活观察器意外停止");
      }
    }
    const outcome = first.source === "liveness" ? await waitForTerminatedChild(childExit) : await childExit;
    await waitForPortRelease(workerPort, "不可变 Worker", signal);
    const now = Date.now();
    restartTimestamps = restartTimestamps.filter((value) => now - value < restartWindowMs);
    restartTimestamps.push(now);
    if (restartTimestamps.length > maxRestartsPerWindow) {
      throw new Error("不可变 Worker 在10分钟内重启超过5次，已失败关闭");
    }
    restartCount += 1;
    const reason = first.source === "liveness"
      ? `存活检查连续 ${first.result.consecutiveFailures ?? localLivenessFailureThreshold} 次失败`
      : outcome.signal ? `signal=${outcome.signal}` : `exit=${outcome.code ?? "unknown"}`;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(restartCount - 1, 5)));
    record("restart_scheduled", { role: "worker", delayMs: delay });
    process.stderr.write(`不可变 Worker 已退出（${reason}），${delay}ms 后受控重启\n`);
    if (!(await waitForDelay(delay, signal))) return;
  }
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--manifest" || argv[2] !== "--approved-manifest-sha256") {
    throw new Error("不可变 Worker supervisor 只接受固定 manifest 身份参数");
  }
  const manifestPath = path.resolve(argv[1]);
  const approvedManifestSha256 = argv[3];
  if (path.dirname(manifestPath) !== releaseRoot || path.basename(manifestPath) !== "deployment-manifest.json" || !hex64.test(approvedManifestSha256)) {
    throw new Error("不可变 Worker supervisor manifest 身份无效");
  }
  return { manifestPath, approvedManifestSha256 };
}

async function readManifestIdentity(manifestPath, approvedManifestSha256) {
  const raw = await readFile(manifestPath);
  if (sha256Bytes(raw) !== approvedManifestSha256) throw new Error("Worker release manifest 原始文件哈希不一致");
  const manifest = JSON.parse(raw.toString("utf8"));
  if (!raw.equals(Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"))) throw new Error("Worker release manifest 不是 canonical JSON");
  return manifest;
}

export async function startImmutableWorker(argv = process.argv.slice(2), record = () => {}) {
  record("startup_validation", { phase: "manifest" });
  const { manifestPath, approvedManifestSha256 } = parseArguments(argv);
  const manifest = await readManifestIdentity(manifestPath, approvedManifestSha256);
  const runtimeRoot = path.resolve(releaseRoot, "..", "..");
  if (manifest.runtime.host !== workerHost || manifest.runtime.port !== workerPort || manifest.runtime.cliOverridesAllowed !== false) {
    throw new Error("Worker release 回环或 CLI 覆盖契约无效");
  }
  if (manifest.runtime.helperMode !== "supervisor_managed_immutable_bundle"
    || manifest.runtime.helperHost !== workerHelperHost || manifest.runtime.helperPort !== workerHelperPort
    || manifest.runtime.helperMutableRoot !== manifest.runtime.protectedSourceRoot
    || manifest.runtime.helperMutableRootPathSha256 !== manifest.runtime.protectedSourceRootPathSha256
    || canonicalJson(manifest.processIdentity.fixedHelperArguments) !== canonicalJson(["serve", "--port", String(workerHelperPort)])) {
    throw new Error("Worker release immutable helper 契约无效");
  }
  record("startup_validation", { phase: "prelaunch" });
  await assertSupervisorPrelaunchProcessState({
    manifestPath,
    releaseRoot,
    expectedSupervisorPid: process.pid,
  });
  await consumeSupervisorPrelaunchVerificationReceipt({
    manifestPath,
    approvedManifestSha256,
    releaseRoot,
  });
  await assertReleaseWorkerLaunchAllowed({ manifestPath, manifestSha256: approvedManifestSha256, runtimeRoot });

  // The deployed supervisor never accepts caller-provided Wrangler arguments
  // or Miniflare cache overrides. Each Worker child receives manifest-bound
  // persistence plus a cache path derived from the verified runtime root.
  await ensureRuntimeDevVarsLink(releaseRoot);
  record("startup_validated");

  const scheduled = createLocalScheduledTriggerSupervisor();
  const shutdown = new AbortController();
  const requestShutdown = (signal) => { record("signal_received", { signal }); shutdown.abort(); };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  scheduled.start();
  try {
    await Promise.all([superviseImmutableWorker({
      releaseRoot,
      manifest,
      manifestPath,
      manifestSha256: approvedManifestSha256,
      runtimeRoot,
      signal: shutdown.signal,
      record,
    }), superviseImmutableHelper({
      releaseRoot,
      manifest,
      manifestPath,
      manifestSha256: approvedManifestSha256,
      runtimeRoot,
      signal: shutdown.signal,
      record,
    })]);
  } finally {
    shutdown.abort();
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    scheduled.stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  let journal;
  try {
    const { approvedManifestSha256 } = parseArguments(process.argv.slice(2));
    journal = await createSupervisorJournal(path.resolve(releaseRoot, "..", "..", "logs"), {
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      manifestSha256: approvedManifestSha256,
    });
  } catch { /* Startup validation remains authoritative even without diagnostics. */ }
  const record = journal ? journal.record.bind(journal) : () => {};
  installSupervisorDiagnostics({ record });
  if (!journal) process.stderr.write("supervisor_diagnostics_unavailable\n");
  record("supervisor_start");
  startImmutableWorker(process.argv.slice(2), record).then(() => record("supervision_stopped")).catch((error) => {
    record("supervision_failed", { error });
    // Do not disclose exception strings (which can contain runtime paths).
    process.stderr.write("Immutable Worker supervisor failed; inspect lifecycle diagnostics.\n");
    process.exitCode = 1;
  });
}
