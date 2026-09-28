// Test-only observation. No response, version cache, or exit status is fabricated.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import http from 'node:http';
import https from 'node:https';
const started = performance.now();
const record = (event) => fs.appendFileSync(process.env.WRANGLER_TEST_TRACE,
  JSON.stringify({ event, pid: process.pid, elapsedMs: Math.round(performance.now() - started) }) + '\n');
record('node_preload');
for (const transport of [http, https]) {
  const original = transport.get;
  transport.get = function (...args) {
    const options = args[0];
    const observe = typeof options === 'object' && options.path === '/wrangler';
    if (observe) record('version_request_start');
    const req = original.apply(this, args);
    if (observe) {
      req.on('timeout', () => record('version_request_timeout'));
      req.on('error', () => record('version_request_error'));
      req.on('close', () => record('version_request_close'));
      req.on('response', (res) => res.on('end', () => record('version_response_end')));
    }
    return req;
  };
}
process.on('exit', () => record('node_exit'));
