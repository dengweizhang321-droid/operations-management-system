"""Private first-use file installer proof, never a formal unit installation.

The Linux preparation logic uses fixed home literals redirected into one fresh
test directory. Docker image inspect is real; the
single systemd daemon-reload seam is intercepted, and no service is started.
"""
import base64
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile
import tempfile
import uuid

import pi_agent_prepare_runtime as preparation


def main():
    root=Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(root/'backend'))
    from pi_runner.install_linux import source_digest
    from pandas_runner.key_file import dpapi,read_key
    image=sys.argv[1]
    namespace='pi-test-prepare-'+uuid.uuid4().hex[:10]
    key=secrets.token_bytes(32)
    with tempfile.TemporaryDirectory(prefix='pi-prepare-negative-') as folder:
        file=Path(folder)/'intent.json'
        preparation.publish(file,{'operationId':'original'})
        original=file.read_bytes()
        try:preparation.publish(file,{'operationId':'new'})
        except FileExistsError:pass
        else:raise ValueError('unknown intent was overwritten')
        if file.read_bytes()!=original:raise ValueError('original intent changed')
        keyfile=Path(folder)/'channel.json'
        preparation.publish(keyfile,{'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()})
        if read_key(keyfile)!=key:raise ValueError('CurrentUser DPAPI failed')
        args=[sys.executable,str(root/'tools/pi_agent_prepare_runtime.py'),'--runtime',folder,'--image',image,
            '--source-sha256',source_digest(),'--authority-epoch','synthetic','--cutover-id','synthetic','--execute']
        denied=subprocess.run(args,capture_output=True,timeout=20)
        if denied.returncode==0 or set(p.name for p in Path(folder).iterdir())!={'intent.json','channel.json'}:
            raise ValueError('unexpected runtime path admitted or mutated')
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w:gz',format=tarfile.GNU_FORMAT) as bundle:
        for file in sorted((root/'backend/pi_runner').rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('test_'):
                bundle.add(file,arcname=file.relative_to(root/'backend').as_posix(),recursive=False)
    payload={'operationId':uuid.uuid4().hex,'namespace':'pi-agent-v1','image':image,'sourceSha256':source_digest(),
        'key':base64.b64encode(key).decode(),'archive':base64.b64encode(archive.getvalue()).decode()}
    # This redirect belongs only to the isolated proof, not the production CLI.
    prelude=r'''
import pathlib,subprocess,os,json,sys
real_path=pathlib.PosixPath
test_home=real_path('/home/teruisi-pandas/.local/share/ISOLATED_NAME')
test_home.mkdir(mode=0o700);(test_home/'.cache').mkdir(mode=0o700)
pathlib.Path.home=classmethod(lambda cls:real_path(test_home))
actual_run=subprocess.run
def run(args,**kwargs):
 if args==['/usr/bin/systemctl','--user','daemon-reload']:
  return subprocess.CompletedProcess(args,0,b'',b'')
 return actual_run(args,**kwargs)
subprocess.run=run
'''.replace('ISOLATED_NAME',namespace)
    redirected=preparation.LINUX_PREPARE.replace('/home/teruisi-pandas','/home/teruisi-pandas/.local/share/'+namespace)
    command=['wsl','-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/python3','-c',prelude+'\n'+redirected]
    result=subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=120)
    if result.returncode:raise ValueError('private file installer failed: '+result.stderr.decode(errors='replace')[-1000:])
    report=json.loads(result.stdout.splitlines()[-1])
    if not report['prepared'] or report['started'] is not False:raise ValueError('private preparation result invalid')
    # The production command's no-overwrite policy is also exercised in a fresh
    # child against the same private files; its destination already exists.
    repeat_prelude=prelude.replace('test_home.mkdir(mode=0o700);(test_home/\'.cache\').mkdir(mode=0o700)',
        "assert test_home.is_dir()")
    denied=subprocess.run(command[:-1]+[repeat_prelude+'\n'+redirected],input=json.dumps(payload).encode(),capture_output=True,timeout=30)
    if denied.returncode==0 or b'existing preparation requires original-outcome inspection' not in denied.stderr:
        raise ValueError('private preparation replay was not rejected')
    for kind in ('source','image'):
        rejected=dict(payload)
        rejected['sourceSha256' if kind=='source' else 'image']='0'*64 if kind=='source' else 'sha256:'+'0'*64
        isolated=namespace+'-'+kind
        code=(prelude+'\n'+redirected).replace(namespace,isolated)
        result=subprocess.run(command[:-1]+[code],input=json.dumps(rejected).encode(),capture_output=True,timeout=30)
        if result.returncode==0:raise ValueError('wrong '+kind+' was admitted')
        expected=b'runner source changed' if kind=='source' else b'CalledProcessError'
        if expected not in result.stderr:raise ValueError('wrong '+kind+' negative did not reach its intended gate')
    print(json.dumps({'status':'passed','productionTouched':False,'formalUnitInstalled':False,'systemdHook':'controlled_fixture',
        'realDockerImageInspect':True,'dpapi':True,'createOnlyIntent':True,'wrongRuntimeRejected':True,
        'actualLinuxInstaller':True,'repeatPreparationRejected':True,'wrongSourceRejected':True,'wrongImageRejected':True,'sourceSha256':source_digest(),
        'image':image,'privateLinuxHome':'/home/teruisi-pandas/.local/share/'+namespace}))


if __name__=='__main__':main()
