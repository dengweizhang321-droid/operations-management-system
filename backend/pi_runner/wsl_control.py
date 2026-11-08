"""Explicit Windows lifecycle of the one opt-in Pi unit; no production fallback."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import time
from .native_isolation import PROFILE, native_port

from .client import command
from .protocol import HEALTH_PATH, decode, encode


def verify_probe(result,config,expected_namespace='pi-agent-v1'):
    """Validate an already HMAC-authenticated probe; formal namespace stays fixed."""
    if (not isinstance(result,dict) or result.get('image')!=config.get('runnerImage')
            or result.get('sourceSha256')!=config.get('runnerSourceSha256')
            or result.get('namespace')!=expected_namespace or result.get('closing')):
        raise ValueError('runner_identity_changed')
    return result


def verify_stop_readiness(result):
    for key in ['activeCount','unresolvedCount','unsafeUnknownCount','unknownStoppedVerifiedCount']:
        if type(result.get(key)) is not int or result[key]<0:raise ValueError('runner_stop_readiness_missing')
    if result['activeCount'] or result['unsafeUnknownCount'] or result['unknownStoppedVerifiedCount']!=result['unresolvedCount']:
        raise ValueError('active_or_unsafe_unknown_runner_operations')
    return result


def control(verb,config_path,key_file):
    if os.name!='nt' or verb not in {'start','stop','probe'}:raise ValueError('invalid_lifecycle')
    from pandas_runner.key_file import read_key
    config=decode(Path(config_path).read_bytes())
    if config.get('version')!=1 or config.get('enabled') is not True:raise ValueError('pi_opt_in_required')
    digest=config.get('runnerSourceSha256','');image=config.get('runnerImage','')
    if not re.fullmatch(r'[a-f0-9]{64}',digest) or not re.fullmatch(r'sha256:[a-f0-9]{64}',image):raise ValueError('bound_runner_source_required')
    import hashlib
    if hashlib.sha256(Path(key_file).read_bytes()).hexdigest()!=config.get('keyFileSha256'):raise ValueError('runner_key_file_changed')
    key=read_key(key_file)
    if hashlib.sha256(key).hexdigest()!=config.get('channelKeySha256'):raise ValueError('runner_channel_key_changed')
    root='/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases/'+digest
    if PROFILE:
        root=PROFILE['linuxRoot']+'/pi/releases/'+digest
    distribution=PROFILE['wslDistribution'] if PROFILE else 'TERUISI-Pandas'
    unit=PROFILE['piUnit'] if PROFILE else 'teruisi-pi-runner.service'
    namespace=PROFILE['namespace'] if PROFILE else 'pi-agent-v1'
    wsl=str(Path(os.environ['SystemRoot'])/'System32/wsl.exe')
    prefix=[wsl,'-d',distribution,'-u','teruisi-pandas','--exec','/usr/bin/env','-i','HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin',
            'XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user']
    env={k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','PATH'}}
    def run(args):return subprocess.run(prefix+args,env=env,capture_output=True,timeout=35,check=True).stdout.decode().strip()
    def probe():
        result=command('http://127.0.0.1:'+str(native_port(8123)),key,{},timeout=5,path=HEALTH_PATH)
        return verify_probe(result,config,namespace)
    if verb=='probe':return probe()
    working=run(['show',unit,'--property=WorkingDirectory','--value'])
    executable=run(['show',unit,'--property=ExecStart','--value'])
    if working!=root+'/backend' or ('/usr/bin/python3 -B -m pi_runner.server --config '+root+'/config.json') not in executable:
        raise ValueError('unit_binding_changed')
    if verb=='stop':
        # A unit that is already inactive is a no-op success for stop
        # semantics, not a failure: probing it would only reach a closed
        # port (the runner's HTTP service is not listening) and raise
        # urllib.error.URLError, which is not evidence of a failed stop.
        if run(['show',unit,'--property=ActiveState','--value'])=='inactive':
            return {'stopped':True,'image':image,'sourceSha256':digest}
        status=probe()
        verify_stop_readiness(status)
        run(['stop',unit])
        active=run(['show',unit,'--property=ActiveState','--value'])
        if active!='inactive':raise ValueError('runner_stop_unknown')
        return {'stopped':True,'image':image,'sourceSha256':digest}
    run(['start',unit])
    deadline=time.monotonic()+15
    while True:
        try:return probe()
        except (OSError,ValueError):
            if time.monotonic()>deadline:raise ValueError('runner_start_not_ready')
            time.sleep(.5)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('verb',choices=['start','stop','probe'])
    parser.add_argument('--config',required=True);parser.add_argument('--key-file',required=True);args=parser.parse_args()
    try:print(encode(control(args.verb,args.config,args.key_file)).decode())
    except Exception as error:
        # stdout stays a fixed error-code string on purpose: it is the
        # redaction boundary consumed by ConvertFrom-UniqueNativeJson. The
        # real exception type and message are not secrets; they are written
        # to stderr only, where the PowerShell caller already captures and
        # redacts combined output (Invoke-BoundedNativeProcess merges
        # stdout+stderr via 2>&1 before Get-BoundedNativeDiagnostic runs its
        # credential/URI redaction), instead of being discarded.
        import sys
        print(f'{type(error).__name__}: {error}',file=sys.stderr)
        print('{"error":"pi_runner_lifecycle_failed_closed"}');raise SystemExit(1)
