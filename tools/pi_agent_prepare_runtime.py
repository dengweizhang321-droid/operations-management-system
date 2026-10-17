"""Explicit first-use Pi preparation, invoked inside the native AI mutex.

No service is started. A partially completed preparation is retained and never
automatically retried. The only new key is an independent random channel key.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import uuid


def publish(file, value):
    with file.open('x',encoding='utf8',newline='\n') as stream:
        json.dump(value,stream,sort_keys=True,separators=(',',':'))
        stream.flush()
        os.fsync(stream.fileno())


LINUX_PREPARE=r'''
import base64,io,json,os,subprocess,sys,tarfile
from pathlib import Path
v=json.load(sys.stdin)
if os.getuid()!=1000 or v['namespace']!='pi-agent-v1':raise ValueError('fixed unprivileged identity required')
os.umask(0o077)
parent=Path('/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases')
unit=Path('/home/teruisi-pandas/.config/systemd/user/teruisi-pi-runner.service')
root=parent/v['sourceSha256']
if root.exists() or unit.exists():raise ValueError('existing preparation requires original-outcome inspection; no replay')
staging=Path('/home/teruisi-pandas/.cache')/('pi-prepare-'+v['operationId'])
staging.mkdir(mode=0o700,parents=False)
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(v['archive'])),mode='r:gz') as archive:archive.extractall(staging,filter='data')
sys.path.insert(0,str(staging))
from pi_runner.install_linux import source_digest,main
if source_digest()!=v['sourceSha256']:raise ValueError('runner source changed')
empty=staging/'empty-docker-config';empty.mkdir(mode=0o700)
env={'HOME':'/home/teruisi-pandas','PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus','DOCKER_HOST':'unix:///run/user/1000/docker.sock','DOCKER_CONFIG':str(empty)}
image=json.loads(subprocess.run(['/usr/bin/docker','image','inspect',v['image']],env=env,capture_output=True,check=True,timeout=20).stdout)[0]
if image['Id']!=v['image'] or image['Config'].get('Entrypoint')!=['node','/opt/pi/entrypoint.mjs'] or image['Config'].get('Volumes'):raise ValueError('reviewed exact image required')
parent.mkdir(parents=True,exist_ok=True,mode=0o700)
sys.argv=['pi_runner.install_linux','--destination',str(root),'--image',v['image'],'--approved-source-sha256',v['sourceSha256'],'--namespace','pi-agent-v1']
sys.stdin=io.TextIOWrapper(io.BytesIO(base64.b64decode(v['key'])),encoding='ascii')
main()
unit.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
with unit.open('xb') as stream:stream.write((root/'pi-runner.service').read_bytes());stream.flush();os.fsync(stream.fileno())
subprocess.run(['/usr/bin/systemctl','--user','daemon-reload'],env=env,capture_output=True,check=True,timeout=20)
print(json.dumps({'prepared':True,'started':False,'enabledAtLogin':False,'sourceSha256':v['sourceSha256'],'image':v['image']}))
'''


def main():
    parser=argparse.ArgumentParser()
    for name in ('runtime','image','source-sha256','authority-epoch','cutover-id'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--skill-version',default='1.0.0')
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args()
    runtime=Path(args.runtime).absolute()
    if os.name!='nt' or runtime!=Path(r'D:\teruisi-runtime\django-sales') or not args.execute:
        raise ValueError('explicit native first-use preparation required')
    if (not re.fullmatch(r'sha256:[a-f0-9]{64}',args.image)
            or not re.fullmatch(r'[a-f0-9]{64}',args.source_sha256)
            or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',args.skill_version)
            or not args.authority_epoch or not args.cutover_id):
        raise ValueError('exact reviewed runtime identity required')
    root=Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(root/'backend'))
    from pi_runner.install_linux import source_digest
    from pi_runner.skills import build
    from pandas_runner.key_file import dpapi
    if source_digest()!=args.source_sha256:raise ValueError('runner source changed')
    build(root/'backend/pi_runner/bundled_skills'/args.skill_version)
    configfile=runtime/'config/pi-agent.json'
    keyfile=runtime/'secrets/pi-agent.dpapi.json'
    intent=runtime/'config/pi-agent-prepare-intent.json'
    if any(file.exists() for file in (configfile,keyfile,intent)):
        raise ValueError('existing or unknown Pi preparation retained; do not replay')
    if any(path.is_symlink() or getattr(path,'is_junction',lambda:False)() for path in (runtime,*runtime.parents)):
        raise ValueError('runtime links forbidden')
    configfile.parent.mkdir(exist_ok=True)
    keyfile.parent.mkdir(exist_ok=True)
    operation=uuid.uuid4().hex
    publish(intent,{'operationId':operation,'at':datetime.now(timezone.utc).isoformat(),'sourceSha256':args.source_sha256,'image':args.image})
    key=os.urandom(32)
    publish(keyfile,{'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()})
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w:gz',format=tarfile.GNU_FORMAT) as bundle:
        for file in sorted((root/'backend/pi_runner').rglob('*')):
            if not file.is_file() or '__pycache__' in file.parts or file.name.startswith('test_'):continue
            if file.is_symlink() or file.stat().st_nlink!=1:raise ValueError('unsafe runner source')
            bundle.add(file,arcname=file.relative_to(root/'backend').as_posix(),recursive=False)
    payload={'operationId':operation,'namespace':'pi-agent-v1','image':args.image,'sourceSha256':args.source_sha256,
        'key':base64.b64encode(key).decode(),'archive':base64.b64encode(archive.getvalue()).decode()}
    wsl=Path(os.environ['SystemRoot'])/'System32/wsl.exe'
    env={k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE'}}
    completed=subprocess.run([str(wsl),'-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/python3','-c',LINUX_PREPARE],
        input=json.dumps(payload).encode(),capture_output=True,timeout=120,env=env)
    if completed.returncode:raise ValueError('Pi preparation outcome requires original intent inspection; no replay')
    report=json.loads(completed.stdout.splitlines()[-1])
    if not report.get('prepared') or report.get('started') is not False or report.get('sourceSha256')!=args.source_sha256:
        raise ValueError('Pi preparation result unknown; original intent retained')
    config={'version':1,'enabled':True,'keyFileSha256':hashlib.sha256(keyfile.read_bytes()).hexdigest(),
        'channelKeySha256':hashlib.sha256(key).hexdigest(),'skillVersion':args.skill_version,
        'authorityEpoch':args.authority_epoch,'cutoverId':args.cutover_id,'runnerImage':args.image,'runnerSourceSha256':args.source_sha256}
    publish(configfile,config)
    publish(runtime/'config/pi-agent-prepared.json',{'operationId':operation,**report,'configSha256':hashlib.sha256(configfile.read_bytes()).hexdigest()})
    print(json.dumps({'prepared':True,'started':False,'sourceSha256':args.source_sha256,'image':args.image,'operationId':operation}))


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"error":"pi_prepare_failed_closed","message":"Inspect original preparation intent before any retry"}')
        raise SystemExit(1)
