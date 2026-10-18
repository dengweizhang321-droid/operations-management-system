"""Windows-only opt-in private PG / WSL Pi / browser acceptance launcher.

No production configuration is loaded. Dependencies are reused read-only.
"""
import base64,hashlib,io,json,os,pathlib,secrets,shutil,socket,subprocess,sys,tarfile,time,uuid

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
OUT=pathlib.Path(os.environ.get('PI_E2E_OUT','D:/codex-artifacts/pi-phase1-closeout-20261018/e2e'))/('attempt-'+time.strftime('%Y%m%dT%H%M%S'))
OUT.mkdir(parents=True,exist_ok=True)
TMP=OUT/('private-stack-'+uuid.uuid4().hex[:8]);TMP.mkdir(parents=True)
BIN=pathlib.Path('D:/teruisi-runtime/django-sales/postgresql-17.11/bin')
PY=sys.executable
PORT=18143; PGPORT=55543; DJPORT=55562; UIPORT=55563
for p in (PORT,PGPORT,DJPORT,UIPORT):
 with socket.socket() as s:s.bind(('127.0.0.1',p))
namespace='pi-test-e2e-'+uuid.uuid4().hex[:12]
linux='/home/teruisi-pandas/'+namespace
key=secrets.token_bytes(32)
from pandas_runner.key_file import dpapi
(TMP/'key.json').write_text(json.dumps({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
image='sha256:c393a84818c0c7f941803da2db11b1cd94395b8188b69af7294490468a48e26d'
config={'docker':'/usr/bin/docker','socket':'/run/user/1000/docker.sock','image':image,'keyFile':linux+'/key','stateDirectory':linux+'/state','gatewayUrl':'http://127.0.0.1:8112/api/ai/pi/gateway','namespace':namespace}
archive=io.BytesIO()
with tarfile.open(fileobj=archive,mode='w:gz') as t:
 t.add(ROOT/'backend/pi_runner',arcname='backend/pi_runner',filter=lambda m:None if '__pycache__' in m.name else m)
 for name,data in [('key',key),('config.json',json.dumps(config).encode())]:
  member=tarfile.TarInfo(name);member.size=len(data);member.mode=0o600;t.addfile(member,io.BytesIO(data))
setup="import os,sys,pathlib,tarfile;os.umask(0o077);p=pathlib.Path("+repr(linux)+");p.mkdir(mode=0o700);tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz').extractall(p,filter='data');(p/'state').mkdir(mode=0o700)"
subprocess.run(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/python3','-c',setup],input=archive.getvalue(),check=True,creationflags=subprocess.CREATE_NO_WINDOW)
runnerlog=(OUT/'private-runner.log').open('wb')
runner=subprocess.Popen(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1','PYTHONPATH='+linux+'/backend','/usr/bin/python3','-m','pi_runner.server','--config',linux+'/config.json','--port',str(PORT)],stdout=runnerlog,stderr=runnerlog,creationflags=subprocess.CREATE_NO_WINDOW)
password=secrets.token_hex(32);(TMP/'pgpassword').write_text(password)
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE'}}
env.update(PI_E2E_ROOT=str(ROOT),PI_E2E_OUT=str(OUT),PI_E2E_RUNNER_PORT=str(PORT),PI_E2E_DJANGO_PORT=str(DJPORT),PI_E2E_UI_PORT=str(UIPORT),AI_SECRET_ENCRYPTION_KEY=secrets.token_hex(32),TERUISI_DJANGO_AI_WRITER_BASE_URL=f'http://127.0.0.1:{DJPORT}',TERUISI_DJANGO_AI_READER_BASE_URL=f'http://127.0.0.1:{DJPORT+2}',PGHOST='127.0.0.1',PGPORT=str(PGPORT),PGUSER='pi_code_fixture',PGPASSWORD=password,PGDATABASE='teruisi_pi_code',PYTHONUTF8='1',DJANGO_SETTINGS_MODULE='teruisi_backend.settings',TERUISI_DJANGO_DATABASE_URL=f'postgresql://pi_code_fixture:{password}@127.0.0.1:{PGPORT}/teruisi_pi_code',TERUISI_DJANGO_PROCESS_ROLE='development',TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32),DJANGO_SECRET_KEY=secrets.token_hex(32),PYTHONPATH=str(TMP)+os.pathsep+str(ROOT/'backend'),PI_REAL_STACK_TEST='1',PI_REAL_STACK_SKIP_FLUSH='1',PI_RUNNER_HMAC_KEY_FILE=str(TMP/'key.json'),AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST='https://api.openai.com',TERUISI_DJANGO_AI_EDGE_BASE_URL='http://127.0.0.1:3000')
def run(args,label,input_data=None):
 with (OUT/(label+'.log')).open('wb') as f:
  result=subprocess.run([str(x) for x in args],input=input_data,env=env,cwd=ROOT,stdout=f,stderr=f,timeout=1800,creationflags=subprocess.CREATE_NO_WINDOW)
 if result.returncode:raise RuntimeError(label+' failed; see private log')
started=False
passed=False
source_paths=['tests/pi-e2e-run.py','tests/pi-e2e-case.py','tests/pi-e2e-browser.mjs',
 'backend/ai_assistant/pi_service.py','backend/ai_assistant/pi_worker.py',
 'backend/ai_assistant/pi_gateway.py','backend/ai_assistant/pi_exports.py',
 'app/ai-pi-agent-view.tsx','lib/ai/django-route.ts','lib/django/ai-service.ts']
def source_hashes():
 return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_paths}
source_before=source_hashes()
(OUT/'source-binding.json').write_text(json.dumps({'files':source_before,'image':image,'namespace':namespace,'privatePorts':[PORT,PGPORT,DJPORT,UIPORT]},indent=2))
try:
 from pi_runner.client import command
 for _ in range(40):
  try:
   health=command('http://127.0.0.1:'+str(PORT),key,{},path='/v1/status');break
  except Exception:time.sleep(.25)
 else:raise RuntimeError('private runner unavailable')
 if health['namespace']!=namespace:raise RuntimeError('wrong private runner')
 (OUT/'runner-health.json').write_text(json.dumps(health,indent=2))
 print(json.dumps({'phase':'private-runner-ready','namespace':namespace,'port':PORT}),flush=True)
 run([BIN/'initdb.exe','-D',TMP/'data','-U','pi_code_fixture','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile',TMP/'pgpassword'],'init')
 with (TMP/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={PGPORT}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
 run([BIN/'pg_ctl.exe','-D',TMP/'data','-l',TMP/'postgres.log','-w','-t','30','start'],'pg-start');started=True
 run([BIN/'createdb.exe','teruisi_pi_code'],'createdb')
 roles=('teruisi_ai_seal_writer','teruisi_sales_owner','teruisi_ai_reader','teruisi_ai_writer','teruisi_inventory_reader','teruisi_inventory_writer','teruisi_bi_reader','teruisi_finance_reader','teruisi_finance_writer','teruisi_netshop_reader','teruisi_netshop_writer')
 for role in roles:run([BIN/'psql.exe','-v','ON_ERROR_STOP=1','-c',f'CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],'role-'+role)
 shutil.copy2(ROOT/'tests/pi-e2e-case.py',TMP/'live_case.py')
 child=TMP/'test.py'
 child.write_text("import django\ndjango.setup()\nfrom ai_assistant import pi_transport\npi_transport.PORT=18143\nfrom django.test.runner import DiscoverRunner\nraise SystemExit(DiscoverRunner(verbosity=2,interactive=False).run_tests(['live_case.BrowserStackTests']))\n")
 run([PY,child],'real-stack')
 if source_before!=source_hashes():raise RuntimeError('source changed during acceptance; new binding required')
 passed=True
 print(json.dumps({'status':'passed','productionTouched':False,'realPi':True,'privatePostgresPort':PGPORT,'privateRunnerPort':PORT,'provider':'synthetic provider protocol and business fixtures; zero paid requests','namespace':namespace}),flush=True)
finally:
 if started:run([BIN/'pg_ctl.exe','-D',TMP/'data','-m','fast','-w','-t','30','stop'],'pg-stop')
 # Stop only the exact private service by its fixed command/config identity.
 stop="import os,signal;from pathlib import Path\nexpected="+repr(linux+'/config.json')+"\nfor p in Path('/proc').iterdir():\n if p.name.isdigit():\n  try:args=(p/'cmdline').read_bytes().split(b'\\0')\n  except OSError:continue\n  if b'pi_runner.server' in args and expected.encode() in args:os.kill(int(p.name),signal.SIGTERM)"
 subprocess.run(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/python3','-c',stop],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
 runner.wait(timeout=30);runnerlog.close()
 # No production namespace or Docker prune. Remove only exact labelled test volumes.
 cleanup="""import subprocess,json,pathlib,shutil
namespace=NS
image=IMAGE
root=pathlib.Path(LINUX)
env={'PATH':'/usr/bin:/bin','DOCKER_HOST':'unix:///run/user/1000/docker.sock'}
def docker(*a):return subprocess.check_output(['/usr/bin/docker',*a],env=env)
removed_containers=[]
for cid in docker('ps','-aq','--filter','label=teruisi.pi.namespace='+namespace).decode().split():
 meta=json.loads(docker('inspect',cid))[0]
 assert meta['Config']['Labels']['teruisi.pi.namespace']==namespace and meta['Image']==image
 assert meta['Name'].lstrip('/').startswith(namespace+'-')
 docker('rm','-f',cid);removed_containers.append(cid)
removed_volumes=[]
for name in docker('volume','ls','-q','--filter','label=teruisi.pi.namespace='+namespace).decode().split():
 meta=json.loads(docker('volume','inspect',name))[0]
 assert meta['Labels']['teruisi.pi.namespace']==namespace and name.startswith(namespace+'-')
 docker('volume','rm',name);removed_volumes.append(name)
assert not docker('ps','-aq','--filter','label=teruisi.pi.namespace='+namespace).strip()
assert not docker('volume','ls','-q','--filter','label=teruisi.pi.namespace='+namespace).strip()
assert root.parent==pathlib.Path('/home/teruisi-pandas') and root.name==namespace and not root.is_symlink()
shutil.rmtree(root)
print(json.dumps({'namespace':namespace,'containersRemaining':0,'volumesRemaining':0,'removedContainers':removed_containers,'removedVolumes':removed_volumes,'privateLinuxDirectoryRemoved':True}))
""".replace('namespace=NS','namespace='+repr(namespace)).replace('image=IMAGE','image='+repr(image)).replace('pathlib.Path(LINUX)','pathlib.Path('+repr(linux)+')')
 cleaned=subprocess.run(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/python3','-c',cleanup],check=True,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
 cleanup_record=json.loads(cleaned.stdout)
 (TMP/'pgpassword').unlink(missing_ok=True);(TMP/'key.json').unlink(missing_ok=True)
 for port in (PORT,PGPORT,DJPORT,UIPORT):
  for _ in range(20):
   with socket.socket() as probe:
    probe.settimeout(.2)
    if probe.connect_ex(('127.0.0.1',port))!=0:break
   time.sleep(.1)
  else:raise RuntimeError('private port still accepting: '+str(port))
 cleanup_record.update({'portsClosed':[PORT,PGPORT,DJPORT,UIPORT],'runnerProcessExited':runner.returncode is not None,'postgresStopped':True})
 data=(TMP/'data').resolve();data.relative_to(OUT.resolve())
 if data.is_dir():shutil.rmtree(data)
 cleanup_record['privatePostgresDataRemoved']=True
 (OUT/'cleanup.json').write_text(json.dumps(cleanup_record,indent=2))
 (OUT/'run-result.json').write_text(json.dumps({'passed':passed,'sourceUnchanged':source_before==source_hashes(),'productionTouched':False,'paidProviderRequests':0},indent=2))
