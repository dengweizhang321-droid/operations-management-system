import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url)),E='E:/codex-artifacts/watchdog-native-census-20261012/';const hash=b=>createHash('sha256').update(b).digest('hex');
const prior='D:/.codex/worktrees/watchdog-census-transport/运营管理系统/docs/watchdog-census-transport-20261012/run-census-install-corrected.mjs';const raw=fs.readFileSync(prior);assert.equal(hash(raw),'779127c4ed4177ffca1d09e5f9169ac6569f5518912025149f4e04562f6d09d6');let source=raw.toString();
const evidence={
 'approved-install-v1/INSTALL_RESULT.json':'96befe9557794723e28ba37c6f90a8250e371dbca471f36aa230725094905742',
 'approved-install-v1/TASK_AFTER.json':'82d5c9cdd88f990786996a84db4f6c9913ebca77445deae6670468b0394c223f',
 'approved-install-attempt-v2/INSTALL_FINISHED.json':'952d96f3f2aca7de1f1e151d540e5d222c781a6537a1e62a3d507c23a2f21861',
 'approved-install-v1/natural/FAILURE.json':'df40b4c06629ce4b8407614ec832bb99a381d93427f1b9fbbac09288abc29737',
 'approved-install-v1/natural/natural-2.json':'2cc106eec604f59a1f401c1fe9e0c382bb3d2ffee37d54fd3e30f036106792f9',
 'final-closeout-v2/RECONCILIATION.FINISHED.json':'cc9ff841834927854249295c8b0101e425b374dba345c540ebfdecb08a605545',
 'final-closeout-v2/TRANSPORT_FINISHED.json':'b3785a7ab9b6eb48b04e7c39d2b2d0426c8d905e48911e7302bdf0afa9ae25f4'
};for(const[n,h]of Object.entries(evidence))assert.equal(hash(fs.readFileSync(E+n)),h);
const begin=source.indexOf('function assertPriorPathFailure()'),end=source.indexOf('function verifyInstalledTask()');assert(begin>0&&end>begin);
const guard=`function installedEvidence(){const pins=${JSON.stringify(evidence)};for(const[n,h]of Object.entries(pins))read(E+n,h);const installed=json(E+'approved-install-v1/INSTALL_RESULT.json');assert.equal(installed.status,'exact-census-version-installed');assert.equal(installed.bundleId,B.bundle);assert.equal(installed.planId,B.plan);assert.equal(installed.triggersPrincipalSettingsUnchanged,true);assert.equal(json(E+'approved-install-attempt-v2/INSTALL_FINISHED.json').exitCode,0);assert.equal(json(E+'final-closeout-v2/RECONCILIATION.FINISHED.json').exitCode,1);assert.equal(json(E+'final-closeout-v2/TRANSPORT_FINISHED.json').exitCode,1);read('D:/teruisi-runtime/operations-watchdog/installation.json','9ab04fa60f75a78358ee5ea69d4b9c885f13723b798c0672bfbebef32121a0db');return installed;}\n`;
source=source.slice(0,begin)+guard+source.slice(end);
function replace(a,b){assert.equal(source.split(a).length,2,a);source=source.replace(a,b);}
replace("out=E+'approved-install-v1/'","out=E+'natural-only-v1/'");
replace("json(out+'TASK_AFTER.json').xml","json(E+'approved-install-v1/TASK_AFTER.json','82d5c9cdd88f990786996a84db4f6c9913ebca77445deae6670468b0394c223f').xml");
replace('const installed=await install();','const installed=installedEvidence();');
replace("const natural=await observeTwoFreshNatural({after:installed.at,outputRoot:out+'natural'});","const observationAfter=new Date().toISOString();assert(Date.parse(observationAfter)>Date.parse(json(E+'approved-install-v1/natural/FAILURE.json').at));once(out+'OBSERVATION_STARTED.json',{at:observationAfter,installedAt:installed.at,installationRepeated:false});const natural=await observeTwoFreshNatural({after:observationAfter,outputRoot:out+'natural'});");
replace('const observations={installed,natural,','const observations={installed,observationStartedAt:observationAfter,installationRepeated:false,priorNaturalFailureSha256:pinsUnusedPlaceholder,natural,');
source=source.replace('pinsUnusedPlaceholder',JSON.stringify(evidence['approved-install-v1/natural/FAILURE.json']));
replace('two new scheduled healthy frames after actual installation, original failed observation retained','two new scheduled healthy frames after a new observation start; already-installed version not reinstalled; both original and later failed observations retained');
assert(!source.includes('await install('));assert(!source.includes('async function install('));assert(!source.includes('spawn(host,'));
const file=path.join(own,'run-natural-only.mjs');fs.writeFileSync(file,source,{flag:'wx'});fs.mkdirSync(E+'natural-only-v1',{recursive:false});fs.mkdirSync(E+'final-closeout-v3',{recursive:false});
const record={version:'already-installed-natural-only-derivation-v1',parentRunner:prior,parentRunnerSha256:hash(raw),receiver:{path:file,sha256:hash(source)},evidence:Object.entries(evidence).map(([n,sha256])=>({path:E+n,sha256})),currentInstallationSha256:'9ab04fa60f75a78358ee5ea69d4b9c885f13723b798c0672bfbebef32121a0db',installationRepeated:false,changedBusinessScope:false,parentApprovalSha256:'ae4def90ff770d86c9bb18899bac464f2b9acec26ee3327dc134e47611723754'};fs.writeFileSync(E+'NATURAL_ONLY_DERIVATION_V1.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({receiverSha256:hash(source),installCalls:0}));
