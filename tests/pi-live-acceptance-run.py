import base64,io,json,os,pathlib,secrets,socket,subprocess,sys,tarfile,time,uuid,re
if '--authorized-live-acceptance' not in sys.argv:
 raise SystemExit('Opt-in only: requires current user authorisation for real model use and synthetic current-principal direct delivery; pass --authorized-live-acceptance')
import importlib.util
spec=importlib.util.spec_from_file_location('live_inputs',pathlib.Path(__file__).with_name('pi-live-acceptance-secrets.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
selected_model=sys.argv[sys.argv.index('--model-id')+1] if '--model-id' in sys.argv else 'ai-model-35ca8a89-01d4-4693-b649-04b84ed69389'
MODEL=module.inputs(selected_model)
MODEL['captionLabel']='AGNES TOOL CAPABILITY' if selected_model=='ai-model-363b2b27-713a-4aa2-b6d1-8cbb4d6f4f9e' else 'CANDIDATE'
MODEL['reuseGenerated']='--reuse-generated' in sys.argv
MODEL['workspaceStaging']='--workspace-staging' in sys.argv
MODEL['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=pathlib.Path(__file__).resolve().parents[1]).decode().strip()
registry=subprocess.check_output(['node','--import','tsx','--input-type','module','-e',"import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,n){return s==='cloudflare:workers'?{url:'data:text/javascript,export const env={};',shortCircuit:true}:n(s,c)}}); const {aiToolRegistry}=await import('./lib/ai/tool-registry.ts'); console.log(JSON.stringify(aiToolRegistry.filter(x=>['get_pi_business_options','prepare_pi_report_delivery','get_pi_business_action'].includes(x.name)).map(({handler,...x})=>x)))"],cwd=pathlib.Path(__file__).resolve().parents[1],creationflags=subprocess.CREATE_NO_WINDOW)
MODEL['catalog']=json.loads(registry)
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
case_name=sys.argv[sys.argv.index('--evidence-name')+1] if '--evidence-name' in sys.argv else 'candidate-isolated-delivery'
assert re.fullmatch(r'[a-z0-9-]{1,80}',case_name)
OUT=pathlib.Path('D:/codex-artifacts/pi-unified-chat-20261020/live/resume-20261021')/case_name
OUT.mkdir(parents=True,exist_ok=True)
SAFEOUT=ROOT/'docs/pi-unified-chat-20261020/live-evidence/resume-20261021'/case_name
SAFEOUT.mkdir(parents=True,exist_ok=True)
assert not (SAFEOUT/'results.json').exists(), 'Never overwrite a prior real attempt'
TMP=ROOT/('.runtime/live-stack-'+uuid.uuid4().hex[:8]);TMP.mkdir(exist_ok=True)
BIN=pathlib.Path('D:/teruisi-runtime/django-sales/postgresql-17.11/bin')
PY=sys.executable
PORT=18123; PGPORT=55541
for p in (PORT,PGPORT):
 with socket.socket() as s:s.bind(('127.0.0.1',p))
namespace=sys.argv[sys.argv.index('--namespace')+1] if '--namespace' in sys.argv else 'pi-test-live-resume-20261021-'+uuid.uuid4().hex[:8]
assert re.fullmatch(r'pi-test-live-resume-20261021-[a-f0-9]{8}',namespace)
linux='/home/teruisi-pandas/'+namespace
key=secrets.token_bytes(32)
from pandas_runner.key_file import dpapi
(TMP/'key.json').write_text(json.dumps({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
image=MODEL['image']
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
env.update(PGHOST='127.0.0.1',PGPORT=str(PGPORT),PGUSER='pi_code_fixture',PGPASSWORD=password,PGDATABASE='teruisi_pi_code',PYTHONUTF8='1',DJANGO_SETTINGS_MODULE='teruisi_backend.settings',TERUISI_DJANGO_DATABASE_URL=f'postgresql://pi_code_fixture:{password}@127.0.0.1:{PGPORT}/teruisi_pi_code',TERUISI_DJANGO_PROCESS_ROLE='development',TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32),DJANGO_SECRET_KEY=secrets.token_hex(32),PYTHONPATH=str(TMP)+os.pathsep+str(ROOT/'backend'),PI_REAL_STACK_TEST='1',PI_REAL_STACK_SKIP_FLUSH='1',PI_RUNNER_HMAC_KEY_FILE=str(TMP/'key.json'),AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST=MODEL['origins'],PI_SKILL_VERSION='1.3.0',AI_SECRET_ENCRYPTION_KEY=secrets.token_hex(48),PI_LIVE_ROOT=str(ROOT),TERUISI_DINGTALK_BOT_CREDENTIALS='D:/teruisi-runtime/django-sales/secrets/dingtalk-bot.dpapi.json',TERUISI_DJANGO_AI_EDGE_BASE_URL='http://127.0.0.1:3000')
env['PI_LIVE_EVIDENCE_DIRECTORY']=str(SAFEOUT)
env['PI_LIVE_RAW_DIRECTORY']=str(OUT)
metadata={'namespace':namespace,'privateDirectory':str(TMP),'privateRunnerConfig':linux+'/config.json','runnerPort':PORT,'postgresPort':PGPORT,'image':image,'sourceCommit':MODEL['sourceCommit'],'worktreeDirtyFixture':True,'selectedModelId':selected_model,'modelName':MODEL['configuration']['model_name'],'modelVersion':MODEL['configuration']['version'],'modelRuntimeFields':{k:MODEL['configuration'][k] for k in ['max_tokens','timeout_ms','reasoning_mode','generation_options_json','temperature_milli','max_tool_rounds','max_total_tool_calls']},'policyVersion':MODEL['config']['policyVersion'],'onlyCurrentPrincipalDirect':True,'modelKeyReads':1}
(SAFEOUT/'run-metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
def run(args,label,input_data=None):
 with (OUT/(label+'.log')).open('wb') as f:
  result=subprocess.run([str(x) for x in args],input=input_data,env=env,cwd=ROOT,stdout=f,stderr=f,timeout=1800,creationflags=subprocess.CREATE_NO_WINDOW)
 if result.returncode:raise RuntimeError(label+' failed; see private log')
started=False
try:
 from pi_runner.client import command
 for _ in range(40):
  try:
   health=command('http://127.0.0.1:'+str(PORT),key,{},path='/v1/status');break
  except Exception:time.sleep(.25)
 else:raise RuntimeError('private runner unavailable')
 if health['namespace']!=namespace:raise RuntimeError('wrong private runner')
 print(json.dumps({'phase':'private-runner-ready','namespace':namespace,'port':PORT}),flush=True)
 run([BIN/'initdb.exe','-D',TMP/'data','-U','pi_code_fixture','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile',TMP/'pgpassword'],'init')
 with (TMP/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={PGPORT}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
 run([BIN/'pg_ctl.exe','-D',TMP/'data','-l',TMP/'postgres.log','-w','-t','30','start'],'pg-start');started=True
 run([BIN/'createdb.exe','teruisi_pi_code'],'createdb')
 roles=('teruisi_ai_seal_writer','teruisi_sales_owner','teruisi_ai_reader','teruisi_ai_writer','teruisi_inventory_reader','teruisi_inventory_writer','teruisi_bi_reader','teruisi_finance_reader','teruisi_finance_writer','teruisi_netshop_reader','teruisi_netshop_writer')
 for role in roles:run([BIN/'psql.exe','-v','ON_ERROR_STOP=1','-c',f'CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],'role-'+role)
 import shutil
 shutil.copy2(ROOT/'tests/pi-live-acceptance-case.py',TMP/'live_case.py')
 child=TMP/'test.py'
 child.write_text("import django\ndjango.setup()\nfrom ai_assistant import pi_transport\npi_transport.PORT=18123\nfrom django.test.runner import DiscoverRunner\nraise SystemExit(DiscoverRunner(verbosity=2,interactive=False).run_tests(['live_case.LiveAcceptance']))\n")
 run([PY,child],'real-stack',json.dumps(MODEL).encode())
 print(json.dumps({'status':'passed','productionTouched':False,'realPi':True,'privatePostgresPort':PGPORT,'privateRunnerPort':PORT,'provider':MODEL['configuration']['model_name'],'namespace':namespace}),flush=True)
finally:
 if started:run([BIN/'pg_ctl.exe','-D',TMP/'data','-m','fast','-w','-t','30','stop'],'pg-stop')
 # Stop only the exact private service by its fixed command/config identity.
 stop="import os,signal;from pathlib import Path\nexpected="+repr(linux+'/config.json')+"\nfor p in Path('/proc').iterdir():\n if p.name.isdigit():\n  try:args=(p/'cmdline').read_bytes().split(b'\\0')\n  except OSError:continue\n  if b'pi_runner.server' in args and expected.encode() in args:os.kill(int(p.name),signal.SIGTERM)"
 subprocess.run(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/python3','-c',stop],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
 runner.wait(timeout=30);runnerlog.close()
 # No production namespace or Docker prune. Remove only exact labelled test volumes.
 cleanup="import os,subprocess,json\nnamespace="+repr(namespace)+"\nenv={'PATH':'/usr/bin:/bin','DOCKER_HOST':'unix:///run/user/1000/docker.sock'}\ndef docker(*a):return subprocess.check_output(['/usr/bin/docker',*a],env=env)\nassert not docker('ps','-aq','--filter','label=teruisi.pi.namespace='+namespace).strip()\nfor name in docker('volume','ls','-q','--filter','label=teruisi.pi.namespace='+namespace).decode().split():\n meta=json.loads(docker('volume','inspect',name))[0]\n assert meta['Labels']['teruisi.pi.namespace']==namespace and name.startswith(namespace+'-')\n docker('volume','rm',name)\nprint('private containers and volumes cleared')"
 subprocess.run(['wsl','-d','TERUISI-Pandas','--exec','/usr/bin/python3','-c',cleanup],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
 (TMP/'pgpassword').unlink(missing_ok=True);(TMP/'key.json').unlink(missing_ok=True)
 ports={}
 for port in (PGPORT,PORT):
  with socket.socket() as probe:ports[str(port)]='closed' if probe.connect_ex(('127.0.0.1',port))!=0 else 'open'
 receipt={'namespace':namespace,'ports':ports,'privateRunnerProcessExitCode':runner.returncode,'privateContainersAndVolumesRemoved':True,'productionServiceLifecycleChanged':False,'cleanupComplete':all(v=='closed' for v in ports.values())}
 (SAFEOUT/'cleanup.json').write_text(json.dumps(receipt,indent=2),encoding='utf8')
 (OUT/'cleanup.json').write_text(json.dumps(receipt,indent=2),encoding='utf8')
 if (SAFEOUT/'results.json').exists():shutil.copy2(SAFEOUT/'results.json',OUT/'results.json')
 assert receipt['cleanupComplete'], 'private ports remain open'
