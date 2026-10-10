// Observe real request lifetimes. No routing, response substitution or retries.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export function installRequestCompletionBarrier(context, { origin, timeoutMs = 60000, quietMs = 100 } = {}) {
  assert.equal(new URL(origin).origin, origin);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
  assert.ok(Number.isSafeInteger(quietMs) && quietMs >= 1 && quietMs <= 1000);
  const records = [], byRequest = new WeakMap(), active = new Set(), listeners = new Set();
  let generation = 0;
  const changed = () => { generation++; for (const listener of [...listeners]) listener(); };
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return; // The unchanged route audit rejects unreviewed origins.
    const record = { id: records.length + 1, request, pathname: url.pathname, method: request.method(), terminal: null, status: null };
    records.push(record); byRequest.set(request, record); active.add(record); changed();
  });
  context.on('response', response => {
    const record = byRequest.get(response.request());
    if (record) { record.status = response.status(); changed(); }
  });
  context.on('requestfinished', request => {
    const record = byRequest.get(request);
    if (record) { record.terminal = 'finished'; active.delete(record); changed(); }
  });
  context.on('requestfailed', request => {
    const record = byRequest.get(request);
    if (record) { record.terminal = 'failed'; active.delete(record); changed(); }
  });
  function until(check, deadline) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); listeners.delete(listener); };
      const listener = () => {
        try { if (performance.now() >= deadline) throw new Error('Current request completion deadline exceeded'); const result = check(); if (result) { cleanup(); resolve(result); } }
        catch (error) { cleanup(); reject(error); }
      };
      listeners.add(listener);
      timer = setTimeout(() => { cleanup(); reject(new Error('Current request completion deadline exceeded')); }, Math.max(1, deadline - performance.now()));
      listener();
    });
  }
  return {
    async waitForIdle() {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        await until(() => active.size === 0, deadline);
        const before = generation;
        const remaining = deadline - performance.now();
        if (remaining < quietMs) throw new Error('Current request completion deadline exceeded');
        await new Promise(resolve => {
          let timer;
          const listener = () => { clearTimeout(timer); listeners.delete(listener); resolve(); };
          listeners.add(listener);
          timer = setTimeout(() => { listeners.delete(listener); resolve(); }, quietMs);
        });
        if (performance.now() >= deadline) throw new Error('Current request completion deadline exceeded');
        if (generation === before && active.size === 0) return;
      }
    },
    async runAndWaitForRead(action, { pathname, requiredQueryKeys = [] }) {
      assert.equal(typeof action, 'function');
      assert.ok(pathname.startsWith('/api/') && !pathname.includes('?'));
      const marker = records.length, deadline = performance.now() + timeoutMs;
      // Register before the click, including immediately completed cache reads.
      const matches = () => records.slice(marker).filter(record => {
        const url = new URL(record.request.url());
        return record.method === 'GET' && record.pathname === pathname && requiredQueryKeys.every(key => url.searchParams.has(key));
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Current request completion deadline exceeded')), Math.max(1, deadline - performance.now()));
        Promise.resolve().then(() => { if (performance.now() >= deadline) throw new Error('Current request completion deadline exceeded'); return action(); }).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
      });
      const record = await until(() => matches()[0], deadline);
      await until(() => record.terminal, deadline);
      assert.equal(record.terminal, 'finished', 'The selected current read failed');
      assert.equal(record.status, 200, 'The selected current read returned an error');
      assert.equal(matches().length, 1, 'The action did not identify one exact current read');
      return { pathname: record.pathname, method: record.method, status: record.status, terminal: record.terminal, deadlineMonoMs: deadline };
    },
  };
}

export async function waitForProductDetailReady(page, { timeoutMs = 60000, deadlineMonoMs = null } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
  assert.ok(deadlineMonoMs === null || Number.isFinite(deadlineMonoMs));
  const deadline = Math.min(performance.now() + timeoutMs, deadlineMonoMs ?? Infinity);
  const remainingMs = Math.floor(deadline - performance.now());
  assert.ok(remainingMs > 0, 'Current product detail completion deadline exceeded');
  const result = await page.waitForFunction(() => {
    const button = document.querySelector('.product-detail-back');
    const region = button?.closest('.data-refresh-region');
    if (!region) return false;
    if (region.querySelector('[role=alert]')) return { error: true };
    return region.getAttribute('aria-busy') === 'false' && Boolean(region.querySelector('.product-detail-kpi-grid')) ? { ready: true } : false;
  }, null, { timeout: remainingMs });
  try {
    assert.deepEqual(await result.jsonValue(), { ready: true }, 'Current product detail must be complete and free of errors');
    assert.ok(performance.now() < deadline, 'Current product detail completion deadline exceeded');
  } finally { await result.dispose(); }
}
