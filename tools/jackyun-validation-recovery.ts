import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectValidationRecovery, publishValidationRecovery, type ValidationRecoveryProposal } from "../lib/jackyun/validation-recovery";
import { readJackyunLoginConfig } from "../lib/jackyun/windows-dpapi";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { readN8nPreflightEvidence } from "./jackyun-preflight-recovery";

async function main() {
  const [action, executionId, proposalPath, approvedSha256] = process.argv.slice(2);
  if (executionId !== "5399" || !["plan", "apply"].includes(action)
    || (action === "plan" ? process.argv.length !== 4 : process.argv.length !== 6)
    || (action === "apply" && !/^[a-f0-9]{64}$/.test(approvedSha256 ?? ""))) {
    throw new Error("用法：plan 5399；apply 5399 <proposal.json> <approvedSha256>");
  }
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const login = await readJackyunLoginConfig(sourceRoot);
  const root = path.dirname(path.dirname(path.resolve(login.profileDirectory)));
  const databasePath = path.join(homedir(), ".n8n", "database.sqlite");
  if (!(await stat(databasePath)).isFile() || path.resolve(await realpath(databasePath)).toLowerCase() !== databasePath.toLowerCase()) {
    throw new Error("n8n 元数据路径身份异常。");
  }
  await withJackyunRunLock({ runId: "n8n-export-first-5399", purpose: "validation_recovery",
    lockDirectory: path.join(root, ".runtime", "jackyun-automation.lock") }, async () => {
    const response = await fetch("http://127.0.0.1:5791/health", { signal: AbortSignal.timeout(10000) });
    const health = await response.json() as { ok: boolean; busy: boolean; activeWorkflow: unknown };
    if (!response.ok || !health.ok || health.busy || health.activeWorkflow) throw new Error("helper 非空闲，拒绝恢复。");
    const evidence = readN8nPreflightEvidence(databasePath, executionId);
    if (action === "plan") {
      const proposal = await inspectValidationRecovery(root, evidence, new Date().toISOString());
      console.log(JSON.stringify({ proposal, approvedSha256: createHash("sha256").update(JSON.stringify(proposal)).digest("hex") }));
    } else {
      const { proposal } = JSON.parse(await readFile(proposalPath, "utf8")) as { proposal: ValidationRecoveryProposal };
      if (proposal.evidence.executionId !== executionId) throw new Error("恢复计划 execution 不一致。");
      console.log(JSON.stringify(await publishValidationRecovery(proposal, evidence, approvedSha256!)));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("5399 校验恢复证据未通过；保留原计划、文件和 active。"); process.exitCode = 1; });
}
