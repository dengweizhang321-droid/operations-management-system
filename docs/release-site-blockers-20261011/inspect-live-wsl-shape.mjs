import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exe='C:/Windows/System32/wsl.exe';
function run(args,input){const r=spawnSync(exe,args,{input,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr.toString());return r.stdout;}
function list(){const b=run(['--list','--running','--quiet']);return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().split(/[\r\n]+/).filter(Boolean).sort();}
const before=list();assert.deepEqual(before,['TERUISI-Pandas']);
const script=String.raw`import os,json
def text(p):
 with open(p) as f: return f.read(1048576)
def start(pid):return text('/proc/'+pid+'/stat').rsplit(')',1)[1].split()[19]
def epoch():return {'bootId':text('/proc/sys/kernel/random/boot_id').strip(),'btime':next(x.split()[1] for x in text('/proc/stat').splitlines() if x.startswith('btime ')),'pid1Start':start('1'),'osrelease':text('/proc/sys/kernel/osrelease').strip()}
first=epoch();namespaces={};errors=[]
for p in sorted(x for x in os.listdir('/proc') if x.isdecimal()):
 try:namespaces.setdefault(os.readlink('/proc/'+p+'/ns/mnt'),[]).append(int(p))
 except OSError as e:errors.append({'pid':int(p),'errno':e.errno})
mounts=[]
for line in text('/proc/self/mountinfo').splitlines():
 a,b=line.split(' - ',1);x=a.split();y=b.split();mounts.append({'id':x[0],'parent':x[1],'device':x[2],'root':x[3],'mount':x[4],'fstype':y[0],'source':y[1],'options':y[2] if y[0] in ('9p','drvfs') else None})
print(json.dumps({'before':first,'after':epoch(),'selfNamespace':os.readlink('/proc/self/ns/mnt'),'namespaces':namespaces,'mounts':mounts,'errors':errors,'scope':'Only proc epoch/mount/namespace metadata; no business file reads or service actions'}))
`;
const result=JSON.parse(run(['--distribution','TERUISI-Pandas','--user','root','--exec','/usr/bin/python3','-I','-S','-'],script));
const after=list();assert.deepEqual(before,after);assert.deepEqual(result.before,result.after);
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_WSL_SHAPE_V1.json',JSON.stringify({runningBefore:before,runningAfter:after,...result},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
