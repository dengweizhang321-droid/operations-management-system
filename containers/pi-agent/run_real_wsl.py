"""Copy only reviewed source into a new WSL namespace and run real Pi tests."""
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import uuid


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--distribution',default='TERUISI-Pandas')
    parser.add_argument('--image',required=True);parser.add_argument('--evidence',type=Path,required=True)
    parser.add_argument('--tests',nargs='+',default=['pi_runner.test_protocol','pi_runner.test_real'])
    args=parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',args.image):raise ValueError('exact_image_required')
    source=Path(__file__).resolve().parents[2]/'backend'/'pi_runner'
    task='pi-test-'+uuid.uuid4().hex[:12]
    destination='/home/teruisi-pandas/'+task
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w:gz',format=tarfile.GNU_FORMAT) as tar:
        tar.add(source,arcname='backend/pi_runner',filter=lambda member:None if '__pycache__' in member.name else member)
    setup='\n'.join(['import os,sys,json,tarfile,pathlib', 'os.umask(0o077)',f'root=pathlib.Path({destination!r})','root.mkdir(mode=0o700)',
        'tarfile.open(fileobj=sys.stdin.buffer,mode="r|gz").extractall(root,filter="data")',
        '(root/"state").mkdir(mode=0o700)','(root/"channel.key").write_bytes(os.urandom(32))',
        f'config={{"docker":"/usr/bin/docker","socket":"/run/user/1000/docker.sock","image":{args.image!r},"keyFile":str(root/"channel.key"),"stateDirectory":str(root/"state"),"gatewayUrl":"http://127.0.0.1:8112/api/ai/pi/gateway","namespace":{task!r}}}',
        '(root/"config.json").write_text(json.dumps(config))'])
    subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/python3','-c',setup],input=archive.getvalue(),check=True)
    process=subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1',
        'PYTHONPATH='+destination+'/backend','PI_RUNNER_TEST_CONFIG='+destination+'/config.json','/usr/bin/python3','-m','unittest',*args.tests,'-v'],capture_output=True)
    args.evidence.write_bytes(process.stdout+process.stderr)
    print(process.stdout.decode(errors='replace')+process.stderr.decode(errors='replace'))
    print(json.dumps({'exitCode':process.returncode,'isolatedDirectory':destination,'namespace':task,'image':args.image,'evidence':str(args.evidence)}))
    raise SystemExit(process.returncode)


if __name__=='__main__':main()
