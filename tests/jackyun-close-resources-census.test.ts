import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);
const idle = { status: "fulfilled", value: { descendants: 0, profileProcesses: 0, portClosed: true } };

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

// The census treats every descendant of the calling process as a leftover
// child, and this test runner keeps tsx's esbuild service as a child. So the
// census runs in a separate plain node process whose only children are the
// ones the scenario creates, like the single shared helper process in production.
const probe = `
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { assertJackyunCloseResourcesIdle } from "./operator-close-resources.mjs";
const [root, scenario, port, inner] = process.argv.slice(2);
if (!inner) {
  // Launched with a fresh hidden console, this process owns a conhost.exe
  // child that the census would rightly count. Re-run on the inherited
  // console so the census process starts with no children, like the helper.
  const child = spawn(process.execPath, [process.argv[1], root, scenario, port, "inner"], { stdio: "inherit", windowsHide: false });
  child.once("exit", code => process.exit(code ?? 1));
} else {
const settle = async count => (await Promise.allSettled(Array.from({ length: count }, () => assertJackyunCloseResourcesIdle(root))))
  .map(r => r.status === "fulfilled" ? r : { status: "rejected", reason: String(r.reason?.message ?? r.reason) });
let out;
if (scenario === "concurrent") out = await settle(3);
else if (scenario === "child") {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const blocked = await settle(2);
  child.kill(); await new Promise(resolve => child.once("exit", resolve));
  out = { blocked, after: await settle(1) };
} else {
  const server = createServer(); await new Promise(resolve => server.listen(Number(port), "127.0.0.1", resolve));
  out = await settle(1); server.close();
}
process.stdout.write(JSON.stringify(out));
}
`;

test("close census: concurrent checks do not see each other's probe; real child and open port still block", { skip: process.platform !== "win32", timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-close-census-"));
  try {
    const port = await freePort();
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(path.join(root, "config/jackyun-login.json"), JSON.stringify({ profileDirectory: path.join(root, "unused-dedicated-profile"), debuggingPort: port }));
    await build({ entryPoints: [path.resolve("lib/jackyun/operator-close-resources.ts")], outfile: path.join(root, "operator-close-resources.mjs"),
      bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
    await writeFile(path.join(root, "probe.mjs"), probe);
    const scenario = async (name: string) => JSON.parse((await run(process.execPath, [path.join(root, "probe.mjs"), root, name, String(port)], { cwd: root, timeout: 90_000, windowsHide: true })).stdout);

    // Before the fix, each concurrent census counted the other's PowerShell probe as a leftover child.
    assert.deepEqual(await scenario("concurrent"), [idle, idle, idle]);

    const child = await scenario("child");
    for (const result of child.blocked) { assert.equal(result.status, "rejected"); assert.match(result.reason, /原任务仍有子进程或专用浏览器/); }
    assert.deepEqual(child.after, [idle], "the serialized queue recovers after rejections");

    const [listening] = await scenario("port");
    assert.equal(listening.status, "rejected");
    assert.match(listening.reason, /专用浏览器端口仍被占用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
