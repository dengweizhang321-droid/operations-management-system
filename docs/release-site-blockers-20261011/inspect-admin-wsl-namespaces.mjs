import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
function run(args,input){const r=spawnSync('C:/Windows/System32/wsl.exe',args,{input,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});assert.equal(r.error,undefined);assert.equal(r.status,0);return r.stdout;}
function list(){const b=run(['--list','--running','--quiet']);return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().split(/[\r\n]+/).filter(Boolean).sort();}
assert.deepEqual(list(),['TERUISI-Pandas']);
const source=String.raw`import os,json,hashlib
spaces={};errors=[]
for pid in sorted((p for p in os.listdir('/proc') if p.isdecimal()),key=int):
 try:spaces.setdefault(os.readlink('/proc/'+pid+'/ns/mnt'),pid)
 except OSError as e:errors.append({'pid':pid,'errno':e.errno})
out=[]
for ns,pid in spaces.items():
 try:
  with open('/proc/'+pid+'/mountinfo') as f:text=f.read(1048577)
  if len(text)>1048576:raise ValueError('mountinfo limit')
  rows=[]
  for line in text.splitlines():
   a,b=line.split(' - ',1);x=a.split();y=b.split();rows.append({'device':x[2],'root':x[3],'mount':x[4],'fstype':y[0],'source':y[1],'options':y[2]})
  out.append({'namespace':ns,'representativePid':pid,'sha256':hashlib.sha256(text.encode()).hexdigest(),'mounts':rows,'namespaceStable':os.readlink('/proc/'+pid+'/ns/mnt')==ns})
 except (OSError,ValueError) as e:errors.append({'pid':pid,'error':type(e).__name__,'errno':getattr(e,'errno',None)})
print(json.dumps({'namespaces':out,'errors':errors}))
`;
const result=JSON.parse(run(['--distribution','TERUISI-Pandas','--user','root','--exec','/usr/bin/python3','-I','-S','-'],source));
assert.deepEqual(list(),['TERUISI-Pandas']);
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/PRIMARY_ADMIN_WSL_NAMESPACES_V1.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({errors:result.errors,namespaces:result.namespaces.map(n=>({namespace:n.namespace,pid:n.representativePid,stable:n.namespaceStable,mounts:n.mounts.filter(m=>['9p','drvfs'].includes(m.fstype))}))},null,2));
