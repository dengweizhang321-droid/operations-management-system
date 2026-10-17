import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { createJackyunCredentialMonitor, probeJackyunCredential } from "../lib/jackyun/credential-health";

test("credential monitor coalesces checks and accepts only complete exited worker results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-health-unit-"));
  try {
    for (const scenario of ["ready", "error", "invalid", "abnormal_exit"]) {
      const file = path.join(root, scenario + ".mjs");
      await writeFile(file, `import {parentPort} from 'node:worker_threads';
        parentPort.postMessage({type:'credential_probe_bootstrap_ready'});
        await new Promise(resolve=>parentPort.once('message',resolve));
        const result={state:'ready',reason:'ready',checkedAt:new Date().toISOString(),context:'isolated_worker'};
        ${scenario === "invalid" ? "result.secret='fixture-only';" : ""}
        ${scenario === "error" ? "throw new Error('fixture-secret');" : "parentPort.postMessage({type:'jackyun-credential-probe-v1',result});"}
        ${scenario === "abnormal_exit" ? "process.exitCode=1;" : ""}`);
      const monitor = createJackyunCredentialMonitor(file);
      const first = monitor.refresh(); assert.equal(first, monitor.refresh());
      await first;
      const snapshot = monitor.snapshot();
      assert.equal(snapshot.state, scenario === "ready" ? "ready" : "blocked");
      assert.doesNotMatch(JSON.stringify(snapshot), /fixture-secret|fixture-only|secret/);
      assert.deepEqual(monitor.snapshot(), snapshot);
    }
    assert.equal((await probeJackyunCredential(root)).reason, "configuration");
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert(path.basename(root).startsWith("jackyun-health-unit-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("expired probe cannot publish late ready or start before authorization", { timeout: 10000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-health-unit-"));
  try {
    const late = path.join(root, "late.mjs");
    await writeFile(late, `import {parentPort} from 'node:worker_threads';
      parentPort.postMessage({type:'credential_probe_bootstrap_ready'});
      await new Promise(resolve=>parentPort.on('message',message=>{if(message.type==='credential_probe_cancel')resolve();}));
      parentPort.removeAllListeners('message');
      parentPort.postMessage({type:'jackyun-credential-probe-v1',result:{state:'ready',reason:'ready',checkedAt:new Date().toISOString(),context:'isolated_worker'}});
      parentPort.close();`);
    const monitor = createJackyunCredentialMonitor(late, 300);
    await monitor.refresh(); assert.equal(monitor.snapshot().state, "blocked");
    const neverReady = path.join(root, "never-ready.mjs");
    await writeFile(neverReady, "await new Promise(r=>setTimeout(r,60000));");
    const beforeStart = createJackyunCredentialMonitor(neverReady, 100);
    await beforeStart.refresh(); assert.equal(beforeStart.snapshot().state, "blocked");
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert(path.basename(root).startsWith("jackyun-health-unit-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("delayed probe bootstrap cancels and reaps its own hanging PowerShell before worker exit", {
  skip: process.platform !== "win32", timeout: 15000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-health-unit-"));
  const pidFile = path.join(root, "owned-powershell.pid");
  try {
    await mkdir(path.join(root, "config"));
    await writeFile(path.join(root, "config/jackyun-login.json"), JSON.stringify({ version: 1, loginMode: "windows_dpapi_credentials",
      tenantId: "999993", profileDirectory: root, debuggingPort: 29225, initialWaitMs: 1000, afterSubmitWaitMs: 1000 }));
    const entry = path.join(root, "probe.ts"), bundle = path.join(root, "probe.mjs");
    await writeFile(entry, `import {runJackyunCredentialProbeWorker} from ${JSON.stringify(path.resolve("lib/jackyun/credential-health.ts"))};
      await new Promise(r=>setTimeout(r,1000)); await runJackyunCredentialProbeWorker(${JSON.stringify(root)});`);
    const nativeFixture = `[IO.File]::WriteAllText('${pidFile.replaceAll("'", "''")}',[string]$PID); Start-Sleep -Seconds 60`;
    await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external",
      plugins: [{ name: "private-powershell-fixture", setup(plugin) {
        plugin.onLoad({ filter: /[\\/]dpapi-program\.ts$/ }, () => ({ contents: `export const jackyunDpapiProgram=${JSON.stringify(nativeFixture)};`, loader: "ts" }));
      } }] });
    const monitor = createJackyunCredentialMonitor(bundle, 5000);
    const pending = monitor.refresh();
    let pid: number | undefined;
    const deadline = Date.now() + 4500;
    while (Date.now() < deadline) {
      const text = await readFile(pidFile, "utf8").catch(() => "");
      if (text) { pid = Number(text); break; }
      await new Promise(r => setTimeout(r, 50));
    }
    assert(pid && Number.isSafeInteger(pid), "fixture PowerShell actually started before cancellation");
    assert.doesNotThrow(() => process.kill(pid!, 0));
    assert.equal(pending, monitor.refresh());
    await pending;
    assert.equal(monitor.snapshot().state, "blocked");
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert(path.basename(root).startsWith("jackyun-health-unit-"));
    await rm(root, { recursive: true, force: true });
  }
});
