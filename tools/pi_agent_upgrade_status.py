"""Read-only exact observation of one registered independent Runner upgrade.

No lifecycle dispatch, signed request, nonce, checkpoint, or receipt publication is
performed here. Windows completion is durable even after the Runner later stops.
The sole eligible unfinished case is handed back to the original reconcile verb.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_property')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique_object)


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def read(path, limit=1048576):
    path = Path(path)
    for part in (path, *path.parents):
        require(not part.is_symlink() and not getattr(part, 'is_junction', lambda: False)(), 'upgrade_path_link')
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit, 'upgrade_file_identity')
    with path.open('rb') as handle:
        raw = handle.read(limit + 1)
    require(len(raw) <= limit, 'upgrade_file_bound')
    return raw


def no_fragment(path, expected=None):
    fragment = path.with_name(path.name + '.new')
    if fragment.exists() or fragment.is_symlink():
        require(expected is not None and read(fragment) == expected, 'upgrade_foreign_fragment_retained')


# Sent directly as python -c source: no drvfs, installed helper, HTTP or import
# from the candidate is needed. All filesystem and systemctl calls are reads.
LINUX = r'''
import hashlib,json,os,re,stat,subprocess,sys
from pathlib import Path
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def require(ok,reason):
 if not ok:raise ValueError(reason)
def unique(pairs):
 result={}
 for k,v in pairs:
  require(k not in result,'linux_duplicate_property');result[k]=v
 return result
def decode(raw):return json.loads(raw.decode('utf-8'),object_pairs_hook=unique)
def private(path,limit=1048576):
 for part in (path,*path.parents):require(not part.is_symlink(),'linux_upgrade_path_link')
 info=path.stat()
 require(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and not info.st_mode&0o077 and info.st_nlink==1 and info.st_size<=limit,'linux_upgrade_file_identity')
 with path.open('rb') as f:raw=f.read(limit+1)
 require(len(raw)<=limit,'linux_upgrade_file_bound')
 return raw
def manifest(root):
 require(root.is_dir(),'linux_old_state_missing')
 for part in (root,*root.parents):require(not part.is_symlink(),'linux_state_link')
 wal=root/'ledger.sqlite3-wal'
 require(not wal.exists() or wal.stat().st_size==0,'old_ledger_wal_not_checkpointed')
 rows=[]
 for file in sorted(root.rglob('*')):
  require(not file.is_symlink(),'linux_state_link')
  if file.is_file() and file.name not in {'broker.lock','ledger.sqlite3-wal','ledger.sqlite3-shm'}:
   digest=hashlib.sha256()
   with file.open('rb') as stream:
    for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
   rows.append([file.relative_to(root).as_posix(),digest.hexdigest()])
 return sha(encode(rows))
def source_bytes(path):
 for part in (path,*path.parents):require(not part.is_symlink(),'linux_source_link')
 info=path.stat()
 require(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and info.st_nlink==1 and info.st_size<=16777216,'linux_source_file_identity')
 with path.open('rb') as f:raw=f.read(16777217)
 require(len(raw)<=16777216,'linux_source_file_bound')
 return raw
def observe(v):
 require(os.getuid()==1000,'linux_fixed_owner_required')
 p=v['plan'];base=Path(p['releaseParent']);unit=Path(p['unitPath'])
 require(p['namespace']=='pi-agent-v1' and base==Path.home()/'.local/share/teruisi-pi-runner/releases' and unit==Path.home()/'.config/systemd/user/teruisi-pi-runner.service' and p['unitName']=='teruisi-pi-runner.service' and p['port']==8123,'linux_fixed_binding_required')
 new=base/p['newSourceSha256'];old=base/p['oldSourceSha256']
 raw=private(new/'source-upgrade-plan.json')
 require(sha(raw)==v['planSha256'] and decode(raw)==p,'linux_plan_binding_changed')
 digest=hashlib.sha256();source=new/'backend/pi_runner'
 require(source.is_dir(),'linux_source_missing')
 for f in sorted(source.rglob('*'),key=lambda x:x.relative_to(source).as_posix()):
  require(not f.is_symlink(),'linux_source_link')
  if f.is_file() and '__pycache__' not in f.parts and not f.name.startswith('test_'):
   digest.update(f.relative_to(source).as_posix().encode()+b'\0'+source_bytes(f))
 require(digest.hexdigest()==p['newSourceSha256'],'linux_source_binding_changed')
 require(sha(private(new/'config.json'))==p['newConfigSha256'] and sha(private(new/'channel.key'))==p['channelKeySha256'],'linux_successor_config_key_changed')
 config=decode(private(new/'config.json'))
 require(config['image']==p['newImage'] and config['namespace']==p['namespace'] and config['keyFile']==str(new/'channel.key') and config['stateDirectory']==str(new/'state'),'linux_successor_config_changed')
 require(sha(private(unit))==p['newUnitSha256'] and private(unit)==private(new/'pi-runner.service') and sha(private(new/'predecessor-unit.service'))==p['oldUnitSha256'],'linux_unit_not_exact_successor')
 intent=decode(private(new/'source-upgrade-intent.json'))
 require(set(intent)=={'operationId','status','freshStateSha256','candidateStateSha256','planSha256'} and intent['operationId']==p['operationId'] and intent['planSha256']==v['planSha256'] and intent['status'] in {'runner_verified','unknown'},'linux_original_intent_unproved')
 require(all(isinstance(intent[k],str) and re.fullmatch('[a-f0-9]{64}',intent[k]) for k in ('freshStateSha256','candidateStateSha256')),'linux_state_identity_invalid')
 for f in (new/'source-upgrade-plan.json',new/'source-upgrade-intent.json',unit):
  fragment=f.with_name(f.name+'.new')
  require(not fragment.exists() and not fragment.is_symlink(),'linux_upgrade_fragment_retained')
 if v['complete']:
  require(intent['freshStateSha256']==v['result']['freshStateSha256'] and intent['candidateStateSha256']==v['result']['candidateStateSha256'],'linux_completed_state_binding_changed')
  return {'observed':True,'staticBindingVerified':True,'activityRequired':False}
 if v.get('pendingResult') is not None:
  require(intent['freshStateSha256']==v['pendingResult']['freshStateSha256'] and intent['candidateStateSha256']==v['pendingResult']['candidateStateSha256'],'linux_pending_result_state_conflict')
 require(sha(private(old/'config.json'))==p['oldConfigSha256'] and manifest(old/'state')==intent['freshStateSha256'],'linux_old_fresh_state_changed')
 env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'}
 fields=('ActiveState','MainPID','FragmentPath','WorkingDirectory','ExecStart','NeedDaemonReload')
 run=subprocess.run(['/usr/bin/systemctl','--user','show',p['unitName'],*['--property='+k for k in fields]],env=env,capture_output=True,timeout=15)
 require(run.returncode==0,'linux_loaded_unit_unknown')
 values=dict(line.split('=',1) for line in run.stdout.decode('utf-8').splitlines() if '=' in line)
 require(set(values)==set(fields) and values['ActiveState']=='active' and values['MainPID'].isdigit() and int(values['MainPID'])>0,'linux_successor_not_active')
 argv=['/usr/bin/python3','-B','-m','pi_runner.server','--config',str(new/'config.json')]
 loaded=re.search(r'argv\[\]=(.*?) ;',values['ExecStart'])
 require(values['FragmentPath']==str(unit) and values['WorkingDirectory']==str(new/'backend') and values['NeedDaemonReload']=='no' and loaded is not None and loaded.group(1)==' '.join(argv),'linux_loaded_unit_changed')
 pid=int(values['MainPID']);matched=[]
 for proc in Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   if proc.stat().st_uid!=1000:continue
   args=(proc/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
  except (FileNotFoundError,ProcessLookupError):continue
  if b'pi_runner.server' not in args:continue
  if str(old/'config.json').encode() in args or str(new/'config.json').encode() in args:
   require(int(proc.name)==pid and args==[a.encode() for a in argv] and os.readlink(proc/'cwd')==str(new/'backend') and os.path.realpath(proc/'exe')==os.path.realpath('/usr/bin/python3'),'linux_runner_process_conflict')
   matched.append(int(proc.name))
 require(matched==[pid],'linux_successor_pid_unproved')
 return {'observed':True,'staticBindingVerified':True,'activityRequired':True,'active':True,'mainPid':pid,'oldFreshStateVerified':True,'loadedUnitVerified':True}
try:
 print(json.dumps(observe(json.load(sys.stdin)),sort_keys=True,separators=(',',':')))
except Exception as e:
 print(json.dumps({'observed':False,'reason':str(e) if isinstance(e,ValueError) else 'linux_observation_unknown'},sort_keys=True,separators=(',',':')))
 raise SystemExit(1)
'''


def invoke_linux(value, runner=subprocess.run):
    wsl = Path(os.environ['SystemRoot']) / 'System32/wsl.exe'
    env = {key: item for key, item in os.environ.items()
           if key.upper() in {'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE'}}
    command = [str(wsl), '-d', 'TERUISI-Pandas', '-u', 'teruisi-pandas', '--exec', '/usr/bin/python3', '-B', '-c', LINUX]
    try:
        result = runner(command, input=encode(value), capture_output=True, timeout=60, env=env)
        stdout, stderr, direct_exit = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr, direct_exit = error.stdout or b'', error.stderr or b'', None
    # Preserve original bytes and the direct process outcome before parsing;
    # neither a legacy log codepage nor a failed decoder changes that outcome.
    evidence = {'directExitCode': direct_exit, 'stdoutBase64': base64.b64encode(stdout).decode('ascii'),
                'stderrBase64': base64.b64encode(stderr).decode('ascii')}
    try:
        records = [decode(line) for line in stdout.splitlines() if line.strip()]
        require(len(records) == 1 and type(records[0]) is dict, 'linux_observation_parse_unknown')
        observed = records[0]
    except (ValueError, UnicodeError):
        return {'observed': False, 'reason': 'linux_observation_parse_unknown'}, evidence
    if direct_exit != 0 or observed.get('observed') is not True:
        return {'observed': False, 'reason': observed.get('reason', 'linux_observation_unknown')}, evidence
    return observed, evidence


def inspect_upgrade(runtime, expected, source_sha, read_key, linux_observer=invoke_linux):
    """Pure observation seam; caller owns the native service mutex and ACL gate."""
    status = {'status': 'blocked', 'reason': 'upgrade_observation_unknown', 'operationId': None,
              'registeredPlanSha256': expected, 'planSha256': None, 'sourceSha256': source_sha,
              'image': None, 'windowsConfigSha256': None, 'windowsKeyFileSha256': None,
              'postconditionsVerified': False, 'upgradeReceipt': None}
    try:
        require(isinstance(expected, str) and re.fullmatch('[a-f0-9]{64}', expected) is not None, 'registered_upgrade_plan_required')
        require(isinstance(source_sha, str) and re.fullmatch('[a-f0-9]{64}', source_sha) is not None, 'upgrade_source_required')
        folder = runtime / 'config/pi-agent-upgrades' / source_sha
        prepared = folder / 'prepared.json'
        raw = read(prepared)
        require(sha(raw) == expected, 'registered_upgrade_plan_changed')
        receipt = decode(raw)
        require(type(receipt) is dict and set(receipt) == {'prepared', 'started', 'plan', 'planSha256', 'linuxPlanPath', 'newWindowsConfig', 'oldWindowsConfigSha256', 'windowsKeyFileSha256'}
                and receipt['prepared'] is True and receipt['started'] is False, 'registered_upgrade_receipt_invalid')
        plan = receipt['plan']
        plan_keys = {'operationId', 'namespace', 'unitName', 'unitPath', 'releaseParent', 'port', 'oldSourceSha256', 'newSourceSha256', 'oldImage', 'newImage', 'channelKeySha256', 'windowsConfigSha256', 'windowsKeyFileSha256', 'schemaVersion', 'protocolVersion', 'oldConfigSha256', 'oldUnitSha256', 'newUnitSha256', 'newConfigSha256'}
        require(type(plan) is dict and set(plan) == plan_keys, 'registered_upgrade_plan_invalid')
        require(type(plan['schemaVersion']) is int and plan['schemaVersion'] == 1 and plan['protocolVersion'] == 'pi-runner-v1'
                and type(plan['port']) is int and plan['port'] == 8123 and plan['namespace'] == 'pi-agent-v1'
                and plan['unitName'] == 'teruisi-pi-runner.service'
                and plan['unitPath'] == '/home/teruisi-pandas/.config/systemd/user/teruisi-pi-runner.service'
                and plan['releaseParent'] == '/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases', 'registered_upgrade_fixed_binding_changed')
        require(all(isinstance(plan[k], str) and re.fullmatch('[a-f0-9]{64}', plan[k]) for k in plan_keys if k.endswith('Sha256'))
                and re.fullmatch('[a-f0-9]{32}', plan['operationId']) is not None
                and all(isinstance(plan[k], str) and re.fullmatch('sha256:[a-f0-9]{64}', plan[k]) for k in ('oldImage', 'newImage')), 'registered_upgrade_identity_invalid')
        require(plan['newSourceSha256'] == source_sha and plan['oldSourceSha256'] != source_sha and sha(encode(plan)) == receipt['planSha256']
                and receipt['oldWindowsConfigSha256'] == plan['windowsConfigSha256']
                and receipt['windowsKeyFileSha256'] == plan['windowsKeyFileSha256']
                and receipt['linuxPlanPath'] == plan['releaseParent'] + '/' + source_sha + '/source-upgrade-plan.json', 'registered_upgrade_plan_binding_changed')
        status.update(operationId=plan['operationId'], planSha256=receipt['planSha256'], image=plan['newImage'])
        intent_raw = read(folder / 'intent.json')
        intent = decode(intent_raw)
        require(type(intent) is dict and intent == {'operationId': plan['operationId'], 'status': 'dispatching', 'registeredPlanSha256': expected}, 'upgrade_original_windows_intent_changed')
        config_path, key_path = runtime / 'config/pi-agent.json', runtime / 'secrets/pi-agent.dpapi.json'
        config_raw, key_raw = read(config_path), read(key_path, 8192)
        config = decode(config_raw)
        successor = receipt['newWindowsConfig']
        config_keys = {'version', 'enabled', 'keyFileSha256', 'channelKeySha256', 'skillVersion', 'authorityEpoch', 'cutoverId', 'runnerImage', 'runnerSourceSha256'}
        require(type(successor) is dict and set(successor) == config_keys and type(successor['version']) is int and successor['version'] == 1
                and successor['enabled'] is True and successor['runnerSourceSha256'] == source_sha and successor['runnerImage'] == plan['newImage']
                and successor['channelKeySha256'] == plan['channelKeySha256'] and successor['keyFileSha256'] == plan['windowsKeyFileSha256']
                and isinstance(successor['skillVersion'], str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', successor['skillVersion'])
                and all(isinstance(successor[k], str) and successor[k] for k in ('authorityEpoch', 'cutoverId')), 'upgrade_successor_windows_config_invalid')
        require(sha(key_raw) == plan['windowsKeyFileSha256'] and sha(read_key(key_path)) == plan['channelKeySha256'], 'upgrade_windows_dpapi_owner_key_changed')
        successor_raw = encode(successor)
        if config_raw != successor_raw:
            require(sha(config_raw) == receipt['oldWindowsConfigSha256'] and type(config) is dict and set(config) == config_keys
                    and {**config, 'runnerSourceSha256': source_sha, 'runnerImage': plan['newImage'], 'skillVersion': successor['skillVersion']} == successor
                    and config['runnerSourceSha256'] == plan['oldSourceSha256'] and config['runnerImage'] == plan['oldImage'], 'upgrade_current_windows_config_conflict')
        status.update(windowsConfigSha256=sha(config_raw), windowsKeyFileSha256=sha(key_raw))
        preparing_raw = read(folder / 'preparing.json')
        preparing = decode(preparing_raw)
        require(preparing == {'operationId': plan['operationId'], 'oldWindowsConfigSha256': plan['windowsConfigSha256'],
                              'newSourceSha256': source_sha, 'newImage': plan['newImage'], 'skillVersion': successor['skillVersion']},
                'upgrade_preparing_identity_changed')
        for path in (prepared, folder / 'preparing.json', folder / 'intent.json', key_path):
            no_fragment(path)
        no_fragment(config_path, successor_raw)
        result_path = folder / 'result.json'
        result_raw = read(result_path) if result_path.exists() or result_path.is_symlink() else None
        result = decode(result_raw) if result_raw is not None else None
        result_fragment = result_path.with_name(result_path.name + '.new')
        fragment_raw = read(result_fragment) if result_fragment.exists() or result_fragment.is_symlink() else None
        fragment = decode(fragment_raw) if fragment_raw is not None else None
        for candidate in (result, fragment):
            if candidate is None:
                continue
            keys = {'upgraded', 'sourceSha256', 'image', 'freshStateSha256', 'candidateStateSha256', 'operationId', 'planSha256', 'oldReleaseRetained', 'windowsConfigSha256', 'windowsKeyFileSha256'}
            require(type(candidate) is dict and set(candidate) in (keys, keys | {'reconciled'})
                    and candidate['upgraded'] is True and candidate['oldReleaseRetained'] is True
                    and ('reconciled' not in candidate or candidate['reconciled'] is True)
                    and candidate['operationId'] == plan['operationId'] and candidate['planSha256'] == receipt['planSha256']
                    and candidate['sourceSha256'] == source_sha and candidate['image'] == plan['newImage']
                    and candidate['windowsConfigSha256'] == sha(successor_raw) and candidate['windowsKeyFileSha256'] == sha(key_raw)
                    and all(isinstance(candidate[k], str) and re.fullmatch('[a-f0-9]{64}', candidate[k]) for k in ('freshStateSha256', 'candidateStateSha256')), 'upgrade_windows_result_binding_changed')
        require(result is None or config_raw == successor_raw, 'upgrade_completed_windows_config_changed')
        require(fragment is None or result is None or fragment == result, 'upgrade_windows_result_fragment_conflict')
        originals = {prepared: raw, folder / 'preparing.json': preparing_raw, folder / 'intent.json': intent_raw,
                     config_path: config_raw, key_path: key_raw, result_path: result_raw, result_fragment: fragment_raw}
        for path in originals:
            current = read(path) if path.exists() or path.is_symlink() else None
            require(current == originals[path], 'upgrade_windows_observation_changed')
        observed, transport = linux_observer({'plan': plan, 'planSha256': receipt['planSha256'], 'complete': result is not None, 'result': result, 'pendingResult': fragment})
        status['linuxTransport'] = transport
        require(observed.get('observed') is True and observed.get('staticBindingVerified') is True, observed.get('reason', 'linux_observation_unknown'))
        for path in originals:
            current = read(path) if path.exists() or path.is_symlink() else None
            require(current == originals[path], 'upgrade_windows_observation_changed')
        for path in (prepared, folder / 'preparing.json', folder / 'intent.json', key_path):
            no_fragment(path)
        no_fragment(config_path, successor_raw)
        status['linuxObservation'] = observed
        if result is not None:
            status.update(status='windows_complete', reason='exact_persisted_windows_upgrade_complete',
                          upgradeReceipt={**result, 'windowsConfigUpdated': True, 'sameDpapiOwner': True})
        else:
            require(observed.get('active') is True and observed.get('loadedUnitVerified') is True
                    and observed.get('oldFreshStateVerified') is True, 'linux_reconciliation_eligibility_unproved')
            status.update(status='reconcile_available', reason='exact_active_successor_original_reconciliation_available')
    except Exception as error:
        status['reason'] = str(error) if isinstance(error, ValueError) else 'upgrade_observation_unknown'
    return status


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--expected-plan-sha256', required=True)
    args = parser.parse_args()
    runtime = Path(args.runtime).absolute()
    require(os.name == 'nt' and runtime == Path(r'D:\teruisi-runtime\django-sales'), 'native_pi_upgrade_status_required')
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / 'backend'))
    from pi_runner.install_linux import source_digest
    from pandas_runner.key_file import read_key
    print(json.dumps(inspect_upgrade(runtime, args.expected_plan_sha256, source_digest(), read_key), sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    main()
