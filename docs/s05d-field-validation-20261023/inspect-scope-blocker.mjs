import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023';
const prior='D:/codex-artifacts/s05d-residual-classification-20261023/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88.observation.json';
const bytes=await fs.readFile(prior),sha=crypto.createHash('sha256').update(bytes).digest('hex');
if(sha!=='cbdab9cbdaca750354df19a92d5ad4448b34b957af10a74d844f339da2cf0f54')throw Error('Prior baseline changed');
const expected=Object.keys(JSON.parse(bytes).sourceInventory).sort();
const git=(...args)=>execFileSync('D:/git/Git/cmd/git.exe',['-C',root,...args],{windowsHide:true,maxBuffer:8*1024*1024}).toString('utf8');
const names=git('ls-files','-z','--cached','--others','--exclude-standard').split('\0').filter(Boolean).sort();
if(names.length>30000)throw Error('Member bound');
const actual=[],absent=[];
for(const n of names){if(n==='.dev.vars'||['dist/','node_modules/','.git/','.runtime/','outputs/','tmp/'].some(x=>n.startsWith(x)))continue;let st;try{st=await fs.lstat(root+'/'+n);}catch(e){if(e.code!=='ENOENT')throw e;absent.push(n);continue;}if(!st.isFile()||st.isSymbolicLink())throw Error('Nonregular member');actual.push(n);}
const wanted=new Set(expected),seen=new Set(actual);
const result={at:new Date().toISOString(),readOnly:true,root,head:git('rev-parse','HEAD').trim(),priorObservationSha256:sha,expectedCount:expected.length,actualCount:actual.length,extra:actual.filter(x=>!wanted.has(x)),missing:expected.filter(x=>!seen.has(x)),listedButAbsent:absent,trackedDiff:git('diff','--name-only','-z','36668589cab03d5d2d9d98383fb58eeb19c391ee','--').split('\0').filter(Boolean),scope:'Member-only explanation of exact collector refusal; not a complete byte-difference proof or source exclusion'};
await fs.writeFile('D:/codex-worktrees/s05d-field-validation-20261023/docs/s05d-field-validation-20261023/scope-blocker.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,extra:result.extra.slice(0,8)}));
