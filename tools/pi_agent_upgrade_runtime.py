"""Explicit independent Runner upgrade, preserving its CurrentUser DPAPI key.

prepare creates an immutable Linux release and a registered plan while production
continues. apply is called only after the native AI stop/fence and publishes the
Windows config after the exact successor's signed probe. Never first-use prepare.
"""
import argparse
import base64
import datetime
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


SAFE_FAILURE_REASONS=frozenset('''
upgrade_compare_changed upgrade_source_digest_required upgrade_owner_required
fixed_upgrade_paths_required isolated_upgrade_paths_required upgrade_real_parent_required
upgrade_source_required old_runner_binding_changed upgrade_preparation_exists
reviewed_upgrade_image_required ledger_checkpoint_busy ledger_wal_not_checkpointed
unsafe_runner_state prepared_upgrade_binding_changed source_upgrade_unknown_no_replay
source_upgrade_intent_requires_reconciliation current_runner_binding_changed
current_runner_signed_probe_failed source_upgrade_reconciliation_unproved
successor_not_verified_active successor_reconciliation_unknown upgrade_plan_changed
upgrade_predecessor_changed old_runner_must_be_stopped old_runner_process_still_present
runner_containers_must_be_stopped old_state_changed_during_copy candidate_runner_identity_changed
source_upgrade_candidate_unknown upgrade_predecessor_unit_changed source_upgrade_rejected_old_retained
pi_upgrade_foreign_fragment_retained pi_upgrade_config_changed pi_upgrade_receipt_exists
pi_upgrade_foreign_config_retained pi_upgrade_config_already_published upgrade_result_changed
pi_upgrade_history_bound pi_upgrade_history_identity_changed previous_pi_upgrade_fragment_retained
previous_pi_upgrade_orphaned_records previous_pi_upgrade_incomplete
previous_pi_upgrade_completion_binding_changed current_pi_config_serialization_changed
previous_pi_upgrade_not_current_completed_predecessor native_pi_upgrade_required
runtime_links_forbidden existing_pi_owner_key_required exact_skill_version_required
exact_source_image_required different_registered_upgrade_plan pi_upgrade_preparation_fragment_retained
unsafe_runner_source upgrade_preparation_unknown registered_upgrade_plan_required
upgrade_original_intent_changed source_upgrade_response_unknown fixed_upgrade_owner_required
unsafe_source_archive subprocess_failed subprocess_timeout os_error unexpected_error
'''.split())
UPGRADE_ACTIONS=frozenset({'prepare','apply','check','current','reconcile'})
FAILURE_MESSAGE='Inspect original registered plan and intent; do not replay'


def safe_reason(error):
    # Never turn exception text, filenames, argv or captured streams into logs.
    if type(error) is ValueError and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in SAFE_FAILURE_REASONS:
        return error.args[0]
    if isinstance(error,subprocess.TimeoutExpired):return 'subprocess_timeout'
    if isinstance(error,subprocess.CalledProcessError):return 'subprocess_failed'
    if isinstance(error,OSError):return 'os_error'
    return 'unexpected_error'


class UpgradeInvocationError(ValueError):
    def __init__(self,diagnostic):
        super().__init__('pi_source_upgrade_failed_closed')
        self.diagnostic=diagnostic


def failure_document(error):
    diagnostic=error.diagnostic if isinstance(error,UpgradeInvocationError) else {
        'stage':'windows_upgrade','reason':safe_reason(error)}
    return {'error':'pi_source_upgrade_failed_closed','message':FAILURE_MESSAGE,'diagnostic':diagnostic}


LINUX_BODY=r'''
import base64,io,json,os,sys,tarfile
from pathlib import Path
v=json.load(sys.stdin)
if os.getuid()!=1000 or v['namespace']!='pi-agent-v1':raise ValueError('fixed_upgrade_owner_required')
os.umask(0o077)
if v['action']=='prepare':
 root=Path.home()/'.cache'/('pi-source-upgrade-'+v['operationId']);root.mkdir(mode=0o700)
 with tarfile.open(fileobj=io.BytesIO(base64.b64decode(v.pop('archive'))),mode='r:gz') as archive:
  members=archive.getmembers()
  if any(m.issym() or m.islnk() or not(m.isfile() or m.isdir()) or m.name.startswith('/') or '..' in m.name.split('/') or not m.name.startswith('pi_runner/') for m in members):raise ValueError('unsafe_source_archive')
  archive.extractall(root,filter='data')
 sys.path.insert(0,str(root))
else:
 root=Path(v['releaseParent'])/v['newSourceSha256'];sys.path.insert(0,str(root/'backend'))
from pi_runner.runtime_upgrade import dispatch
print(json.dumps(dispatch(v),sort_keys=True,separators=(',',':')))
'''
# The transport reports only reviewed static codes. A traceback can contain keys
# or customer payloads; never relay it, even when the subprocess itself failed.
LINUX=('import json,subprocess,sys\nSAFE_FAILURE_REASONS='+repr(SAFE_FAILURE_REASONS)+'\n'
       'v={}\ntry:\n'+''.join(' '+line+'\n' for line in LINUX_BODY.splitlines())+r'''
except Exception as error:
 def reason(e):
  if type(e) is ValueError and len(e.args)==1 and type(e.args[0]) is str and e.args[0] in SAFE_FAILURE_REASONS:return e.args[0]
  if isinstance(e,subprocess.TimeoutExpired):return 'subprocess_timeout'
  if isinstance(e,subprocess.CalledProcessError):return 'subprocess_failed'
  if isinstance(e,OSError):return 'os_error'
  return 'unexpected_error'
 action=v.get('action') if type(v) is dict else None
 stage='linux_'+action if type(action) is str and action in {'prepare','apply','check','current','reconcile'} else 'linux_input'
 detail={'stage':stage,'reason':reason(error),'causeReasons':[]}
 cause=error.__cause__ or error.__context__
 for _ in range(3):
  if cause is None:break
  detail['causeReasons'].append(reason(cause));cause=cause.__cause__ or cause.__context__
 print(json.dumps({'piUpgradeFailure':1,**detail},separators=(',',':')),file=sys.stderr)
 raise SystemExit(1)
''')


def linux_failure(stderr,action):
    """Accept one bounded diagnostic; WSL warnings are discarded, never echoed."""
    if len(stderr)>4096:return None
    records=[]
    lines=stderr.split(b'\n')
    for index,line in enumerate(lines):
        # wsl.exe can prepend UTF-16LE warnings to the child's UTF-8 stderr.
        # Splitting its CR\0 LF\0 leaves one NUL before the JSON object. Strip
        # exactly that byte only at this observed transport boundary; never
        # normalize NULs within JSON or decode the mixed stream as one codec.
        if index and lines[index-1].endswith(b'\r\x00') and line.startswith(b'\x00{'):
            line=line[1:]
        try:record=json.loads(line)
        except (ValueError,UnicodeError):continue
        if type(record) is dict and 'piUpgradeFailure' in record:records.append(record)
    if len(records)!=1:return None
    record=records[0]
    if (set(record)!={'piUpgradeFailure','stage','reason','causeReasons'}
            or type(record['piUpgradeFailure']) is not int or record['piUpgradeFailure']!=1
            or type(record['stage']) is not str or record['stage'] not in {'linux_input','linux_'+action}
            or type(record['reason']) is not str or record['reason'] not in SAFE_FAILURE_REASONS
            or type(record['causeReasons']) is not list or len(record['causeReasons'])>3
            or any(type(reason) is not str or reason not in SAFE_FAILURE_REASONS for reason in record['causeReasons'])):
        return None
    return {key:record[key] for key in ('stage','reason','causeReasons')}


def invoke(value):
    wsl=Path(os.environ['SystemRoot'])/'System32/wsl.exe'
    env={key:value for key,value in os.environ.items() if key.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE'}}
    action=value.get('action')
    if type(action) is not str or action not in UPGRADE_ACTIONS:action='unknown'
    try:
        result=subprocess.run([str(wsl),'-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/python3','-B','-c',LINUX],
            input=json.dumps(value).encode(),capture_output=True,timeout=180,env=env)
    except (subprocess.TimeoutExpired,OSError) as error:
        raise UpgradeInvocationError({'stage':'wsl_transport','action':action,
            'reason':'wsl_timeout' if isinstance(error,subprocess.TimeoutExpired) else 'wsl_launch_failed',
            'directExitCode':None}) from None
    if result.returncode:
        diagnostic=linux_failure(result.stderr,action) or {'stage':'wsl_transport','reason':'linux_failure_unknown'}
        raise UpgradeInvocationError({**diagnostic,'action':action,'directExitCode':result.returncode})
    try:
        records=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        if (len(records)!=1 or type(records[0]) is not dict
                or linux_failure(result.stderr,action) is not None):raise ValueError()
    except (ValueError,UnicodeError):
        raise UpgradeInvocationError({'stage':'wsl_response','action':action,
            'reason':'pi_source_upgrade_response_unknown','directExitCode':result.returncode}) from None
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


def rebuilt_image_replacement_allowed(saved,old_raw,key_path,new_sha,image,skill_version,plan_directory):
    """Narrow exception to the 'different_registered_upgrade_plan' rejection.

    `build_image.py` is not actually reproducible (same source, same lock
    files, different Docker layer metadata -> different image id each build).
    When every field EXCEPT `newImage` still matches the registered plan, and
    neither side of that plan was ever dispatched (no intent.json, no
    result.json here; no source-upgrade-intent.json on the Linux release),
    only the image id changed because of a harmless rebuild. Returns the
    unchanged `plan` dict to replace, or None if any required condition fails
    -- callers must keep raising `different_registered_upgrade_plan` on None.
    """
    plan=saved.get('plan')
    if type(plan) is not dict:return None
    if (saved.get('oldWindowsConfigSha256')!=sha(old_raw) or saved.get('windowsKeyFileSha256')!=sha(key_path.read_bytes())
            or plan.get('newSourceSha256')!=new_sha or saved.get('newWindowsConfig',{}).get('skillVersion')!=skill_version):
        return None
    if plan.get('newImage')==image:return None
    if (plan_directory/'intent.json').exists() or (plan_directory/'result.json').exists():return None
    for name in ('prepared.json','preparing.json','intent.json','result.json'):
        if (plan_directory/(name+'.new')).exists():return None
    return plan


# The shape this must accept is exactly what runtime_upgrade.py:prepare()
# writes under `new` (base/newSourceSha256) when it ran to completion: the
# top-level files channel.key, config.json, pi-runner.service,
# predecessor-unit.service, source-upgrade-plan.json, PLUS two directories
# `backend` (copied release source) and `state` (created empty, mode 0o700).
# A bare `require(entry.is_file())` loop would wrongly reject that normal,
# fully-prepared-but-never-dispatched shape; only source-upgrade-intent.json
# (dispatch) or any `*.new` fragment anywhere under the tree disqualifies it.
LINUX_REMOVE_NEVER_DISPATCHED_RELEASE=r'''
import json,os,re,shutil,sys
from pathlib import Path
def require(ok,reason):
 if not ok:raise ValueError(reason)
def remove(v):
 require(os.getuid()==1000,'linux_rebuild_residue_fixed_owner_required')
 base=Path(v['releaseParent']);require(re.fullmatch('[a-f0-9]{64}',v['sha']) is not None,'linux_rebuild_residue_sha_required')
 folder=base/v['sha']
 if not folder.is_dir() or folder.is_symlink():return {'removed':False,'alreadyAbsent':True}
 intent=folder/'source-upgrade-intent.json'
 require(not intent.exists() and not intent.is_symlink(),'linux_rebuild_residue_dispatched')
 top_files={'channel.key','config.json','pi-runner.service','predecessor-unit.service','source-upgrade-plan.json'}
 top_dirs={'backend','state'}
 for entry in folder.iterdir():
  require(not entry.name.endswith('.new'),'linux_rebuild_residue_fragment_present')
  if entry.is_symlink():require(False,'linux_rebuild_residue_unexpected_entry')
  elif entry.is_file():require(entry.name in top_files,'linux_rebuild_residue_unexpected_entry')
  elif entry.is_dir():require(entry.name in top_dirs,'linux_rebuild_residue_unexpected_entry')
  else:require(False,'linux_rebuild_residue_unexpected_entry')
 for sub in folder.rglob('*'):
  require(not sub.is_symlink(),'linux_rebuild_residue_unexpected_entry')
  require(not sub.name.endswith('.new'),'linux_rebuild_residue_fragment_present')
 shutil.rmtree(folder)
 return {'removed':True,'alreadyAbsent':False}
try:
 print(json.dumps(remove(json.load(sys.stdin)),sort_keys=True,separators=(',',':')))
except Exception as e:
 print(json.dumps({'removed':False,'alreadyAbsent':False,
     'reason':str(e) if isinstance(e,ValueError) else 'linux_rebuild_residue_removal_unknown'},sort_keys=True,separators=(',',':')))
 raise SystemExit(1)
'''


def remove_stale_linux_release(release_parent,source_sha,runner=subprocess.run):
    """Clear the WSL-side `<releaseParent>/<newSourceSha256>/` release left by
    a previous `prepare` so the next `prepare` can rebuild it for the new
    image. Refuses (raises) if that release was ever dispatched (an
    `source-upgrade-intent.json` exists) or carries an in-flight `*.new`
    fragment; reports success if the directory is already gone. This is the
    Linux-side half of a rebuilt-image replacement -- it must run together
    with the Windows-side `prepared.json` replacement, never alone."""
    wsl=Path(os.environ['SystemRoot'])/'System32/wsl.exe'
    env={key:value for key,value in os.environ.items() if key.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE'}}
    result=runner([str(wsl),'-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/python3','-B','-c',LINUX_REMOVE_NEVER_DISPATCHED_RELEASE],
        input=json.dumps({'releaseParent':release_parent,'sha':source_sha}).encode(),capture_output=True,timeout=60,env=env)
    lines=[line for line in result.stdout.splitlines() if line.strip()]
    # The embedded script always prints one JSON record to stdout, on both
    # the success and the `raise SystemExit(1)` refusal path; parse it either
    # way so a real refusal reason (e.g. already dispatched) is not collapsed
    # into an opaque "transport unknown". Only an actually unparseable or
    # missing record falls back to that generic transport failure.
    try:
        if len(lines)!=1:raise ValueError()
        record=json.loads(lines[0])
        if type(record) is not dict:raise ValueError()
    except ValueError:
        raise ValueError('linux_rebuild_residue_transport_unknown') from None
    if record.get('removed') is not True and record.get('alreadyAbsent') is not True:
        raise ValueError(record.get('reason','linux_rebuild_residue_removal_unknown'))
    return record


def write_rebuild_evidence(evidence_directory,operation_id,plan,old_image,old_registered_plan_sha256,new_image):
    """Durable, non-runtime record of the image id this replacement discarded.

    Never written under D:/teruisi-runtime; defaults to the same docs tree
    pi_agent_upgrade_residue.py uses, overridable for tests/non-default runs.
    """
    evidence_directory.mkdir(parents=True,exist_ok=True)
    record={'version':'teruisi-pi-upgrade-rebuilt-image-evidence-v1',
        'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'operationId':plan.get('operationId'),
        'newSourceSha256':plan.get('newSourceSha256'),'discardedOldPlanImage':old_image,'replacementNewImage':new_image,
        'discardedPlanSha256':old_registered_plan_sha256}
    path=evidence_directory/('pi-upgrade-rebuilt-image-'+operation_id+'.json')
    if path.exists():raise ValueError('pi_upgrade_rebuild_evidence_exists')
    path.write_text(json.dumps(record,indent=2,sort_keys=True,ensure_ascii=False)+'\n',encoding='utf-8')
    return path


def run_prepare_action(runtime,root,args,config,old_raw,key,key_path,plan_directory,prepared,source_digest):
    """Body of `action=='prepare'`, extracted verbatim from main() so it is
    directly testable against a synthetic `runtime` tree without touching the
    hard-coded D:/teruisi-runtime/django-sales production gate in main()."""
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
                or saved['newWindowsConfig']['skillVersion']!=skill_version):
            stale_plan=rebuilt_image_replacement_allowed(saved,old_raw,key_path,new_sha,args.image,skill_version,plan_directory)
            if stale_plan is None:raise ValueError('different_registered_upgrade_plan')
            evidence_directory=Path(args.rebuild_evidence_directory) if args.rebuild_evidence_directory else root/'docs/运维/部署与启动/pi-upgrade-rebuilt-image-evidence'
            write_rebuild_evidence(evidence_directory,stale_plan['operationId'],stale_plan,stale_plan['newImage'],sha(raw),args.image)
            if (rebuilt_image_replacement_allowed(saved,old_raw,key_path,new_sha,args.image,skill_version,plan_directory)
                    is None):raise ValueError('pi_upgrade_rebuild_eligibility_changed')
            remove_stale_linux_release(stale_plan['releaseParent'],new_sha)
            os.remove(prepared)
            if (plan_directory/'preparing.json').exists():os.remove(plan_directory/'preparing.json')
            if not any(plan_directory.iterdir()):plan_directory.rmdir()
            else:raise ValueError('pi_upgrade_rebuild_unexpected_sibling_file')
        else:
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


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','apply','check','reconcile'])
    parser.add_argument('--runtime',required=True);parser.add_argument('--image');parser.add_argument('--source-sha256')
    parser.add_argument('--expected-plan-sha256');parser.add_argument('--skill-version');parser.add_argument('--execute',action='store_true')
    parser.add_argument('--rebuild-evidence-directory',default=None)
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
        return run_prepare_action(runtime,root,args,config,old_raw,key,key_path,plan_directory,prepared,source_digest)
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
    except Exception as error:
        print(json.dumps(failure_document(error),separators=(',',':')))
        raise SystemExit(1)
