import { spawn } from "node:child_process";
import { access, link, mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localWorkerPort = 3000;
const tmallWorkflowHelperPort = 5791;
const helperStableLifetimeMs = 30_000;

export function getLocalWorkerBuildCommand(root = projectRoot) {
  return {
    command: process.execPath,
    args: [resolve(root, "node_modules", "vinext", "dist", "cli.js"), "build"],
    env: { ...process.env, VITE_TERUISI_LOCAL_BUILD: "true" },
  };
}

export function getTmallWorkflowHelperCommand(root = projectRoot, port = tmallWorkflowHelperPort) {
  return {
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      resolve(root, "tools", "tmall-sycm-cookie-pipeline.ts"),
      "serve",
      "--port",
      String(port),
    ],
    env: { ...process.env },
  };
}

export function getTmallWorkflowHelperRestartDelay(restartCount) {
  const normalizedCount = Number.isFinite(restartCount) ? Math.max(0, Math.floor(restartCount)) : 0;
  return Math.min(5_000, 500 * (2 ** Math.min(normalizedCount, 4)));
}

export function parseLocalWorkerArguments(args = []) {
  return {
    shouldBuild: args.includes("--build"),
    wranglerArgs: args.filter((argument) => argument !== "--build"),
  };
}

export function isLocalWorkerPortInUse(port = 3000, host = "127.0.0.1") {
  return new Promise((resolvePort) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePort(inUse);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function assertLocalWorkerPortAvailable(checkPort = isLocalWorkerPortInUse) {
  if (await checkPort(localWorkerPort)) {
    throw new Error("端口 3000 已有服务运行。为避免覆盖正在使用的 dist 构建，本次构建/启动已取消。");
  }
}

export async function assertTmallWorkflowHelperPortAvailable(checkPort = isLocalWorkerPortInUse) {
  if (await checkPort(tmallWorkflowHelperPort)) {
    throw new Error("端口 5791 已有服务运行，无法确认其是否属于当前天猫工作流；本次启动已安全取消");
  }
}

export function createTmallWorkflowHelperSupervisor({
  root = projectRoot,
  spawnProcess = spawn,
  scheduleRestart = setTimeout,
  cancelRestart = clearTimeout,
  now = Date.now,
} = {}) {
  let child = null;
  let restartTimer = null;
  let stopping = false;
  let consecutiveRestarts = 0;

  const launch = () => {
    if (stopping || child) return;
    const { command, args, env } = getTmallWorkflowHelperCommand(root);
    const startedAt = now();
    const launchedChild = spawnProcess(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child = launchedChild;
    let settled = false;

    const scheduleNextLaunch = (reason) => {
      if (settled) return;
      settled = true;
      if (child === launchedChild) child = null;
      if (stopping) return;

      const lifetime = Math.max(0, now() - startedAt);
      consecutiveRestarts = lifetime >= helperStableLifetimeMs ? 0 : consecutiveRestarts + 1;
      const delay = getTmallWorkflowHelperRestartDelay(Math.max(0, consecutiveRestarts - 1));
      console.warn(`天猫工作流辅助服务已退出（${reason}），将在 ${delay}ms 后重新待命`);
      restartTimer = scheduleRestart(() => {
        restartTimer = null;
        launch();
      }, delay);
    };

    launchedChild.once("error", (error) => scheduleNextLaunch(error instanceof Error ? error.message : String(error)));
    launchedChild.once("exit", (code, signal) => {
      const reason = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
      scheduleNextLaunch(reason);
    });
    console.log(`天猫工作流辅助服务已启动：http://127.0.0.1:${tmallWorkflowHelperPort}`);
  };

  return {
    start() {
      if (!stopping && !child && !restartTimer) launch();
    },
    stop() {
      stopping = true;
      if (restartTimer) {
        cancelRestart(restartTimer);
        restartTimer = null;
      }
      const runningChild = child;
      child = null;
      if (runningChild && runningChild.exitCode == null && runningChild.signalCode == null) {
        runningChild.kill();
      }
    },
  };
}

async function waitForChild(child, operation) {
  const result = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  if (result.code !== 0) {
    const reason = result.signal ? `被信号 ${result.signal} 中断` : `退出码 ${result.code ?? "未知"}`;
    throw new Error(`${operation}失败：${reason}`);
  }
}

export async function buildLocalWorker(root = projectRoot) {
  const { command, args, env } = getLocalWorkerBuildCommand(root);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  await waitForChild(child, "本地 Worker 构建");
}

export async function ensureRuntimeDevVarsLink(root = projectRoot) {
  const sourcePath = resolve(root, ".dev.vars");
  const runtimePath = resolve(root, "dist", "server", ".dev.vars");

  try {
    await access(sourcePath);
  } catch {
    throw new Error("缺少本机 .dev.vars，无法为 Worker 加载本机密钥配置");
  }

  await mkdir(dirname(runtimePath), { recursive: true });
  try {
    await link(sourcePath, runtimePath);
    return { runtimePath, created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return { runtimePath, created: false };
    }
    throw error;
  }
}

export async function startLocalWorker(wranglerArgs = process.argv.slice(2)) {
  await assertLocalWorkerPortAvailable();
  await assertTmallWorkflowHelperPortAvailable();
  const { runtimePath, created } = await ensureRuntimeDevVarsLink();
  const wranglerEntrypoint = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  try {
    await access(wranglerEntrypoint);
  } catch {
    throw new Error("未找到 Wrangler。请先安装项目依赖后重试");
  }

  console.log(`${created ? "已创建" : "复用"}运行时密钥链接：${runtimePath}`);
  const helperSupervisor = createTmallWorkflowHelperSupervisor();
  helperSupervisor.start();
  try {
    const child = spawn(
      process.execPath,
      [wranglerEntrypoint, "dev", "--config", "dist/server/wrangler.json", "--port", "3000", "--persist-to", ".wrangler/state", ...wranglerArgs],
      { cwd: projectRoot, stdio: "inherit", windowsHide: true },
    );
    await waitForChild(child, "本地 Worker");
  } finally {
    helperSupervisor.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { shouldBuild, wranglerArgs } = parseLocalWorkerArguments(process.argv.slice(2));
  const run = async () => {
    if (shouldBuild) {
      await assertLocalWorkerPortAvailable();
      await buildLocalWorker();
    }
    await startLocalWorker(wranglerArgs);
  };
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
