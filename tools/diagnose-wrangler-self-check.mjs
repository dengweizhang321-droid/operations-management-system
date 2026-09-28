// Serial, local-only experiment. Never starts the application or uses its R2 state.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, cpus, freemem, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(workspace, 'tmp'), { recursive: true });
const root = await mkdtemp(path.join(workspace, 'tmp/wrangler-diagnostic-'));
const cli = path.join(workspace, 'node_modules/wrangler/wrangler-dist/cli.js');
const preload = path.join(workspace, 'tests/fixtures/wrangler-network-trace.mjs');
const oldCache = path.join(tmpdir(), 'update-check/wrangler-latest.json');
const results = [];
let warmCache;
const sockets = new Set();
const server = createServer(() => { /* Deliberate nonresponding registry, no fake metadata. */ });
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const stalledRegistry = `http://127.0.0.1:${server.address().port}/`;
const hash = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
async function command(cwd, args, env, stage) {
  const trace = path.join(cwd, `${stage}.jsonl`);
  const before = cpus().map((cpu) => cpu.times);
  const start = performance.now();
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, cli, ...args], {
    cwd, env: { ...env, WRANGLER_TEST_TRACE: trace }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', firstOutputMs = null, completedMs = null, timedOut = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => {
    firstOutputMs ??= Math.round(performance.now() - start);
    output += data.toString();
    if (/Upload complete|Download complete|Delete complete/.test(output)) completedMs ??= Math.round(performance.now() - start);
  });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, stage === 'version' || stage === 'help' ? 15000 : 30000);
  const [exitCode, signal] = await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', (...value) => resolve(value));
  });
  clearTimeout(timer);
  await writeFile(path.join(cwd, `${stage}.output.txt`), output);
  const after = cpus().map((cpu) => cpu.times);
  let total = 0, idle = 0;
  for (let i = 0; i < before.length; i++) for (const field of Object.keys(before[i])) {
    const delta = after[i][field] - before[i][field]; total += delta; if (field === 'idle') idle += delta;
  }
  return { stage, elapsedMs: Math.round(performance.now() - start), firstOutputMs, completedMs,
    exitCode, signal, timedOut, cpuBusyPercent: Math.round((1 - idle / total) * 100), freeMemoryMiB: Math.round(freemem() / 1048576),
    outputSha256: createHash('sha256').update(output).digest('hex'), missingMessage: /does not exist/.test(output),
    trace: existsSync(trace) ? (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse) : [] };
}
try {
  for (const scenario of [
    { name: 'absent-real', cache: 'absent' },
    { name: 'warm-real', cache: 'warm' },
    { name: 'expired-real', cache: 'expired' },
    { name: 'absent-stalled', cache: 'absent', stalled: true },
    { name: 'hidden-stalled', cache: 'absent', stalled: true, hide: true },
    { name: 'hidden-medium-stalled', cache: 'absent', stalled: true, hide: true, depth: 1 },
    { name: 'hidden-long-stalled', cache: 'absent', stalled: true, hide: true, depth: 4 },
    { name: 'hidden-long-shortstate', cache: 'absent', stalled: true, hide: true, depth: 4, shortState: true },
    { name: 'hidden-stalled-repeat', cache: 'absent', stalled: true, hide: true },
  ]) {
    const cwd = path.join(root, scenario.name, scenario.depth ? '中文路径 with spaces/'.repeat(scenario.depth) : 'short');
    const temp = path.join(cwd, 'temp');
    await mkdir(temp, { recursive: true });
    if (scenario.cache === 'expired') {
      if (!existsSync(oldCache)) throw new Error('No existing real expired cache available; do not fabricate it');
      const original = JSON.parse(await readFile(oldCache, 'utf8'));
      if (Date.now() - original.lastUpdate < 3600000) throw new Error('Existing cache is not expired; do not fabricate it');
      await mkdir(path.join(temp, 'update-check'));
      await copyFile(oldCache, path.join(temp, 'update-check/wrangler-latest.json'));
    }
    if (scenario.cache === 'warm') {
      if (!warmCache) throw new Error('No real CLI-produced cache available');
      await mkdir(path.join(temp, 'update-check'));
      await copyFile(warmCache, path.join(temp, 'update-check/wrangler-latest.json'));
    }
    await writeFile(path.join(cwd, '.npmrc'), `registry=${scenario.stalled ? stalledRegistry : 'https://registry.npmjs.org/'}\n`);
    await writeFile(path.join(cwd, 'empty.npmrc'), '');
    await writeFile(path.join(cwd, 'wrangler.json'), JSON.stringify({ name: 'isolated-smoke', compatibility_date: '2026-05-15' }));
    const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: String(!!scenario.hide),
      TEMP: temp, TMP: temp, XDG_CONFIG_HOME: path.join(cwd, 'config'), WRANGLER_LOG_PATH: path.join(cwd, 'logs'),
      npm_config_registry: scenario.stalled ? stalledRegistry : 'https://registry.npmjs.org/',
      npm_config_userconfig: path.join(cwd, 'empty.npmrc'), NPM_CONFIG_USERCONFIG: path.join(cwd, 'empty.npmrc') };
    for (const name of Object.keys(env)) if (/^(NODE_OPTIONS|NODE_PATH|CLOUDFLARE_|CF_API_|WRANGLER_API)/i.test(name)) delete env[name];
    const cacheFile = path.join(temp, 'update-check/wrangler-latest.json');
    const row = { ...scenario, pathLength: cwd.length, cacheBeforeSha256: existsSync(cacheFile) ? await hash(cacheFile) : null, stages: [] };
    results.push(row);
    const object = 'teruisi-runtime-smoke/__runtime_smoke__/test.bin';
    const input = path.join(cwd, 'input.bin'), output = path.join(cwd, 'output.bin');
    await writeFile(input, 'teruisi-wrangler-runtime-smoke-v1');
    const statePath = scenario.shortState ? path.join(root, 'short-state') : path.join(cwd, 'state');
    row.statePathLength = statePath.length;
    const common = ['--local', '--persist-to', statePath];
    for (const [stage, args] of [
      ['version', ['--version']], ['help', ['r2', 'object', 'delete', '--help']],
      ['put', ['r2', 'object', 'put', object, ...common, '--file', input]],
      ['get', ['r2', 'object', 'get', object, ...common, '--file', output]],
      ['delete', ['r2', 'object', 'delete', object, ...common, '--force']],
      ['missing', ['r2', 'object', 'get', object, ...common, '--file', path.join(cwd, 'missing.bin')]],
    ]) {
      const result = await command(cwd, args, env, stage);
      row.stages.push(result);
      console.log(`${scenario.name} ${stage}: ${result.elapsedMs}ms exit=${result.exitCode} timeout=${result.timedOut}`);
      if (stage === 'get' && result.exitCode === 0) {
        const started = performance.now();
        row.stages.push({ stage: 'hash', matched: await hash(input) === await hash(output), elapsedMs: performance.now() - started });
      }
      await writeFile(path.join(root, 'results.json'), JSON.stringify({ node: process.version, totalMemoryMiB: totalmem()/1048576, results }, null, 2));
      if (result.timedOut || (stage !== 'missing' && result.exitCode !== 0)) break;
    }
    row.cacheAfterSha256 = existsSync(cacheFile) ? await hash(cacheFile) : null;
    if (scenario.name === 'absent-real' && existsSync(cacheFile)) warmCache = cacheFile;
    await writeFile(path.join(root, 'results.json'), JSON.stringify({ node: process.version, totalMemoryMiB: totalmem()/1048576, results }, null, 2));
  }
} finally {
  for (const socket of sockets) socket.destroy();
  server.close();
}
console.log(`Evidence: ${path.join(root, 'results.json')}`);
