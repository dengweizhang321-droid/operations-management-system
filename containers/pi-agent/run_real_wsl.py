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
    parser.add_argument('--dependency-fixtures',type=Path)
    parser.add_argument('--upgrade-from-image')
    parser.add_argument('--legacy-source-ref')
    args=parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',args.image):raise ValueError('exact_image_required')
    source=Path(__file__).resolve().parents[2]/'backend'/'pi_runner'
    task='pi-test-'+uuid.uuid4().hex[:12]
    destination='/home/teruisi-pandas/'+task
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w:gz',format=tarfile.GNU_FORMAT) as tar:
        tar.add(source,arcname='backend/pi_runner',filter=lambda member:None if '__pycache__' in member.name else member)
        if args.dependency_fixtures:
            for name in ['install-six.json','install-is-number.json','install-is-odd.json']:
                tar.add(args.dependency_fixtures/name,arcname='fixtures/'+name)
        if args.legacy_source_ref:
            legacy=subprocess.check_output(['git','archive',args.legacy_source_ref,'backend/pi_runner'],cwd=source.parents[1])
            with tarfile.open(fileobj=io.BytesIO(legacy)) as original:
                for member in original.getmembers():
                    if not member.isfile():continue
                    handle=original.extractfile(member)
                    member.name='legacy/'+member.name.removeprefix('backend/')
                    tar.addfile(member,handle)
    setup='\n'.join(['import os,sys,json,tarfile,pathlib', 'os.umask(0o077)',f'root=pathlib.Path({destination!r})','root.mkdir(mode=0o700)',
        'tarfile.open(fileobj=sys.stdin.buffer,mode="r|gz").extractall(root,filter="data")',
        '(root/"state").mkdir(mode=0o700)','(root/"channel.key").write_bytes(os.urandom(32))',
        f'config={{"docker":"/usr/bin/docker","socket":"/run/user/1000/docker.sock","image":{args.image!r},"keyFile":str(root/"channel.key"),"stateDirectory":str(root/"state"),"gatewayUrl":"http://127.0.0.1:8112/api/ai/pi/gateway","namespace":{task!r}}}',
        '(root/"config.json").write_text(json.dumps(config))'])
    subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/python3','-c',setup],input=archive.getvalue(),check=True)
    process=subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1',
        'PYTHONPATH='+destination+'/backend','PI_RUNNER_TEST_CONFIG='+destination+'/config.json',
        'PI_RUNNER_DEPENDENCY_FIXTURES='+destination+'/fixtures' if args.dependency_fixtures else 'PI_RUNNER_DEPENDENCY_FIXTURES=',
        'PI_RUNNER_UPGRADE_FROM_IMAGE='+args.upgrade_from_image if args.upgrade_from_image else 'PI_RUNNER_UPGRADE_FROM_IMAGE=',
        'PI_RUNNER_LEGACY_SOURCE_DIR='+destination+'/legacy' if args.legacy_source_ref else 'PI_RUNNER_LEGACY_SOURCE_DIR=',
        '/usr/bin/python3','-m','unittest',*args.tests,'-v'],capture_output=True)
    args.evidence.write_bytes(process.stdout+process.stderr)
    print(process.stdout.decode(errors='replace')+process.stderr.decode(errors='replace'))
    print(json.dumps({'exitCode':process.returncode,'isolatedDirectory':destination,'namespace':task,'image':args.image,'evidence':str(args.evidence)}))
    raise SystemExit(process.returncode)


if __name__=='__main__':main()
