import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPendingJackyunContinueJob, updateJackyunContinueJob } from "@/lib/jackyun/continue-queue";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const job = await getPendingJackyunContinueJob();
  const runId = job?.runId ?? process.env.JACKYUN_RUN_ID ?? `manual-${Date.now()}`;
  if (job) {
    await updateJackyunContinueJob(job.id, { status: "running", message: "开始执行导出" });
  }
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", "tools/jackyun-automation-runner.ts", "--run-id", runId, "--resume", "--headed"], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (job) await updateJackyunContinueJob(job.id, { status: "completed", message: result.stdout || "执行完成" });
    console.log(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job) await updateJackyunContinueJob(job.id, { status: "failed", message });
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
