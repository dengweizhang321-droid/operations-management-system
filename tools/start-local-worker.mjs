import { spawn } from "node:child_process";
import { access, link, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function getLocalWorkerBuildCommand(root = projectRoot) {
  return {
    command: process.execPath,
    args: [resolve(root, "node_modules", "vinext", "dist", "cli.js"), "build"],
    env: { ...process.env, VITE_TERUISI_LOCAL_BUILD: "true" },
  };
}

export function parseLocalWorkerArguments(args = []) {
  return {
    shouldBuild: args.includes("--build"),
    wranglerArgs: args.filter((argument) => argument !== "--build"),
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
  const { runtimePath, created } = await ensureRuntimeDevVarsLink();
  const wranglerEntrypoint = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  try {
    await access(wranglerEntrypoint);
  } catch {
    throw new Error("未找到 Wrangler。请先安装项目依赖后重试");
  }

  console.log(`${created ? "已创建" : "复用"}运行时密钥链接：${runtimePath}`);
  const child = spawn(
    process.execPath,
    [wranglerEntrypoint, "dev", "--config", "dist/server/wrangler.json", "--port", "3000", "--persist-to", ".wrangler/state", ...wranglerArgs],
    { cwd: projectRoot, stdio: "inherit", windowsHide: true },
  );

  await waitForChild(child, "本地 Worker");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { shouldBuild, wranglerArgs } = parseLocalWorkerArguments(process.argv.slice(2));
  (shouldBuild ? buildLocalWorker().then(() => startLocalWorker(wranglerArgs)) : startLocalWorker(wranglerArgs)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
