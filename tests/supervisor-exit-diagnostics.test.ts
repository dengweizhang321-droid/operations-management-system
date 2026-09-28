import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createSupervisorJournal, installSupervisorDiagnostics, observeChild } from "../tools/worker-local-runtime-supervisor.mjs";

const identity = { startedAt: "2026-09-29T00:00:00Z", manifestSha256: "a".repeat(64) };
const source = pathToFileURL(path.resolve("tools/worker-local-runtime-supervisor.mjs")).href;
async function entries(root: string) {
  return (await Promise.all([0, 1].map(async slot => {
    try { return await readFile(path.join(root, `supervisor-lifecycle-${slot}.jsonl`), "utf8"); }
    catch { return ""; }
  }))).join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

test("journal bounds two slots, redacts errors, preserves identities and tolerates closed disk handles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "supervisor-journal-"));
  const journal = await createSupervisorJournal(root, identity);
  try {
    for (let i = 0; i < 4500; i++) journal.record("child_error", {
      role: "helper", childPid: 123, error: new Error("SECRET https://private/?token=SECRET"),
      url: "SECRET", argv: ["SECRET"], errorCode: "SECRET WITH SPACE",
    });
    journal.record("final_sample");
    const events = await entries(root);
    assert.equal(events.at(-1)?.event === "final_sample" || events.some(e => e.event === "final_sample"), true);
    assert.equal(JSON.stringify(events).includes("SECRET"), false);
    assert.ok(events.some(e => e.errorSha256?.length === 64));
    assert.ok(events.every(e => e.manifestSha256 === identity.manifestSha256 && e.pid === process.pid));
    for (const slot of [0, 1]) assert.ok((await stat(path.join(root, `supervisor-lifecycle-${slot}.jsonl`))).size <= 1024 * 1024);
    journal.close();
    assert.doesNotThrow(() => journal.record("after_close"));
  } finally { journal.close(); await rm(root, { recursive: true, force: true }); }
});

test("journal refuses hard-linked targets without modifying the linked file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "supervisor-journal-"));
  try {
    const target = path.join(root, "preserve.txt");
    await writeFile(target, "preserve");
    await link(target, path.join(root, "supervisor-lifecycle-0.jsonl"));
    await assert.rejects(createSupervisorJournal(root, identity), /单链接|Unsafe/);
    assert.equal(await readFile(target, "utf8"), "preserve");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("broken output pipe is diagnosed without hiding other supervisor errors or accumulating listeners", () => {
  const target = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  const records: unknown[] = [];
  assert.throws(() => target.stdout.emit("error", Object.assign(new Error("pipe gone"), { code: "EPIPE" })), /pipe gone/);
  const dispose = installSupervisorDiagnostics({ record: (...args: unknown[]) => records.push(args) }, target);
  assert.doesNotThrow(() => target.stdout.emit("error", Object.assign(new Error("pipe gone"), { code: "EPIPE" })));
  assert.throws(() => target.stderr.emit("error", Object.assign(new Error("unrelated"), { code: "EIO" })), /unrelated/);
  assert.equal(records.length, 2);
  dispose();
  assert.equal(target.stdout.listenerCount("error"), 0);
  assert.equal(target.listenerCount("uncaughtExceptionMonitor"), 0);
});

for (const mode of ["normal", "throw", "rejection", "pipe"])
  test(`real diagnostic process distinguishes ${mode} without production ports or credentials`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "supervisor-journal-"));
    try {
      const code = `import {createSupervisorJournal,installSupervisorDiagnostics} from ${JSON.stringify(source)};
        const j=await createSupervisorJournal(${JSON.stringify(root)},${JSON.stringify(identity)});
        installSupervisorDiagnostics(j);j.record('supervisor_start');
        ${mode === "throw" ? "setImmediate(()=>{throw new Error('SECRET')});" :
          mode === "rejection" ? "Promise.reject(new Error('SECRET'));" :
          mode === "pipe" ? "process.stdout.emit('error',Object.assign(new Error('SECRET'),{code:'EPIPE'}));" : ""}`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true, stdio: "ignore" });
      const [exitCode] = await once(child, "exit");
      const events = await entries(root);
      const failed = ["throw", "rejection"].includes(mode);
      assert.equal(exitCode, failed ? 1 : 0);
      assert.equal(events.some(e => e.event === "uncaught_exception"), failed);
      assert.equal(events.find(e => e.event === "supervisor_exit")?.code, failed ? 1 : 0);
      assert.equal(JSON.stringify(events).includes("SECRET"), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("direct child exit and spawn failure retain role, PID and code; abort listener is removed", async () => {
  const records: { event: string; fields: Record<string, unknown> }[] = [];
  const record = (event: string, fields: Record<string, unknown>) => records.push({ event, fields });
  const child = spawn(process.execPath, ["-e", "process.exit(23)"], { windowsHide: true, stdio: "ignore" });
  assert.deepEqual(await observeChild(child, undefined, record, "helper"), { code: 23, signal: null });
  assert.equal(records[0].fields.childPid, child.pid);
  assert.equal(records[0].fields.code, 23);
  const missing = spawn(path.join(tmpdir(), "nonexistent-supervisor-fixture", "missing.exe"), [], { windowsHide: true });
  await assert.rejects(observeChild(missing, new AbortController().signal, record, "worker"), /ENOENT/);
  assert.equal(records[1].event, "child_error");
});

for (const shell of ["powershell.exe", "pwsh.exe"]) test(`controlled stop diagnostics (${shell})`, { skip: process.platform !== "win32" }, () => {
  const output = execFileSync(shell, ["-NoProfile", "-File", path.resolve("tests/supervisor-stop-diagnostics.test.ps1")], { encoding: "utf8", windowsHide: true });
  assert.match(output, /bounded replacement and unavailable sink passed/);
});

test("external hard termination has no fabricated fatal/normal-exit event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "supervisor-journal-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(process.execPath, ["--input-type=module", "-e", `
      import {createSupervisorJournal,installSupervisorDiagnostics} from ${JSON.stringify(source)};
      const j=await createSupervisorJournal(${JSON.stringify(root)},${JSON.stringify(identity)});
      installSupervisorDiagnostics(j);j.record('supervisor_start');process.send('ready');setInterval(()=>{},1000);
    `], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    await once(child, "message");
    const exited = once(child, "exit");
    child.kill("SIGKILL"); // Only the exact process created by this fixture.
    await exited;
    const events = await entries(root);
    assert.deepEqual(events.map(e => e.event), ["supervisor_start"]);
    // Absence of exit telemetry is unknown, not evidence of OOM or an actor.
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("real disconnected stdout pipe: baseline exits, candidate records EPIPE and survives", { timeout: 15000 }, async () => {
  for (const guarded of [false, true]) {
    const root = await mkdtemp(path.join(tmpdir(), "supervisor-journal-"));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(process.execPath, ["--input-type=module", "-e", `
        import {createSupervisorJournal,installSupervisorDiagnostics} from ${JSON.stringify(source)};
        const j=await createSupervisorJournal(${JSON.stringify(root)},${JSON.stringify(identity)});
        ${guarded ? "installSupervisorDiagnostics(j);" : ""}
        process.on('message',()=>{
          process.stdout.write('fixture output');
          setTimeout(()=>{j.record('survived');process.disconnect();},100);
        });process.send('ready');
      `], { windowsHide: true, stdio: ["ignore", "pipe", "ignore", "ipc"] });
      const exited = once(child, "exit");
      await once(child, "message");
      child.stdout!.destroy();
      // Wait for the read end to close before asking this fixture to write.
      await new Promise(resolve => setTimeout(resolve, 100));
      child.send("write");
      const [code] = await exited;
      const events = await entries(root);
      assert.equal(code, guarded ? 0 : 1);
      assert.equal(events.some(e => e.event === "survived"), guarded);
      if (guarded) assert.ok(events.some(e => e.event === "output_error" && e.errorCode === "EPIPE"));
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  }
});
