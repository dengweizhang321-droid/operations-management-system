import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { readN8nPreflightEvidence } from "./jackyun-preflight-recovery";
import { inspectPartialImportRecovery, publishPartialImportRecovery, type PartialImportRecoveryProposal } from "../lib/jackyun/partial-import-recovery";
import { recoverySha } from "../lib/jackyun/preflight-recovery";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { verifyJackyunPreparedImports, type JackyunExportFirstPlan } from "./jackyun-export-first-pipeline";

async function main() {
  const [action, rootArg, proposalFile, approvedSha] = process.argv.slice(2);
  if (!rootArg || !path.isAbsolute(rootArg) || !["plan", "apply"].includes(action)
    || (action === "plan" ? process.argv.length !== 4 : process.argv.length !== 6)
    || (action === "apply" && !/^[a-f0-9]{64}$/.test(approvedSha ?? ""))) throw Error("用法：plan <root>；apply <root> <proposal.json> <approvedSha256>");
  const root = path.resolve(rootArg);
  await withJackyunRunLock({ runId: "n8n-export-first-5478", purpose: "audited_partial_import_recovery",
    lockDirectory: path.join(root, ".runtime/jackyun-automation.lock") }, async () => {
    const health = await fetch("http://127.0.0.1:5791/health", { signal: AbortSignal.timeout(10000) });
    const state = await health.json() as { ok: boolean; busy: boolean; activeWorkflow: unknown };
    if (!health.ok || !state.ok || state.busy || state.activeWorkflow) throw Error("helper 非空闲，拒绝准备或发布 5478 恢复许可。");
    const evidence = readN8nPreflightEvidence(path.join(homedir(), ".n8n/database.sqlite"), "5478");
    const plan = JSON.parse(await readFile(path.join(root, "outputs/jackyun-export-first/n8n-export-first-5478.json"), "utf8")) as JackyunExportFirstPlan;
    const policy = JSON.parse(await readFile(path.join(root, "config/jackyun-export-first-policy.json"), "utf8"));
    await verifyJackyunPreparedImports(root, plan, policy);
    if (action === "plan") {
      const proposal = await inspectPartialImportRecovery(root, evidence, new Date().toISOString());
      console.log(JSON.stringify({ proposal, approvedSha256: recoverySha(JSON.stringify(proposal)) }));
    } else {
      const { proposal } = JSON.parse(await readFile(proposalFile, "utf8")) as { proposal: PartialImportRecoveryProposal };
      if (proposal.root !== root || Date.now() < Date.parse(proposal.createdAt) || Date.now() - Date.parse(proposal.createdAt) > 30 * 60000) throw Error("5478 批准目录或有效期不符。");
      await publishPartialImportRecovery(proposal, evidence, approvedSha);
      console.log(JSON.stringify({ status: "partial_import_permit_published", failedExecutionId: "5478", runId: plan.runId }));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "5478 导入恢复拒绝"); process.exitCode = 1; });
}
