import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { writeJsonDurable } from "./json-file";

export const recoveryProtocol = "jackyun-recovery-control-v1";
export type RecoveryRequest = { version: typeof recoveryProtocol; kind: "new" }
  | { version: typeof recoveryProtocol; kind: "retry"; logicalExecutionId: string; failedExecutionId: string };
export type RecoveryControl = {
  version: typeof recoveryProtocol; logicalExecutionId: string; sequence: number; previousDigest: string | null;
  sourceExecutionId: string; attemptExecutionId: string; ownerToken: string; generation: number;
  decision: "collect" | "resume" | "completed"; proofDigest: string; at: string;
  failureAttempts: number; nextAllowedAt: string | null;
};
type Sealed = { record: RecoveryControl; digest: string };
const id = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,19}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const controlDigest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function exact(v: object, keys: string[]) { return Object.keys(v).sort().join(",") === keys.sort().join(","); }
export function parseRecoveryRequest(raw: string): RecoveryRequest {
  if (raw.length > 512) throw new Error("恢复请求超过上限。");
  const v = JSON.parse(raw) as RecoveryRequest;
  if (!v || typeof v !== "object" || Array.isArray(v) || v.version !== recoveryProtocol
    || (v.kind === "new" ? !exact(v, ["version", "kind"]) : v.kind !== "retry"
      || !exact(v, ["version", "kind", "logicalExecutionId", "failedExecutionId"])
      || !id(v.logicalExecutionId) || !id(v.failedExecutionId) || BigInt(v.failedExecutionId) < BigInt(v.logicalExecutionId))) {
    throw new Error("恢复请求必须明确绑定原逻辑运行及失败 execution，或明确选择新采集。");
  }
  return v;
}
function directory(root: string, logical: string) {
  if (!path.isAbsolute(root) || !id(logical)) throw new Error("恢复记录身份无效。");
  return path.join(root, "outputs", "jackyun-export-first", "recovery-control", logical);
}
function valid(v: RecoveryControl, logical: string, sequence: number, previousDigest: string | null) {
  return v && typeof v === "object" && !Array.isArray(v)
    && exact(v, ["version", "logicalExecutionId", "sequence", "previousDigest", "sourceExecutionId", "attemptExecutionId",
      "ownerToken", "generation", "decision", "proofDigest", "at", "failureAttempts", "nextAllowedAt"])
    && v.version === recoveryProtocol && v.logicalExecutionId === logical && v.sequence === sequence
    && v.previousDigest === previousDigest && id(v.sourceExecutionId) && id(v.attemptExecutionId)
    && BigInt(v.sourceExecutionId) >= BigInt(logical) && BigInt(v.attemptExecutionId) >= BigInt(v.sourceExecutionId)
    && /^[a-f0-9-]{36}$/i.test(v.ownerToken) && Number.isSafeInteger(v.generation) && v.generation >= 1
    && ["collect", "resume", "completed"].includes(v.decision) && hash(v.proofDigest)
    && typeof v.at === "string" && Number.isFinite(Date.parse(v.at)) && new Date(v.at).toISOString() === v.at
    && Number.isSafeInteger(v.failureAttempts) && v.failureAttempts >= 0 && v.failureAttempts <= 3
    && (v.nextAllowedAt === null || typeof v.nextAllowedAt === "string" && Number.isFinite(Date.parse(v.nextAllowedAt))
      && new Date(v.nextAllowedAt).toISOString() === v.nextAllowedAt);
}
/** Records are immutable and contiguous. No pointer, copy fallback, TTL-based
 * deletion, or business progress replica. Must be used under the existing lock. */
export async function readRecoveryControl(root: string, logical: string): Promise<Sealed | null> {
  const dir = directory(root, logical);
  for (let cursor = dir; ; cursor = path.dirname(cursor)) {
    const info = await lstat(cursor).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("恢复记录目录身份异常。");
    if (path.dirname(cursor) === cursor) break;
  }
  const entries = await readdir(dir).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (entries === null) return null;
  if (!entries.length || entries.length > 64 || entries.some(n => !/^\d{4}\.json$/.test(n))) throw new Error("恢复记录不完整或有未决临时证据，需要人工核查。");
  let previous: Sealed | null = null;
  for (const [index, name] of entries.sort().entries()) {
    const sequence = index + 1;
    if (name !== `${String(sequence).padStart(4, "0")}.json`) throw new Error("恢复记录序列缺失。");
    const file = path.join(dir, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192) throw new Error("恢复记录文件身份异常。");
    const sealed = JSON.parse(await readFile(file, "utf8")) as Sealed;
    if (!sealed || !exact(sealed, ["record", "digest"]) || !hash(sealed.digest)
      || !valid(sealed.record, logical, sequence, previous?.digest ?? null)
      || controlDigest(sealed.record) !== sealed.digest) throw new Error("恢复记录摘要或身份无效。");
    if (previous && (Date.parse(sealed.record.at) < Date.parse(previous.record.at)
      || sealed.record.failureAttempts < previous.record.failureAttempts
      || sealed.record.generation < previous.record.generation
      || BigInt(sealed.record.attemptExecutionId) < BigInt(previous.record.attemptExecutionId)
      || previous.record.decision === "completed" && sealed.record.decision !== "completed")) throw new Error("恢复记录发生回退。");
    previous = sealed;
  }
  return previous;
}
export async function appendRecoveryControl(root: string, record: Omit<RecoveryControl, "sequence" | "previousDigest">,
  expectedDigest: string | null, assertOwned: () => Promise<void>) {
  await assertOwned();
  const previous = await readRecoveryControl(root, record.logicalExecutionId);
  if ((previous?.digest ?? null) !== expectedDigest) throw new Error("恢复记录 owner 或代次已变化。");
  const value: RecoveryControl = { ...record, sequence: (previous?.record.sequence ?? 0) + 1, previousDigest: expectedDigest };
  if (value.sequence > 64 || !valid(value, value.logicalExecutionId, value.sequence, expectedDigest)) throw new Error("恢复记录字段无效。");
  const sealed = { record: value, digest: controlDigest(value) };
  await assertOwned();
  await writeJsonDurable(path.join(directory(root, value.logicalExecutionId), `${String(value.sequence).padStart(4, "0")}.json`), sealed, true);
  await assertOwned();
  const actual = await readRecoveryControl(root, value.logicalExecutionId);
  if (actual?.digest !== sealed.digest) throw new Error("恢复记录发布后复验失败。");
  return sealed;
}
