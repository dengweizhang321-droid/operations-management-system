import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const windows = process.platform === 'win32';
test('watchdog retains failure stages, distinguishes unknown ports, and closes notified incidents once', { skip: !windows }, () => {
  const r = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', 'tests/watchdog-diagnostics.test.ps1'], { windowsHide: true, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const receipt = JSON.parse(r.stdout.trim());
  assert.ok(receipt.passed >= 35);
  assert.equal(receipt.productionServicesTouched, false);
  assert.equal(receipt.messagesSent, false);
});
for (const shell of ['pwsh.exe', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe']) {
  test(`core diagnostics retain the original readiness contract in ${shell}`, { skip: !windows }, () => {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', 'tests/core-readiness-diagnostics.test.ps1'], { windowsHide: true, encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const receipt = JSON.parse(r.stdout.trim());
    assert.ok(receipt.passed >= 30);
    assert.equal(receipt.productionServicesTouched, false);
    assert.equal(receipt.httpRequestsMade, false);
  });
}

test('watchdog HTTP probes reject malformed health contracts on an isolated loopback port', { skip: !windows, timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'watchdog-http-diagnostics-'));
  const source = path.resolve('tools/operations-system-watchdog.ps1');
  const fixture = path.join(directory, 'fixture.ps1');
  const script = String.raw`param([string]$Source,[string]$BaseUrl)
$ErrorActionPreference='Stop'
. $Source -FunctionsOnly
$results=@()
foreach($name in @('valid','array','stringBool','arrayMarker','invalid','limit','http','redirect')) {
  $results+=@{name=$name;result=Test-WatchHttp ($BaseUrl+'/'+$name) 'ready'}
}
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS='1'
$results+=@{name='expired';result=Test-WatchHttp ($BaseUrl+'/valid') 'ready'}
$results|ConvertTo-Json -Depth 8 -Compress
`;
  await writeFile(fixture, '\ufeff' + script);
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const name = req.url!.slice(1);
    calls.push(name);
    assert.equal(req.headers['x-teruisi-local-health'], '1');
    const bodies: Record<string, string> = { valid: '{"ok":true,"status":"ready"}', array: '[{"ok":true,"status":"ready"}]', stringBool: '{"ok":"true","status":"ready"}', arrayMarker: '{"ok":true,"status":["ready"]}', invalid: '{"PRIVATE_SECRET"', limit: 'x'.repeat(8200), http: 'PRIVATE_SECRET', redirect: '' };
    res.writeHead(name === 'http' ? 503 : name === 'redirect' ? 302 : 200, { 'content-type': 'application/json', ...(name === 'redirect' ? { location: '/valid' } : {}) });
    res.end(bodies[name]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  assert.ok(![3000, 5791, 5432, 8001, 8002].includes(port));
  try {
    const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', fixture, '-Source', source, '-BaseUrl', `http://127.0.0.1:${port}`], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
    const timer = setTimeout(() => child.kill(), 20_000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    clearTimeout(timer);
    assert.equal(code, 0, stderr);
    const rows = JSON.parse(stdout) as { name: string; result: { ok: boolean; reason: string; status: number; elapsedMs: number } }[];
    assert.equal(rows.length, 9);
    for (const row of rows) {
      assert.equal(row.result.ok, row.name === 'valid', row.name);
      assert.ok(row.result.elapsedMs >= 0);
    }
    assert.equal(rows.find(x => x.name === 'limit')!.result.reason, 'body_limit');
    assert.equal(rows.find(x => x.name === 'http')!.result.status, 503);
    assert.equal(rows.find(x => x.name === 'expired')!.result.reason, 'deadline');
    assert.equal(stdout.includes('PRIVATE_SECRET'), false);
    assert.deepEqual(calls, ['valid','array','stringBool','arrayMarker','invalid','limit','http','redirect']);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(fixture); await rmdir(directory);
  }
});
