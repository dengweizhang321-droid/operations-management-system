// Generate a NEW exact strict batch, NEVER execute/apply/install/backup it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir, readdir, open, lstat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { auditInventory } from './adapter.mjs';
import { prepareUi } from './ui-setup.mjs';
import { pythonInventory,validatePythonEnvironment } from './python-closure.mjs';
import { sha, canonical, profileDigest, components } from './validators.mjs';
const own=path.dirname(fileURLToPath(import.meta.url)),doc=path.resolve(own,'..'),source='D:\\运营管理系统-sales-django-release';
const scope=process.argv[2]??'AB';assert.ok(['AB','ABC'].includes(scope));
const scopeDoc=JSON.parse(await readFile(path.join(doc,'candidate-scope.json'))),original=scopeDoc.records[scope];
const candidate=original.immutableCandidateRoot,runtime='D:\\teruisi-runtime\\teruisi-worker-sales';
const lib=await import(pathToFileURL(path.join(candidate,'tools/release-impact.mjs')));
const {readSourceTree,sourceTreeDigest,sourceInventory,hash,safeFileDigest}=lib;
const {workerPreparationIdentity,runProcess}=await import(pathToFileURL(path.join(candidate,'tools/worker-local-release.mjs')));
const {makeBatch}=await import(pathToFileURL(path.join(candidate,'tools/release-batch.mjs')));
const {resolveEffectiveReleaseChain}=await import(pathToFileURL(path.join(candidate,'tools/worker-local-release-rotation.mjs')));
const id=`integration-${scope.toLowerCase()}-v2-20261010-${randomBytes(5).toString('hex')}`;
const root=path.resolve(`E:/codex-artifacts/release-integration-review-20261010/${scope}-v2-${randomBytes(8).toString('hex')}`);
await mkdir(root);await writeFile(path.join(root,'attempt-started.json'),canonical({id,scope,status:'preparing-not-approved',at:new Date().toISOString()})+'\n',{flag:'wx'});
const put=async(name,raw)=>{const handle=await open(path.join(root,name),'wx');try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}};
let authorityConfirmed=false;
const json=async(name,value)=>put(name,canonical(value)+'\n');
const file=async target=>({path:path.resolve(target),sha256:await safeFileDigest(target)});
async function treeFiles(directory,excluded=new Set()) {
  const result=[];for(const entry of await readdir(directory,{withFileTypes:true})) {
    assert.ok(!entry.isSymbolicLink());if(excluded.has(entry.name))continue;const target=path.join(directory,entry.name);
    if(entry.isDirectory())result.push(...await treeFiles(target,excluded));else result.push(await file(target));
  }return result;
}
try {
  const before=await readSourceTree(path.join(runtime,'releases',original.predecessor.releaseId,'source-snapshot')),after=await readSourceTree(source);
  const manifest=JSON.parse(await readFile(path.join(candidate,'deployment-manifest.json'))),identity=await workerPreparationIdentity(source);
  assert.equal(sourceTreeDigest(before),original.predecessorSourceSha256);
  assert.equal(sourceTreeDigest(after),original.candidateSourceSha256);assert.equal(identity.sourceTree.sha256,manifest.source.sourceFingerprint);
  const chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});
  assert.equal(chain.head.bindingSha256,original.predecessor.bindingSha256);
  const ownerManifest='D:/teruisi-runtime/django-sales/app/deployment.json';
  assert.equal(await safeFileDigest(ownerManifest),original.djangoManifestSha256);
  const planRaw=await readFile(path.join(runtime,'state/worker-release-rotation-plans',original.workerPlan.planSha256+'.json'));
  assert.equal(sha(planRaw),original.workerPlan.planSha256);
  const protectedBefore=[];
  for(const entry of JSON.parse(planRaw).protectedEntrypoints) {
    const target=path.resolve('D:/运营管理系统',entry.relativePath);assert.ok(target.startsWith(path.resolve('D:/运营管理系统')+path.sep));
    const raw=await readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const current=raw&&sha(raw);assert.ok(current===entry.predecessorSha256||current===entry.candidateSha256);
    const archive=raw&&current!==entry.candidateSha256?'primary-before-'+protectedBefore.length+'.bin':null;
    if(archive)await put(archive,raw);
    protectedBefore.push({...entry,currentSha256:current,archive,willChange:current!==entry.candidateSha256});
  }
  await json('primary-entrypoint-preservation.json',{status:'original-bytes-preserved-primary-unchanged',protectedBefore,
    scope:'Original CAS-managed primary entrypoints only. Original three locally modified tool files are retained byte-for-byte; Git/unrelated user files unchanged. Future approved apply explicitly replaces these managed entries.'});
  // The old snapshot establishes the exact schema/table/software contract,
  // never supplies this new strict batch's actual pre/post Backup operations.
  const pointRaw=await readFile('E:/运营管理系统业务数据/daily-20261009T114230Z-7117da1c1055/backup-manifest.json');
  assert.equal(sha(pointRaw),'c3def80e40bf8ebad3e0d3e3a2c09a64b2d4d99bd6cf95d48c41b7b12ff62400');
  const point=JSON.parse(pointRaw);assert.equal(profileDigest(point.profileEvidence),point.profileEvidence.contentSha256);
  const preparation=JSON.parse(await readFile(path.join(doc,'evidence/batch-v2-readonly-preparation.json')));
  const profileContract={...preparation.contract,software:point.software};
  const ownerLog=await readFile(path.join(doc,'evidence/owner-contract-relative-guard-final.log'),'utf8');
  assert.match(ownerLog,/Ran 25 tests/);assert.match(ownerLog,/\nOK\r?\n/);assert.ok(!/FAILED \(/.test(ownerLog));
  const parsePass=async(name,expected)=>{
    const raw=await readFile(path.join(doc,'evidence',name),'utf8');
    assert.match(raw,new RegExp('(?:pass |# pass )'+expected+'(?:\\r?\\n|$)'));
    assert.match(raw,/(?:fail |# fail )0(?:\r?\n|$)/);return file(path.join(doc,'evidence',name));
  };
  const tested=await Promise.all([parsePass('ab-scoped-regression.log',158),parsePass('ab-inventory-regression-final.log',61),
    parsePass('batch-v2-validator-checksum.log',17),parsePass('batch-v2-validator-independent-fixed.log',5),parsePass('batch-v2-adapter-independent-fixed.log',5),parsePass('batch-v2-adapter-ui-independent-final.log',12),parsePass('batch-v2-python-closure.log',2)]);
  const extraNames=['owner-contract-relative-guard-final.log','owner-guard-relative-negative.log','owner-test-source.json','owner-test-config.json','owner-test-shared-fixtures.json','owner-test-tools.json','owner-test-all-sql.json',
    'independent-combined-final.log','restorerehearsal-existing-point.json','independent-existing-mirror-review.json','batch-v2-readonly-preparation.json','static-final.json','full-unit-coverage.json',
    'batch-v2-ui-quiescence.log','batch-v2-ui-quiescence-preparation.json','batch-v2-resources-live-readonly.json','batch-v2-python-closure-independent.log'];
  const uiPreparationResult=JSON.parse(await readFile(path.join(doc,'evidence/batch-v2-ui-quiescence.log'),'utf8'));
  assert.deepEqual(uiPreparationResult,{status:'passed',fourFixesProductionUi:true,productionWrites:0,cases:4});
  const evidence=[...tested,...await Promise.all(extraNames.map(name=>file(path.join(doc,'evidence',name)))),...await treeFiles(own)];
  const mapping={
    domain:{evidence:['owner-contract-relative-guard-final.log','ab-scoped-regression.log'],scope:'Exact installed owner reader/writer/API data and AB guarded adapters'},
    contract:{evidence:['ab-scoped-regression.log','ab-inventory-regression-final.log'],scope:'Final AB unchanged protocol bytes except separately tested complete inventory safety'},
    negative:{evidence:['batch-v2-validator-checksum.log','batch-v2-validator-independent-fixed.log','independent-combined-final.log'],scope:'Wrong identities/results/budgets/profile/audit/task/fence rejection'},
    concurrency:{evidence:['ab-scoped-regression.log'],scope:'Original named lease, WAL/active and no-replay concurrency regression'},
    permissions:{evidence:['owner-contract-relative-guard-final.log','owner-test-source.json','batch-v2-readonly-preparation.json','restorerehearsal-existing-point.json'],scope:'Exact owner isolated API/role/scope plus current unsigned GET and original restored PG role/catalog'},
    'migration-rehearsal':{evidence:['owner-contract-relative-guard-final.log','owner-test-all-sql.json','restorerehearsal-existing-point.json'],scope:'Exact owner isolated migration/idempotency/terminal fences and real PG restored migration/catalog; no new candidate migration'},
    lifecycle:{evidence:['ab-scoped-regression.log','independent-combined-final.log'],scope:'Actual original child/EOF/direct-preserve and exact lifecycle/source guard regressions'},
    'backup-recovery':{evidence:['restorerehearsal-existing-point.json','independent-existing-mirror-review.json','batch-v2-readonly-preparation.json'],scope:'Full retained same-owner PG point profile/sequence/content/cleanup, independently read; new pre/post restores still required'},
    boundary:{evidence:['static-final.json'],scope:'Whole integration module boundary/lint; production delta tools/tests/docs only, no business/dependency source changes'},
    build:{evidence:[scope.toLowerCase()+'-online-prepare.json'],scope:'This exact immutable candidate original prepare-online build/helper/guard/full verification'},
  };
  assert.equal(JSON.parse(await readFile(path.join(doc,`evidence/${scope.toLowerCase()}-online-prepare.json`))).exitCode,0);
  evidence.push(await file(path.join(doc,`evidence/${scope.toLowerCase()}-online-prepare.json`)));
  const tests={status:'passed',sourceSha256:identity.sourceTree.sha256,artifactSha256:original.workerPlan.candidateManifestSha256,
    checks:Object.keys(mapping),mapping,evidence,ownerManifestSha256:original.djangoManifestSha256,
    limits:['SQLite contracts are not PostgreSQL role execution; restored/current original PG catalog is separate evidence',
      'PostgreSQL profile scope excludes R2 payload/n8n state; no candidate mutation of those stores is approved',
      'New pre/post backups/restores and real complete acceptance remain required',
      'Native latest scheduler unknown; recovery fast path ineligible; no production timing SLA']};
  const testsPath=path.join(root,'candidate-tests.json');await json('candidate-tests.json',tests);
  for(const name of ['adapter.mjs','validators.mjs','read-watchdog-task.ps1','collector.mjs','python-closure.mjs'])await put(name,await readFile(path.join(own,name)));
  const ui=await prepareUi(root,candidate);
  const shell=path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),node=process.execPath;
  const powerShellPath=path.resolve('C:/Users/86137/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
  const task=await runProcess(powerShellPath,['-NoProfile','-NonInteractive','-File',path.join(root,'read-watchdog-task.ps1')],{timeoutMs:60000,outputProtocol:'direct-exit-files',cleanup:'direct'});
  const taskBefore=JSON.parse(task.stdout);assert.equal(taskBefore.exists,true);assert.equal(taskBefore.enabled,true);assert.equal(taskBefore.triggerCount,2);
  const watchdogDirectory='D:/teruisi-runtime/operations-watchdog',installation=JSON.parse(await readFile(path.join(watchdogDirectory,'installation.json')));
  const launcherPath=path.resolve(watchdogDirectory,'Watchdog.NoConsole-'+installation.launcherSourceSha256.slice(0,16)+'.exe');
  const scriptSha256=await safeFileDigest(path.join(candidate,'source-snapshot/tools/operations-system-watchdog.ps1'));
  const transportSha256=await safeFileDigest(path.join(candidate,'source-snapshot/tools/process-deadline.ps1'));
  const launcherSourceSha256=await safeFileDigest(path.join(candidate,'source-snapshot/tools/watchdog-launcher/NoConsoleLauncher.cs'));
  assert.equal(launcherSourceSha256,installation.launcherSourceSha256);
  const expectedAction=launcherPath+'\n'+`"${powerShellPath}" "${path.resolve(watchdogDirectory,'operations-system-watchdog.ps1')}"`+'\n'+path.resolve(watchdogDirectory);
  // All original audit roots are enumerated twice. No _queue/_observations or
  // unknown/failed/reconciled history is omitted. Mutable active is separate.
  const auditRoots=[{path:path.resolve(runtime,'state/release-batches'),mode:'full-root'},
    {path:path.resolve('D:/teruisi-runtime/django-sales/audits'),mode:'audit-records'},
    {path:path.resolve('D:/teruisi-runtime/django-sales/rehearsals/postgres-restore'),mode:'published-recovery-receipts'},
    {path:path.resolve('E:/TERUISI-Postgres-Rehearsals'),mode:'published-recovery-receipts'},
    {path:path.resolve(runtime,'state/worker-release-successors'),mode:'full-root'},
    {path:path.resolve(runtime,'state/worker-release-rotation-consumptions'),mode:'full-root'},
    {path:path.resolve(runtime,'releases',original.predecessor.releaseId,'audit'),mode:'full-root'}];
  const files=await auditInventory(auditRoots,safeFileDigest),again=await auditInventory(auditRoots,safeFileDigest);
  assert.deepEqual(files,again);assert.ok(files.length>0);
  const baseline={version:'task-d-complete-audit-baseline-v2',capturedAt:new Date().toISOString(),completeRootInventory:true,
    scope:'Full declared WAL/successor/consumption/package audit roots; all Django audit json/jsonl/sidecar/log/text/XML records and published restore result/failure/receipt JSON. Historical D1/backup binary payloads and live monitoring/startup state excluded, never declared newly reverified.',
    roots:auditRoots.map(p=>({...p,fileCount:files.filter(x=>x.root===p.path).length})),files,fileCount:files.length,inventorySha256:hash(files)};
  await json('historical-audit-sha.json',baseline);
  const h={...original,version:'task-d-exact-batch-preparation-v2',profileContract,journalRoot:path.resolve(runtime,'state/release-batches'),historicalCaptureSha256:hash(baseline),
    ownerTests:{status:'passed',count:25,logSha256:sha(Buffer.from(ownerLog)),productionWriteTestPerformed:false},
    watchdog:{powerShellPath,launcherPath,before:taskBefore,after:{scriptSha256,transportSha256,launcherSourceSha256,launcherSha256:installation.launcherSha256,actionSha256:sha(expectedAction)}},
    approvalScopeIncludes:'Original watchdog installation updates/enables/starts existing task; existing automatic recovery/incident-notification policy may run. No manual message/TestNotification.',
    productionApproval:false,productionAdopted:false};
  await json('candidate-handoff.json',h);
  const op=path.resolve('D:/teruisi-runtime/django-sales/app/tools/django-postgres-maintenance.ps1'),wrap=path.resolve(candidate,'tools/release-lifecycle-step.ps1');
  const nativeNames=['django-postgres-maintenance.ps1','postgres-backup-retention.ps1','postgres-backup-continuity.ps1','django-local-service.ps1','postgres-consistent-backup.py','postgres_no_key_backup.py'];
  const nativeRawFiles=[await file(shell),await file(ownerManifest),...await Promise.all(nativeNames.map(n=>file(path.join(path.dirname(op),n)))),
    await file('D:/teruisi-runtime/django-sales/venv/Scripts/python.exe'),await file('D:/teruisi-runtime/django-sales/venv/pyvenv.cfg'),await file('D:/teruisi-runtime/django-sales/service.json'),
    await file('D:/teruisi-runtime/django-sales/config/dingtalk-startup.json'),await file('D:/teruisi-runtime/django-sales/config/dingtalk-ask.json')];
  for(const entry of await readdir('D:/teruisi-runtime/django-sales/postgresql-17.11/bin'))if(/\.(exe|dll)$/i.test(entry))nativeRawFiles.push(await file('D:/teruisi-runtime/django-sales/postgresql-17.11/bin/'+entry));
  for(const entry of await readdir(path.dirname(op)))if(/\.(ps1|py)$/i.test(entry))nativeRawFiles.push(await file(path.join(path.dirname(op),entry)));
  // Original backup/restore Python imports psycopg and its native libpq.
  const pythonBase=path.resolve('C:/Users/86137/AppData/Local/Programs/Python/Python312'),site=path.resolve('D:/teruisi-runtime/django-sales/venv/Lib/site-packages');
  const venvConfig=Object.fromEntries((await readFile('D:/teruisi-runtime/django-sales/venv/pyvenv.cfg','utf8')).trim().split(/\r?\n/).map(line=>{const at=line.indexOf(' = ');return [line.slice(0,at),line.slice(at+3)];}));
  assert.equal(path.resolve(venvConfig.home),pythonBase);assert.equal(path.resolve(venvConfig.executable),path.join(pythonBase,'python.exe'));assert.equal(venvConfig.version,'3.12.10');assert.equal(venvConfig['include-system-site-packages'],'false');
  validatePythonEnvironment(process.env);
  const pythonRoots=[path.join(pythonBase,'Lib'),path.join(pythonBase,'DLLs'),site];
  await json('python-closure.json',{version:'task-d-original-python-closure-v1',roots:pythonRoots,files:await pythonInventory(pythonRoots,safeFileDigest),cacheBoundary:'Original Python validates bytecode cache against pinned source; no universal native sandbox claim'});
  for(const name of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE'])assert.ok(!process.env[name],'Unbound Python search path refused');
  const hooks=(await readdir(site)).filter(name=>name.endsWith('.pth'));assert.equal(hooks.length,0,'Python startup hook requires separate exact closure');
  for(const name of ['python.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll'])nativeRawFiles.push(await file(path.join(pythonBase,name)));
  nativeRawFiles.push(...await treeFiles(path.join(pythonBase,'DLLs')));
  nativeRawFiles.push(...await treeFiles(path.join(pythonBase,'Lib'),new Set(['site-packages','__pycache__'])));
  for(const name of ['psycopg','psycopg_binary','psycopg_binary.libs'])nativeRawFiles.push(...await treeFiles(path.join(site,name)));
  nativeRawFiles.push(await file(path.join(site,'typing_extensions.py')));
  const ownerSource=JSON.parse(await readFile(path.join(doc,'evidence/owner-test-source.json')));
  for(const entry of ownerSource.inventory.filter(x=>x.kind==='exact-installed-owner')) {
    const bound=await file(path.resolve('D:/teruisi-runtime/django-sales/app',entry.path));assert.equal(bound.sha256,entry.sha256);nativeRawFiles.push(bound);
  }
  for(const metadata of ['owner-test-config.json','owner-test-tools.json','owner-test-all-sql.json']) {
    const decoded=JSON.parse(await readFile(path.join(doc,'evidence',metadata))),entries=Array.isArray(decoded)?decoded:[decoded];
    for(const entry of entries) { const bound=await file(path.resolve('D:/teruisi-runtime/django-sales/app',entry.path));assert.equal(bound.sha256,entry.sha256);nativeRawFiles.push(bound); }
  }
  const nativeFiles=[...new Map(nativeRawFiles.map(f=>[f.path,f])).values()];
  const modules=['release-batch','release-batch-admission','release-impact','release-daily-backup','release-readonly-retry','worker-local-release','worker-local-release-rotation','d1-retirement-proof','collect-d1-retirement-proof'];
  if(scope==='ABC')modules.push('release-preparation-evidence','release-admission-timing');
  const chromeBase=path.resolve('C:/Program Files/Google/Chrome/Application'),chromeVersions=(await readdir(chromeBase,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^\d+\.\d+\.\d+\.\d+$/.test(e.name));assert.equal(chromeVersions.length,1);
  const uiClosure=[...await treeFiles(path.join(candidate,'node_modules/playwright-core')),await file(path.join(chromeBase,'chrome.exe')),...await treeFiles(path.join(chromeBase,chromeVersions[0].name))];
  const collectorFiles=[await file(node),...uiClosure,...await Promise.all(modules.map(n=>file(path.join(candidate,'tools',n+'.mjs')))),
    await file(path.join(candidate,'node_modules/typescript/lib/typescript.js')),await file(path.join(candidate,'node_modules/typescript/package.json')),
    await file(testsPath),...evidence,...await Promise.all(['candidate-handoff.json','adapter.mjs','validators.mjs','historical-audit-sha.json','read-watchdog-task.ps1','resource-inventory.json','production-ui.mjs','ui-audit.mjs','ui-icon-witness.json','ui-scope.json','collector.mjs','python-closure.mjs','python-closure.json','primary-entrypoint-preservation.json',...protectedBefore.filter(e=>e.archive).map(e=>e.archive)].map(n=>file(path.join(root,n)))),...nativeFiles];
  const dwsBinary=await file(path.resolve(process.env.APPDATA,'npm/node_modules/dingtalk-workspace-cli/vendor/dws.exe'));collectorFiles.push(dwsBinary);
  const batchPath=path.join(root,'approved-batch.json');
  const collector={executable:node,args:[path.join(root,'collector.mjs'),root],cwd:source,
    files:[...new Map(collectorFiles.map(f=>[f.path,f])).values()]};
  const owner=randomBytes(16).toString('hex'),bi=sourceInventory(before),ai=sourceInventory(after);
  const binding={sourceSha256:identity.sourceTree.sha256,predecessorSourceSha256:sourceTreeDigest(before),sourceInventorySha256:hash(ai),predecessorInventorySha256:hash(bi),dependencySha256:manifest.source.packageLockSha256,
    toolchainSha256:hash({node:identity.nodeExecutableSha256,toolchain:identity.toolchain}),configurationSha256:hash({environment:identity.environmentSha256,runtime:identity.runtimeConfigurationSha256,npm:identity.externalNpmConfiguration}),
    artifactSha256:original.workerPlan.candidateManifestSha256,testsSha256:hash(tests),predecessorSha256:original.predecessor.bindingSha256,workerPlanSha256:original.workerPlan.planSha256,
    maintenanceId:owner,djangoPredecessorSha256:original.djangoManifestSha256,djangoCandidateSha256:original.djangoManifestSha256};
  const a=(key,equals)=>({path:key,equals}),operations=[{id:'reuse-reviewed-worker',phase:'prepare',kind:'worker-plan',mutating:false,planSha256:binding.workerPlanSha256}];
  const rehearsal={pre:randomBytes(6).toString('hex'),post:randomBytes(6).toString('hex')};
  const backup=label=>operations.push({id:'backup-'+label,phase:'backup-'+label,kind:'backup',mutating:true,command:{executable:shell,args:['-NoProfile','-NonInteractive','-File',op,'-Action','Backup','-Execute'],cwd:source,timeoutMs:1800000,files:nativeFiles},assertions:[a('status','completed'),a('serviceStateChanged',false)]});
  const restore=(label,port)=>operations.push({id:'restore-'+label,phase:'restore-'+label,kind:'restore',mutating:true,backupOperationId:'backup-'+label,command:{executable:shell,args:['-NoProfile','-NonInteractive','-File',op,'-Action','RestoreRehearsal','-Execute','-ConfirmedIsolatedRestore','-BackupDirectory',`{receipt:backup-${label}:backupDirectory}`,'-ApprovedManifestSha256',`{receipt:backup-${label}:manifestSha256}`,'-RehearsalId',rehearsal[label],'-RehearsalPort',String(port),'-RehearsalDrive','E'],cwd:source,timeoutMs:1800000,files:nativeFiles},assertions:[a('status','completed'),a('serviceStateChanged',false),a('productionDatabaseTouched',false),a('cleanupStatus','isolated_data_removed'),a('profileRestoreVerified',true),a('sequenceHealthVerified',true)]});
  const lifecycleFiles=[await file(shell),await file(wrap),await file(path.resolve(candidate,'tools/process-deadline.ps1'))];
  const managedNames=['operations-system-control.ps1','worker-local-service.ps1'];
  const managedBefore=await Promise.all(managedNames.map(n=>file(path.resolve('D:/运营管理系统/tools',n))));
  const managedAfter=await Promise.all([...managedNames,'process-deadline.ps1'].map(async n=>({path:path.resolve('D:/运营管理系统/tools',n),sha256:await safeFileDigest(path.resolve(candidate,'tools',n))})));
  function lifecycle(step,phase,args,covers=[]) { operations.push({id:step.toLowerCase(),phase,kind:'lifecycle',step,mutating:step!=='VerifyStartup',covers,
    command:{executable:shell,args:['-NoProfile','-NonInteractive','-File',wrap,'-Step',step,...args],cwd:source,timeoutMs:1800000,files:[...new Map([...lifecycleFiles,...nativeFiles,...(phase==='drain'?managedBefore:managedAfter)].map(f=>[f.path,f])).values()]},assertions:[a('status','completed'),...(phase==='drain'?[a('drainConfirmed',true)]:[])]}); }
  const adapterFiles=[await file(node),...await Promise.all(['adapter.mjs','validators.mjs','candidate-handoff.json','historical-audit-sha.json','read-watchdog-task.ps1'].map(n=>file(path.join(root,n))))];
  function adapter(id,phase,action,args,assertions,covers=[],mutating=false,extra=[]) { operations.push({id,phase,kind:'command',mutating,covers,command:{executable:node,args:[path.join(root,'adapter.mjs'),action,root,...args],cwd:source,timeoutMs:600000,files:[...adapterFiles,...extra]},assertions}); }
  backup('pre');restore('pre',55592);
  lifecycle('EnterMaintenance','drain',['-MaintenanceId',owner,'-KeepPostgres']);
  operations.push({id:'apply-reviewed-worker',phase:'switch',kind:'worker-apply',mutating:true,planSha256:binding.workerPlanSha256});
  lifecycle('ExitMaintenance','switch',['-MaintenanceId',owner]);
  lifecycle('StartWorker','switch',['-MaintenanceId',owner,'-ExpectedWorkerManifestSha256',binding.artifactSha256,'-ExpectedDjangoManifestSha256',binding.djangoCandidateSha256]);
  const recoveryArgs=(label,port)=>[label,...['backupDirectory','manifestSha256'].map(k=>`{receipt:backup-${label}:${k}}`),rehearsal[label],String(port)];
  adapter('preserve-pre-recovery','acceptance','preserve-recovery',recoveryArgs('pre',55592),[a('status','passed'),a('fullRecoveryMetadataPreserved',true)]);
  adapter('verify-all-resources','acceptance','resources',[],[a('status','passed'),a('resourcesVerified',true)],['resources'],false,[await file(path.join(root,'resource-inventory.json'))]);
  const snapshotFiles=await Promise.all(modules.map(n=>file(path.resolve(candidate,'source-snapshot/tools',n+'.mjs'))));
  const uiFiles=[await file(node),await file(ui.scriptPath),await file(path.join(root,'candidate-handoff.json')),await file(path.join(root,'resource-inventory.json')),
    await file(ui.uiModule),...snapshotFiles,await file(path.join(root,'ui-audit.mjs')),await file(path.join(root,'ui-icon-witness.json')),...uiClosure];
  operations.push({id:'actual-readonly-ui',phase:'acceptance',kind:'command',mutating:false,covers:['task-specific'],command:{executable:node,args:[ui.scriptPath],cwd:source,timeoutMs:600000,files:[...new Map(uiFiles.map(f=>[f.path,f])).values()]},assertions:[a('status','passed'),a('fourFixesProductionUi',true),a('productionWrites',0),a('cases',4)]});
  adapter('unsigned-reader-permission-denials','acceptance','unsigned-permission-denials',[],[a('status','passed'),a('liveUnsignedReaderGetDenied',true),a('isolatedRoleAndScopeMatrixPassed',true),a('originalOwnerManifestVerified',true)],['permissions'],false,[await file(ownerManifest)]);
  const statusHost=await file(shell);
  function fullStatus(operationId,phase,covers) { operations.push({id:operationId,phase,kind:'command',mutating:false,covers,readOnlyRetry:{version:'teruisi-status-retry-v1',totalTimeoutMs:240000},
    command:{executable:shell,args:['-NoProfile','-NonInteractive','-File',path.resolve('D:/运营管理系统/tools/operations-system-control.ps1'),'-Action','Status','-Json'],cwd:source,timeoutMs:240000,files:[...new Map([statusHost,...managedAfter,...nativeFiles].map(f=>[f.path,f])).values()]},
    assertions:[a('state','Running'),a('backendState','Ready'),a('workerState','exact_release'),a('releaseId',original.workerPlan.candidateReleaseId),...components.map(c=>a('components.'+c,true))]}); }
  fullStatus('complete-component-readiness','acceptance',['components']);lifecycle('VerifyStartup','acceptance',[],['startup']);
  const watchdogPins=await Promise.all([powerShellPath,path.resolve(candidate,'source-snapshot/tools/operations-system-watchdog.ps1'),path.resolve(candidate,'source-snapshot/tools/process-deadline.ps1'),
    path.resolve(candidate,'source-snapshot/tools/watchdog-launcher/NoConsoleLauncher.cs'),launcherPath].map(file));watchdogPins.push(dwsBinary,...managedAfter);
  adapter('install-reviewed-watchdog','acceptance','watchdog-install',[],[a('status','passed'),a('originalWatchdogInstallationBound',true),a('existingTaskActionUpdatedAndStarted',true)],[],true,[...watchdogPins,...snapshotFiles]);
  adapter('two-natural-watchdogs','acceptance','natural-watchdog',[],[a('status','passed'),a('twoNaturalHealthy',true),a('allFreshObservationsPreserved',true)],['natural-watchdog']);
  backup('post');restore('post',55593);
  adapter('preserve-post-recovery','closeout','preserve-recovery',recoveryArgs('post',55593),[a('status','passed'),a('fullRecoveryMetadataPreserved',true)]);
  adapter('full-postgresql-deep-comparison','closeout','deep-recovery-comparison',['{receipt:backup-pre:manifestSha256}','{receipt:backup-post:manifestSha256}'],
    [a('status','passed'),a('completeBusinessContentEqual',true),a('migrationsEqual',true),a('roleAndPermissionCatalogueEqual',true),a('unauthorizedContentChanges',0),a('productionWriteTestPerformed',false)],['business','migrations','writes']);
  adapter('original-historical-audits-preserved','closeout','historical-audits',[],[a('status','passed'),a('originalAuditBytesPreserved',true)]);
  fullStatus('exact-final-readiness','closeout',[]);
  const batch=makeBatch({id,binding,before,after,witness:null,evidence:null,current:null,tests,acceptance:lib.requirements.strict.acceptance,
    rollback:{application:'Original controlled compatible D5 '+original.predecessor.releaseId+' / '+original.predecessor.manifestSha256,
      compatibility:'No application/dependency/Django deployment or new migration. Preserve guard/authority/fence/successor history. Data restore requires separate exact retained point approval.',
      failureState:'Retain every original started/unknown/failed/reconciliation and exact owner; no replay/hand deletion. Post backup may rotate pre dump; preserved pre JSON is not a recoverable payload.'},operations,collector});
  assert.equal(batch.impact.level,'strict');assert.equal(batch.recovery.mode,'full');
  const spec=canonical({batch,collector,journalRoot:h.journalRoot})+'\n';assert.ok(Buffer.byteLength(spec)<=16*1024*1024);
  // Publish only after all concrete operations/assertions/closures validate.
  await json('sealed-plan.json',{status:'validated-awaiting-authority-file',scope,id,batchSha256:batch.batchSha256,batchFileSha256:sha(spec),sourceCommit:original.sourceGitCommit,
    candidate:original.workerPlan.candidateReleaseId,manifest:binding.artifactSha256,plan:binding.workerPlanSha256,maintenanceId:owner,rehearsal,operations:operations.map(o=>({id:o.id,phase:o.phase,mutating:o.mutating,covers:o.covers??[]})),
    currentMutableSourceMatches:true,productionApproval:false,productionAdopted:false,nativeSchedulerLatest:'unknown',recoveryFastPathEligible:false,notificationBoundary:h.approvalScopeIncludes});
  // The fsynced create-only authority is published LAST. Metadata alone never
  // establishes a sealed batch; readers must verify the exact authority bytes.
  await put('approved-batch.json',spec);authorityConfirmed=true;
  console.log(canonical({status:'sealed-not-approved',scope,root,batchSha256:batch.batchSha256,operations:operations.length}));
} catch(error) {
  const authorityPresent=await lstat(path.join(root,'approved-batch.json')).then(()=>true,()=>false);
  const status=authorityConfirmed?'sealed-not-approved-reporting-failed':authorityPresent?'authority-present-durability-unconfirmed-not-approved':'not-sealed-not-approved';
  await json('attempt-failure.json',{status,authorityPresent,authorityConfirmed,code:error.code??'INPUT_OR_ASSERTION_FAILED',messageSha256:sha(String(error.message))});
  console.error(canonical({status,scope,root,code:error.code??'INPUT_OR_ASSERTION_FAILED'}));process.exitCode=1;
}
