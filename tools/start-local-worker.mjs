import { spawn } from "node:child_process";
import { access, link, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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

export async function startLocalWorker() {
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
    [wranglerEntrypoint, "dev", "--config", "dist/server/wrangler.json", "--port", "3000", "--persist-to", ".wrangler/state", ...process.argv.slice(2)],
    { cwd: projectRoot, stdio: "inherit", windowsHide: true },
  );

  await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
