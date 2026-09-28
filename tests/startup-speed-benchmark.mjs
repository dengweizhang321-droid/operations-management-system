import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import path from 'node:path';

// Explicit lightweight benchmark, not part of ordinary unit-test timing claims.
const baseline = 'e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e';
const root = path.resolve('.runtime/startup-speed/benchmark');
await mkdir(path.join(root, 'baseline/tools'), { recursive: true });
const files = execFileSync('git', ['ls-tree', '--name-only', baseline, 'tools/'], { encoding: 'utf8', windowsHide: true })
  .trim().split(/\r?\n/).filter(file => /^tools\/django-.*\.ps1$/.test(file));
for (const file of files) {
  await writeFile(path.join(root, 'baseline', file), execFileSync('git', ['show', `${baseline}:${file}`], { windowsHide: true }));
}
let requests = 0;
const server = createServer((request, response) => {
  if (request.url !== '/fixture') { response.writeHead(404).end(); return; }
  requests++;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ready","fixture":true}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const results = [];
const snapshot = () => ({ at: new Date().toISOString(), freeMemory: freemem(), cpuTimes: cpus().map(cpu => cpu.times) });
try {
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const before = snapshot();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-File', 'tests/startup-speed-benchmark.ps1',
        '-BaselineRoot', path.join(root, 'baseline'), '-HealthUrl', `http://127.0.0.1:${port}/fixture`], { windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(`${code}: ${stderr}\n${stdout}`)));
    });
    results.push({ ...result, before, after: snapshot() });
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
const evidence = { baseline, measuredAt: new Date().toISOString(), fixturePort: port, totalMemory: totalmem(), requests, results };
const output = path.join(root, 'results.json');
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ output, requests, results: results.map(({ shell, samples }) => ({ shell, samples })) }));
