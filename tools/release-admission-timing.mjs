import { performance } from 'node:perf_hooks';

// Disjoint measurements; these are children of the journal admission duration,
// never additional elapsed time. No paths, configuration values or errors.
export function admissionTimer() {
  const stages = [];
  return {
    async measure(stage, category, action) {
      const start = performance.now();
      let status = 'failed';
      try { const result = await action(); status = 'passed'; return result; }
      finally { stages.push({ stage, category, status, durationMs: performance.now() - start }); }
    },
    result: () => structuredClone(stages),
  };
}
