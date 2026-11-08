"""Install new private systemd units and exact source; never start either Runner."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile
from native_control_import import entry

sys.path.insert(0,str(entry.SOURCE/'backend'))
from pandas_runner.key_file import dpapi
from pandas_runner.protocol import package_digest
from pi_runner.install_linux import source_digest
profile=json.loads((entry.ROOT/'isolation.json').read_bytes())
before=json.loads((entry.EVIDENCE/'WSL-BEFORE.json').read_text())
assert before['oldFilesUnchanged'] and before['oldUnitsUnchanged']
pi_image=json.loads(Path('D:/codex-artifacts/ai-repair-batch3-20261108/w11b/IMAGE.json').read_text())
pd_image=json.loads(Path('D:/codex-artifacts/ai-repair-batch2-20261108/environment/IMAGE.json').read_text())
spec=importlib.util.spec_from_file_location('builder',entry.SOURCE/'containers/pi-agent/build_image.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
inputs={p:hashlib.sha256(raw).hexdigest() for p,raw in builder.source_inputs(entry.SOURCE).items()}
assert hashlib.sha256(json.dumps(inputs,sort_keys=True,separators=(',',':')).encode()).hexdigest()==pi_image['inputsSha256']
assert all(hashlib.sha256((entry.SOURCE/path).read_bytes()).hexdigest()==digest for path,digest in pd_image['sources'].items())
images={'pi':pi_image['image'],'pandas':pd_image['image']}
digests={'pi':source_digest(),'pandas':package_digest()}
keys={name:secrets.token_bytes(32) for name in images}
files={}
for package in ['pi_runner','pandas_runner']:
    for file in (entry.SOURCE/'backend'/package).rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('test_'):
            relative=file.relative_to(entry.SOURCE).as_posix()
            assert file.read_bytes()==(entry.ROOT/'django/app'/relative).read_bytes()
            files[relative]=file.read_bytes()
manifest={name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}
files.update({'isolation.json':(entry.ROOT/'isolation.json').read_bytes(),
    'input.json':json.dumps({'images':images,'digests':digests}).encode(),**{name+'.key':key for name,key in keys.items()}})
archive=io.BytesIO()
with tarfile.open(fileobj=archive,mode='w') as tar:
    for name,raw in sorted(files.items()):
        member=tarfile.TarInfo(name);member.size=len(raw);member.mode=0o600;tar.addfile(member,io.BytesIO(raw))
code=r'''
import base64,hashlib,io,json,os,shutil,subprocess,sys,tarfile,time
from pathlib import Path
assert os.getuid()==1000 and os.environ.get('WSL_DISTRO_NAME')=='Codex-AI-Batch2-20261108'
os.umask(0o077)
root=Path('/home/teruisi-pandas/.local/share/native-control-ai-20261108')
resume=sys.argv[1:] in (['resume-installed-source'],['resume-partial-unit'])
if resume:
    assert root.is_dir()
    if sys.argv[1:] == ['resume-installed-source']:assert not (root/'pi').exists() and not (root/'pandas').exists()
else:
    assert not root.exists(),'existing installation must be reconciled, not overwritten'
    root.mkdir()
    with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())) as tar:tar.extractall(root,filter='data')
os.environ['TERUISI_NATIVE_ISOLATION_FILE']=str(root/'isolation.json')
os.environ['TERUISI_NATIVE_ISOLATION_SHA256']=hashlib.sha256((root/'isolation.json').read_bytes()).hexdigest()
sys.path.insert(0,str(root/'backend'))
from pandas_runner.native_isolation import PROFILE
from pandas_runner.protocol import package_digest
from pi_runner.install_linux import source_digest
inputs=json.loads((root/'input.json').read_bytes())
assert inputs['digests']=={'pi':source_digest(),'pandas':package_digest()}
env={'HOME':'/home/teruisi-pandas','PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus','DOCKER_HOST':'unix:///run/user/1000/docker.sock'}
def run(args):return subprocess.check_output(args,env=env,timeout=60).decode().strip()
run(['/usr/bin/systemctl','--user','start','docker.service'])
deadline=time.monotonic()+30
while True:
    ready=subprocess.run(['/usr/bin/docker','info','--format','{{.ID}}'],env=env,capture_output=True,timeout=5)
    if ready.returncode==0:break
    if time.monotonic()>=deadline:raise RuntimeError('private docker readiness deadline exceeded')
    time.sleep(.2)
assert not run(['/usr/bin/docker','ps','-aq']),'old containers retained; do not clean to pass'
for name,image in inputs['images'].items():
    assert json.loads(run(['/usr/bin/docker','image','inspect',image]))[0]['Id']==image
units=[]
for name,package in [('pi','pi_runner'),('pandas','pandas_runner')]:
    release=root/name/'releases'/inputs['digests'][name]
    (release/'backend').mkdir(parents=True,exist_ok=resume)
    target=release/'backend'/package
    if target.exists():
        expected={p.relative_to(root/'backend'/package).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'backend'/package).rglob('*') if p.is_file()}
        actual={p.relative_to(target).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in target.rglob('*') if p.is_file()}
        assert resume and actual==expected,'partial source differs; preserve for investigation'
    else:shutil.copytree(root/'backend'/package,target)
    state=root/name/'state';state.mkdir(mode=0o700,exist_ok=resume)
    key=root/(name+'.key');key.chmod(0o600)
    config={'docker':'/usr/bin/docker','socket':'/run/user/1000/docker.sock','image':inputs['images'][name],'keyFile':str(key),'stateDirectory':str(state)}
    if name=='pi':config.update(gatewayUrl='http://127.0.0.1:28112/api/ai/pi/gateway',namespace=PROFILE['namespace'],limits={'workspaceBytes':268435456,'workspaceFiles':5000,'idleSeconds':1800,'maxSessions':1})
    config_path=release/'config.json'
    if config_path.exists():assert resume and config_path.read_text()==json.dumps(config)
    else:config_path.write_text(json.dumps(config));config_path.chmod(0o600)
    unit=PROFILE['piUnit' if name=='pi' else 'pandasUnit']
    unit_path=Path.home()/'.config/systemd/user'/unit
    unit_path.parent.mkdir(parents=True,exist_ok=True)
    text='\n'.join(['[Unit]','Description=Explicit private native lifecycle rehearsal','Requires=docker.service','After=docker.service','[Service]','Type=simple',
        'WorkingDirectory='+str(release/'backend'),
        "ExecStartPre=/usr/bin/timeout 25 /usr/bin/bash -c 'until /usr/bin/docker --host=unix:///run/user/1000/docker.sock info >/dev/null 2>&1; do /usr/bin/sleep 0.2; done'",
        'ExecStart=/usr/bin/python3 -B -m '+package+'.server --config '+str(release/'config.json'),
        'Environment=TERUISI_NATIVE_ISOLATION_FILE='+str(root/'isolation.json'),'Environment=TERUISI_NATIVE_ISOLATION_SHA256='+PROFILE['sha256'],
        'Environment=PYTHONDONTWRITEBYTECODE=1','UMask=0077','NoNewPrivileges=yes','Restart=no','KillMode=mixed','TimeoutStopSec=45',''])
    if unit_path.exists():assert resume and unit_path.read_text()==text
    else:unit_path.write_text(text)
    units.append({'name':unit,'sha256':hashlib.sha256(text.encode()).hexdigest(),'release':str(release)})
run(['/usr/bin/systemctl','--user','daemon-reload'])
for item in units:
    assert run(['/usr/bin/systemctl','--user','show',item['name'],'--property=ActiveState','--value'])=='inactive'
    assert run(['/usr/bin/systemctl','--user','is-enabled',item['name']])=='static'
run(['/usr/bin/systemctl','--user','stop','docker.service'])
print(json.dumps({'status':'installed_not_started','units':units,'images':inputs['images'],'digests':inputs['digests'],'oldContainersEmpty':True,'persistentEnablement':False,
    '_privateKeys':{name:base64.b64encode((root/(name+'.key')).read_bytes()).decode() for name in ['pi','pandas']}}))
'''
resume=sys.argv[1:] in (['--resume-installed-source'],['--resume-partial-unit'])
result=subprocess.run(['wsl.exe','-d',profile['wslDistribution'],'-u','teruisi-pandas','--exec','/usr/bin/python3','-B','-c',code,*([sys.argv[1].removeprefix('--')] if resume else [])],
    input=archive.getvalue(),env=entry.environment(),capture_output=True,timeout=180)
label='wsl-prepare-r3' if sys.argv[1:]==['--resume-partial-unit'] else ('wsl-prepare-r2' if resume else 'wsl-prepare')
(entry.EVIDENCE/(label+'.stderr.log')).write_bytes(result.stderr)
if result.returncode:raise RuntimeError('Private WSL installation failed; retain original files and inspect without replay')
native=json.loads(result.stdout)
keys={name:base64.b64decode(value) for name,value in native.pop('_privateKeys').items()}
assert native['digests']==digests and native['images']==images and all(len(k)==32 for k in keys.values())
(entry.EVIDENCE/(label+'.stdout.log')).write_text(json.dumps(native)+'\n')
config_dir=entry.ROOT/'django/config';config_dir.mkdir(exist_ok=True)
key_dir=entry.ROOT/'django/secrets'
authority=json.loads((entry.EVIDENCE/'SYNTHETIC-PRECONDITIONS.json').read_text())['authorities']['ai-apply']
for name,key in keys.items():
    key_path=key_dir/('pi-agent.dpapi.json' if name=='pi' else 'pandas-sandbox.dpapi.json')
    assert not key_path.exists()
    key_path.write_text(json.dumps({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
    if name=='pi':config={'version':1,'enabled':True,'keyFileSha256':hashlib.sha256(key_path.read_bytes()).hexdigest(),'channelKeySha256':hashlib.sha256(key).hexdigest(),
        'skillVersion':'1.3.0','authorityEpoch':authority['authority_epoch'],'cutoverId':authority['cutover_id'],'runnerImage':images[name],'runnerSourceSha256':digests[name]}
    else:config={'version':1,'image':images[name],'keySha256':hashlib.sha256(key_path.read_bytes()).hexdigest()}
    (config_dir/('pi-agent.json' if name=='pi' else 'pandas-sandbox.json')).write_text(json.dumps(config))
(entry.EVIDENCE/'WSL-INSTALL.json').write_text(json.dumps({**native,'manifest':manifest,'imageInputsReusedExactly':True,'formalArtifacts':False},indent=2)+'\n')
print(json.dumps({'status':native['status'],'units':[u['name'] for u in native['units']],'imageInputsReusedExactly':True}))
