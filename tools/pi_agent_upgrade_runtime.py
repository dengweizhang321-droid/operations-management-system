"""Explicit independent Runner upgrade, preserving its CurrentUser DPAPI key.

prepare creates an immutable Linux release and a registered plan while production
continues. apply is called only after the native AI stop/fence and publishes the
Windows config after the exact successor's signed probe. Never first-use prepare.
"""
import argparse
import base64
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


def sha(raw):return hashlib.sha256(raw).hexdigest()


def publish(path,value,expected=None,reconcile=False):
    raw=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    temp=path.with_name(path.name+'.new')
    if temp.exists():
        if not reconcile or temp.read_bytes()!=raw:raise ValueError('pi_upgrade_foreign_fragment_retained')
    else:
        with temp.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    if expected is not None and sha(path.read_bytes())!=expected:raise ValueError('pi_upgrade_config_changed')
    if expected is None and path.exists():raise ValueError('pi_upgrade_receipt_exists')
    os.replace(temp,path)


def finish_windows(config_path,result_path,receipt,result,key_file_sha,reconcile=False):
    successor=receipt['newWindowsConfig']
    raw=json.dumps(successor,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    actual=config_path.read_bytes()
    if actual!=raw:
        if sha(actual)!=receipt['oldWindowsConfigSha256']:raise ValueError('pi_upgrade_foreign_config_retained')
        publish(config_path,successor,expected=receipt['oldWindowsConfigSha256'],reconcile=reconcile)
    elif not reconcile:raise ValueError('pi_upgrade_config_already_published')
    fragment=config_path.with_name(config_path.name+'.new')
    if fragment.exists() and fragment.read_bytes()!=raw:raise ValueError('pi_upgrade_foreign_fragment_retained')
    complete={**result,'windowsConfigSha256':sha(raw),'windowsKeyFileSha256':key_file_sha}
    variants=[complete,{key:value for key,value in complete.items() if key!='reconciled'}]
    expected=[json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode() for value in variants]
    target_fragment=result_path.with_name(result_path.name+'.new')
    if result_path.exists():
        if not reconcile or result_path.read_bytes() not in expected:raise ValueError('upgrade_result_changed')
    elif target_fragment.exists():
        if not reconcile or target_fragment.read_bytes() not in expected:raise ValueError('pi_upgrade_foreign_fragment_retained')
        os.replace(target_fragment,result_path)
    else:publish(result_path,complete)
    return complete


LINUX=r'''
import base64,io,json,os,sys,tarfile
from pathlib import Path
v=json.load(sys.stdin)
if os.getuid()!=1000 or v['namespace']!='pi-agent-v1':raise ValueError('fixed owner required')
os.umask(0o077)
if v['action']=='prepare':
 root=Path.home()/'.cache'/('pi-source-upgrade-'+v['operationId']);root.mkdir(mode=0o700)
 with tarfile.open(fileobj=io.BytesIO(base64.b64decode(v.pop('archive'))),mode='r:gz') as archive:
  members=archive.getmembers()
  if any(m.issym() or m.islnk() or not(m.isfile() or m.isdir()) or m.name.startswith('/') or '..' in m.name.split('/') or not m.name.startswith('pi_runner/') for m in members):raise ValueError('unsafe source archive')
  archive.extractall(root,filter='data')
 sys.path.insert(0,str(root))
else:
 root=Path(v['releaseParent'])/v['newSourceSha256'];sys.path.insert(0,str(root/'backend'))
from pi_runner.runtime_upgrade import dispatch
print(json.dumps(dispatch(v),sort_keys=True,separators=(',',':')))
'''


def invoke(value):
    wsl=Path(os.environ['SystemRoot'])/'System32/wsl.exe'
    env={key:value for key,value in os.environ.items() if key.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE'}}
    result=subprocess.run([str(wsl),'-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/python3','-B','-c',LINUX],
        input=json.dumps(value).encode(),capture_output=True,timeout=180,env=env)
    if result.returncode:raise ValueError('pi_source_upgrade_failed_closed')
    records=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    if len(records)!=1:raise ValueError('pi_source_upgrade_response_unknown')
    return records[0]


def previous_upgrade_complete(runtime, config, config_raw, key_path):
    """Retain all records; an unfinished source plan blocks every new target."""
    plans = runtime / "config/pi-agent-upgrades"
    candidates = []
    if plans.exists():
        entries = sorted(plans.iterdir())
        if len(entries)>64:raise ValueError("pi_upgrade_history_bound")
        for folder in entries:
            if (not re.fullmatch(r"[a-f0-9]{64}",folder.name) or not folder.is_dir()
                    or folder.is_symlink() or getattr(folder,"is_junction",lambda:False)()):
                raise ValueError("pi_upgrade_history_identity_changed")
            candidates.append((folder / "prepared.json", folder / "result.json", folder / "intent.json"))
    candidates.append((runtime / "config/pi-agent-upgrade-prepared.json", runtime / "config/pi-agent-upgrade-result.json", runtime / "config/pi-agent-upgrade-intent.json"))
    found_current, existing = False, False
    key_sha=sha(key_path.read_bytes())
    for prepared, result_path, intent_path in candidates:
        fragments=[prepared.with_name(prepared.name+".new"),result_path.with_name(result_path.name+".new"),intent_path.with_name(intent_path.name+".new")]
        if any(file.exists() for file in fragments):raise ValueError("previous_pi_upgrade_fragment_retained")
        if not prepared.exists():
            if result_path.exists() or intent_path.exists() or prepared.parent!=runtime/"config":
                raise ValueError("previous_pi_upgrade_orphaned_records")
            continue
        existing = True
        if not result_path.is_file() or not intent_path.is_file():raise ValueError("previous_pi_upgrade_incomplete")
        receipt = json.loads(prepared.read_bytes()); result = json.loads(result_path.read_bytes()); intent = json.loads(intent_path.read_bytes())
        plan = receipt["plan"]; successor=receipt["newWindowsConfig"]
        successor_raw=json.dumps(successor,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
        if (result.get("upgraded") is not True or result.get("sourceSha256") != successor["runnerSourceSha256"]
                or result.get("image") != successor["runnerImage"] or result.get("windowsConfigSha256") != sha(successor_raw)
                or result.get("windowsKeyFileSha256") != key_sha or receipt.get("windowsKeyFileSha256") != key_sha
                or result.get("operationId") != plan["operationId"] or result.get("planSha256") != receipt["planSha256"]
                or intent.get("operationId") != plan["operationId"] or intent.get("registeredPlanSha256") != sha(prepared.read_bytes())
                or successor["runnerSourceSha256"] != plan["newSourceSha256"] or successor["runnerImage"] != plan["newImage"]
                or prepared.parent!=runtime/"config" and prepared.parent.name!=plan["newSourceSha256"]):
            raise ValueError("previous_pi_upgrade_completion_binding_changed")
        if successor==config:
            if sha(successor_raw)!=sha(config_raw):raise ValueError("current_pi_config_serialization_changed")
            found_current=True
    if existing and not found_current:raise ValueError("previous_pi_upgrade_not_current_completed_predecessor")


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','apply','check','reconcile'])
    parser.add_argument('--runtime',required=True);parser.add_argument('--image');parser.add_argument('--source-sha256')
    parser.add_argument('--expected-plan-sha256');parser.add_argument('--skill-version');parser.add_argument('--execute',action='store_true')
    args=parser.parse_args();runtime=Path(args.runtime).absolute()
    if os.name!='nt' or runtime!=Path(r'D:\teruisi-runtime\django-sales') or not args.execute:raise ValueError('native_pi_upgrade_required')
    for path in (runtime,*runtime.parents):
        if path.is_symlink() or getattr(path,'is_junction',lambda:False)():raise ValueError('runtime_links_forbidden')
    root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'backend'))
    from pi_runner.install_linux import source_digest
    from pandas_runner.key_file import read_key
    config_path=runtime/'config/pi-agent.json';key_path=runtime/'secrets/pi-agent.dpapi.json'
    old_raw=config_path.read_bytes();config=json.loads(old_raw);key=read_key(key_path)
    if (config.get('version')!=1 or config.get('enabled') is not True or sha(key_path.read_bytes())!=config['keyFileSha256']
            or sha(key)!=config['channelKeySha256']
            or not re.fullmatch(r'[a-f0-9]{64}',config.get('runnerSourceSha256',''))):raise ValueError('existing_pi_owner_key_required')
    plan_directory=runtime/'config/pi-agent-upgrades'/source_digest()
    prepared=plan_directory/'prepared.json'
    if args.action=='prepare':
        new_sha=source_digest()
        skill_version=args.skill_version or config['skillVersion']
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',skill_version):raise ValueError('exact_skill_version_required')
        from pi_runner.skills import build
        build(root/'backend/pi_runner/bundled_skills'/skill_version)
        if args.source_sha256!=new_sha or not re.fullmatch(r'sha256:[a-f0-9]{64}',args.image or ''):raise ValueError('exact_source_image_required')
        if config['runnerSourceSha256']==new_sha and config['runnerImage']==args.image and config['skillVersion']==skill_version:
            value={'action':'current','namespace':'pi-agent-v1','unitName':'teruisi-pi-runner.service',
                'unitPath':'/home/teruisi-pandas/.config/systemd/user/teruisi-pi-runner.service',
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases','port':8123,
                'newSourceSha256':new_sha,'newImage':args.image,'channelKeySha256':sha(key)}
            print(json.dumps(invoke(value)));return
        if prepared.exists():
            raw=prepared.read_bytes();saved=json.loads(raw);plan=saved['plan']
            if (saved['oldWindowsConfigSha256']!=sha(old_raw) or saved['windowsKeyFileSha256']!=sha(key_path.read_bytes())
                    or plan['newSourceSha256']!=new_sha or plan['newImage']!=args.image
                    or saved['newWindowsConfig']['skillVersion']!=skill_version):raise ValueError('different_registered_upgrade_plan')
            result=invoke({**plan,'action':'check','planSha256':saved['planSha256']})
            print(json.dumps({'prepared':True,'started':False,'reused':True,'operationId':plan['operationId'],
                'registeredPlanSha256':sha(raw),'planSha256':saved['planSha256'],'sourceSha256':new_sha,'image':args.image}));return
        previous_upgrade_complete(runtime,config,old_raw,key_path)
        if plan_directory.exists():raise ValueError('pi_upgrade_preparation_fragment_retained')
        plan_directory.mkdir(parents=True)
        operation=uuid.uuid4().hex;archive=io.BytesIO()
        publish(plan_directory/'preparing.json',{'operationId':operation,'oldWindowsConfigSha256':sha(old_raw),'newSourceSha256':new_sha,'newImage':args.image,'skillVersion':skill_version})
        with tarfile.open(fileobj=archive,mode='w:gz',format=tarfile.GNU_FORMAT) as bundle:
            for file in sorted((root/'backend/pi_runner').rglob('*')):
                if not file.is_file() or '__pycache__' in file.parts or file.name.startswith('test_'):continue
                if file.is_symlink() or file.stat().st_nlink!=1:raise ValueError('unsafe_runner_source')
                bundle.add(file,arcname=file.relative_to(root/'backend').as_posix(),recursive=False)
        value={'action':'prepare','operationId':operation,'namespace':'pi-agent-v1','unitName':'teruisi-pi-runner.service',
            'unitPath':'/home/teruisi-pandas/.config/systemd/user/teruisi-pi-runner.service',
            'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases','port':8123,
            'oldSourceSha256':config['runnerSourceSha256'],'newSourceSha256':new_sha,'oldImage':config['runnerImage'],
            'newImage':args.image,'channelKeySha256':sha(key),'windowsConfigSha256':sha(old_raw),
            'windowsKeyFileSha256':sha(key_path.read_bytes()),'archive':base64.b64encode(archive.getvalue()).decode()}
        result=invoke(value)
        if result.get('prepared') is not True or result.get('started') is not False:raise ValueError('upgrade_preparation_unknown')
        successor={**config,'runnerImage':args.image,'runnerSourceSha256':new_sha,'skillVersion':skill_version}
        receipt={**result,'newWindowsConfig':successor,'oldWindowsConfigSha256':sha(old_raw),'windowsKeyFileSha256':sha(key_path.read_bytes())}
        publish(prepared,receipt)
        print(json.dumps({'prepared':True,'started':False,'operationId':operation,'registeredPlanSha256':sha(prepared.read_bytes()),'planSha256':result['planSha256'],'sourceSha256':new_sha,'image':args.image}))
        return
    raw=prepared.read_bytes()
    if not re.fullmatch(r'[a-f0-9]{64}',args.expected_plan_sha256 or '') or sha(raw)!=args.expected_plan_sha256:raise ValueError('registered_upgrade_plan_required')
    receipt=json.loads(raw);plan=receipt['plan']
    successor_raw=json.dumps(receipt['newWindowsConfig'],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    already_published=args.action=='reconcile' and old_raw==successor_raw
    if ((not already_published and sha(old_raw)!=receipt['oldWindowsConfigSha256']) or sha(key_path.read_bytes())!=receipt['windowsKeyFileSha256']
            or source_digest()!=plan['newSourceSha256']):raise ValueError('upgrade_predecessor_changed')
    if args.action=='check':
        invoke({**plan,'action':'check','planSha256':receipt['planSha256']})
        print(json.dumps({'prepared':True,'checked':True,'started':False,'registeredPlanSha256':sha(raw),'sourceSha256':plan['newSourceSha256'],'image':plan['newImage']}));return
    intent=plan_directory/'intent.json'
    if args.action=='reconcile':
        original=json.loads(intent.read_bytes())
        if original['operationId']!=plan['operationId'] or original['registeredPlanSha256']!=sha(raw):raise ValueError('upgrade_original_intent_changed')
    else:publish(intent,{'operationId':plan['operationId'],'status':'dispatching','registeredPlanSha256':sha(raw)})
    result=invoke({**plan,'action':args.action,'planSha256':receipt['planSha256']})
    if result.get('upgraded') is not True or result.get('sourceSha256')!=plan['newSourceSha256'] or result.get('image')!=plan['newImage']:
        raise ValueError('source_upgrade_response_unknown')
    result_path=plan_directory/'result.json'
    finish_windows(config_path,result_path,receipt,result,sha(key_path.read_bytes()),reconcile=args.action=='reconcile')
    print(json.dumps({**result,'windowsConfigUpdated':True,'sameDpapiOwner':True}))


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"error":"pi_source_upgrade_failed_closed","message":"Inspect original registered plan and intent; do not replay"}')
        raise SystemExit(1)
