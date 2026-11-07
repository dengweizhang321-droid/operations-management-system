"""Single original AI159 Runner start. Called by the native recovery wrapper."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


RUNTIME = Path(r'D:\teruisi-runtime\django-sales')
ATTEMPT = Path(r'D:\codex-isolated\main-release-packages\e030caba1271-aaab2674-b0c1080e\publish-e030caba1271')
SOURCE = 'e030caba1271d47fced663649f288855234a02e2'
REGISTERED = '58f8ce87c52d0040fe448131679baa72c5963e3e5b5bb9dcd1c1c4ee32c75d5a'
PLAN = '093fc9fcbe8ddba224bf90d2f434d04aa47398af70b8fe5eeec2f11abc52b749'
OPERATION = '88b7e64f18dd4afdb67869895c5d7f1e'
OLD = '1175d4b874ca4b7d52e8b64c527f6ff7c80978fc5b6a33837ad17b72c36067ce'
NEW = '781a2a300e668f78072c8105882af8851a7776374e068ca8472ed1bfff6ad557'
STATUS_HASH = '61596f746a470861b5b97df82a444ee4706a7c0998dcbc01f817e44c690696b1'
GUARD = 'PiRunnerRecovery-started.json'


LINUX_SUPPORT = r'''
import base64,sqlite3,time

def ctl(env, *args, timeout=12):
 return subprocess.run(['/usr/bin/systemctl','--user',*args],env=env,capture_output=True,timeout=timeout)

def check_docker(config, env, wait):
 sock=Path(config['socket']);docker=Path(config['docker'])
 require(sock==Path('/run/user/1000/docker.sock') and docker==Path('/usr/bin/docker'),'recovery_docker_binding_changed')
 docker_env={**env,'DOCKER_HOST':'unix://'+str(sock),'DOCKER_CONFIG':config['stateDirectory']+'/empty-docker-config'}
 docker_config=Path(docker_env['DOCKER_CONFIG']);info=docker_config.lstat()
 require(stat.S_ISDIR(info.st_mode) and info.st_uid==1000 and not info.st_mode&0o077,'recovery_docker_config_changed')
 deadline=time.monotonic()+(50 if wait else 0)
 while True:
  try:
   if ctl(env,'is-active','docker.service',timeout=4).stdout.strip()==b'active':
    sock_info=sock.lstat()
    require(stat.S_ISSOCK(sock_info.st_mode) and sock_info.st_uid==1000,'recovery_docker_socket_changed')
    run=subprocess.run([str(docker),'info','--format','{{json .}}'],env=docker_env,capture_output=True,timeout=5)
    if run.returncode==0:break
  except (FileNotFoundError,subprocess.TimeoutExpired):pass
  require(time.monotonic()<deadline,'recovery_docker_not_ready')
  time.sleep(.4)
 data=decode(run.stdout);security=' '.join(data.get('SecurityOptions',[]))
 require(data.get('OSType')=='linux' and 'rootless' in security and 'seccomp' in security
  and data.get('CgroupVersion')=='2' and data.get('CgroupDriver')=='systemd'
  and all(data.get(k) is True for k in ('MemoryLimit','SwapLimit','PidsLimit','CpuCfsQuota')),'recovery_docker_isolation_changed')
 image=subprocess.run([str(docker),'image','inspect',config['image']],env=docker_env,capture_output=True,timeout=5,check=True)
 image=decode(image.stdout)[0]
 require(image['Id']==config['image'] and image.get('Os')=='linux' and not image['Config'].get('Volumes')
  and image['Config'].get('Entrypoint')==['node','/opt/pi/entrypoint.mjs'],'recovery_docker_image_changed')
 running=subprocess.run([str(docker),'ps','-q','--filter','label=teruisi.pi.namespace='+config['namespace']],env=docker_env,capture_output=True,timeout=5,check=True)
 require(not running.stdout.strip(),'recovery_runner_container_active')

def listeners(port):
 result=set()
 for table in ('/proc/net/tcp','/proc/net/tcp6'):
  for line in Path(table).read_text().splitlines()[1:]:
   row=line.split()
   if row[3]=='0A' and int(row[1].rsplit(':',1)[1],16)==port:result.add(row[9])
 return result

def ledger_counts(state):
 file=state/'ledger.sqlite3';info=file.lstat()
 require(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and info.st_nlink==1 and not info.st_mode&0o077,'recovery_candidate_ledger_changed')
 # The caller requires a stopped, empty-WAL database. Immutable mode cannot
 # create SQLite sidecars and only aggregate counts leave the ledger.
 connection=sqlite3.connect(file.as_uri()+'?mode=ro&immutable=1',uri=True)
 try:
  return ledger_metadata(connection)
 finally:connection.close()

def ledger_metadata(connection):
 queries={
  'sessions': "SELECT count(*) FROM sessions WHERE status NOT IN ('stopped','disposed') OR status IS NULL",
  'commands': "SELECT count(*) FROM commands WHERE status IN ('dispatching','unknown')",
  'gateway': "SELECT count(*) FROM gateway WHERE status='dispatching'",
  'controls': "SELECT count(*) FROM workspace_controls WHERE status IN ('dispatching','accepted','queued','unknown')",
  'activities': "SELECT count(*) FROM workspace_activities WHERE status IN ('active','unknown')",
  'terminals': "SELECT count(*) FROM workspace_terminals WHERE status IN ('starting','running')",
  'helpers': "SELECT count(*) FROM workspace_helpers WHERE status!='complete'",
  'upgrades': "SELECT count(*) FROM workspace_upgrades",
 }
 counts={key:connection.execute(query).fetchone()[0] for key,query in queries.items()}
 require(not any(counts.values()),'recovery_candidate_ledger_active_or_unsafe')
 unknown=connection.execute("SELECT operation,request,digest FROM gateway WHERE status='unknown' ORDER BY operation,request LIMIT 16").fetchall()
 require(len(unknown)==15,'recovery_gateway_unknown_inventory_changed')
 bound=[]
 for operation,request,digest in unknown:
  owner=connection.execute("SELECT DISTINCT e.workspace,s.identity,s.status FROM events e LEFT JOIN sessions s USING(workspace) WHERE e.operation=? LIMIT 2",(operation,)).fetchall()
  require(len(owner)==1 and isinstance(owner[0][1],bytes) and owner[0][2] in {'stopped','disposed'},'recovery_gateway_unknown_owner_unproved')
  workspace,identity,state=owner[0]
  bound.append([operation,request,digest,'unknown',workspace,sha(identity),state])
 return {'activeCounts':counts,'retainedGatewayUnknownCount':len(bound),'retainedGatewayUnknownSha256':sha(encode(bound))}

def inactive(v,p,old,new,unit,config,intent,env,values):
 require(intent['status']=='unknown' and values['ActiveState']=='inactive' and values['MainPID']=='0'
  and values['SubState']=='dead' and values['Result']=='success','recovery_successor_not_cleanly_inactive')
 for proc in Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   if proc.stat().st_uid!=1000:continue
   args=(proc/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
  except (FileNotFoundError,ProcessLookupError):continue
  require(b'pi_runner.server' not in args,'recovery_runner_process_conflict')
 require(not listeners(p['port']),'recovery_runner_port_occupied')
 check_docker(config,env,v['phase']=='preflight')
 state=new/'state';state_sha=manifest(state);counts=ledger_counts(state)
 require(manifest(state)==state_sha,'recovery_candidate_state_changed')
 return {'observed':True,'staticBindingVerified':True,'active':False,'mainPid':0,
  'oldFreshStateVerified':True,'loadedUnitVerified':True,'dockerReady':True,'ledgerCounts':counts,
  'freshStateSha256':intent['freshStateSha256'],'preparedCandidateStateSha256':intent['candidateStateSha256'],
  'stoppedCandidateStateSha256':state_sha,'invocationId':values['InvocationID'],
  'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
  'managerPid':bus_manager_pid()}

def bus_manager_pid():
 run=subprocess.run(['/usr/bin/busctl','--user','call','org.freedesktop.DBus','/org/freedesktop/DBus',
  'org.freedesktop.DBus','GetConnectionUnixProcessID','s','org.freedesktop.systemd1'],capture_output=True,timeout=5,
  env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'})
 require(run.returncode==0 and re.fullmatch(rb'u [1-9][0-9]*\s*',run.stdout) is not None,'recovery_user_manager_unproved')
 return int(run.stdout.split()[1])

def ready(p,values,pid,expected):
 require(re.fullmatch('[a-f0-9]{32}',values['InvocationID']) and values['InvocationID']!=expected['invocationId']
  and Path('/proc/sys/kernel/random/boot_id').read_text().strip()==expected['bootId']
  and bus_manager_pid()==expected['managerPid'],'recovery_runner_invocation_unproved')
 owned=set()
 for fd in (Path('/proc')/str(pid)/'fd').iterdir():
  try:target=os.readlink(fd)
  except FileNotFoundError:continue
  match=re.fullmatch(r'socket:\[([0-9]+)\]',target)
  if match:owned.add(match.group(1))
 bound=listeners(p['port'])
 require(bound and bound<=owned,'recovery_runner_not_listening')
 return {'invocationId':values['InvocationID'],'listening':True}

def dispatch(v):
 if v['phase']=='preflight':return observe(v)
 if v['phase']=='start':
  try:require(observe(v)==v['expected'],'recovery_preflight_changed')
  except Exception as e:
   return {'startDispatched':False,'reason':str(e) if isinstance(e,ValueError) else 'recovery_preflight_unknown'}
  env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'}
  try:
   run=ctl(env,'start',v['plan']['unitName'],timeout=35)
   code,stdout,stderr=run.returncode,run.stdout,run.stderr
  except subprocess.TimeoutExpired as e:
   code,stdout,stderr=None,e.stdout or b'',e.stderr or b''
  return {'startDispatched':True,'startExitCode':code,'stdoutBase64':base64.b64encode(stdout).decode('ascii'),
   'stderrBase64':base64.b64encode(stderr).decode('ascii')}
 deadline=time.monotonic()+40
 while True:
  try:return observe(v)
  except (ValueError,FileNotFoundError,ProcessLookupError) as e:
   if str(e) not in {'linux_successor_not_active','recovery_runner_not_listening'} or time.monotonic()>=deadline:raise
   time.sleep(.4)

try:
 print(json.dumps(dispatch(json.load(sys.stdin)),sort_keys=True,separators=(',',':')))
except Exception as e:
 code=str(e)
 print(json.dumps({'observed':False,'reason':code if re.fullmatch('[a-z_]{1,80}',code) else 'recovery_linux_unknown'}))
 raise SystemExit(1)
'''


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def replace_once(source, old, new):
    require(source.count(old) == 1, 'original_linux_observer_shape_changed')
    return source.replace(old, new, 1)


def linux_source(original):
    """Reuse the frozen read-only validations with two narrowly gated branches."""
    source = original.split("\ntry:\n print(json.dumps(observe(json.load(sys.stdin))", 1)
    require(len(source) == 2, 'original_linux_observer_shape_changed')
    script = replace_once(source[0], "'NeedDaemonReload')", "'NeedDaemonReload','DropInPaths','SubState','Result','InvocationID')")
    script = replace_once(script, "'--user','show',p['unitName']", "'--user','show','--all',p['unitName']")
    active = " require(set(values)==set(fields) and values['ActiveState']=='active' and values['MainPID'].isdigit() and int(values['MainPID'])>0,'linux_successor_not_active')\n"
    script = replace_once(script, active, " require(set(values)==set(fields) and not values['DropInPaths'],'recovery_loaded_unit_overridden')\n")
    script = replace_once(script, " pid=int(values['MainPID']);matched=[]", (
        " if v['phase'] in {'preflight','start'}:return inactive(v,p,old,new,unit,config,intent,env,values)\n"
        + active + " pid=int(values['MainPID']);matched=[]"))
    script = replace_once(script, "'loadedUnitVerified':True}", "'loadedUnitVerified':True,**ready(p,values,pid,v['expected'])}")
    return script + LINUX_SUPPORT


def save(path, data):
    with path.open('xb') as file:
        file.write(data)
        file.flush()
        os.fsync(file.fileno())


def save_record(path, value):
    save(path, (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode())


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def invoke(status, script, value, output, phase, expected=None, runner=subprocess.run):
    wsl = Path(os.environ['SystemRoot']) / 'System32/wsl.exe'
    command = [str(wsl), '-d', 'TERUISI-Pandas', '-u', 'teruisi-pandas', '--exec', '/usr/bin/python3', '-B', '-c', script]
    env = {key: item for key, item in os.environ.items()
           if key.upper() in {'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE'}}
    try:
        result = runner(command, input=status.encode({**value, 'phase': phase, 'expected': expected}),
                        capture_output=True, timeout=90, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        stdout, stderr, code = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr, code = error.stdout or b'', error.stderr or b'', None
    save(output / f'Runner-{phase}.stdout.log', stdout)
    save(output / f'Runner-{phase}.stderr.log', stderr)
    evidence = {'directExitCode': code, 'stdoutSha256': status.sha(stdout), 'stderrSha256': status.sha(stderr)}
    save_record(output / f'Runner-{phase}-process.json', evidence)
    try:
        value = status.decode(stdout.strip())
        require(type(value) is dict, 'recovery_linux_record_invalid')
    except (ValueError, UnicodeError):
        value = {'observed': False, 'reason': 'recovery_linux_record_unknown'}
    return value, evidence


def recover(status, read_key, output, keeper, invoke_linux=invoke, attempt=ATTEMPT, runtime=RUNTIME):
    script = linux_source(status.LINUX)
    payload = None

    def preflight(value):
        nonlocal payload
        plan = value['plan']
        require(value['planSha256'] == PLAN and plan['operationId'] == OPERATION and plan['newSourceSha256'] == NEW
                and plan['oldSourceSha256'] == OLD and not value['complete'] and value['pendingResult'] is None,
                'recovery_exact_original_plan_required')
        require(status.sha(status.read(runtime / 'config/pi-agent.json')) == plan['windowsConfigSha256'],
                'recovery_windows_predecessor_changed')
        payload = value
        return invoke_linux(status, script, value, output, 'preflight')

    started = attempt / GUARD
    require(not started.exists() and not started.is_symlink(), 'recovery_original_start_guard_exists')
    observation = status.inspect_upgrade(runtime, REGISTERED, NEW, read_key, preflight)
    candidate = observation.get('linuxObservation', {})
    require(payload is not None and candidate.get('active') is False and candidate.get('dockerReady') is True
            and candidate.get('mainPid') == 0 and candidate.get('loadedUnitVerified') is True
            and candidate.get('oldFreshStateVerified') is True and candidate.get('staticBindingVerified') is True
            and observation['linuxTransport']['directExitCode'] == 0,
            'recovery_preflight_unproved')
    save_record(started, {'at': now(), 'sourceCommit': SOURCE, 'registeredPlanSha256': REGISTERED,
                          'planSha256': PLAN, 'operationId': OPERATION, 'sourceSha256': NEW,
                          'oldSourceSha256': OLD, 'invocation': str(output), 'keeper': keeper,
                          'unitSha256': payload['plan']['newUnitSha256'],
                          'configSha256': payload['plan']['newConfigSha256'], 'preflight': candidate})
    # An uncertain direct exit cannot authorize another start. Independently
    # prove the original unit has a new invocation and its exact PID is listening.
    direct, transport = invoke_linux(status, script, payload, output, 'start', candidate)
    require(direct.get('startDispatched') is not False, 'recovery_live_start_preflight_refused')
    active, proof = invoke_linux(status, script, payload, output, 'postflight', candidate)
    require(proof['directExitCode'] == 0 and active.get('observed') is True and active.get('active') is True
            and active.get('listening') is True and active.get('staticBindingVerified') is True
            and active.get('loadedUnitVerified') is True and active.get('oldFreshStateVerified') is True,
            'recovery_started_successor_unproved')
    result = {'sourceCommit': SOURCE, 'sourceSha256': NEW, 'operationId': OPERATION, 'activeSuccessorVerified': True,
              'registeredPlanSha256': REGISTERED, 'planSha256': PLAN, 'mainPid': active['mainPid'],
              'invocationId': active['invocationId'], 'startDirectExit': transport['directExitCode'],
              'systemctlExit': direct.get('startExitCode'), 'keeper': keeper}
    save_record(output / 'RunnerStart-observed.json', result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--invocation', required=True)
    args = parser.parse_args()
    output = Path(args.invocation)
    require(os.name == 'nt' and output.is_absolute() and output.resolve() == output and output.is_dir(), 'recovery_output_binding_required')
    installed = RUNTIME / 'app'
    original = installed / 'tools/pi_agent_upgrade_status.py'
    require(hashlib.sha256(original.read_bytes()).hexdigest() == STATUS_HASH, 'installed_original_pi_status_changed')
    spec = importlib.util.spec_from_file_location('original_pi_upgrade_status', original)
    status = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(status)
    sys.path.insert(0, str(installed / 'backend'))
    from pandas_runner.key_file import read_key
    keeper_path = output / 'RunnerKeeper.json'
    keeper = status.decode(status.read(keeper_path))
    print(json.dumps(recover(status, read_key, output, keeper), sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error)
        if not reason.startswith(('recovery_', 'installed_original_', 'original_linux_')) or not reason.replace('_', '').isalnum():
            reason = 'recovery_runner_unknown'
        print(json.dumps({'activeSuccessorVerified': False, 'reason': reason}))
        raise SystemExit(1)
