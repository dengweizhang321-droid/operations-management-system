import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimPendingJackyunContinueJob, updateJackyunContinueJob } from "@/lib/jackyun/continue-queue";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const job = await claimPendingJackyunContinueJob();
  if (!job) {
    throw new Error("没有明确排队且绑定原 RUN_ID 的吉客云续跑任务；已拒绝新建或猜测运行编号。");
  }
  const runId = job.runId;
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", "tools/jackyun-automation-runner.ts", "--run-id", runId, "--resume", "--headed"], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    await updateJackyunContinueJob(job.id, { status: "completed", message: result.stdout || "执行完成" });
    console.log(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJackyunContinueJob(job.id, { status: "failed", message });
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
