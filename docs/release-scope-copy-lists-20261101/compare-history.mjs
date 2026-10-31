import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {classifyRelease,parseNameStatus} from '../../tools/release-scope-plan.mjs';
import {extractCopyRules,copyRuleSourcePaths} from '../../tools/release-copy-rules.mjs';
import {readCopyRuleGitSources} from '../../tools/release-copy-git-sources.mjs';
const cwd=new URL('../../',import.meta.url);
const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
const end='3ce73dfa87884ceea23f3b71f90b2244704b4170';
const rows=git(['log','--first-parent','--since=2026-10-01T00:00:00+08:00','--format=%H%x09%P%x09%cI%x09%s',end]).trim().split('\n');
const oldText=git(['show',`${end}:tools/release-scope-plan.mjs`]);
// Import only the frozen offline planner, never execute historical lifecycle tools.
const offlineOld=oldText.slice(0,oldText.lastIndexOf('if(process.argv[1]')).replace("const root=fileURLToPath(new URL('../',import.meta.url));","const root='';");
const old=await import(`data:text/javascript;base64,${Buffer.from(offlineOld).toString('base64')}`);
const cache=new Map();
const objectCache=new Map();
const sourcesAt=sha=>{
  const key=git(['ls-tree',sha,'--','tools','lib','config','app']).trim();
  if(!cache.has(key)){
    // Source blobs are immutable Git objects. Limit this offline reuse to64 MB
    // of UTF-16 text; never cache runtime state or qualification results.
    if([...objectCache.values()].reduce((n,s)=>n+s.length*2,0)>64*1024*1024)objectCache.clear();
    try{cache.set(key,extractCopyRules(readCopyRuleGitSources(sha,cwd,{objectCache})));}catch(error){cache.set(key,{known:false,reason:error.message});}
  }
  return cache.get(key);
};
const result=[];
for(const row of rows){
  const [head,parents,date,...subject]=row.split('\t');const base=parents.split(' ')[0];if(!base)continue;
  const changes=parseNameStatus(git(['diff','--name-status','--find-renames=50%','-z',base,head]));
  const hasTools=changes.some(c=>/^tools\//i.test(c.path)||/^tools\//i.test(c.before??''));
  const unaffected={known:true,djangoFiles:[],workerFiles:[],controlFiles:[],notNeeded:'no tools path changed'};
  const before=hasTools?sourcesAt(base):unaffected,after=hasTools?sourcesAt(head):unaffected;
  const rules=before.known&&after.known?{...after,djangoFiles:[...new Set([...before.djangoFiles,...after.djangoFiles])],workerFiles:[...new Set([...before.workerFiles,...after.workerFiles])],controlFiles:[...new Set([...before.controlFiles,...after.controlFiles])]}:{known:false,reason:before.reason??after.reason};
  const previous=old.classifyRelease(changes),next=classifyRelease(changes,{copyRules:rules});
  const changed=JSON.stringify([previous.components,previous.scope,previous.databaseProtection])!==JSON.stringify([next.components,next.scope,next.databaseProtection]);
  result.push({base,head,date,subject:subject.join('\t'),changes,previous,next,changed,copyRuleEvidence:{before,after}});
  if(result.length%100===0)console.log(JSON.stringify({processed:result.length,total:rows.length,ruleVersions:cache.size}));
}
writeFileSync(new URL('./history-comparison.json',import.meta.url),JSON.stringify({end,since:'2026-10-01T00:00:00+08:00',dateField:'committer',traversal:'first-parent',diff:'each first parent to commit; merges include complete net branch diff',count:result.length,changed:result.filter(x=>x.changed).length,rows:result},null,2)+'\n');
const cell=v=>'"'+String(v).replaceAll('"','""')+'"';
const changed=result.filter(x=>x.changed);
writeFileSync(new URL('./changed-judgments.csv',import.meta.url),[['commit','date','subject','oldComponents','newComponents','oldScope','newScope','toolChanges','newReasons'].map(cell).join(','),...changed.map(r=>[r.head,r.date,r.subject,r.previous.components.join('+'),r.next.components.join('+'),r.previous.scope,r.next.scope,r.changes.filter(c=>/^tools\//i.test(c.path)||/^tools\//i.test(c.before??'')).map(c=>`${c.status}:${c.before?c.before+' -> ':''}${c.path}`).join('; '),r.next.reasons.filter(x=>/复制|发布控制/.test(x)).join('; ')].map(cell).join(','))].join('\n')+'\n');
console.log(JSON.stringify({count:result.length,changed:result.filter(x=>x.changed).length,ruleVersions:cache.size}));
