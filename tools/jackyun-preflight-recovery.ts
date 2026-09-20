import { DatabaseSync } from "node:sqlite";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { inspectPreflightClosure, publishPreflightClosure, recoverySha, jackyunWorkflowId, type PreflightEvidence, type PreflightClosure } from "../lib/jackyun/preflight-recovery";
import { readJackyunLoginConfig } from "../lib/jackyun/windows-dpapi";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";

export function readN8nPreflightEvidence(databasePath: string, executionId: string): PreflightEvidence {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("n8n execution ID 无效。");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const row = db.prepare("SELECT id,workflowId,status,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, jackyunWorkflowId);
    if (!row || row.deletedAt !== null) throw new Error("缺少原 n8n execution。");
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof data !== "string") throw new Error("n8n 运行证据缺失或超限。");
    // n8n stores flatted references. Resolve only the allowlisted diagnostic
    // fields; never expand/log credentials, resume tokens or arbitrary outputs.
    const values = JSON.parse(data) as unknown[];
    if (!Array.isArray(values) || values.length > 10000) throw new Error("n8n 证据格式不支持。");
    const deref = (value: unknown): unknown => typeof value === "string" && /^\d+$/.test(value) ? values[Number(value)] : value;
    const object = (value: unknown): Record<string, unknown> => {
      const resolved = deref(value);
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) throw new Error("n8n 诊断对象格式不支持。");
      return resolved as Record<string, unknown>;
    };
    const root = values[0] as Record<string, unknown>;
    const result = object(root.resultData), error = object(result.error), node = object(error.node), parameters = object(node.parameters);
    const utc = (value: unknown) => { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) throw new Error("n8n 时间证据不明确。"); return value.replace(" ", "T") + "Z"; };
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(jackyunWorkflowId);
    return { executionId: String(row.id), workflowId: String(row.workflowId), status: String(row.status),
      startedAt: utc(row.startedAt), stoppedAt: utc(row.stoppedAt), retrySuccessId: row.retrySuccessId === null ? null : String(row.retrySuccessId),
      lastNode: String(deref(result.lastNodeExecuted)), runNodes: Object.keys(object(result.runData)),
      error: String(deref(error.description)), httpCode: String(deref(error.httpCode)), requestUrl: String(deref(parameters.url)),
      executionDataSha256: recoverySha(data), activeExecutions: Number(active?.count) };
  } finally { db.close(); }
}
async function main() {
  const [action, executionId, proposalPath, approvedSha] = process.argv.slice(2);
  if (!executionId || !["plan", "apply"].includes(action) || (action === "plan" ? process.argv.length !== 4 : process.argv.length !== 6)
    || (action === "apply" && !/^[a-f0-9]{64}$/.test(approvedSha ?? ""))) throw new Error("用法：plan <executionId>；apply <executionId> <plan.json> <approvedSha256>");
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = await readJackyunLoginConfig(sourceRoot);
  const root = path.dirname(path.dirname(path.resolve(config.profileDirectory)));
  const databasePath = path.join(homedir(), ".n8n", "database.sqlite");
  if (!(await stat(databasePath)).isFile() || path.resolve(await realpath(databasePath)).toLowerCase() !== databasePath.toLowerCase()) throw new Error("n8n 数据库路径身份异常。");
  await withJackyunRunLock({ runId: `n8n-export-first-${executionId}`, purpose: "preflight_recovery",
    lockDirectory: path.join(root, ".runtime", "jackyun-automation.lock") }, async () => {
    const health = await fetch("http://127.0.0.1:5791/health", { signal: AbortSignal.timeout(10000) });
    const state = await health.json() as { ok: boolean; busy: boolean; activeWorkflow: unknown };
    if (!health.ok || !state.ok || state.busy || state.activeWorkflow) throw new Error("helper 非空闲，拒绝恢复。");
    const evidence = readN8nPreflightEvidence(databasePath, executionId);
    if (action === "plan") {
      const proposal = await inspectPreflightClosure(root, executionId, evidence, new Date().toISOString());
      console.log(JSON.stringify({ proposal, approvedSha256: recoverySha(JSON.stringify(proposal)) }));
    } else {
      const { proposal } = JSON.parse(await readFile(proposalPath, "utf8")) as { proposal: PreflightClosure };
      if (proposal.executionId !== executionId) throw new Error("批准计划的 execution 不一致。");
      console.log(JSON.stringify(await publishPreflightClosure(root, proposal, evidence, approvedSha)));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("吉客云恢复证据未通过；保留原运行并停止。请先核查原 n8n 失败阶段、活动所有者和文件证据。"); process.exitCode = 1; });
}
