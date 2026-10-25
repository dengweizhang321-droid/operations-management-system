"""Create-only preservation of the exact retired diagnostic worktree. No removal."""
import pathlib, subprocess, json, hashlib, os, stat, tarfile, uuid, datetime, sys
target=pathlib.Path('D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023')
docs=pathlib.Path('D:/codex-worktrees/s05d-diagnostic-cleanup-20261023/docs/s05d-diagnostic-cleanup-20261023')
base=pathlib.Path('D:/codex-artifacts/s05d-diagnostic-cleanup-20261023')
head='36668589cab03d5d2d9d98383fb58eeb19c391ee'
gitexe='D:/git/Git/cmd/git.exe'
def git(*args): return subprocess.check_output([gitexe,'-C',str(target),*args])
def sha(b): return hashlib.sha256(b).hexdigest()
def sig(s): return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink]
assert str(target.resolve()).casefold()==str(target).casefold()
for p in [target,*target.parents]:
 s=p.lstat();assert not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400
assert git('rev-parse','HEAD').decode().strip()==head
assert git('diff','--name-only','HEAD','--')==b''
assert git('ls-files','--others','--ignored','--exclude-standard','-z')==b''
assert all(x.startswith(b'H ') for x in git('ls-files','-v','-z').split(b'\0') if x)
scope=json.loads(pathlib.Path('D:/codex-worktrees/s05d-field-validation-20261023/docs/s05d-field-validation-20261023/scope-blocker.json').read_text(encoding='utf-8'))
extra=sorted(scope['extra']);assert len(extra)==44
assert sorted(x.decode() for x in git('ls-files','--others','--exclude-standard','-z').split(b'\0') if x)==extra
tracked={}
for row in git('ls-tree','-r','-z',head).split(b'\0'):
 if not row:continue
 meta,name=row.split(b'\t',1);mode,kind,oid=meta.split();assert kind==b'blob' and mode in [b'100644',b'100755'];tracked[name.decode()]=oid.decode()
actual=[];dirs=[]
def walk(p):
 for entry in os.scandir(p):
  st=entry.stat(follow_symlinks=False);assert not stat.S_ISLNK(st.st_mode) and not getattr(st,'st_file_attributes',0)&0x400
  name=pathlib.Path(entry.path).relative_to(target).as_posix()
  if entry.is_dir(follow_symlinks=False):dirs.append(name);assert len(dirs)<10000;walk(entry.path)
  else:assert stat.S_ISREG(st.st_mode);actual.append(name);assert len(actual)<20000
walk(target)
assert set(actual)==set(tracked)|set(extra)|{'.git'},'Unknown physical members'
backup=pathlib.Path(sys.argv[1]) if len(sys.argv)==2 else base/('preserved-'+str(uuid.uuid4()))
assert backup.parent==base and backup.name.startswith('preserved-')
if backup.exists():assert str(backup.resolve()).casefold()==str(backup).casefold() and not (backup/'MANIFEST.json').exists()
else:backup.mkdir()
rows=[]
for name in extra:
 p=target/name;before=p.lstat();assert before.st_nlink==1 and before.st_size<8*1024*1024
 with p.open('rb') as f:
  opened=os.fstat(f.fileno())
  # This Windows Python build reports differing ctime views for path/handle.
  # Cross-bind identity/size/mtime/link count; keep each full view stable itself.
  if [sig(opened)[i] for i in [0,1,2,3,5]]!=[sig(before)[i] for i in [0,1,2,3,5]]:
   (backup/'FAILED.json').write_text(json.dumps(dict(file=name,before=[str(x) for x in sig(before)],opened=[str(x) for x in sig(opened)])),encoding='utf-8')
   raise AssertionError('Path/handle signature differs: '+name)
  raw=f.read();assert sig(os.fstat(f.fileno()))==sig(opened)
 assert sig(p.lstat())==sig(before)
 out=backup/'files'/name;out.parent.mkdir(parents=True,exist_ok=True)
 if not out.exists():
  with out.open('xb') as f:f.write(raw)
 assert out.read_bytes()==raw
 rows.append(dict(path=name,bytes=len(raw),sha256=sha(raw),sourceSignature=[str(x) for x in sig(before)],handleSignature=[str(x) for x in sig(opened)]))
archive=backup/'tracked.tar'
if not archive.exists():subprocess.check_call([gitexe,'-C',str(target),'archive','--format=tar','--output',str(archive),head])
seen=set();transforms=[]
with tarfile.open(archive,'r:') as tf:
 for m in tf:
  if m.isdir():continue
  assert m.isfile() and m.name in tracked and m.name not in seen
  data=tf.extractfile(m).read()
  def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
  if blob(data)!=tracked[m.name]:
   attrs=git('check-attr','-z','text','eol','--',m.name).split(b'\0')
   assert attrs==[m.name.encode(),b'text',b'set',m.name.encode(),b'eol',b'crlf',b''],'Unqualified archive transform'
   assert blob(data.replace(b'\r\n',b'\n'))==tracked[m.name]
   transforms.append(dict(path=m.name,transform='explicit tracked text/eol=crlf archive checkout conversion'))
  seen.add(m.name)
assert seen==set(tracked)
for r in rows:assert sha((target/r['path']).read_bytes())==r['sha256'] and sha((backup/'files'/r['path']).read_bytes())==r['sha256']
record=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),target=str(target),head=head,branch=git('branch','--show-current').decode().strip(),backup=str(backup),extraCount=len(rows),extraBytes=sum(x['bytes'] for x in rows),trackedCount=len(tracked),archive=dict(path=str(archive),bytes=archive.stat().st_size,sha256=sha(archive.read_bytes()),gitBlobContentsVerified=True,qualifiedCheckoutTransforms=transforms),files=rows,physicalMembersVerified=True,reparsePoints=False,ignoredFiles=[],trackedDiff=[],removed=False)
raw=(json.dumps(record,ensure_ascii=False,indent=2)+'\n').encode()
(backup/'MANIFEST.json').write_bytes(raw)
(docs/'preservation.json').write_bytes(raw)
(backup/'RESTORE.txt').write_text('Restore tracked baseline with git worktree add at commit '+head+' into a new unique path; overlay the 44 files from files/ preserving relative paths. Do not copy an old .git pointer. tracked.tar is an independently verified portable Git baseline. Verify all MANIFEST hashes first. No restoration is performed automatically.\n',encoding='utf-8')
print(json.dumps(dict(backup=str(backup),extraCount=len(rows),extraBytes=record['extraBytes'],trackedCount=len(tracked),manifestSha256=sha(raw),archiveSha256=record['archive']['sha256'],removed=False)))
