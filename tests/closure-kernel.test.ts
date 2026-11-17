import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ClosureRefusal, assertConfirmMode, assertPortAbsent, createOnly, moveNoReplace, normalizeReason, probeHelperIdle, readControlFile, sha256, windowsPowerShellPath,
} from "../lib/closure/kernel";

async function temp() { return mkdtemp(path.join(tmpdir(), "closure-kernel-")); }
class Thrown extends Error { constructor(readonly code: string) { super(code); } }
const refuse = (reason: string): never => { throw new Thrown(reason); };
const thrown = (code: string) => (error: unknown) => error instanceof Thrown && error.code === code;
const reasonIs = (reason: string) => (error: unknown) => error instanceof ClosureRefusal && error.reason === reason;

test("sha256 与 Node 摘要一致，字符串与字节等价", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(new TextEncoder().encode("abc")), sha256("abc"));
});

test("readControlFile：缺失为 null，普通文件原字节返回", async () => {
  const dir = await temp();
  try {
    assert.equal(await readControlFile(path.join(dir, "none.json"), 1024, refuse), null);
    await writeFile(path.join(dir, "a.json"), "hello");
    assert.equal((await readControlFile(path.join(dir, "a.json"), 1024, refuse))!.toString(), "hello");
    // Exactly at the limit is allowed.
    assert.equal((await readControlFile(path.join(dir, "a.json"), 5, refuse))!.length, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("readControlFile：超限、多链接、目录、符号链接都拒绝，且 reason 由调用方透传", async () => {
  const dir = await temp();
  try {
    await writeFile(path.join(dir, "big.json"), "123456");
    await assert.rejects(readControlFile(path.join(dir, "big.json"), 5, refuse), thrown("control_file_identity"));
    await writeFile(path.join(dir, "one.json"), "x");
    await link(path.join(dir, "one.json"), path.join(dir, "two.json"));
    await assert.rejects(readControlFile(path.join(dir, "one.json"), 1024, refuse), thrown("control_file_identity"));
    await mkdir(path.join(dir, "folder"));
    await assert.rejects(readControlFile(path.join(dir, "folder"), 1024, refuse), thrown("control_file_identity"));
    await writeFile(path.join(dir, "target.json"), "y");
    const linked = await symlink(path.join(dir, "target.json"), path.join(dir, "sym.json")).then(() => true, () => false);
    if (linked) await assert.rejects(readControlFile(path.join(dir, "sym.json"), 1024, refuse), thrown("control_file_identity"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("createOnly：写入并落盘，已存在报 EEXIST 且不改原文件", async () => {
  const dir = await temp();
  try {
    const file = path.join(dir, "evidence.json");
    await createOnly(file, "first");
    assert.equal(await readFile(file, "utf8"), "first");
    await assert.rejects(createOnly(file, "second"), (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST");
    assert.equal(await readFile(file, "utf8"), "first");
    await createOnly(path.join(dir, "bytes.bin"), new Uint8Array([1, 2, 3]));
    assert.deepEqual([...await readFile(path.join(dir, "bytes.bin"))], [1, 2, 3]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("moveNoReplace：移动成功后源消失；目标已存在时拒绝且源与目标都保持原样（含引号路径）", async () => {
  const dir = await temp();
  try {
    const from = path.join(dir, "it's source.json");
    const to = path.join(dir, "dest.json");
    await writeFile(from, "payload");
    await moveNoReplace(from, to);
    assert.equal(await readFile(to, "utf8"), "payload");
    assert.equal(await stat(from).then(() => true, () => false), false);
    await writeFile(from, "second");
    await assert.rejects(moveNoReplace(from, to));
    assert.equal(await readFile(from, "utf8"), "second");
    assert.equal(await readFile(to, "utf8"), "payload");
    assert.deepEqual((await readdir(dir)).sort(), ["dest.json", "it's source.json"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("windowsPowerShellPath：SystemRoot 缺失时回落到 C:\\Windows 的绝对路径", () => {
  const saved = process.env.SystemRoot;
  try {
    delete process.env.SystemRoot;
    assert.equal(windowsPowerShellPath(), path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    if (process.platform === "win32") assert.equal(windowsPowerShellPath(), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    process.env.SystemRoot = "D:\\Win";
    assert.equal(windowsPowerShellPath(), path.join("D:\\Win", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  } finally {
    if (saved === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = saved;
  }
});

const health = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const sameStore = (slot: { storeKey?: string | null; workflow?: string }) => slot.workflow === "tmall" && slot.storeKey === "tmall-yijiu";

test("probeHelperIdle：未运行可继续、空闲通过、命中谓词拒绝", async () => {
  const refused = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  assert.equal(await probeHelperIdle(sameStore, { fetcher: refused }), "helper_not_running");
  assert.equal(await probeHelperIdle(sameStore, { fetcher: health({ storeExecutions: [{ workflow: "tmall", storeKey: "tmall-other" }, { workflow: "jd", storeKey: "tmall-yijiu" }] }) }), "helper_store_idle");
  assert.equal(await probeHelperIdle(sameStore, { fetcher: health({ storeExecutions: [] }) }), "helper_store_idle");
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: health({ storeExecutions: [{ workflow: "tmall", storeKey: "tmall-yijiu" }] }) }), reasonIs("helper_store_active"));
});

test("probeHelperIdle：超时、非 2xx、缺 storeExecutions 都拒绝，并可注入调用方的拒绝类型", async () => {
  const timeout = (async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: timeout }), reasonIs("helper_probe_failed"));
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: health({}, 503) }), reasonIs("helper_probe_failed"));
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: health({ busy: false }) }), reasonIs("helper_probe_failed"));
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: health({ storeExecutions: "x" }) }), reasonIs("helper_probe_failed"));
  await assert.rejects(probeHelperIdle(sameStore, { fetcher: health({}, 500), refuse: reason => refuse(reason) }), thrown("helper_probe_failed"));
});

test("assertPortAbsent：空闲端口通过，被占用端口拒绝", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await assert.rejects(assertPortAbsent(port), reasonIs("port_in_use"));
  await new Promise<void>(resolve => server.close(() => resolve()));
  await assertPortAbsent(port);
});

test("assertConfirmMode：dry-run 与 confirm 互斥，confirm 需要 64 位小写十六进制摘要与 4-300 字原因", () => {
  const hex = "a".repeat(64);
  const run = (input: Partial<Parameters<typeof assertConfirmMode>[0]>) => assertConfirmMode({ dryRun: false, confirmed: false, ...input });
  assert.throws(() => run({ dryRun: true, confirmed: true, expectSha256: hex, reason: "原因足够长" }), reasonIs("mode_conflict"));
  assert.throws(() => run({}), reasonIs("not_confirmed"));
  assert.throws(() => run({ confirmed: true, reason: "原因足够长" }), reasonIs("expect_sha256_missing"));
  assert.throws(() => run({ confirmed: true, expectSha256: "A".repeat(64), reason: "原因足够长" }), reasonIs("expect_sha256_missing"));
  assert.throws(() => run({ confirmed: true, expectSha256: "a".repeat(63), reason: "原因足够长" }), reasonIs("expect_sha256_missing"));
  assert.throws(() => run({ confirmed: true, expectSha256: hex, reason: "太短" }), reasonIs("reason_length"));
  assert.throws(() => run({ confirmed: true, expectSha256: hex }), reasonIs("reason_length"));
  assert.throws(() => run({ confirmed: true, expectSha256: hex, reason: "长".repeat(301) }), reasonIs("reason_length"));
  assert.deepEqual(run({ confirmed: true, expectSha256: hex, reason: "  原因   足够长  " }), { mode: "confirm", reason: "原因 足够长", expectSha256: hex });
  // dry-run: reason optional but validated when given; the digest is not needed.
  assert.equal(run({ dryRun: true }).mode, "dry-run");
  assert.throws(() => run({ dryRun: true, reason: "短" }), reasonIs("reason_length"));
  assert.throws(() => run({ dryRun: true, reasonRequiredInDryRun: true }), reasonIs("reason_length"));
  // A pipeline that does not use the digest can waive it.
  assert.equal(run({ confirmed: true, reason: "原因足够长", requireExpect: false }).mode, "confirm");
  assert.throws(() => run({}), ClosureRefusal);
  assert.throws(() => normalizeReason("短", true, refuse), thrown("reason_length"));
});
