import {execFileSync} from 'node:child_process';

// Batched read-only Git object adapter. Never checks out or imports a producer.
export function readCopyRuleGitSources(sha,cwd,{objectCache=new Map()}={}){
  const options={cwd,windowsHide:true,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']};
  const rows=execFileSync('git',['ls-tree','-r','-z',sha,'--','tools','lib','config','app'],{...options,encoding:'utf8'}).split('\0').filter(Boolean);
  const entries=rows.map(row=>{const [header,p]=row.split('\t');return {oid:header.split(' ')[2],p};}).filter(({p})=>/\.(?:[cm]?[jt]sx?|ps1|json|sql)$/.test(p));
  const unique=[...new Set(entries.map(x=>x.oid))].filter(oid=>!objectCache.has(oid));
  const bytes=unique.length?execFileSync('git',['cat-file','--batch'],{...options,input:unique.join('\n')+'\n'}):Buffer.alloc(0);
  const objects=objectCache;let offset=0;
  for(const expected of unique){
    const newline=bytes.indexOf(10,offset);if(newline<0)throw Error('truncated git object header');
    const [oid,type,length]=bytes.subarray(offset,newline).toString('ascii').split(' ');const size=Number(length);
    if(oid!==expected||type!=='blob'||!Number.isSafeInteger(size)||size<0||size>16*1024*1024)throw Error('unsupported git source object');
    const start=newline+1,end=start+size;if(end>=bytes.length||bytes[end]!==10)throw Error('truncated git source object');
    objects.set(oid,bytes.subarray(start,end).toString('utf8'));offset=end+1;
  }
  return Object.fromEntries(entries.map(({oid,p})=>[p,objects.get(oid)]));
}
