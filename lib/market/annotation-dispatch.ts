/** Bounded transport fan-out. Django owns every queue, lease and retry decision. */
export type AnnotationDispatchJob = {
  jobId: string;
  ownerEmail: string;
  availableSlots: number;
};

export type AnnotationStepResult = {
  processedCount?: number;
  failedCount?: number;
  waiting?: boolean;
  done?: boolean;
  failureCode?: string;
  stopped?: unknown;
};

export async function dispatchAnnotationJobs<Handle>(input: {
  jobs: AnnotationDispatchJob[];
  /** Preparation must retain its own bounded authorization and lease requests. */
  prepare: (job: AnnotationDispatchJob) => Promise<Handle | null>;
  run: (job: AnnotationDispatchJob, handle: Handle) => Promise<AnnotationStepResult>;
  release: (job: AnnotationDispatchJob, handle: Handle) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}) {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const preparationStartedAt = now();
  const jobs = input.jobs.slice(0, 50).map((job) => {
    if (!job.jobId || !job.ownerEmail || !Number.isSafeInteger(job.availableSlots)
      || job.availableSlots < 0 || job.availableSlots > 50) throw new Error("市场派发容量返回无效");
    return { job, lanes: 0, handle: null as Handle | null };
  });
  if (new Set(jobs.map(({ job }) => job.jobId)).size !== jobs.length) throw new Error("市场派发任务重复");
  // Allocate one lane per job before giving any job another lane.
  let capacity = 50;
  while (capacity > 0) {
    let added = false;
    for (const entry of jobs) {
      if (capacity > 0 && entry.lanes < entry.job.availableSlots) {
        entry.lanes += 1;
        capacity -= 1;
        added = true;
      }
    }
    if (!added) break;
  }
  const totals = { idle: true, processedCount: 0, failedCount: 0, dispatchErrors: 0, jobCount: 0, preparationMs: 0, launchCount: 0 };
  let launches = 0;
  try {
    await Promise.all(jobs.filter(({ lanes }) => lanes > 0).map(async (entry) => {
      try { entry.handle = await input.prepare(entry.job); }
      catch { totals.dispatchErrors += 1; }
      if (entry.handle !== null) totals.jobCount += 1;
    }));
    const preparedAt = now();
    totals.preparationMs = Math.max(0, preparedAt - preparationStartedAt);
    // Authorization and coordinator acquisition have their own request limits.
    // A slower preparation must not exhaust every prepared job's launch window.
    // Remains below the 110s coordinator lease. Each HTTP inference has its own
    // single-image lease/deadline; the tail settles before releasing coordination.
    const deadline = preparedAt + 70_000;
    const lane = async (entry: typeof jobs[number]) => {
      while (entry.handle !== null && launches < 200 && now() < deadline && !input.signal?.aborted) {
        launches += 1;
        let result: AnnotationStepResult;
        try { result = await input.run(entry.job, entry.handle); }
        catch { totals.dispatchErrors += 1; break; }
        totals.processedCount += Math.max(0, result.processedCount ?? 0);
        totals.failedCount += Math.max(0, result.failedCount ?? 0);
        if (result.done || result.stopped || ["authorization_revoked", "model_configuration", "provider_rate_limit", "inference_result_unknown"].includes(result.failureCode ?? "")) break;
        // Ordinary image failures free their slot immediately. Django decides
        // whether a retry lane is cooled; polling cannot override that decision.
        if (result.waiting) { await wait(Math.min(1_000, Math.max(0, deadline - now()))); continue; }
        if (!(Number(result.processedCount) > 0) && !(Number(result.failedCount) > 0)) break;
      }
    };
    await Promise.all(jobs.flatMap((entry) => Array.from({ length: entry.handle === null ? 0 : entry.lanes }, () => lane(entry))));
  } finally {
    await Promise.all(jobs.map(async (entry) => {
      if (entry.handle === null) return;
      try { await input.release(entry.job, entry.handle); }
      catch { totals.dispatchErrors += 1; }
    }));
  }
  totals.idle = launches === 0;
  totals.launchCount = launches;
  return totals;
}
