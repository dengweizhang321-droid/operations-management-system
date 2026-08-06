import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withJackyunRunLock } from "./run-lock";

export type JackyunContinueJob = {
  id: string;
  runId: string;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  updatedAt?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const queuePath = path.join(projectRoot, "tmp", "jackyun-continue-queue.json");
const queueClaimLockDirectory = path.join(projectRoot, "tmp", "jackyun-continue-queue.claim");

async function readQueue(): Promise<JackyunContinueJob[]> {
  try {
    const raw = await readFile(queuePath, "utf8");
    const payload = JSON.parse(raw) as unknown;
    return Array.isArray(payload) ? payload.filter((item) => item && typeof item === "object") as JackyunContinueJob[] : [];
  } catch {
    return [];
  }
}

async function writeQueue(jobs: JackyunContinueJob[]) {
  await mkdir(path.dirname(queuePath), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
}

export async function enqueueJackyunContinue(runId: string) {
  const jobs = await readQueue();
  const existing = jobs.find((job) => job.runId === runId && ["queued", "running"].includes(job.status));
  if (existing) return existing;
  const job: JackyunContinueJob = {
    id: `job-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    runId,
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  jobs.push(job);
  await writeQueue(jobs);
  return job;
}

export async function getPendingJackyunContinueJob() {
  const jobs = await readQueue();
  return jobs.find((job) => job.status === "queued") ?? null;
}

export async function claimPendingJackyunContinueJob() {
  return withJackyunRunLock(
    { runId: "continue-queue", purpose: "claim_continue_job", lockDirectory: queueClaimLockDirectory },
    async () => {
      const jobs = await readQueue();
      const index = jobs.findIndex((job) => job.status === "queued");
      if (index < 0) return null;
      jobs[index] = {
        ...jobs[index],
        status: "running",
        message: "开始执行导出",
        updatedAt: new Date().toISOString(),
      };
      await writeQueue(jobs);
      return jobs[index];
    },
  );
}

export async function updateJackyunContinueJob(jobId: string, patch: Partial<JackyunContinueJob>) {
  const jobs = await readQueue();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) return null;
  jobs[index] = { ...jobs[index], ...patch, updatedAt: new Date().toISOString() };
  await writeQueue(jobs);
  return jobs[index];
}
