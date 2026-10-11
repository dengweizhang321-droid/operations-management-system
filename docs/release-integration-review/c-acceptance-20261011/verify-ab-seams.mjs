// Candidate-bound A/B regression harness. Uses private fixtures, never invokes a
// production service Action. Does not modify candidate or test assertions.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T034516Z-f308beaede528df7';
const revision=process.argv[2]??'v1';
if(!['v1','v2'].includes(revision))throw Error('Unknown harness revision');
const archive='E:/codex-artifacts/release-c-acceptance-20261011/ab-seams-'+revision;
const snapshot=path.join(candidate,'source-snapshot');
const candidateManifestSha256=hash(fs.readFileSync(path.join(candidate,'deployment-manifest.json')));
if(candidateManifestSha256!=='20855e01531d0a089cccfd01d5287aba774991cc2fe06747424a72a3ce1ff3ed')throw Error('Candidate identity changed');
fs.mkdirSync(path.join(archive,'harness'),{recursive:true});
const pins=new Map(),tests=[];
function pin(p){const sha256=hash(fs.readFileSync(p));pins.set(p,sha256);return p;}
function tool(name){const bundled=path.join(candidate,'tools',name);return pin(fs.existsSync(bundled)?bundled:path.join(snapshot,'tools',name));}
const names=['release-process-deadline.test.mjs','release-batch-powershell-environment.test.mjs','release-acceptance-closeout.test.mjs'];
for(const name of names){const original=fs.readFileSync(path.join(repo,'tests',name));let content=original.toString();
  content=content.replace(/'\.\.\/tools\/([^']+)'/g,(_,n)=>JSON.stringify(pathToFileURL(tool(n)).href));
  content=content.replace(/path\.resolve\('tools\/([^']+)'\)/g,(_,n)=>JSON.stringify(tool(n)));
  content=content.replace("path.resolve('tests/fixtures/release-process-child.mjs')",JSON.stringify(pin(path.join(snapshot,'tests/fixtures/release-process-child.mjs'))));
  if(name==='release-acceptance-closeout.test.mjs'){
    content=content.replace("'esbuild'",JSON.stringify(pathToFileURL(pin(path.join(candidate,'node_modules/esbuild/lib/main.js'))).href));
    content=content.replace("'playwright-core'",JSON.stringify(pathToFileURL(pin(path.join(candidate,'node_modules/playwright-core/index.mjs'))).href));
    content=content.replace("fileURLToPath(new URL('../', import.meta.url))",JSON.stringify(snapshot));
    content=content.replace("fileURLToPath(new URL('../app/globals.css', import.meta.url))",JSON.stringify(path.join(snapshot,'app/globals.css')));
    content=content.replace("fileURLToPath(new URL('../node_modules/tailwindcss/index.css', import.meta.url))",JSON.stringify(path.join(candidate,'node_modules/tailwindcss/index.css')));
    for(const n of ['release-history-preservation.test.py','release-closeout-independent.test.py'])content=content.replace(`fileURLToPath(new URL('./${n}', import.meta.url))`,JSON.stringify(path.join(snapshot,'tests',n)));
  }
  let fixtureRecoveryFieldsAdded=0;
  if(revision==='v2'&&name==='release-process-deadline.test.mjs'){
    for(const needle of ["batch:{id:'isolated-negative'","const batch={id:'isolated-start'"]){
      if(content.split(needle).length!==2)throw Error('Original A fixture constructor changed');
      content=content.replace(needle,needle.replace('{id:',"{recovery:{mode:'full'},id:"));fixtureRecoveryFieldsAdded++;
    }
  }
  const file=path.join(archive,'harness',name),raw=Buffer.from(content);fs.writeFileSync(file,raw,{flag:'wx'});
  tests.push({name,file,originalTestSha256:hash(original),harnessSha256:hash(raw),assertionsChanged:false,pathRebasingOnly:fixtureRecoveryFieldsAdded===0,fixtureRecoveryFieldsAdded});
}
const cwd=repo,testSourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
const controls=[{name:'A-deadline',file:tests[0].file,pattern:revision==='v2'?'approved runner rejects|original nested PS5 adapter':null},{name:'AB-PS5-environment',file:tests[1].file,pattern:null},{name:'B-readonly-retry-and-report',file:tests[2].file,pattern:'classified temporary|exhausted transient|terminal status|unknown errors|one total deadline|retry waits|complete readiness|retry declaration|bounded native|timing unions|uncompleted batch|offline report'}];
const initial={version:'teruisi-candidate-ab-seams-harness-v1',at:new Date().toISOString(),candidateManifestSha256,testSourceCommit,cwd,tests,pins:[...pins].map(([file,sha256])=>({file,sha256})),controls,productionOperations:0,uiBrowserAndPythonDomainTestsNotSelected:true,heavyBuildsAndDatabaseRestoreNotRun:true};
fs.writeFileSync(path.join(archive,'HARNESS.json'),JSON.stringify(initial,null,2)+'\n',{flag:'wx'});
for(const control of controls){const args=['--test','--test-concurrency=1'];if(control.pattern)args.push('--test-name-pattern',control.pattern);args.push(control.file);
  const startedAt=new Date().toISOString(),start=performance.now(),out=fs.openSync(path.join(archive,control.name+'.stdout.log'),'wx'),err=fs.openSync(path.join(archive,control.name+'.stderr.log'),'wx');
  const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore',out,err]});console.log(JSON.stringify({name:control.name,pid:child.pid,startedAt}));
  const result=await new Promise(resolve=>{child.once('error',error=>resolve({exitCode:null,error:error.message}));child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});
  fs.closeSync(out);fs.closeSync(err);const finishedAt=new Date().toISOString();
  const summary={...result,name:control.name,startedAt,finishedAt,elapsedMs:performance.now()-start,executable:process.execPath,args,cwd};
  fs.writeFileSync(path.join(archive,control.name+'.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
  if(result.exitCode!==0){process.exitCode=1;break;}
}
const drift=[...pins].filter(([file,sha256])=>hash(fs.readFileSync(file))!==sha256).map(([file])=>file);
const manifestStable=hash(fs.readFileSync(path.join(candidate,'deployment-manifest.json')))===candidateManifestSha256;
fs.writeFileSync(path.join(archive,'FINAL.json'),JSON.stringify({at:new Date().toISOString(),candidateManifestSha256,manifestStable,drift,processExitCode:process.exitCode??0,finalCAdoptionAccepted:false,productionOperations:0},null,2)+'\n',{flag:'wx'});
if(drift.length||!manifestStable)throw Error('Tested candidate drifted');
