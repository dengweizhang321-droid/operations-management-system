// Readonly dynamic startup inventory before invoking the unchanged collector.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { verifyPythonClosure } from "file:///E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/python-closure.mjs";
async function main() {
  const [input,...phaseArgs]=process.argv.slice(2),root=path.resolve(input);
  assert.equal(path.dirname(root),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
  assert.match(path.basename(root),/^(AB|ABC)-v2-[a-z0-9-]{8,70}$/);
  assert.ok(phaseArgs.length===0||(phaseArgs.length===2&&phaseArgs[0]==='--phase'&&['admission','prepare','backup-pre','restore-pre','drain','switch','acceptance','backup-post','restore-post','closeout'].includes(phaseArgs[1])));
  const h=JSON.parse(await readFile(path.join(root,'candidate-handoff.json')));
  const {safeRead,safeFileDigest}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/release-impact.mjs')));
  const baseline=JSON.parse(await safeRead(path.join(root,'python-closure.json')));
  await verifyPythonClosure(baseline,safeFileDigest);
  const {runProcess}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/worker-local-release.mjs')));
  const result=await runProcess(process.execPath,[fileURLToPath(new URL('./release-batch-admission.mjs',import.meta.url)),'collect',path.join(root,'approved-batch.json'),path.join(root,'candidate-tests.json'),...phaseArgs],
    {cwd:h.sourceRoot,timeoutMs:1200000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'original readonly collector after exact Python inventory'});
  if(result.stderr)process.stderr.write(result.stderr);process.stdout.write(result.stdout);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Exact readonly collector/startup closure failed');process.exitCode=1;});
