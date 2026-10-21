/** Offline candidate checks only. Never adopts a control plane or runs lifecycle actions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {canonical,sha} from '../../tools/main-prebuild-queue.mjs';
import {controlFiles} from '../../tools/install-main-prebuild.mjs';
const execute=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),out=path.join(import.meta.dirname,'evidence'),base='f641685b60ca11a674da713e3b7b454f338c622c';await fs.mkdir(out,{recursive:true});
const records=[],env={...process.env,PATH:'D:/teruisi-runtime/tools/pwsh;'+process.env.PATH};
async function run(name,exe,args){const startedAt=new Date().toISOString();let result;try{result=await execute(exe,args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});result.code=0;}catch(e){result=e;}const stdout=Buffer.from(result.stdout??''),stderr=Buffer.from(result.stderr??'');await fs.writeFile(path.join(out,name+'.stdout.log'),stdout);await fs.writeFile(path.join(out,name+'.stderr.log'),stderr);const record={name,command:[exe,...args],startedAt,completedAt:new Date().toISOString(),exitCode:result.code??-1,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};records.push(record);console.log(JSON.stringify(record));return record.exitCode===0;}
const changed=(await execute('git',['diff','--name-only',base],{cwd:root,encoding:'utf8',windowsHide:true})).stdout;
const untracked=(await execute('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8',windowsHide:true})).stdout;
const files=[...new Set((changed+'\n'+untracked).trim().split(/\r?\n/).filter(Boolean))];
assert.ok(files.every(n=>n.startsWith('tools/')||n.startsWith('tests/')||n.startsWith('docs/preparation-resolution-20261022/')),'Change escaped tool/test/report scope');
for(const forbidden of ['tools/release-scope-plan.mjs','tools/worker-local-service.ps1','package.json','package-lock.json'])assert.equal(files.includes(forbidden),false,'Out-of-scope file changed');
for(const name of controlFiles)assert.ok((await fs.stat(path.join(root,'tools',name))).isFile());
const syntax=[...new Set([...controlFiles,...files.filter(n=>n.endsWith('.mjs')&&n.startsWith('tools/')).map(n=>n.slice(6))])];
for(const name of syntax){const {stderr}=await execute(process.execPath,['--check',path.join(root,'tools',name)],{encoding:'utf8',windowsHide:true});assert.equal(stderr,'');}
for(const name of ['main-prebuild-queue.mjs','cleaned-preparation-observer.mjs','cleaned-preparation-writer.mjs','schema-rejection-writer.mjs','schema-rejection-observer.mjs','cache-rejection-writer.mjs','cache-rejection-observer.mjs','native-abandonment-writer.mjs','native-abandonment-observer.mjs']){const {stdout}=await execute('git',['show',base+':tools/'+name],{cwd:root,encoding:'buffer',windowsHide:true,maxBuffer:4*1024*1024});assert.equal(sha(stdout),sha(await fs.readFile(path.join(root,'tests/fixtures/legacy-preparation',name))),'Historical fixture changed');}
assert.equal((await fs.readFile(path.join(root,'tools/main-prebuild-queue.mjs'),'utf8')).includes('readFixed'),false);
assert.equal((await fs.readFile(path.join(root,'tools/main-prebuild-queue.mjs'),'utf8')).includes('--native-391'),false);
const legacy=files.filter(n=>n.startsWith('tests/')&&n.endsWith('.test.mjs')&&n!=='tests/main-control-upgrade.test.mjs');
const sourceFiles=[...new Set([...files,...controlFiles.map(n=>'tools/'+n)])].filter(n=>n.startsWith('tools/')||n.startsWith('tests/'));
async function sourceSnapshot(){const result={};for(const name of sourceFiles)result[name]=sha(await fs.readFile(path.join(root,name)));return result;}
const beforeSource=await sourceSnapshot();
await run('node-targeted',process.execPath,['--test','--test-concurrency=1','--test-skip-pattern=real on-demand fixed task',...new Set([...legacy,'tests/preparation-resolution.test.mjs','tests/main-prebuild-queue-v2.test.mjs','tests/main-prebuild-generation-rejection.test.mjs','tests/main-prebuild-task.test.mjs','tests/main-prebuild-status.test.mjs','tests/main-prebuild-hook.test.mjs','tests/main-prebuild-eligibility.test.mjs'])]);
await run('frozen-control-materials',process.execPath,['--test','--test-name-pattern=materials build includes the generic resolution operator without control adoption','tests/main-control-upgrade.test.mjs']);
await run('ps5','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-File','tests/preparation-exit-maintenance.fixture.ps1','-EvidenceDirectory',out]);
await run('ps7','D:/teruisi-runtime/tools/pwsh/pwsh.exe',['-NoProfile','-File','tests/preparation-exit-maintenance.fixture.ps1','-EvidenceDirectory',out]);
const source=await sourceSnapshot();assert.deepEqual(source,beforeSource,'Source changed during checks; rerun affected checks');
const report={version:'teruisi-preparation-resolution-candidate-check-v1',base,status:records.every(r=>r.exitCode===0)?'passed':'failed',source,syntaxFiles:syntax.length,boundary:'tools/tests/docs only; classifier, Worker gate, app and database untouched',controlInstallationPerformed:false,publicationPerformed:false,records};await fs.writeFile(path.join(out,'VALIDATION.json'),canonical(report));if(report.status!=='passed')process.exitCode=1;
