/** Run reviewed release compatibility checks on an exact, isolated candidate.
 * This does not publish, grant a startup permit, or claim a native cold start.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {publisherEnvironment} from './publish-latest-main.mjs';
import {hashTree} from './worker-local-release.mjs';
import {dingtalkScreenshotAclQualification,aDescendantCreationGuardDjangoScriptSha256,piNativeCandidateDjangoScriptSha256,bWorkerJsonFailureCauseScriptSha256,readinessCopyControllerPair,pandasRotationControllerPair} from './manual-maintenance-continuation.mjs';

/** A 项 (2026-10-25): one exact installed -> candidate django-local-service.ps1
 * pair. The candidate changes only Get-VerifiedProcessDescendants (purely
 * additive: two guard lines that `continue` past a reused-PID phantom whose
 * CreationDate is missing or older than its claimed parent's); every other
 * function, the parameter block, every top-level statement and the order of
 * the existing functions must be byte-identical, so Stop-VerifiedProcessTree
 * and the rest of the stop protocol are untouched. The whole-file hashes
 * below are the same values already registered in
 * piNativeCandidateControllerSha256 (manual-maintenance-continuation.mjs),
 * so a candidate that passes the maintenance-admission gate is bound to the
 * exact same bytes this verifier proves at the function level — no drift
 * between the two gates is possible. Evidence:
 * D:\teruisi-ops\release-20261025\A项-停服务误认进程-审查证据.md. */
export const descendantCreationGuardQualification=Object.freeze({
 fileBeforeSha256:piNativeCandidateDjangoScriptSha256,
 fileAfterSha256:aDescendantCreationGuardDjangoScriptSha256,
 beforeSha256:'3b3d82449c182609c0f4cec2a4275f548f02b74008f5cf590f249079bd497fa2',
 afterSha256:'a2d588d65e58ad1ad21a8885a6e9ac09e872c78d154f34f52b621e912efd0731'
});

/** B 项 (2026-10-25): one exact installed -> candidate worker-local-service.ps1
 * pair. The candidate changes only the terminal top-level try/catch statement:
 * in -Json mode the real exception text now reaches stderr (the non-Json branch
 * has always printed it), while the stdout reconciliation JSON keeps the exact
 * same key set (status / processEvidence / startupPhases / failedStartPhase) so
 * every consumer parsing that line is unaffected. Unlike Q14 and A 项 the change
 * is NOT in a function: it lives in `other`, so the comparator below pins one
 * top-level statement by hash instead of requiring `other` to be identical.
 * Every one of the 81 functions, the parameter block and the other 42 top-level
 * statements must stay byte-identical, so maintenance enter/exit, the lock,
 * drain, STARTED/SUCCESS receipts, worker start/stop sequencing and process-tree
 * termination are untouched. The whole-file hashes are the same values already
 * registered in piNativeCandidateControllerSha256
 * (manual-maintenance-continuation.mjs), so a candidate that passes the
 * maintenance-admission gate is bound to the exact bytes this verifier proves —
 * no drift between the two gates is possible. Evidence:
 * D:\teruisi-ops\release-20261025\B项-实施规划.md. */
export const workerJsonFailureCauseQualification=Object.freeze({
 fileBeforeSha256:'83705551d9a9b2f3d2948d7b7eb8b41f3c6cfae5a8747949ffd8d6e3a4ee7058',
 fileAfterSha256:bWorkerJsonFailureCauseScriptSha256,
 otherBeforeSha256:'31693378bf8bea799d31bef6c8fe137b0bc164cced82eda6512877817440c762',
 otherAfterSha256:'6c4fa17e1e8e96a3101b7ff59ce88f9bbfa7a4d2d2133ad851d454a830a23c43'
});

const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const git=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})).stdout.trim();
const productionRoots=['D:/teruisi-runtime','D:/运营管理系统','D:/运营管理系统-sales-django-release'];
const within=(root,target)=>{const r=path.relative(path.resolve(root),path.resolve(target));return !r||(!r.startsWith('..')&&!path.isAbsolute(r));};

export function candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory}){
 const environment=publisherEnvironment(process.env);
 environment.PATH=[path.dirname(process.execPath),path.dirname(gitExe),path.dirname(shell7),path.dirname(pythonExe),path.join(environment.SYSTEMROOT,'System32'),path.dirname(shell5)].join(';');
 environment.PSModuleAnalysisCachePath=path.join(directory,'module-cache');
 environment.PSModulePath=path.join(path.dirname(shell7),'Modules');
 environment.PYTHONDONTWRITEBYTECODE='1';environment.PYTHONIOENCODING='utf-8';
 return environment;
}
/** Windows PowerShell 5.1 must resolve its own built-in modules; the PowerShell 7
 * module path inherited from candidateTestEnvironment would hide Get-FileHash etc. */
export function windowsPowerShellEnvironment(environment){
 return Object.fromEntries(Object.entries(environment).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
}

// This complete task closure has its own bounded program/entry checks below.
// It grants no old Pi/apply-timing qualification and accepts no extra runtime file.
export const readinessStabilityFiles=Object.freeze([
 'lib/django/backend-readiness.ts','tools/desktop-launcher/Launcher.cs',
 'tools/install-main-prebuild.mjs','tools/operations-system-control.ps1',
 'tools/operations-system-watchdog.ps1','tools/publish-latest-main.mjs',
 'tools/publish-main-status.mjs','tools/publish-main-tail.mjs','tools/publish-prepared-main.mjs',
 'tools/start-local-worker.mjs','tools/publication-readiness.mjs','tools/django-local-service.ps1',
 'tools/manual-maintenance-continuation.mjs',
]);
export function compareReadinessDjangoCopyOnly(before,after){
 const normalize=text=>text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
 before=normalize(before);after=normalize(after);
 const anchor='      "tools\\publish-prepared-main.mjs",\n';
 const addition='      "tools\\publication-readiness.mjs",\n';
 return !before.includes(addition)&&after.split(addition).length===2
  &&after.includes(anchor+addition)&&after.replace(addition,'')===before;
}
export function compareReadinessMaintenancePairOnly(before,after){
 const normalize=text=>text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
 before=normalize(before);after=normalize(after);
 const declaration="// Readiness helper packaging only: exact old/new controller bytes, no new stop route.\n"
  +"// Evidence: docs/readiness-stability-20261103/COMPATIBILITY.md.\n"
  +"export const readinessCopyControllerPair=Object.freeze({\n"
  +" installedSha:'af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c',\n"
  +" candidateSha:'c7e02ddbc55e2ff2a3790ef2dd89b76a580ef98ec479b6f40ae471c2af7fa5c0'\n});\n";
 const branch=" if(name==='django-local-service.ps1'&&installedSha===readinessCopyControllerPair.installedSha&&candidateSha===readinessCopyControllerPair.candidateSha&&expected===candidateSha)return;\n";
 return !before.includes('readinessCopyControllerPair')&&after.split(declaration).length===2&&after.split(branch).length===2
  &&after.includes(declaration+'export function assertMaintenanceControllerGeneration(')
  &&after.includes(' if(installedSha===expected)return;\n'+branch)
  &&after.replace(declaration,'').replace(branch,'')===before;
}

export const aiRepairBatch1Qualification=Object.freeze({
 base:'0c7d0feb33f45cfc6ae1f283b81d401c873c5768',
 app:'eee39f9d315eaf9dd71f8390181879cdb6ba2c82',
 tree:'18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed',
 reviewedBytesSha256:'ba7fbd961afa817b4f8991a04bd902eea00a429e55bbb6380c3b8b97f1a2d12b',
});
const aiRepairBatch1Reviewed=Object.freeze({
 'app/ai-assistant-view.tsx':'M',
 'app/api/ai/chat/cancel/route.ts':'A',
 'backend/ai_assistant/chat.py':'M',
 'backend/ai_assistant/chat_stream.py':'M',
 'backend/ai_assistant/datasets.py':'M',
 'backend/ai_assistant/management/commands/pi_reclaim_stopped.py':'A',
 'backend/ai_assistant/pandas_diagnostics.py':'A',
 'backend/ai_assistant/pandas_sandbox.py':'M',
 'backend/ai_assistant/pi_transport.py':'M',
 'backend/ai_assistant/pi_worker.py':'M',
 'backend/ai_assistant/pi_workspace.py':'M',
 'backend/ai_assistant/report_library.py':'M',
 'backend/ai_assistant/test_chat_stop.py':'A',
 'backend/ai_assistant/test_chat_tool_budget.py':'M',
 'backend/ai_assistant/test_pandas_sandbox.py':'M',
 'backend/ai_assistant/test_pi_retained_lifecycle.py':'A',
 'backend/ai_assistant/test_promotion_chat.py':'M',
 'backend/ai_assistant/test_shop_conversion_guidance.py':'A',
 'backend/ai_assistant/test_streaming.py':'M',
 'backend/ai_assistant/tests.py':'M',
 'backend/ai_assistant/transport.py':'M',
 'backend/ai_assistant/views.py':'M',
 'backend/pi_runner/server.py':'M',
 'backend/pi_runner/test_retained_lifecycle.py':'A',
 'backend/pi_runner/upgrade_linux.py':'M',
 'backend/pi_runner/workspace.py':'M',
 'containers/pi-agent/Dockerfile':'M',
 'containers/pi-agent/build_image.py':'M',
 'containers/pi-agent/gateway-extension.mjs':'M',
 'lib/ai/analysis-sandbox.ts':'M',
 'lib/ai/django-route.ts':'M',
 'lib/ai/page-data-tools.ts':'M',
 'lib/ai/tool-registry.ts':'M',
 'lib/ai/workspace-recovery.ts':'M',
 'lib/django/ai-stream.ts':'M',
 'lib/netshop/ai-tool.ts':'M',
 'tests/ai-chat-recovery-interaction.test.ts':'A',
 'tests/ai-chat-stop-route.test.ts':'A',
 'tests/ai-chat-stream.test.ts':'M',
 'tests/ai-page-data-tools.test.ts':'M',
 'tests/ai-workspace-recovery.test.ts':'M',
 'tests/netshop-product-insights-ai-tool.test.ts':'M',
 'tests/pandas-sandbox.test.ts':'M',
 'tests/publish-prepared-main.test.mjs':'M',
 'tools/publish-main-resume.mjs':'M',
 'tools/publish-prepared-main.mjs':'M',
});
const aiRepairBatch1Adapter=Object.freeze({
 'tools/verify-release-candidate.mjs':'M',
 'tests/verify-release-candidate.test.mjs':'M',
 'tests/ai-repair-batch1-compatibility.test.mjs':'A',
 'tests/ai-repair-batch1-pi-native-start.py':'A',
});
const aiRepairBatch1Docs=file=>file==='docs/任务记录/README.md'||
 /^docs\/ai-repair-batch1-20261107\/[^/]+\.(?:md|html|json)$/.test(file);

export function aiRepairBatch1ScopeMatches(changes,baseCommit){
 if(baseCommit!==aiRepairBatch1Qualification.base)return false;
 const expected=new Map(Object.entries({...aiRepairBatch1Reviewed,...aiRepairBatch1Adapter}));
 for(const {path:file,before,status} of changes){
  if(typeof file!=='string'||before)return false;
  if(aiRepairBatch1Docs(file)&&['A','M'].includes(status))continue;
  if(expected.get(file)!==status)return false;
  expected.delete(file);
 }
 return expected.size===0;
}

export const aiRepairBatch2Qualification=Object.freeze({
 base:'0c7d0feb33f45cfc6ae1f283b81d401c873c5768',
 application:'638fd30db3e1fa670805878d060ee3894baa462d',
 applicationTree:'116000d9b258178234ac489c3b24d445815bd672',
 // Fixed application and adapter bytes, never supplied by a caller. The
 // verifier itself cannot self-pin; review it with the full payload receipt.
 reviewedBytesSha256:'69324e8df7b382016184b78ba448c50156a50dfe51e2adb952877c149f823eef',
});
export const aiRepairBatch2Reviewed=Object.freeze({
 'app/ai-dingtalk-schedules-view.tsx':'M',
 'app/ai-report-workbench-view.tsx':'M',
 'backend/ai_assistant/datasets.py':'M',
 'backend/ai_assistant/diagnostics.py':'A',
 'backend/ai_assistant/dingtalk_schedules.py':'M',
 'backend/ai_assistant/dingtalk_transport.py':'M',
 'backend/ai_assistant/pandas_diagnostics.py':'A',
 'backend/ai_assistant/pandas_sandbox.py':'M',
 'backend/ai_assistant/pi_gateway.py':'M',
 'backend/ai_assistant/provider.py':'M',
 'backend/ai_assistant/provider_responses.py':'M',
 'backend/ai_assistant/provider_stream.py':'M',
 'backend/ai_assistant/reports.py':'M',
 'backend/ai_assistant/test_dingtalk_enterprise.py':'M',
 'backend/ai_assistant/test_dingtalk_schedules.py':'M',
 'backend/ai_assistant/test_dingtalk_transport.py':'M',
 'backend/ai_assistant/test_pandas_sandbox.py':'M',
 'backend/ai_assistant/test_provider_roundtrip.py':'M',
 'backend/ai_assistant/test_report_library.py':'M',
 'backend/ai_assistant/test_schedule_monitor.py':'M',
 'backend/ai_assistant/test_schedule_storage_bounds.py':'M',
 'backend/ai_assistant/test_transport.py':'M',
 'backend/ai_assistant/test_workflow_timing.py':'A',
 'backend/ai_assistant/transport.py':'M',
 'backend/ai_assistant/workflow_timing.py':'A',
 'backend/ai_assistant/workflows.py':'M',
 'backend/netshop/query.py':'M',
 'backend/netshop/tests/test_insights_common.py':'M',
 'backend/pandas_runner/diagnostics.py':'A',
 'backend/pandas_runner/server.py':'M',
 'backend/pandas_runner/test_diagnostics.py':'A',
 'lib/ai/analysis-sandbox.ts':'M',
 'lib/ai/django-edge.ts':'M',
 'lib/ai/tool-registry.ts':'M',
 'tests/pandas-broker-rotation-native.py':'A',
 'tests/pandas-broker-rotation-ps.test.ps1':'A',
 'tests/pandas-broker-rotation-startup-fixture.py':'A',
 'tests/pandas-broker-rotation-startup-seam.test.ps1':'A',
 'tests/pandas-sandbox.test.ts':'M',
 'tests/publish-main-pandas.test.mjs':'A',
 'tests/publish-prepared-main.test.mjs':'M',
 'tools/django-ai.ps1':'M',
 'tools/django-local-service.ps1':'M',
 'tools/pandas_broker_rotation.py':'A',
 'tools/pandas_broker_rotation_linux.py':'A',
 'tools/publish-main-pandas.mjs':'A',
 'tools/publish-main-resume.mjs':'M',
 'tools/publish-main-tail.mjs':'M',
 'tools/publish-prepared-main.mjs':'M',
});
export const aiRepairBatch2Adapter=Object.freeze({
 'tools/manual-maintenance-continuation.mjs':'M',
 'tools/verify-release-candidate.mjs':'M',
 'tests/ai-repair-batch2-compatibility.test.mjs':'A',
 'tests/ai-repair-batch2-powershell-entry.ps1':'A',
 'tests/manual-maintenance-continuation.test.mjs':'M',
 'tests/release-candidate-package.test.ps1':'M',
});
const aiRepairBatch2Docs=file=>/^docs\/ai-repair-batch2-20261108\/[^/]+\.(?:md|html|json)$/.test(file)||
 ['METRICS-DIAGNOSTICS.md','PANDAS-ADOPTION-PLAN.md','REVIEW-W6A.md'].some(name=>file==='docs/ai-repair-batch1-20261107/'+name);

export function aiRepairBatch2ScopeMatches(changes,baseCommit){
 if(baseCommit!==aiRepairBatch2Qualification.base)return false;
 const expected=new Map(Object.entries({...aiRepairBatch2Reviewed,...aiRepairBatch2Adapter})),seen=new Set();
 for(const {path:file,before,status} of changes){
  if(typeof file!=='string'||before||seen.has(file))return false;
  seen.add(file);
  if(aiRepairBatch2Docs(file)&&['A','M'].includes(status))continue;
  if(expected.get(file)!==status)return false;
  expected.delete(file);
 }
 return expected.size===0;
}

export function assertAiRepairBatch1Bytes(payload){
 const digestByPath=new Map(payload.map(member=>[member.path,member.sha256]));
 const rows=Object.keys(aiRepairBatch1Reviewed).sort().map(file=>[file,digestByPath.get(file)]);
 assert.equal(sha(Buffer.from(JSON.stringify(rows))),aiRepairBatch1Qualification.reviewedBytesSha256,
  '第一批AI应用候选字节已变化，原有限资格不适用');
}

export function aiRepairBatch2BytesDigest(payload){
 const byPath=new Map(payload.map(member=>[member.path,member.sha256]));
 const statuses={...aiRepairBatch2Reviewed,...aiRepairBatch2Adapter};
 const rows=Object.keys(statuses).filter(file=>file!=='tools/verify-release-candidate.mjs').sort().map(file=>{
  const digest=byPath.get(file);
  assert.match(digest??'',/^[a-f0-9]{64}$/,'第二批审查载荷缺少 '+file);
  return [file,statuses[file],digest];
 });
 return sha(Buffer.from(JSON.stringify(rows)));
}
export function assertAiRepairBatch2Bytes(payload){
 assert.equal(aiRepairBatch2BytesDigest(payload),aiRepairBatch2Qualification.reviewedBytesSha256,
  '第二批AI应用候选字节已变化，原有限资格不适用');
}

const aiRepairBatch3Qualification=Object.freeze({
 base:'0c7d0feb33f45cfc6ae1f283b81d401c873c5768',
 application:'d9a148335ffeb6dc75328d81342d8f94e60297c5',
 tree:'963ed7b88134eb8a9770981cacb2ce884b4c6780',
});

async function reviewedAiRepairBatch3(source,baseCommit,commit){
 const q=aiRepairBatch3Qualification;
 if(baseCommit!==q.base)return null;
 try{
  if(await git(source,['rev-parse',q.application+'^{tree}'])!==q.tree)return null;
  await git(source,['merge-base','--is-ancestor',q.application,commit]);
 }catch{return null;}
 const delta=(await git(source,['diff','--name-status','--no-renames','-z',q.application,commit])).split('\0').filter(Boolean);
 let verifierChanged=false;
 for(let i=0;i<delta.length;i+=2){
  const [status,file]=[delta[i],delta[i+1]];
  if(status==='M'&&file==='tools/verify-release-candidate.mjs'){verifierChanged=true;continue;}
  if(!['A','M'].includes(status)||!/^docs\/ai-repair-batch3-20261108\/[^/]+\.(?:md|html|json)$/.test(file??''))return null;
 }
 return verifierChanged?q:null;
}

export const aiRepairIntegrationQualification=Object.freeze({
 base:'0c7d0feb33f45cfc6ae1f283b81d401c873c5768',
 application:'557b497dc0fe42f3693a0c6c76320a4833b46b49',
 tree:'277573157b4c0e4c41e72a329351639ac6cc80c3',
 test:'tests/ai-repair-integration-compatibility.test.mjs',
 testSha256:'ea207d31f2ddc51788cd1fe954c30719a1a3bf1a86175e9b41a96f15edd9c9cd',
});

export function aiRepairIntegrationScopeMatches(records,baseCommit){
 const q=aiRepairIntegrationQualification,seen=new Set();
 if(baseCommit!==q.base||records.length%2)return false;
 for(let i=0;i<records.length;i+=2){
  const [entry,file]=[records[i],records[i+1]];
  const match=/^:(000000|100644) 100644 [a-f0-9]{40} [a-f0-9]{40} ([AM])$/.exec(entry);
  if(!match||(match[1]==='000000')!==(match[2]==='A')||seen.has(file))return false;
  seen.add(file);
  if(file==='tools/verify-release-candidate.mjs'&&match[2]==='M')continue;
  if(file===q.test&&match[2]==='A')continue;
  if(file==='docs/任务记录/README.md')continue;
  if(!/^docs\/ai-repair-integration-20261108\/[^/]+\.(?:md|html|json)$/.test(file))return false;
 }
 return seen.has(q.test)&&seen.has('tools/verify-release-candidate.mjs');
}

async function reviewedAiRepairIntegration(source,baseCommit,commit){
 const q=aiRepairIntegrationQualification;
 if(baseCommit!==q.base)return null;
 try{
  if(await git(source,['rev-parse',q.application+'^{tree}'])!==q.tree)return null;
  await git(source,['merge-base','--is-ancestor',q.application,commit]);
 }catch{return null;}
 const delta=(await git(source,['diff','--raw','--no-abbrev','--no-renames','-z',q.application,commit])).split('\0');
 assert.equal(delta.pop(),'','组合候选Git差异未正确终止');
 return aiRepairIntegrationScopeMatches(delta,baseCommit)?q:null;
}

export function candidateCompatibilityProfile(changes,{baseCommit}={}){
 const files=changes.flatMap(c=>[c.before,c.path].filter(Boolean));
 const paths=files.filter(f=>!f.startsWith('docs/')&&!f.startsWith('tests/')&&!['README.md','AGENTS.md'].includes(f));
 if(aiRepairBatch1ScopeMatches(changes,baseCommit))return {
  version:'ai-repair-batch1-compatibility-v1',aiRepairBatch1Only:true,paths,unsupported:[],
  worker:true,django:true,publication:true,nativeColdStartPerformed:false,
 };
 if(aiRepairBatch2ScopeMatches(changes,baseCommit))return {
  version:'ai-repair-batch2-compatibility-v1',aiRepairBatch2Only:true,paths,unsupported:[],
  worker:true,django:true,publication:true,nativeColdStartPerformed:false,
 };
 if(files.some(file=>['tools/publish-main-pandas.mjs','tools/pandas_broker_rotation.py','tools/pandas_broker_rotation_linux.py'].includes(file)))
  return {paths,unsupported:['第二批Pandas轮换需要完整精确差异与固定前驱']};
 const readinessAllowed=new Set([...readinessStabilityFiles,'tools/verify-release-candidate.mjs']);
 const readinessStabilityOnly=readinessStabilityFiles.every(p=>paths.includes(p))
  &&paths.includes('tools/verify-release-candidate.mjs')&&paths.every(p=>readinessAllowed.has(p));
 const piResumeFiles=['tools/publish-main-resume.mjs','tools/publish-main-status.mjs','tools/publish-main-step.mjs','tools/publish-main-tail.mjs','tools/publish-main-owner.mjs','tools/publish-main-pi-reconciliation.mjs','tools/pi_agent_upgrade_status.py','tools/publish-prepared-main.mjs','tools/worker-local-release.mjs','tools/django-ai.ps1','tools/django-local-service.ps1','tools/verify-release-candidate.mjs'];
 const piMainResumeOnly=paths.includes('tools/publish-main-resume.mjs')&&paths.includes('tools/pi_agent_upgrade_status.py')&&paths.every(p=>piResumeFiles.includes(p));
 const proofFiles=['bi_app_addition','jackyun_audit_addition','ai_schedule_addition','jd_logistics_addition','jd_monitor_preferences_addition','jd_product_monitoring_addition','tmall_warehouse_addition','pi_agent_addition'].map(name=>'tools/'+name+'.py');
 const preparationFiles=['tools/main-prebuild-task.mjs','tools/main-prebuild-hook.mjs','tools/main-prebuild-queue.mjs','tools/main-control-dispatch.mjs','tools/install-main-prebuild.mjs','tools/manual-maintenance-continuation.mjs','tools/manual-maintenance-continuation.ps1','tools/manual-maintenance-start.ps1','tools/manual-maintenance-process.psm1','tools/manual-maintenance-preflight.ps1','tools/frozen-main-source.mjs'];
 const supported=new Set(['tools/publish-main.mjs','tools/publish-prepared-main.mjs','tools/publish-latest-main.mjs',
  'tools/main-prebuild-status.mjs','tools/worker-local-release.mjs','tools/django-local-service.ps1','tools/django-ai.ps1','tools/verify-release-candidate.mjs']);
 for(const file of [...proofFiles,...preparationFiles,'tools/worker-local-release-rotation.mjs','tools/pi_workspace_addition.py','config/main-schema-releases/ai-0085.json'])supported.add(file);
 for(const file of ['tools/main-schema-release.mjs','tools/schema-rejection-observer.mjs','tools/schema-rejection-writer.mjs','tools/cache-rejection-observer.mjs','tools/cache-rejection-writer.mjs','tools/native-abandonment-observer.mjs','tools/native-abandonment-writer.mjs','tools/cleaned-preparation-observer.mjs','tools/cleaned-preparation-writer.mjs'])supported.add(file);
 if(piMainResumeOnly)for(const file of piResumeFiles)supported.add(file);
 const contentionFiles=['tools/django-workflow-service.ps1','tools/manual-maintenance-lock.psm1','tools/publish-main-progress.mjs'];
 const contentionAllowed=new Set([...contentionFiles,'tools/manual-maintenance-start.ps1','tools/frozen-main-source.mjs','tools/publish-prepared-main.mjs','tools/verify-release-candidate.mjs','config/main-schema-releases/ai-0086.json']);
 const releaseContentionOnly=paths.some(p=>contentionFiles.includes(p))&&paths.every(p=>contentionAllowed.has(p));
 const weeklyReleaseLeaseOnly=releaseContentionOnly&&paths.includes('tools/django-workflow-service.ps1')&&paths.includes('tools/publish-prepared-main.mjs')&&paths.every(p=>['tools/django-workflow-service.ps1','tools/publish-prepared-main.mjs','tools/verify-release-candidate.mjs'].includes(p));
 if(releaseContentionOnly)for(const file of contentionAllowed)supported.add(file);
 // B 项: worker-local-service.ps1 is the only application-side file; the two
 // verifier/readiness files may travel with it because the qualification lives
 // there (same shape as Q14 / A 项). This file is NOT unconditionally in
 // `supported`: it is a lifecycle controller (the single startup engine) with no
 // regular AST-level coverage, so admitting it only under this exact flag keeps
 // every other change to it failing closed.
 const workerJsonFailureCauseOnly=paths.includes('tools/worker-local-service.ps1')&&paths.every(p=>['tools/worker-local-service.ps1','tools/verify-release-candidate.mjs','tools/manual-maintenance-continuation.mjs'].includes(p));
 if(workerJsonFailureCauseOnly)supported.add('tools/worker-local-service.ps1');
 // C 项 (2026-10-26): preparation-producer-qualification.mjs is the closures
 // list that pins the three producer files byte for byte. S16 appends a second
 // closure for the log-only preparation stage timing in
 // worker-local-release-rotation.mjs, so the list itself must change bytes and
 // would otherwise land in `unsupported`. It is NOT unconditionally supported:
 // the only test that exercises the closure decision
 // (tests/preparation-resolution.test.mjs) is run by no check here, so putting
 // the list in `supported` outright would leave every later edit to it with no
 // automated coverage at all. Admitting it only under this exact flag keeps any
 // other change to the list failing closed. verify-release-candidate.mjs is a
 // member because the qualification lives here and it is already
 // unconditionally supported (same shape as Q14 / A 项 / B 项).
 const preparationProducerQualifyOnly=paths.includes('tools/preparation-producer-qualification.mjs')&&paths.every(p=>['tools/preparation-producer-qualification.mjs','tools/worker-local-release-rotation.mjs','tools/verify-release-candidate.mjs'].includes(p));
 if(preparationProducerQualifyOnly)supported.add('tools/preparation-producer-qualification.mjs');
 // C 项第三步修复 (2026-10-27): publish-main-tail.mjs is where a regular
 // publication actually runs apply, so the apply-window timing receipt has to be
 // written there. The file is NOT unconditionally supported: it is the shared
 // publication tail (apply, maintenance exit, service start, startup
 // verification) and admitting it outright would leave every later edit to that
 // sequence with no narrow gate at all. The tightening is
 // `includes(tail) && includes(verifier)`, NOT includes(latest-main): the parser
 // in publish-latest-main.mjs is reused byte for byte, so that file never enters
 // the diff and requiring it would make this flag unreachable. Requiring the
 // verifier instead means touching the landing point always leaves a registered
 // trace here (same shape as Q14 / A 项 / B 项). publish-latest-main.mjs stays a
 // member so the parser could later travel with the tail without failing closed;
 // `every()` only forbids outsiders, it does not require members to be present.
 const applyTimingReceiptFiles=['tools/publish-main-tail.mjs','tools/publish-latest-main.mjs','tools/verify-release-candidate.mjs'];
 const applyTimingReceiptOnly=paths.includes('tools/publish-main-tail.mjs')
  &&paths.includes('tools/verify-release-candidate.mjs')
  &&paths.every(p=>applyTimingReceiptFiles.includes(p));
 if(applyTimingReceiptOnly)supported.add('tools/publish-main-tail.mjs');
 if(readinessStabilityOnly)for(const file of readinessAllowed)supported.add(file);
 const unsupported=paths.filter(p=>!supported.has(p));
 // Q14: django-ai.ps1 is the only application-side file; the two verifier/readiness
 // files may travel with it because the qualification lives there.
 const dingtalkScreenshotAclOnly=paths.includes('tools/django-ai.ps1')&&paths.every(p=>['tools/django-ai.ps1','tools/verify-release-candidate.mjs','tools/manual-maintenance-continuation.mjs'].includes(p));
 // A 项: django-local-service.ps1 is the only application-side file; the two
 // verifier/readiness files may travel with it because the qualification lives
 // there (same shape as Q14's dingtalkScreenshotAclOnly).
 const descendantCreationGuardOnly=paths.includes('tools/django-local-service.ps1')&&paths.every(p=>['tools/django-local-service.ps1','tools/verify-release-candidate.mjs','tools/manual-maintenance-continuation.mjs'].includes(p));
 const schemaProof=paths.some(p=>proofFiles.includes(p)),preparationQueue=paths.some(p=>preparationFiles.includes(p)||p==='tools/publish-latest-main.mjs'||p==='tools/worker-local-release-rotation.mjs');
 return {version:readinessStabilityOnly?'readiness-stability-v1':schemaProof||preparationQueue?'release-three-optimizations-v1':'release-compatibility-profile-v1',paths,unsupported,schemaProof,preparationQueue,releaseContentionOnly,weeklyReleaseLeaseOnly,piMainResumeOnly,readinessStabilityOnly,
  nativeAbandonmentOnly:paths.includes('tools/main-prebuild-queue.mjs')&&paths.every(p=>['tools/main-prebuild-queue.mjs','tools/native-abandonment-observer.mjs','tools/native-abandonment-writer.mjs','tools/verify-release-candidate.mjs'].includes(p)),
  cleanedPreparationOnly:paths.includes('tools/main-prebuild-queue.mjs')&&paths.some(p=>p.startsWith('tools/cleaned-preparation-'))&&paths.every(p=>['tools/main-prebuild-queue.mjs','tools/cleaned-preparation-observer.mjs','tools/cleaned-preparation-writer.mjs','tools/verify-release-candidate.mjs'].includes(p)),
  releaseChainPreflight:paths.some(p=>p==='tools/manual-maintenance-process.psm1'||p==='tools/frozen-main-source.mjs')&&paths.every(p=>['tools/manual-maintenance-process.psm1','tools/manual-maintenance-preflight.ps1','tools/frozen-main-source.mjs','tools/manual-maintenance-continuation.mjs','tools/manual-maintenance-continuation.ps1','tools/manual-maintenance-start.ps1','tools/publish-main.mjs','tools/publish-prepared-main.mjs','tools/publish-latest-main.mjs','tools/verify-release-candidate.mjs','tools/install-main-prebuild.mjs','tools/django-local-service.ps1','tools/pi_workspace_addition.py','config/main-schema-releases/ai-0085.json'].includes(p)),
  schemaAdmissionOnly:paths.includes('tools/main-schema-release.mjs')&&paths.includes('tools/main-prebuild-queue.mjs')&&paths.every(p=>['tools/main-schema-release.mjs','tools/main-prebuild-queue.mjs','tools/publish-latest-main.mjs','tools/schema-rejection-observer.mjs','tools/schema-rejection-writer.mjs','tools/verify-release-candidate.mjs','config/main-schema-releases/ai-0085.json'].includes(p)),
  publication:paths.some(p=>/publish-|main-prebuild|manual-maintenance|verify-release-candidate|release-scope-plan/.test(p)),
  worker:readinessStabilityOnly||paths.some(p=>/worker-local-release/.test(p)),
  django:paths.includes('tools/django-local-service.ps1'),
  piExitObservation:paths.includes('tools/django-ai.ps1')&&!piMainResumeOnly&&!dingtalkScreenshotAclOnly,
  dingtalkScreenshotAclOnly,
  descendantCreationGuardOnly,
  workerJsonFailureCauseOnly,
  preparationProducerQualifyOnly,
  // Independent reading of the decision above, not a second copy of it. This
  // gate's criterion is indirect — it checks that the verifier travels with the
  // tail, not that the landing point is still correct — so a bare true/false
  // hides two silent failures: the verifier changing for some unrelated reason,
  // and the tail's receipt being moved away again (exactly the defect this
  // change repairs). Reporting the files that actually took part lets REPORT.json
  // be cross-checked against the boolean instead of trusted blindly; the project
  // has already had one gate fail silently behind a single unverified number.
  applyTimingReceiptPaths:paths.filter(p=>applyTimingReceiptFiles.includes(p)),
  applyTimingReceiptOnly,
  nativeColdStartPerformed:false};
}

export async function assertPrivateCandidateLocation(target){
 const absolute=path.resolve(target);
 for(const root of productionRoots)assert.ok(!within(root,absolute),'候选验证不能使用生产根目录：'+absolute);
 // Refuse a path that becomes a different directory through a junction.
 let cursor=absolute;
 for(;;){
  try{assert.equal((await fs.lstat(cursor)).isSymbolicLink(),false,'候选路径不能经过重解析点：'+cursor);}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
 }
 return absolute;
}

async function functionsOf(script,host,environment){
 const code='$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($env:TERUISI_CANDIDATE_PARSE_FILE,[ref]$null,[ref]$e);if($e.Count){throw "parse failed"};$functions=@($a.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{[pscustomobject]@{name=$_.Name;text=$_.Extent.Text}});$other=@([string]$a.ParamBlock.Extent.Text)+@($a.EndBlock.Statements|Where-Object{$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{$_.Extent.Text});[pscustomobject]@{functions=$functions;other=$other}|ConvertTo-Json -Depth 4 -Compress';
 const result=await execute(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',env:{...environment,TERUISI_CANDIDATE_PARSE_FILE:script},windowsHide:true,maxBuffer:8*1024*1024});
 return JSON.parse(result.stdout);
}
/** Same projection as functionsOf, but lossless: the file is decoded as strict UTF-8
 * (BOM tolerated) and parsed from that string on every host, and each text travels as
 * base64 UTF-8, so a pinned SHA-256 of a function that contains non-ASCII text (Chinese
 * messages) is independent of the console code page and of the PowerShell edition. */
export async function functionsOfExact(script,host,environment){
 const code='$e=$null;$text=[IO.File]::ReadAllText($env:TERUISI_CANDIDATE_PARSE_FILE,[Text.UTF8Encoding]::new($false,$true));$a=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$null,[ref]$e);if($e.Count){throw "parse failed"};$enc={param($s)[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$s))};$functions=@($a.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{[pscustomobject]@{name=$_.Name;text=(& $enc $_.Extent.Text)}});$other=@(& $enc $a.ParamBlock.Extent.Text)+@($a.EndBlock.Statements|Where-Object{$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{& $enc $_.Extent.Text});[pscustomobject]@{functions=$functions;other=$other}|ConvertTo-Json -Depth 4 -Compress';
 const result=await execute(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',env:{...environment,TERUISI_CANDIDATE_PARSE_FILE:script},windowsHide:true,maxBuffer:8*1024*1024});
 const decode=value=>Buffer.from(value,'base64').toString('utf8'),parsed=JSON.parse(result.stdout);
 return {functions:[].concat(parsed.functions).map(f=>({name:f.name,text:decode(f.text)})),other:[].concat(parsed.other).map(decode)};
}
export function compareFunctionOnlyChange(before,after){
 const allowed=new Set(['Get-FileSha256','Get-ExistingFileSha256','Get-ApplicationTreeFingerprintEvidence']);
 const normalize=text=>text.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)]));
 const next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 for(const name of new Set([...old.keys(),...next.keys()]))if(old.get(name)!==next.get(name)&&!allowed.has(name)){
  if(name==='Prepare-Application'&&stripMaintenancePackageEntries(next.get(name))===old.get(name))continue;
  if(name!=='Invoke-DjangoMigrations'||stripGateTiming(next.get(name))!==old.get(name))return false;
 }
 return true;
}
export function stripMaintenancePackageEntries(text){
 const entries='      "tools\\manual-maintenance-process.psm1",\n      "tools\\manual-maintenance-preflight.ps1",\n      "tools\\frozen-main-source.mjs",\n';
 if(typeof text!=='string'||text.split(entries).length!==2)return null;
 return text.replace(entries,'');
}
export function compareMaintenanceInventoryOnly(before,after){
 const normalize=value=>value.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 return next.size===before.functions.length&&before.functions.every(f=>f.name==='Prepare-Application'?stripMaintenancePackageEntries(next.get(f.name))===normalize(f.text):next.get(f.name)===normalize(f.text));
}
export const piResumePackageEntries=['pi_agent_upgrade_status.py','publish-main-step.mjs','publish-main-pi-reconciliation.mjs','publish-main-owner.mjs','publish-main-tail.mjs','main-prebuild-task.mjs'];
export const pandasRotationPackageEntries=Object.freeze(['pandas_broker_rotation.py','pandas_broker_rotation_linux.py','publish-main-pandas.mjs']);
export function comparePandasRotationInventoryOnly(before,after){
 const eol=before.includes('\r\n')?'\r\n':'\n';
 let stripped=after;
 for(const name of pandasRotationPackageEntries){
  const line='      "tools\\'+name+'",'+eol;
  if(stripped.split(line).length!==2)return false;
  stripped=stripped.replace(line,'');
 }
 return stripped===before;
}
export function comparePiResumeInventoryOnly(before,after){
 const normalize=value=>value.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(next.size!==before.functions.length)return false;
 return before.functions.every(f=>{
  let text=next.get(f.name);if(typeof text!=='string')return false;
  if(f.name==='Prepare-Application')for(const name of piResumePackageEntries){const line='      "tools\\'+name+'",\n';if(text.split(line).length!==2)return false;text=text.replace(line,'');}
  return text===normalize(f.text);
 });
}
export function comparePiUpgradeObservationOnly(before,after){
 const normalize=value=>value.replaceAll('\r\n','\n');
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)])),next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(next.size!==old.size+1||old.has('Get-PiUpgradeStatus')||!next.has('Get-PiUpgradeStatus'))return false;
 if(sha(Buffer.from(next.get('Get-PiUpgradeStatus')))!=='8723f11061f9ad6a048f43adf4f03f70ad8d3adf1e1cf6f68ffbcf6922dd39aa')return false;
 for(const [name,text]of old)if(next.get(name)!==text)return false;
 const revert=text=>normalize(text).replace('"PiUpgradeStatus", "VerifyPiUpgradeResult", ','').replace('    "PiUpgradeStatus" { Invoke-WithServiceMutex { Get-PiUpgradeStatus } }\n','').replace('    "VerifyPiUpgradeResult" { Invoke-WithServiceMutex { Get-PiUpgradeStatus $true } }\n','');
 return JSON.stringify(before.other.map(normalize))===JSON.stringify(after.other.map(revert));
}
export function usesGateTimingExemption(before,after){
 const find=value=>value.functions.find(item=>item.name==='Invoke-DjangoMigrations')?.text.replaceAll('\r\n','\n');
 const old=find(before),next=find(after);return typeof old==='string'&&typeof next==='string'&&old!==next&&stripGateTiming(next)===old;
}
export function comparePiExitObservationChange(before,after){
 const normalize=text=>text.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)])),next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(old.has('Wait-PiWorkerExit')||!next.has('Wait-PiWorkerExit')||sha(Buffer.from(next.get('Wait-PiWorkerExit')))!=='4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3')return false;
 const addition=`  $receiptSha256 = if (Test-Path -LiteralPath $PiWorkerPidPath -PathType Leaf) { Get-FileSha256 $PiWorkerPidPath } else { $null }\n`;
 const pin=`    if ((Get-FileSha256 $PiWorkerPidPath) -cne $receiptSha256) { throw "Pi worker ownership record changed before stop" }\n`;
 const observer='    Wait-PiWorkerExit $owned $receiptSha256 (Get-FileSha256 $PiWorkerControlPath) $deadline';
 const prior=`    while (Resolve-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python) {
      if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "Pi queue stop remains unknown; writer and runner were preserved" }
      Start-Sleep -Milliseconds 250
    }`;
 const stop=next.get('Stop-PiRuntime');
 if(!stop?.includes(addition)||!stop.includes(pin)||!stop.includes(observer))return false;
 next.set('Stop-PiRuntime',stop.replace(addition,'').replace(pin,'').replace(observer,prior));next.delete('Wait-PiWorkerExit');
 return old.size===next.size&&[...old].every(([name,text])=>next.get(name)===text);
}
/** Q14 (2026-10-25): DingTalk screenshot ACL tolerance. Syntax-tree proof, on the
 * parsed functions/top-level statements of tools/django-ai.ps1, that the candidate
 * differs from the base only by (1) Assert-DingTalkScreenshotProfile whose old and
 * new text are pinned by SHA-256 and (2) one added Test-AppContainerReadOnlyAce
 * whose text is pinned. Every other function, the parameter block, every top-level
 * statement and the order of the existing functions must be byte-identical, so
 * Wait-PiWorkerExit / Stop-PiRuntime and all Start/Stop routing are unchanged. */
export function compareDingTalkScreenshotAclChange(before,after,qualification=dingtalkScreenshotAclQualification){
 const assertName='Assert-DingTalkScreenshotProfile',helperName='Test-AppContainerReadOnlyAce';
 const normalize=text=>text.replaceAll('\r\n','\n');
 const digest=text=>sha(Buffer.from(text));
 if(!Array.isArray(before?.functions)||!Array.isArray(after?.functions)||!Array.isArray(before.other)||!Array.isArray(after.other))return false;
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)])),next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(old.size!==before.functions.length||next.size!==after.functions.length)return false;
 if(!old.has(assertName)||old.has(helperName)||!next.has(assertName)||!next.has(helperName)||next.size!==old.size+1)return false;
 if(digest(old.get(assertName))!==qualification.assertProfileBeforeSha256||digest(next.get(assertName))!==qualification.assertProfileAfterSha256||digest(next.get(helperName))!==qualification.appContainerAceSha256)return false;
 for(const [name,text] of old)if(name!==assertName&&next.get(name)!==text)return false;
 return JSON.stringify(before.functions.map(f=>f.name))===JSON.stringify(after.functions.map(f=>f.name).filter(name=>name!==helperName));
}
/** A 项 (2026-10-25): syntax-tree proof, on the parsed functions/top-level
 * statements of tools/django-local-service.ps1, that the candidate differs
 * from the base only by Get-VerifiedProcessDescendants (old and new text
 * pinned by SHA-256). Unlike Q14 this adds no function: the guard is two new
 * lines inside the existing function body. Every other function, the
 * parameter block, every top-level statement, the function count and the
 * order of all functions must be byte-identical, so Stop-VerifiedProcessTree
 * and the rest of the stop protocol stay untouched. */
export function compareDescendantCreationGuardChange(before,after,qualification=descendantCreationGuardQualification){
 const guardedName='Get-VerifiedProcessDescendants';
 const normalize=text=>text.replaceAll('\r\n','\n');
 const digest=text=>sha(Buffer.from(text));
 if(!Array.isArray(before?.functions)||!Array.isArray(after?.functions)||!Array.isArray(before.other)||!Array.isArray(after.other))return false;
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 if(before.functions.length!==after.functions.length)return false;
 if(JSON.stringify(before.functions.map(f=>f.name))!==JSON.stringify(after.functions.map(f=>f.name)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)])),next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(!old.has(guardedName)||!next.has(guardedName))return false;
 if(digest(old.get(guardedName))!==qualification.beforeSha256||digest(next.get(guardedName))!==qualification.afterSha256)return false;
 for(const [name,text] of old)if(name!==guardedName&&next.get(name)!==text)return false;
 return true;
}
/** B 项 (2026-10-25): syntax-tree proof, on the parsed functions/top-level
 * statements of tools/worker-local-service.ps1, that the candidate differs from
 * the base only by one top-level statement whose old and new text are pinned by
 * SHA-256. Unlike every other comparator here, `other` is NOT required to be
 * identical — this is the only shape that can cover a change in a top-level
 * try/catch. In exchange the proof is strict on everything else: the function
 * count, the function name order and every function's text must be byte-
 * identical, `other` must keep the same length, and exactly one of its elements
 * may differ — that one, located by hash rather than by index, must match the
 * registered pair. */
export function compareWorkerJsonFailureCauseChange(before,after,qualification=workerJsonFailureCauseQualification){
 const normalize=text=>text.replaceAll('\r\n','\n');
 const digest=text=>sha(Buffer.from(text));
 if(!Array.isArray(before?.functions)||!Array.isArray(after?.functions)||!Array.isArray(before.other)||!Array.isArray(after.other))return false;
 // B 项 touches no function at all: count, name order and every text must match.
 if(before.functions.length!==after.functions.length)return false;
 if(JSON.stringify(before.functions.map(f=>f.name))!==JSON.stringify(after.functions.map(f=>f.name)))return false;
 for(let i=0;i<before.functions.length;i++)if(normalize(before.functions[i].text)!==normalize(after.functions[i].text))return false;
 // exactly one top-level statement may differ, and only the registered pair.
 if(before.other.length!==after.other.length)return false;
 const differing=[];
 for(let i=0;i<before.other.length;i++){
  const old=normalize(before.other[i]),next=normalize(after.other[i]);
  if(old!==next)differing.push([old,next]);
 }
 if(differing.length!==1)return false;
 const [old,next]=differing[0];
 return digest(old)===qualification.otherBeforeSha256&&digest(next)===qualification.otherAfterSha256;
}
export function stripGateTiming(text){
 if(typeof text!=='string')return text;
 const release=`  $protectedGateClock = [Diagnostics.Stopwatch]::StartNew()
  $protectedGateAt = [DateTimeOffset]::UtcNow.ToString('o')
  $protectedGateOutcome = 'completed'
  try {
    Assert-NoUnapprovedProtectedAiMigration "Django migrate"
  } catch {
    $protectedGateOutcome = 'failed'
    throw
  } finally {
    try { Write-DjangoStartupTiming 'protected-release-gate' $protectedGateAt $protectedGateClock.ElapsedMilliseconds $protectedGateOutcome } catch { }
  }`;
 const database=`      $databaseGateClock = [Diagnostics.Stopwatch]::StartNew()
      $databaseGateAt = [DateTimeOffset]::UtcNow.ToString('o')
      $databaseGateOutcome = 'completed'
      try {
        $check = Invoke-BoundedNativeProcess $Python @($integrationGate, 'database', '--root', $ExecutionRoot, '--runtime', $RuntimeRoot) $BackendRoot
        $verified = ConvertFrom-UniqueNativeJson $check 'Verify completed integration migrations'
        if ([string]$verified.status -cne 'verified') { throw 'Protected migration plan is incomplete' }
      } catch {
        $databaseGateOutcome = 'failed'
        throw
      } finally {
        try { Write-DjangoStartupTiming 'database-complete-gate' $databaseGateAt $databaseGateClock.ElapsedMilliseconds $databaseGateOutcome } catch { }
      }`;
 if(!text.includes(release)||!text.includes(database))return null;
 return text.replace(release,'  Assert-NoUnapprovedProtectedAiMigration "Django migrate"').replace(database,`      $check = Invoke-BoundedNativeProcess $Python @($integrationGate, 'database', '--root', $ExecutionRoot, '--runtime', $RuntimeRoot) $BackendRoot
      $verified = ConvertFrom-UniqueNativeJson $check 'Verify completed integration migrations'
      if ([string]$verified.status -cne 'verified') { throw 'Protected migration plan is incomplete' }`);
}

export function compareFixedAdminQueueChange(before,after){
 before=before.replaceAll('\r\n','\n');after=after.replaceAll('\r\n','\n');
 const begin='\n// FIXED_ADMIN_E2_BEGIN\n',end='// FIXED_ADMIN_E2_END\n';
 const start=after.indexOf(begin),stop=after.indexOf(end,start);
 if(start<0||stop<0||before.includes(begin)||after.indexOf(begin,start+1)!==-1)return false;
 const block=after.slice(start,stop+end.length);
 if(sha(Buffer.from(block))!=='942bfda5342275eb27b57c77512720cf11c3ab07e7aaac53a8c5e3559486d563')return false;
 const changed="      if(!terminal||['unknown','failed','blocked'].includes(terminal.status)){\n       if(!terminal||!await readFixedAdminRejectionResolution(directory,dispatch,terminal))unresolved={dispatch,sha256:read.sha256};\n      }";
 const original="      if(!terminal||['unknown','failed','blocked'].includes(terminal.status))unresolved={dispatch,sha256:read.sha256};";
 let remainder=after.slice(0,start)+after.slice(stop+end.length);
 const replacements=[
  [changed,original],
  ["  const admissionBlocked=value.status==='blocked'&&value.admission==='ordinary-user-before-dispatch-v1';\n",''],
  ["const extra=admissionBlocked?['admission','error']:value.status",'const extra=value.status'],
  ["  if(admissionBlocked){\n   assert.equal(typeof value.error,'string');\n   for(const name of await entries(directory,'dispatches')){const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);assert.ok(!read.value.tickets.some(ref=>ref.requestId===requestId),'A dispatched ticket cannot become a pre-dispatch admission rejection');}\n   return value;\n  }\n",''],
  ["   assert.equal(prior.sha256,value.blockedDispatchSha256);\n   return value;","   assert.equal(prior.sha256,value.blockedDispatchSha256);assert.equal(prior.value.configSha256,value.configSha256);assert.equal(prior.value.bundleSha256,value.bundleSha256);return value;"],
  ['onStage=async()=>{},admitPreparation=async()=>{}})','onStage=async()=>{}})'],
  ["    try{await admitPreparation();}\n    catch(error){for(const item of pending)await finish(item,'blocked',{admission:'ordinary-user-before-dispatch-v1',error:String(error.message)});break;}\n",''],
 ];
 for(const [next,prior] of replacements){if(!remainder.includes(next))return false;remainder=remainder.replace(next,prior);}
 return remainder===before;
}
export function compareFixedPreparationAdmissionChange(before,after){
 before=before.replaceAll('\r\n','\n');after=after.replaceAll('\r\n','\n');
 const begin='// PREPARATION_ELIGIBILITY_BEGIN\n',end='// PREPARATION_ELIGIBILITY_END\n',start=after.indexOf(begin),stop=after.indexOf(end,start);
 if(start<0||stop<0||before.includes(begin)||after.indexOf(begin,start+1)!==-1)return false;
 if(sha(Buffer.from(after.slice(start,stop+end.length)))!=='8d095e2413bfac310803273f4e1b44bc6b8899a68897b12c7f52bf9118dac2cd')return false;
 const core=after.slice(0,start)+after.slice(stop+end.length),signature='assertGeneration=assertControlGeneration,admit=assertOrdinaryPreparationContext}={})',callback='admitPreparation:()=>admit(config),';
 if(!core.includes(signature)||!core.includes(callback))return false;
 return core.replace(signature,'assertGeneration=assertControlGeneration}={})').replace(callback,'')===before;
}

export async function verifyReleaseCandidate({sourceRoot,base,head='HEAD',out,dependencies,python='python.exe',reuseReport,reusePreflightReport}={}){
 const source=await assertPrivateCandidateLocation(sourceRoot??process.cwd());
 const verifierRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 assert.equal((await fs.realpath(source)).toLowerCase(),(await fs.realpath(verifierRoot)).toLowerCase(),'验证器必须来自被验证候选，不能使用其他工作树的旧工具');
 assert.ok(base,'必须指定 --base，不能省略前驱差异');
 assert.equal(await git(source,['status','--porcelain']),'','候选存在未提交修改；先冻结候选提交再验证');
 const commit=await git(source,['rev-parse',head+'^{commit}']);
 assert.equal(await git(source,['rev-parse','HEAD']),commit,'候选必须是当前干净HEAD');
 const baseCommit=await git(source,['rev-parse',base+'^{commit}']);
 await git(source,['merge-base','--is-ancestor',baseCommit,commit]);
 const tree=await git(source,['rev-parse','HEAD^{tree}']);
 const directory=await assertPrivateCandidateLocation(out??path.join(os.tmpdir(),'release-candidate-'+randomUUID()));
 assert.ok(!within(source,directory),'验证输出必须在候选工作树之外');
 await fs.mkdir(directory,{recursive:false});
 const plan=makeReleasePlan({base:baseCommit,head:commit,cwd:source});
 const integration=await reviewedAiRepairIntegration(source,baseCommit,commit);
 const batch3=integration?null:await reviewedAiRepairBatch3(source,baseCommit,commit);
 const profile=integration?{
  version:'ai-repair-integration-compatibility-v1',qualification:integration,
  paths:plan.changes.map(change=>change.path),unsupported:[],
  worker:true,django:true,publication:true,
 }:batch3?{
  version:'ai-repair-batch3-application-compatibility-v1',qualification:batch3,
  paths:plan.changes.map(change=>change.path),unsupported:[],
  worker:true,django:true,publication:false,nativeColdStartPerformed:false,
 }:candidateCompatibilityProfile(plan.changes,{baseCommit});
 const aiRepairBatch2Only=profile.aiRepairBatch2Only===true;
 const nativeAbandonmentOnly=profile.nativeAbandonmentOnly;
 const cleanedPreparationOnly=profile.cleanedPreparationOnly;
 if(cleanedPreparationOnly){
  const old=(await execute('git',['-C',source,'show',baseCommit+':tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout,next=await fs.readFile(path.join(source,'tools/main-prebuild-queue.mjs'),'utf8'),marker='// FIXED_CLEANED_4AAC_BEGIN';assert.equal(next.split(marker).length,2);assert.ok(next.trimEnd().endsWith('// FIXED_CLEANED_4AAC_END'));
  const core=next.slice(0,next.indexOf(marker)).trimEnd()+'\n';assert.equal(core.replace('&&!await readFixedCleanedPreparationResolution(directory,dispatch,terminal)','').replace(';assertFixedCleanedNoReplay(directory,selection);',';').replace('deadlineUnixMs:Date.now()+60*60*1000','deadlineUnixMs:Date.now()+30*60*1000'),old,'Only fixed 4aac seams and the new-dispatch budget may change');
 }
 if(nativeAbandonmentOnly){
  const old=(await execute('git',['-C',source,'show',baseCommit+':tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  const next=await fs.readFile(path.join(source,'tools/main-prebuild-queue.mjs'),'utf8'),marker='// FIXED_NATIVE_693E_BEGIN';assert.equal(next.split(marker).length,2);assert.ok(next.trimEnd().endsWith('// FIXED_NATIVE_693E_END'));
  const stripCore=text=>(text.includes(marker)?text.slice(0,text.indexOf(marker)).trimEnd()+'\n':text).replace('&&!await readFixedNativeAbandonmentResolution(directory,dispatch,terminal)','').replace(';assertFixedNativeNoReplay(directory,selection);',';');assert.equal(stripCore(next),stripCore(old),'Only the fixed native abandonment reader and original queue blocking/admission seams are permitted');
 }
 let schemaAdmissionOnly=false,preflightBaseline;
 if(reusePreflightReport){
  assert.equal(baseCommit,'a7041338462acb766a50df376777c619557ea4eb');assert.equal(profile.schemaAdmissionOnly,true,'增量超出有限schema admission/ece恢复接缝');
  const raw=await fs.readFile(reusePreflightReport);assert.equal(sha(raw),'94251c24d5ecd43b535b975fb2de7ea023c3930522ce07f3a4cd5274f1cafdbb');const baseline=JSON.parse(raw);assert.equal(baseline.status,'passed');assert.equal(baseline.commit,'2d9d1d9c8395f8ec44d0003d5c44905bcfa09490');assert.equal(baseline.evidence.packageIntegrity,true);assert.equal(baseline.evidence.nativeEntryBoundary,true);
  const before=async name=>(await execute('git',['-C',source,'show',baseCommit+':'+name],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  const oldSchema=await before('tools/main-schema-release.mjs'),nextSchema=await fs.readFile(path.join(source,'tools/main-schema-release.mjs'),'utf8'),addition='/** Pure installed-control capability check, before a preparation dispatch. */\nexport function assertMainSchemaPlanSupported(plan){return plan.migrate?planSpec(plan).schema:null;}\n';assert.equal(nextSchema.split(addition).length,2);assert.equal(nextSchema.replace(addition,''),oldSchema,'仅允许结构模块导出原planSpec纯检查');
  const oldQueue=await before('tools/main-prebuild-queue.mjs'),nextQueue=await fs.readFile(path.join(source,'tools/main-prebuild-queue.mjs'),'utf8'),start=nextQueue.indexOf('// FIXED_SCHEMA_ECE_BEGIN');assert.ok(start>0&&nextQueue.trimEnd().endsWith('// FIXED_SCHEMA_ECE_END'));
  const core=nextQueue.slice(0,start).trimEnd()+'\n';assert.equal(core.replace(',admitSelectedPreparation=async()=>{}','').replace(';await admitSelectedPreparation(selection);',';').replace("(!await readFixedAdminRejectionResolution(directory,dispatch,terminal)&&!await readFixedSchemaRejectionResolution(directory,dispatch,terminal))","!await readFixedAdminRejectionResolution(directory,dispatch,terminal)"),oldQueue,'旧队列仅允许两个明确准入接缝，旧e2资格保持');
  schemaAdmissionOnly=true;preflightBaseline={path:path.resolve(reusePreflightReport),sha256:sha(raw),commit:baseline.commit,tree:baseline.tree,evidence:baseline.evidence,inputs:{tools:baseline.tools,dependencies:baseline.dependencies,powerShellModules:baseline.powerShellModules},payload:baseline.payload};
 }
 if(profile.schemaAdmissionOnly)assert.ok(schemaAdmissionOnly,'有限schema/ece profile必须绑定已审a704应用证明');
 if(profile.paths.some(p=>['tools/main-schema-release.mjs','tools/schema-rejection-observer.mjs','tools/schema-rejection-writer.mjs'].includes(p)))assert.equal(schemaAdmissionOnly,true,'新增schema能力/见证入口必须有专用受审增量资格');
 let fixedAdminOnly=false,reusedBaseline;
 if(reuseReport){
  assert.equal(baseCommit,'aaca18485021b6f98107fe168b69c8f57d55ee46','限定增量只复用已核aaca基线');
  assert.ok(profile.paths.includes('tools/main-prebuild-queue.mjs')&&profile.paths.includes('tools/publish-latest-main.mjs')&&profile.paths.every(name=>['tools/main-prebuild-queue.mjs','tools/publish-latest-main.mjs','tools/verify-release-candidate.mjs'].includes(name)),'增量超出固定queue协调/普通用户准入范围');
  const old=(await execute('git',['-C',source,'show',baseCommit+':tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  assert.equal(compareFixedAdminQueueChange(old,await fs.readFile(path.join(source,'tools/main-prebuild-queue.mjs'),'utf8')),true,'固定helper或unresolved接缝以外发生变化');
  const oldPublisher=(await execute('git',['-C',source,'show',baseCommit+':tools/publish-latest-main.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  assert.equal(compareFixedPreparationAdmissionChange(oldPublisher,await fs.readFile(path.join(source,'tools/publish-latest-main.mjs'),'utf8')),true,'普通用户只读准入/回调接缝以外发生变化');
  const raw=await fs.readFile(reuseReport);assert.equal(sha(raw),'f4d7678e3c34d91c30aa44b05628521efbdfa55fb16d0ac0a2e3f5dc743ee33c','原完整证明变化');
  const baseline=JSON.parse(raw);assert.equal(baseline.status,'passed');assert.equal(baseline.commit,baseCommit);assert.equal(baseline.evidence.packageIntegrity,true);assert.equal(baseline.evidence.piWorkerExitObservation,true);
  fixedAdminOnly=true;reusedBaseline={path:path.resolve(reuseReport),sha256:sha(raw),commit:baseline.commit,tree:baseline.tree,evidence:baseline.evidence,inputs:{tools:baseline.tools,dependencies:baseline.dependencies,powerShellModules:baseline.powerShellModules}};
 }
 const report={version:'release-candidate-verification-v1',source,baseCommit,commit,tree,plan,profile,startedAt:new Date().toISOString(),
  status:'running',checks:[],evidence:{packageIntegrity:false,nativeEntryBoundary:false,nativeColdStart:false},publicationPerformed:false};
 if(profile.weeklyReleaseLeaseOnly)report.profile={...profile,version:'weekly-release-lease-v1'};
 if(fixedAdminOnly){report.profile={...profile,version:'fixed-admin-e2-preparation-admission-v1',fixedAdminOnly:true};report.reusedBaseline=reusedBaseline;}
 if(schemaAdmissionOnly){report.profile={...profile,version:'schema-before-native-ece-admission-v1'};report.reusedPreflightBaseline={...preflightBaseline,payload:undefined};}
 const reportFile=path.join(directory,'REPORT.json');
 const write=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
 await write();
 const candidate=path.join(directory,'candidate');let attached=false;
 try{
  assert.equal(profile.unsupported.length,0,'本验证器没有覆盖这些变更，需补受影响兼容适配器：'+profile.unsupported.join(', '));
  if(batch3||integration){
   assert.deepEqual(plan.components,['worker','django']);
   assert.equal(plan.scope,'full');
   assert.equal(plan.migrate,false);
  }
  const where=async name=>(await execute('C:/Windows/System32/where.exe',[name],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0];
  const shell5='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',shell7=await where('pwsh.exe'),gitExe=await where('git.exe'),pythonExe=path.isAbsolute(python)?python:await where(python);
  const environment=candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory});
  environment.TERUISI_COMPATIBILITY_BASE=baseCommit;
  environment.PYTHONPATH=[path.join(candidate,'tools'),path.join(candidate,'tests'),path.join(candidate,'backend')].join(path.delimiter);
  report.environmentSha256=sha(Buffer.from(JSON.stringify(environment)));
  report.tools=await Promise.all([process.execPath,shell5,shell7,pythonExe,gitExe].map(async file=>({path:file,sha256:sha(await fs.readFile(file))})));
  report.powerShellModules={root:environment.PSModulePath,tree:await hashTree(environment.PSModulePath)};
  await git(source,['worktree','add','--detach',candidate,commit]);attached=true;
  assert.ok(dependencies||(!profile.worker&&!profile.django&&!profile.publication),'该profile需要显式的只读依赖目录');
  if(dependencies){
   assert.ok((await fs.stat(path.join(dependencies,'typescript','package.json'))).isFile(),'依赖不完整');
   await fs.symlink(path.resolve(dependencies),path.join(candidate,'node_modules'),'junction');
   const physicalRoot=await fs.realpath(dependencies);
   report.dependencies={physicalRoot,tree:await hashTree(physicalRoot)};
  }
  if(fixedAdminOnly){
   assert.deepEqual(report.tools,reusedBaseline.inputs.tools,'执行工具漂移，不能复用原应用/Pi证明');
   assert.deepEqual(report.dependencies,reusedBaseline.inputs.dependencies,'依赖漂移，不能复用原应用/Pi证明');
   assert.deepEqual(report.powerShellModules,reusedBaseline.inputs.powerShellModules,'PowerShell模块漂移，不能复用原应用/Pi证明');
  }
  if(schemaAdmissionOnly){assert.deepEqual(report.tools,preflightBaseline.inputs.tools,'执行工具漂移，不能复用');assert.deepEqual(report.dependencies,preflightBaseline.inputs.dependencies,'依赖漂移，不能复用');assert.deepEqual(report.powerShellModules,preflightBaseline.inputs.powerShellModules,'PowerShell模块漂移，不能复用');}
  const members=(await git(candidate,['ls-files','-z'])).split('\0').filter(Boolean);
  report.payload=[];
  for(const name of members){const file=path.join(candidate,name);assert.ok(!(await fs.lstat(file)).isSymbolicLink(),'候选包含链接：'+name);report.payload.push({path:name,sha256:sha(await fs.readFile(file))});}
  report.payloadSha256=sha(Buffer.from(JSON.stringify(report.payload)));
  if(integration){
   assert.equal(report.payload.find(member=>member.path===integration.test)?.sha256,integration.testSha256,'组合检查器字节已变化');
   report.applicationQualification=integration;
   report.requiresNativeColdStart=true;
   report.requiredNativeScopes=['windowsApplicationStack','piRunner','pandasBroker'];
  }
  if(profile.aiRepairBatch1Only){
   const qualification=aiRepairBatch1Qualification;
   assert.equal(await git(source,['rev-parse',qualification.app+'^{tree}']),qualification.tree);
   await git(source,['merge-base','--is-ancestor',qualification.app,commit]);
   assert.deepEqual(plan.components,['worker','django']);
   assert.equal(plan.scope,'full');
   assert.equal(plan.migrate,false);
   assertAiRepairBatch1Bytes(report.payload);
   report.applicationQualification=qualification;
  }
  if(aiRepairBatch2Only){
   const q=aiRepairBatch2Qualification;
   assert.equal(await git(source,['rev-parse',q.application+'^{tree}']),q.applicationTree);
   await git(source,['merge-base','--is-ancestor',q.application,commit]);
   assert.deepEqual(plan.components,['worker','django']);
   assert.equal(plan.scope,'full');
   assert.equal(plan.migrate,false);
   assertAiRepairBatch2Bytes(report.payload);
   const scopedPaths=Object.keys({...aiRepairBatch2Reviewed,...aiRepairBatch2Adapter});
   const index=(await git(candidate,['ls-files','--stage','-z','--',...scopedPaths])).split('\0').filter(Boolean);
   assert.equal(index.length,scopedPaths.length,'第二批Git索引成员不完整');
   for(const record of index)assert.match(record,/^100644 [a-f0-9]{40} 0\t/,'第二批Git索引成员不是受审普通文件模式');
   report.applicationQualification=q;
   report.requiresNativeColdStart=true;
   report.requiredNativeScopes=['pandasBroker'];
  }
  if(aiRepairBatch2Only||integration){
   const files=['django-ai.ps1','django-local-service.ps1','worker-local-service.ps1','process-deadline.ps1'];
   const pair=pandasRotationControllerPair,byController=[
    [pair.installedAiSha256,pair.candidateAiSha256],
    [pair.installedDjangoSha256,pair.candidateDjangoSha256],
    [pair.workerSha256,pair.workerSha256],
    [pair.transportSha256,pair.transportSha256],
   ];
   const originals={};
   for(const [index,name] of files.entries()){
    const raw=(await execute('git',['-C',source,'show',baseCommit+':tools/'+name],{encoding:'buffer',maxBuffer:8*1024*1024,windowsHide:true})).stdout;
    const actual=await fs.readFile(path.join(candidate,'tools',name));
    assert.deepEqual([sha(raw),sha(actual)],byController[index],'Pandas维护兼容控制器与冻结字节不符：'+name);
    originals[name]=raw;
    if(name==='django-local-service.ps1')assert.ok(comparePandasRotationInventoryOnly(raw.toString('utf8'),actual.toString('utf8')),'Django基础控制器只允许三项原位复制清单增量');
   }
   const originalAi=path.join(directory,'before-pandas-django-ai.ps1');
   await fs.writeFile(originalAi,originals['django-ai.ps1']);
   const [before,after]=await Promise.all([functionsOfExact(originalAi,shell7,environment),functionsOfExact(path.join(candidate,'tools/django-ai.ps1'),shell7,environment)]);
   const stable=['Wait-PiWorkerExit','Stop-PiRuntime','Start-AiStack','Stop-AiStack','Stop-PandasSandbox','Invoke-PandasSystemctl'];
   for(const name of stable){
    const prior=before.functions.find(f=>f.name===name)?.text;
    assert.ok(prior,'前驱缺少生命周期函数：'+name);
    assert.equal(after.functions.find(f=>f.name===name)?.text,prior,'非本次Pandas接缝的生命周期函数已变化：'+name);
   }
   report.pandasControllerQualification={pair,unchangedFunctions:stable,runtimeObservedByVerifier:false};
  }
  if(schemaAdmissionOnly){
   const mutable=new Set(profile.paths);for(const entry of preflightBaseline.payload)if(!entry.path.startsWith('docs/')&&!entry.path.startsWith('tests/')&&!mutable.has(entry.path))assert.equal(sha(await fs.readFile(path.join(candidate,entry.path))),entry.sha256,'前轮应用/生命周期字节变化：'+entry.path);
   await run('schema-current-proof-binding',pythonExe,['tests/release-chain-schema-binding.py'],'package-integrity');
   await run('schema-admission-and-ece',process.execPath,['--test','--test-concurrency=1','tests/main-schema-selected-admission.test.mjs','tests/fixed-schema-rejection.test.mjs','tests/fixed-admin-resolution.test.mjs','tests/main-prebuild-eligibility.test.mjs','tests/main-prebuild-queue-v2.test.mjs','tests/publish-latest-main.test.mjs'],'native-entry-boundary');
  }
  if(!schemaAdmissionOnly&&profile.paths.some(p=>p==='tools/pi_workspace_addition.py'||p==='config/main-schema-releases/ai-0085.json')){
   assert.equal(profile.releaseChainPreflight,true,'PiWorkspace改动需要专用结构验证适配器');
   const old=(await execute('git',['-C',source,'show',baseCommit+':tools/pi_workspace_addition.py'],{encoding:'utf8',windowsHide:true})).stdout;
   const next=await fs.readFile(path.join(candidate,'tools/pi_workspace_addition.py'),'utf8');
   const addition='    "tools/manual-maintenance-process.psm1", "tools/manual-maintenance-preflight.ps1", "tools/frozen-main-source.mjs",\n';
   assert.equal(next.split(addition).length,2,'结构工具库存扩展不精确');assert.equal(next.replace(addition,''),old,'仅允许PiWorkspace CODE_FILES增加三项闭包；其他结构代码必须保持');
   await run('pi-workspace-current-binding',pythonExe,['tests/release-chain-schema-binding.py'],'package-integrity');
  }
  if(profile.readinessStabilityOnly){
   const old=(await execute('git',['-C',source,'show',baseCommit+':tools/django-local-service.ps1'],{encoding:'buffer',windowsHide:true,maxBuffer:8*1024*1024})).stdout;
   const current=await fs.readFile(path.join(candidate,'tools/django-local-service.ps1'));
   assert.equal(compareReadinessDjangoCopyOnly(old.toString('utf8'),current.toString('utf8')),true,'readiness profile只允许Django新增一个helper复制项，其他字节必须不变');
   assert.equal(sha(old),readinessCopyControllerPair.installedSha,'readiness资格的原控制器必须绑定冻结基线的原始字节');
   assert.equal(sha(current),readinessCopyControllerPair.candidateSha,'readiness资格的候选控制器必须绑定实际原始字节，不能用规范化文本摘要');
   const oldMaintenance=(await execute('git',['-C',source,'show',baseCommit+':tools/manual-maintenance-continuation.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
   assert.equal(compareReadinessMaintenancePairOnly(oldMaintenance,await fs.readFile(path.join(candidate,'tools/manual-maintenance-continuation.mjs'),'utf8')),true,'readiness维护资格只允许固定pair和原guard的一条精确分支，其他字节必须不变');
   report.requiresNativeColdStart=false;
   report.readinessDjangoCopyOnly=true;
   report.readinessControllerPair={installedSourceSha256:sha(old),candidateSha256:sha(current),runtimeObservedByVerifier:false};
  }
  if(profile.django&&!profile.readinessStabilityOnly&&!profile.aiRepairBatch1Only&&!aiRepairBatch2Only&&!integration){
   const old=path.join(directory,'before-django.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-local-service.ps1'],{encoding:'buffer',maxBuffer:8*1024*1024,windowsHide:true})).stdout;
   await fs.writeFile(old,bytes);
   const current=path.join(candidate,'tools/django-local-service.ps1');
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(current,shell7,environment)]);
   report.gateTimingChanged=usesGateTimingExemption(a,b);
   // A 项 (descendantCreationGuardOnly) proves on functionsOfExact, not
   // functionsOf: the file contains non-ASCII (Chinese) comments elsewhere,
   // so the console-codepage-dependent functionsOf extraction of this exact
   // function does not reproduce the same bytes functionsOfExact pins
   // (verified empirically against both base and candidate text). Every
   // other profile here keeps using functionsOf/a/b unchanged.
   const requiresNativeColdStart=profile.descendantCreationGuardOnly
    ?!compareDescendantCreationGuardChange(...await Promise.all([functionsOfExact(old,shell7,environment),functionsOfExact(current,shell7,environment)]))
    :!(profile.piMainResumeOnly?comparePiResumeInventoryOnly(a,b):profile.releaseChainPreflight?compareMaintenanceInventoryOnly(a,b):compareFunctionOnlyChange(a,b));
   report.requiresNativeColdStart=requiresNativeColdStart;
   assert.equal(report.requiresNativeColdStart,false,'生命周期语义发生变化，需专用隔离冷启动适配器；不能以边界测试代替');
  }
  if(profile.piExitObservation){
   const old=path.join(directory,'before-django-ai.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-ai.ps1'],{encoding:'buffer',maxBuffer:4*1024*1024,windowsHide:true})).stdout;
   await fs.writeFile(old,bytes);
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(path.join(candidate,'tools/django-ai.ps1'),shell7,environment)]);
   assert.equal(comparePiExitObservationChange(a,b),true,'Pi adapter only permits the reviewed Windows exit observer; routing or other lifecycle changes require native cold start');
   report.piExitObservationOnly=true;
  }
  if(profile.dingtalkScreenshotAclOnly){
   const q=dingtalkScreenshotAclQualification,old=path.join(directory,'before-django-ai.ps1'),current=path.join(candidate,'tools/django-ai.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-ai.ps1'],{encoding:'buffer',maxBuffer:4*1024*1024,windowsHide:true})).stdout;
   assert.equal(sha(bytes),q.installedAiSha256,'前驱 django-ai.ps1 不是线上已登记的字节');
   assert.equal(sha(await fs.readFile(current)),q.candidateAiSha256,'候选 django-ai.ps1 不是已登记的字节');
   await fs.writeFile(old,bytes);
   const a=await functionsOfExact(old,shell7,environment),b=await functionsOfExact(current,shell7,environment);
   assert.equal(compareDingTalkScreenshotAclChange(a,b),true,'DingTalk截图ACL窄配置只允许Assert-DingTalkScreenshotProfile（固定新旧哈希）和新增Test-AppContainerReadOnlyAce（固定哈希），其余函数、参数和顶层语句必须逐字不变');
   const windowsPowerShell=windowsPowerShellEnvironment(environment);
   for(const file of ['dingtalk-screenshot-acl','dingtalk-startup-acl']){
    await run('ps5-'+file,shell5,['-NoProfile','-NonInteractive','-File','tests/'+file+'.test.ps1'],'isolated-functions',windowsPowerShell);
    await run('ps7-'+file,shell7,['-NoProfile','-NonInteractive','-File','tests/'+file+'.test.ps1'],'isolated-functions');
   }
   report.dingtalkScreenshotAclOnly=true;report.evidence.dingtalkScreenshotAclTolerance=true;
  }
  if(profile.workerJsonFailureCauseOnly){
   const q=workerJsonFailureCauseQualification,old=path.join(directory,'before-worker-local-service.ps1'),current=path.join(candidate,'tools/worker-local-service.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/worker-local-service.ps1'],{encoding:'buffer',maxBuffer:8*1024*1024,windowsHide:true})).stdout;
   assert.equal(sha(bytes),q.fileBeforeSha256,'前驱 worker-local-service.ps1 不是线上已登记的字节');
   assert.equal(sha(await fs.readFile(current)),q.fileAfterSha256,'候选 worker-local-service.ps1 不是已登记的字节');
   await fs.writeFile(old,bytes);
   const a=await functionsOfExact(old,shell7,environment),b=await functionsOfExact(current,shell7,environment);
   assert.equal(compareWorkerJsonFailureCauseChange(a,b),true,'Worker -Json 失败原因窄资格只允许终末 try/catch 顶层语句按固定新旧哈希变化，全部 81 个函数、参数块与其余顶层语句必须逐字不变');
   report.workerJsonFailureCauseOnly=true;report.evidence.workerJsonFailureCause=true;
  }
  if(profile.piMainResumeOnly){
   const old=path.join(directory,'before-django-ai.ps1');
   await fs.writeFile(old,(await execute('git',['-C',source,'show',baseCommit+':tools/django-ai.ps1'],{encoding:'buffer',maxBuffer:4*1024*1024,windowsHide:true})).stdout);
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(path.join(candidate,'tools/django-ai.ps1'),shell7,environment)]);
   assert.equal(comparePiUpgradeObservationOnly(a,b),true,'只允许两个只读Pi升级观察入口，原生命周期函数必须不变');
   await run('pi-main-resume',process.execPath,['--test','tests/publish-prepared-main.test.mjs','tests/publish-main-resume.test.mjs','tests/publish-main-step.test.mjs','tests/pi-main-resume-profile.test.mjs'],'native-entry-boundary');
   await run('pi-upgrade-readonly',pythonExe,['-B','tests/pi-upgrade-status.test.py'],'native-entry-boundary');
   for(const [name,host] of [['ps5',shell5],['ps7',shell7]])await run(name+'-pi-upgrade-status',host,['-NoProfile','-NonInteractive','-File','tests/pi-upgrade-status.fixture.ps1','-Controller',path.join(candidate,'tools/django-ai.ps1')],'native-entry-boundary');
   report.evidence.piMainResume=true;
  }
  async function run(name,executable,args,kind,env=environment){
   const started=Date.now(),item={name,executable,args,kind,startedAt:new Date().toISOString(),status:'running'};report.checks.push(item);await write();
   const output=path.join(directory,name+'.stdout.log'),errors=path.join(directory,name+'.stderr.log');
   try{
    const result=await execute(executable,args,{cwd:candidate,env,encoding:'buffer',windowsHide:true,timeout:900000,maxBuffer:16*1024*1024});
    await fs.writeFile(output,result.stdout);await fs.writeFile(errors,result.stderr);item.exitCode=0;item.status='passed';
   }catch(error){await fs.writeFile(output,error.stdout??Buffer.alloc(0));await fs.writeFile(errors,error.stderr??Buffer.alloc(0));item.error=String(error.message);item.exitCode=error.code??null;item.status='failed';throw error;}
   finally{item.elapsedMs=Date.now()-started;item.stdoutSha256=sha(await fs.readFile(output));item.stderrSha256=sha(await fs.readFile(errors));await write();}
  }
  if(integration){
   await run('ai-repair-integration-scope-and-entry',process.execPath,['--test',integration.test],'native-entry-boundary',
    {...environment,TERUISI_AI_INTEGRATION_PS5:shell5,TERUISI_AI_INTEGRATION_PS7:shell7});
   await run('ai-repair-integration-maintenance-admission',process.execPath,
    ['--test','--test-name-pattern=^batch 2 maintenance |^reviewed Django controller generations',
     'tests/ai-repair-batch2-compatibility.test.mjs','tests/manual-maintenance-continuation.test.mjs'],'isolated-functions');
   await run('ai-repair-integration-publication',process.execPath,
    ['--test','--test-concurrency=1','--test-name-pattern=Pandas|Pi image-input changes|interrupted Pi image build|Runner source-only release',
     'tests/publish-main-pandas.test.mjs','tests/publish-prepared-main.test.mjs'],'isolated-functions');
   await run('worker-integrity',process.execPath,['--test','tests/worker-source-read-once.test.mjs','tests/release-source-binding.test.mjs','tests/release-preparation-runtime-config.test.mjs'],'package-integrity');
   await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1','-AiRepairBatch2'],'package-integrity');
  }else if(profile.aiRepairBatch1Only){
   report.requiresNativeColdStart=true;
   report.requiredNativeScopes=['piRunner'];
   const output=path.join(directory,'ai-repair-batch1-verified-evidence.json');
   await run('ai-repair-batch1-profile',process.execPath,['--test','--test-name-pattern=ai repair batch1','tests/verify-release-candidate.test.mjs'],'isolated-functions');
   await run('ai-repair-batch1-compatibility',process.execPath,['--test','tests/ai-repair-batch1-compatibility.test.mjs'],'native-entry-boundary',
    {...environment,TERUISI_AI_BATCH1_EVIDENCE_OUTPUT:output,TERUISI_AI_BATCH1_PYTHON:pythonExe});
   const verified=JSON.parse(await fs.readFile(output,'utf8'));
   assert.equal(verified.scopedNativeEvidence?.piRunner?.status,'passed','缺少本批Pi原入口启动证据');
   report.reusedEvidence=verified.reusedEvidence;
   report.scopedNativeEvidence=verified.scopedNativeEvidence;
   report.frozenPublisherClosure=verified.frozenPublisherClosure;
   report.unchangedControllers=verified.unchangedControllers;
   report.piImageInputs=verified.imageInputs;
   await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1'],'package-integrity');
  }else if(aiRepairBatch2Only){
   const evidenceFile=path.join(directory,'ai-repair-batch2-verified-evidence.json');
   await run('ai-repair-batch2-compatibility',process.execPath,['--test','--test-name-pattern=^batch 2 |^reviewed Django controller generations',
    'tests/ai-repair-batch2-compatibility.test.mjs','tests/manual-maintenance-continuation.test.mjs'],'native-entry-boundary',
    {...environment,TERUISI_AI_BATCH2_EVIDENCE_OUTPUT:evidenceFile,TERUISI_AI_BATCH2_PYTHON:pythonExe,
     TERUISI_AI_BATCH2_PS5:shell5,TERUISI_AI_BATCH2_PS7:shell7});
   const verified=JSON.parse(await fs.readFile(evidenceFile,'utf8'));
   assert.equal(verified.scopedNativeEvidence?.pandasBroker?.status,'passed','缺少本批Pandas原生启动证据');
   report.frozenPublisherClosure=verified.frozenPublisherClosure;
   report.reusedEvidence=verified.reusedEvidence;
   report.scopedNativeEvidence=verified.scopedNativeEvidence;
   await run('ai-repair-batch2-publication',process.execPath,['--test','--test-name-pattern=Pandas','tests/publish-main-pandas.test.mjs','tests/publish-prepared-main.test.mjs'],'isolated-functions');
   await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1','-AiRepairBatch2'],'package-integrity');
  }else{
  if(profile.readinessStabilityOnly){
   await run('readiness-profile',process.execPath,['--test','--test-name-pattern=readiness stability','tests/verify-release-candidate.test.mjs'],'isolated-functions');
   await run('readiness-entry-closures',process.execPath,['--test','tests/readiness-entry-compatibility.test.mjs'],'package-integrity');
   await run('readiness-aggregate',process.execPath,['--import','tsx','--test','--test-name-pattern=readiness|direct callers|missing configuration','tests/django-aggregate-boundary.test.ts','tests/readiness-probe-budgets.test.ts'],'isolated-functions');
   await run('readiness-direct-callers',process.execPath,['--import','tsx','--test','tests/local-worker-start.test.ts','tests/operations-system-control.test.ts'],'isolated-functions');
   await run('readiness-observations',process.execPath,['--test','tests/publication-readiness.test.mjs'],'isolated-functions');
   await run('readiness-publication-entry',process.execPath,['--test','tests/main-publication-readiness.test.mjs'],'native-entry-boundary');
   await run('readiness-publication-callers',process.execPath,['--test','--test-concurrency=1','--test-name-pattern=unready HTTP|ready transient|ready success reuse|HTTP 200|real Fetch Response|parent deadline|native lock rejection|P12 refuses|only the exact fetched main','tests/publish-prepared-main.test.mjs','tests/publish-latest-main.test.mjs','tests/publisher-adopt-live.test.mjs'],'native-entry-boundary');
   await run('readiness-watchdog-parent',shell7,['-NoProfile','-NonInteractive','-File','tests/watchdog-diagnostics.test.ps1'],'isolated-functions');
   await run('readiness-ps5-parse',shell5,['-NoProfile','-NonInteractive','-File','tests/readiness-entry-compatibility.test.ps1','-ParseOnly'],'isolated-functions',windowsPowerShellEnvironment(environment));
   await run('readiness-launcher-entry',shell7,['-NoProfile','-NonInteractive','-File','tests/readiness-entry-compatibility.test.ps1'],'native-entry-boundary');
  }
  if(profile.releaseContentionOnly){
   if(profile.weeklyReleaseLeaseOnly){
    await run('weekly-release-lease-boundaries',process.execPath,['--test','tests/release-contention-boundaries.test.mjs','tests/main-publication-readiness.test.mjs','tests/publish-prepared-main.test.mjs','tests/publish-latest-main.test.mjs','tests/publish-main-command.test.mjs','tests/main-prebuild-status.test.mjs','tests/verify-release-candidate.test.mjs','tests/release-batch-powershell-environment.test.mjs','tests/manual-maintenance-pi-readiness.test.mjs','tests/manual-maintenance-continuation.test.mjs','tests/release-chain-preflight.test.mjs'],'native-entry-boundary');
    for(const [name,host] of [['ps5',shell5],['ps7',shell7]]){
     await run(name+'-weekly-release-lease-projection',host,['-NoProfile','-NonInteractive','-File','docs/weekly-release-lease-20261020/Check-WeeklyReleaseLeaseProjection.ps1','-SourceRoot',candidate,'-BaselineCommit',baseCommit],'isolated-functions');
     await run(name+'-weekly-release-lease-admission',host,['-NoProfile','-NonInteractive','-File','tests/weekly-report-admission.fixture.ps1','-SourceRoot',candidate],'native-entry-boundary');
    }
   }else{
    await run('release-contention-boundaries',process.execPath,['--test','tests/release-contention-boundaries.test.mjs','tests/manual-maintenance-lock.test.mjs','tests/publish-main-progress.test.mjs'],'native-entry-boundary');
    for(const [name,host] of [['ps5',shell5],['ps7',shell7]]){
     await run(name+'-weekly-admission-projection',host,['-NoProfile','-NonInteractive','-File','docs/release-contention-20261020/Check-WeeklyAdmissionProjection.ps1','-SourceRoot',candidate,'-BaselineCommit',baseCommit],'isolated-functions');
     await run(name+'-weekly-admission',host,['-NoProfile','-NonInteractive','-File','tests/weekly-report-admission.fixture.ps1','-SourceRoot',candidate],'native-entry-boundary');
    }
   }
  }
  if(fixedAdminOnly){
   await run('fixed-admin-queue',process.execPath,['--test','--test-concurrency=1','tests/fixed-admin-resolution.test.mjs','tests/fixed-admin-compatibility.test.mjs','tests/main-prebuild-eligibility.test.mjs','tests/main-prebuild-queue-v2.test.mjs'],'native-entry-boundary');
   await run('fixed-admin-private-bundle',process.execPath,['--test','--test-name-pattern=materials preserve frozen environment','tests/main-control-upgrade.test.mjs','tests/main-prebuild-task.test.mjs','tests/fixed-admin-resolution.test.mjs','tests/main-prebuild-eligibility.test.mjs'],'package-integrity');
  }
  if(nativeAbandonmentOnly){
   await run('fixed-native-abandonment',process.execPath,['--test','--test-concurrency=1','tests/fixed-native-abandonment.test.mjs','tests/verify-release-candidate.test.mjs'],'native-entry-boundary');
   await run('fixed-native-private-bundle',process.execPath,['--test','--test-name-pattern=materials preserve frozen environment','tests/main-control-upgrade.test.mjs'],'package-integrity');
  }
  if(cleanedPreparationOnly){
   await run('fixed-cleaned-preparation',process.execPath,['--test','--test-concurrency=1','tests/fixed-cleaned-preparation.test.mjs','tests/verify-release-candidate.test.mjs'],'native-entry-boundary');
   await run('historical-693e-reader',process.execPath,['--test','--test-name-pattern=693e twice observed closure','tests/fixed-native-abandonment.test.mjs'],'native-entry-boundary');
   await run('fixed-cleaned-private-bundle',process.execPath,['--test','--test-name-pattern=materials preserve frozen environment','tests/main-control-upgrade.test.mjs'],'package-integrity');
  }
  if(!profile.readinessStabilityOnly&&!profile.piMainResumeOnly&&!cleanedPreparationOnly&&!nativeAbandonmentOnly&&!fixedAdminOnly&&!schemaAdmissionOnly&&profile.publication&&!profile.weeklyReleaseLeaseOnly)await run('publication',process.execPath,['--test','tests/main-publication-readiness.test.mjs','tests/publish-prepared-main.test.mjs','tests/publish-latest-main.test.mjs','tests/publish-main-command.test.mjs','tests/main-prebuild-status.test.mjs','tests/verify-release-candidate.test.mjs','tests/release-batch-powershell-environment.test.mjs','tests/manual-maintenance-pi-readiness.test.mjs','tests/manual-maintenance-continuation.test.mjs','tests/release-chain-preflight.test.mjs'],'native-entry-boundary');
  if(!profile.readinessStabilityOnly&&!cleanedPreparationOnly&&!nativeAbandonmentOnly&&!fixedAdminOnly&&!schemaAdmissionOnly&&profile.preparationQueue&&!profile.releaseChainPreflight&&!profile.releaseContentionOnly)await run('preparation-queue-control',process.execPath,['--test','--test-concurrency=1','tests/main-prebuild-hook.test.mjs','tests/main-prebuild-queue-v2.test.mjs','tests/main-control-upgrade.test.mjs','tests/main-prebuild-task.test.mjs','tests/fixed-admin-resolution.test.mjs','tests/fixed-schema-rejection.test.mjs','tests/fixed-cache-rejection.test.mjs','tests/main-prebuild-eligibility.test.mjs','tests/main-dependency-selected-admission.test.mjs','tests/control-dependency-update.test.mjs'],'native-entry-boundary');
  if(profile.worker&&!profile.readinessStabilityOnly)await run('worker-integrity',process.execPath,['--test','tests/worker-source-read-once.test.mjs','tests/release-source-binding.test.mjs','tests/release-preparation-runtime-config.test.mjs'],'package-integrity');
  if(!profile.readinessStabilityOnly&&!cleanedPreparationOnly&&!nativeAbandonmentOnly&&!fixedAdminOnly&&!schemaAdmissionOnly&&(profile.schemaProof||profile.preparationQueue))await run('optimization-boundaries',process.execPath,['--test','tests/release-optimization-boundaries.test.mjs'],'package-integrity');
  if(profile.schemaProof){
   await run('schema-proof-unit',pythonExe,['-m','unittest','discover','-s','tests','-p','test_*addition.py'],'isolated-functions');
   await run('schema-proof-full-history',pythonExe,['-m','unittest','discover','-s','tests','-p','test_schema_proof_flow.py'],'package-integrity');
   await run('schema-proof-boundary',pythonExe,['tests/schema-proof-change-boundary.py','--base',baseCommit],'isolated-functions');
   const baselineTools=path.join(directory,'baseline-python-tools');await fs.mkdir(baselineTools);
   for(const name of ['bi_app_addition','jackyun_audit_addition','ai_schedule_addition','jd_logistics_addition','jd_monitor_preferences_addition','jd_product_monitoring_addition','tmall_warehouse_addition','pi_agent_addition']){
    const raw=(await execute('git',['-C',source,'show',baseCommit+':tools/'+name+'.py'],{encoding:'buffer',windowsHide:true,maxBuffer:8*1024*1024})).stdout;await fs.writeFile(path.join(baselineTools,name+'.py'),raw);
   }
   await run('schema-private-postgres',pythonExe,['tests/schema-gate-postgres.py','--out',path.join(directory,'private-postgres'),'--baseline',baselineTools,'--skip-measurements'],'real-private-postgres');
  }
  if(profile.django&&!profile.readinessStabilityOnly&&!profile.releaseChainPreflight&&!profile.piMainResumeOnly)for(const [name,host] of [['ps5',shell5],['ps7',shell7]]){
   for(const file of ['django-lifecycle-tree-reuse','django-local-service-fingerprint','django-orchestrated-start-acl'])await run(name+'-'+file,host,['-NoProfile','-NonInteractive','-File','tests/'+file+'.test.ps1'],'isolated-functions');
   if(report.gateTimingChanged)await run(name+'-migration-gate-timing',host,['-NoProfile','-NonInteractive','-File','tests/django-migration-gate-timing.test.ps1'],'native-entry-boundary');
  }
  if(profile.piExitObservation){
   await run('pi-exit-change-boundary',process.execPath,['--test','tests/pi-exit-change-boundary.test.mjs'],'isolated-functions');
   for(const [name,host] of [['ps5',shell5],['ps7',shell7]])await run(name+'-pi-exit-negative',host,['-NoProfile','-NonInteractive','-File','tests/pi-worker-exit.test.ps1'],'isolated-functions');
   await run('pi-worker-native-exit',shell7,['-NoProfile','-NonInteractive','-File','tests/pi-worker-exit.test.ps1','-Native','-Python',pythonExe],'native-pi-worker-exit');
   report.evidence.piWorkerExitObservation=true;
  }
  if(!cleanedPreparationOnly&&!nativeAbandonmentOnly&&!fixedAdminOnly&&!schemaAdmissionOnly&&(profile.publication||profile.django)){
   if(!profile.readinessStabilityOnly)await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1'],'package-integrity');
  }
  }
  assert.equal(await git(candidate,['status','--porcelain']),'','测试修改了候选工作树');
  for(const member of report.payload)assert.equal(sha(await fs.readFile(path.join(candidate,member.path))),member.sha256,'验证期间候选字节变化：'+member.path);
  if(report.dependencies)assert.deepEqual(await hashTree(report.dependencies.physicalRoot),report.dependencies.tree,'验证期间依赖字节发生变化');
  for(const tool of report.tools)assert.equal(sha(await fs.readFile(tool.path)),tool.sha256,'验证期间执行工具发生变化：'+tool.path);
  assert.deepEqual(await hashTree(report.powerShellModules.root),report.powerShellModules.tree,'验证期间PowerShell模块发生变化');
  report.evidence.packageIntegrity=report.checks.some(c=>c.kind==='package-integrity');
  report.evidence.nativeEntryBoundary=report.checks.some(c=>c.kind==='native-entry-boundary');
  if(fixedAdminOnly){report.evidence.unmodifiedApplicationAndPi=reusedBaseline.evidence;report.evidence.fixedAdminQueueResolution=true;}
  if(schemaAdmissionOnly){report.evidence.unmodifiedApplicationAndPi=preflightBaseline.evidence;report.evidence.fixedSchemaQueueResolution=true;}
  if(nativeAbandonmentOnly)report.evidence.fixedNativeAbandonmentResolution=true;
  if(cleanedPreparationOnly)report.evidence.fixedCleanedPreparationResolution=true;
  report.nativeColdStartReason=profile.readinessStabilityOnly?'Not executed: readiness budgets, bounded observations, direct caller and frozen/control import closures, and the exact old/new controller admission pair only; Django differs solely by the helper copy-list item. Package and isolated entry checks do not prove a native cold start.':profile.workerJsonFailureCauseOnly?'Not executed: exact AST-qualified terminal catch only; in -Json mode the real failure cause now reaches stderr while the stdout reconciliation key set is byte-identical. All 81 functions, the parameter block and the other 42 top-level statements are byte-identical, so no Start/Stop routing, maintenance, lock, drain, receipt or process-tree semantics changed.':profile.dingtalkScreenshotAclOnly?'Not executed: exact AST-qualified DingTalk screenshot ACL tolerance only (Assert-DingTalkScreenshotProfile plus one added helper); every other function and Start/Stop routing, including the Pi stop protocol, is byte-identical.':profile.piExitObservation?'Not executed: exact AST-qualified Windows Pi exit observer only; real private empty pi_worker.main and same-token Stop tested, fixed WSL runner lifecycle not executed.':'Not executed: profiles cover package digests, admission and native command boundaries; no Start/Stop routing semantics changed.';
  if(profile.aiRepairBatch1Only){
   report.evidenceScope={
    packageIntegrity:'Private Django copy, dependencies, ACL and local Wrangler; frozen Pi image inputs. No formal Worker release.',
    nativeEntryBoundary:'Frozen publisher import closure and actual PS entry parameters with probes stopped before the first side effect.',
    nativeColdStart:'Original Pi Runner main and signed health passed in scope. Full Windows application stack cold start was not executed.',
   };
   report.nativeColdStartReason=report.evidenceScope.nativeColdStart;
  }
  if(aiRepairBatch2Only){
   report.evidenceScope={
    packageIntegrity:'Private Django copy, deployment manifest, ACL, dependency and local Wrangler checks with stopped-process and schema observations substituted; no formal Worker release.',
    nativeEntryBoundary:'Frozen publisher import closure, private predecessor admission, and actual Windows PowerShell 5 and PowerShell 7 parameters up to the original mutex before effects.',
    nativeColdStart:'Original Pandas Broker lifecycle, root-owned rotation and signed readiness were verified in the private WSL scope. Full Windows application stack cold start was not executed.',
   };
   report.nativeColdStartReason=report.evidenceScope.nativeColdStart;
  }
  if(integration){
   report.evidenceScope={
    packageIntegrity:'Worker source/dependency binding and private Django copy, deploy, ACL and local Wrangler checks; no formal release.',
    nativeEntryBoundary:'Frozen publisher imports, private predecessor admission, and the actual PowerShell 5.1 and 7 parameter dispatcher up to its mutex. Publication ordering and recovery are checked with native action stand-ins.',
    nativeColdStart:'Pending separate Windows application stack, Pi Runner and Pandas Broker evidence for the pinned combined application source.',
   };
   report.nativeColdStartReason=report.evidenceScope.nativeColdStart;
  }
  report.status=integration?'native-cold-start-pending':'passed';
 }catch(error){report.status='failed';report.error=String(error.message);}
 finally{
  report.completedAt=new Date().toISOString();
  if(attached){
   try{
    const modules=path.join(candidate,'node_modules');try{if((await fs.lstat(modules)).isSymbolicLink())await fs.unlink(modules);}catch(e){if(e.code!=='ENOENT')throw e;}
    await git(source,['worktree','remove',candidate]);report.candidateWorktreeRemoved=true;
   }catch(error){report.candidateWorktreeRemoved=false;report.cleanupError=String(error.message);report.status='failed';}
  }
  await write();
 }
 return {status:report.status,reportFile,tree,commit,evidence:report.evidence};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{source:{type:'string'},base:{type:'string'},head:{type:'string',default:'HEAD'},out:{type:'string'},dependencies:{type:'string'},python:{type:'string'},'reuse-report':{type:'string'},'reuse-preflight-report':{type:'string'}}});
 verifyReleaseCandidate({sourceRoot:values.source,base:values.base,head:values.head,out:values.out,dependencies:values.dependencies,python:values.python,reuseReport:values['reuse-report'],reusePreflightReport:values['reuse-preflight-report']}).then(result=>{console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
