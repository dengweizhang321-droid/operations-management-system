import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),baseline='bab42d8ce836b4ee9acd82e80de085ff71f9f494';
const tracked=new Set(execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8',windowsHide:true}).split('\n'));
const changed=execFileSync('git',['diff','--name-only',baseline],{encoding:'utf8',windowsHide:true}).trim().split('\n');
const sources=new Map(changed.filter(f=>tracked.has(f)&&/\.tsx?$/.test(f)).map(f=>[f,execFileSync('git',['show',baseline+':'+f],{encoding:'utf8',windowsHide:true})]));
const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const relative=f=>path.relative(root,f).split(path.sep).join('/');
function check(isBaseline) {
  const host=ts.createCompilerHost(parsed.options),read=host.readFile,exists=host.fileExists;
  if(isBaseline){
    host.readFile=f=>sources.get(relative(f))??read(f);
    host.fileExists=f=>relative(f).startsWith('node_modules/')?exists(f):tracked.has(relative(f))&&exists(f);
    host.getSourceFile=(f,languageVersion,onError)=>{const source=host.readFile(f);if(source===undefined){onError?.('missing source');return undefined;}return ts.createSourceFile(f,source,languageVersion);};
  }
  const program=ts.createProgram(parsed.fileNames.filter(f=>!isBaseline||tracked.has(relative(f))),{...parsed.options,noEmit:true,incremental:false},host);
  return ts.getPreEmitDiagnostics(program).map(d=>({file:d.file?relative(d.file.fileName):null,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
}
const before=check(true),after=check(false),key=d=>JSON.stringify(d),old=new Set(before.map(key));
const added=after.filter(d=>!old.has(key(d)));
await writeFile('docs/performance/products/evidence/typescript.json',JSON.stringify({baseline,method:'same installed locked dependencies and config; TypeScript compiler host overrides changed tracked sources from git and excludes files absent in baseline; diagnostics compare file/code/message, not moving line numbers',baselineCount:before.length,candidateCount:after.length,added,before,after},null,2));
console.log({baseline:before.length,candidate:after.length,added:added.length});if(added.length)process.exitCode=1;
