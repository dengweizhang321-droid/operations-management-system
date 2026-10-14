/** Synthetic event-clock comparison of the actual old/new dispatch functions.
 * No network, production database, provider runtime or paid inference is used.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { dispatchAnnotationJobs } from "../lib/market/annotation-dispatch";

const base = "3711d54989cafac557ea7ee0a6c9d1c8512fc71e";
const folder = resolve(".runtime/annotation-scheduling-benchmark");
await mkdir(folder, { recursive: true });
const baselinePath = resolve(folder, "baseline.ts");
await writeFile(baselinePath, execFileSync("git", ["show", `${base}:lib/market/annotation-dispatch.ts`]));
const old = (await import(pathToFileURL(baselinePath).href)).dispatchAnnotationJobs as typeof dispatchAnnotationJobs;
const candidates = Array.from({ length: 240 }, (_, id) => ({ id, mode: id % 10 === 9 ? "A" : "B", duration: id % 10 === 9 ? 12_000 : 6_000 }));

async function simulate(dispatch: typeof old, priority: boolean, wakeDelay: number) {
  const pending = [...candidates];
  let clock = 0, modelCalls = 0, completed = 0, busyMs = 0, aCompletedAt = 0, peak = 0;
  let driving = false;
  const events: Array<{ at: number; finish: () => void }> = [];
  const completedPerMinute: Record<string, number> = {};
  const drive = () => {
    if (driving || !events.length) return;
    driving = true;
    setImmediate(() => {
      driving = false;
      events.sort((a, b) => a.at - b.at);
      const event = events.shift()!;
      clock = event.at;
      event.finish();
      // Promise continuations replenish free slots before the next clock event.
      setImmediate(drive);
    });
  };
  while (pending.length) {
    await dispatch({ jobs: [{ jobId: "synthetic", ownerEmail: "fixture@example.invalid", availableSlots: 12 }],
      now: () => clock, prepare: async () => true, release: async () => {},
      run: async () => {
        if (!pending.length) return { done: true };
        const index = priority ? Math.max(0, pending.findIndex((candidate) => candidate.mode === "A")) : 0;
        const candidate = pending.splice(index, 1)[0]!;
        modelCalls++;
        busyMs += candidate.duration;
        return new Promise((finish) => {
          events.push({ at: clock + candidate.duration, finish: () => {
            completed++;
            completedPerMinute[String(Math.floor(clock / 60_000))] = (completedPerMinute[String(Math.floor(clock / 60_000))] ?? 0) + 1;
            if (candidate.mode === "A") aCompletedAt = clock;
            finish({ processedCount: 1, done: completed === candidates.length });
          } });
          peak = Math.max(peak, events.length);
          drive();
        });
      },
    });
    if (pending.length) clock += wakeDelay;
  }
  return { aCompletedMs: aCompletedAt, allCompletedMs: clock, idleSlotMs: clock * 12 - busyMs, averageNewCompletedPerMinute: completed * 60_000 / clock, completedPerMinute, modelCalls, errors: 0, peakConcurrency: peak };
}
const report = { kind: "synthetic-scheduling-only", baseline: base, candidates: candidates.length, aCandidates: candidates.filter((c) => c.mode === "A").length, concurrency: 12, realModelCalls: 0,
  original: await simulate(old, false, 60_000), priorityOnly: await simulate(old, true, 60_000), priorityAndRefill: await simulate(dispatchAnnotationJobs, true, 0) };
await writeFile(resolve(folder, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
