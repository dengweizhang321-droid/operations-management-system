"""Frozen independent Runner source handoff, separate from workspace images.

Prepare is online and leaves the old unit/config/state untouched. Apply requires
the old service and all its containers stopped, copies the *fresh* ledger/state,
then CAS-switches one exact user unit. Windows publishes its config only after
the signed candidate probe; interrupted outcomes retain both releases and intent.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import time

from .protocol import VERSION, HEALTH_PATH, decode, encode
from .install_linux import source_digest


def sha(raw):return hashlib.sha256(raw).hexdigest()


def private_file(path):
    from .server import private
    return private(path)


def atomic(path,raw,expected=None):
    if expected is not None and sha(path.read_bytes())!=expected:raise ValueError('upgrade_compare_changed')
    temp=path.with_name(path.name+'.new')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as handle:handle.write(raw);handle.flush();os.fsync(handle.fileno())
    if expected is not None and sha(path.read_bytes())!=expected:raise ValueError('upgrade_compare_changed')
    os.replace(temp,path)


def environment():
    return {'HOME':str(Path.home()),'PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':f'/run/user/{os.getuid()}',
            'DBUS_SESSION_BUS_ADDRESS':f'unix:path=/run/user/{os.getuid()}/bus',
            'DOCKER_HOST':f'unix:///run/user/{os.getuid()}/docker.sock'}


def systemctl(unit,*args):
    tail=[] if args==('daemon-reload',) else [unit]
    return subprocess.run(['/usr/bin/systemctl','--user',*args,*tail],env=environment(),capture_output=True,check=True,timeout=35).stdout.decode().strip()


def context(value):
    namespace=value['namespace'];unit_name=value['unitName'];port=value['port']
    base=Path(value['releaseParent']);unit=Path(value['unitPath'])
    formal=namespace=='pi-agent-v1'
    for key in ('oldSourceSha256','newSourceSha256'):
        if key in value and not re.fullmatch(r'[a-f0-9]{64}',value[key]):raise ValueError('upgrade_source_digest_required')
    if os.name!='posix' or os.getuid()!=1000:raise ValueError('upgrade_owner_required')
    if formal:
        if (base!=Path.home()/'.local/share/teruisi-pi-runner/releases' or unit_name!='teruisi-pi-runner.service'
                or unit!=Path.home()/'.config/systemd/user'/unit_name or port!=8123):raise ValueError('fixed_upgrade_paths_required')
    elif (not re.fullmatch(r'pi-test-[a-z0-9-]{4,40}',namespace) or unit_name!=namespace+'.service'
            or base!=Path.home()/namespace/'releases' or unit!=Path.home()/'.config/systemd/user'/unit_name
            or type(port) is not int or not 1024<port<65535 or port==8123):raise ValueError('isolated_upgrade_paths_required')
    for path in (base,unit.parent):
        if not path.is_dir() or path.is_symlink():raise ValueError('upgrade_real_parent_required')
    return base,unit,unit_name,port


def prepare(value):
    base,unit,unit_name,port=context(value)
    old_sha,new_sha=value['oldSourceSha256'],value['newSourceSha256']
    if any(not re.fullmatch(r'[a-f0-9]{64}',x) for x in (old_sha,new_sha)) or new_sha!=source_digest() or old_sha==new_sha:
        raise ValueError('upgrade_source_required')
    old,new=base/old_sha,base/new_sha
    old_config=decode(private_file(old/'config.json').read_bytes())
    key=private_file(old/'channel.key').read_bytes()
    old_unit=private_file(unit).read_bytes()
    if (old_config['image']!=value['oldImage'] or old_config['namespace']!=value['namespace']
            or old_config['stateDirectory']!=str(old/'state') or old_config['keyFile']!=str(old/'channel.key')
            or sha(key)!=value['channelKeySha256'] or str(old).encode() not in old_unit):raise ValueError('old_runner_binding_changed')
    if new.exists():raise ValueError('upgrade_preparation_exists')
    inspected=decode(subprocess.run([old_config['docker'],'image','inspect',value['newImage']],env=environment(),capture_output=True,check=True,timeout=20).stdout)[0]
    if (inspected['Id']!=value['newImage'] or inspected.get('Os')!='linux' or inspected['Config'].get('Volumes')
            or inspected['Config'].get('Entrypoint')!=['node','/opt/pi/entrypoint.mjs']):raise ValueError('reviewed_upgrade_image_required')
    new.mkdir(mode=0o700)
    shutil.copytree(Path(__file__).parent,new/'backend/pi_runner',ignore=shutil.ignore_patterns('__pycache__','test_*.py'))
    (new/'state').mkdir(mode=0o700)
    for name,raw in [('channel.key',key),('config.json',encode({**old_config,'image':value['newImage'],
            'keyFile':str(new/'channel.key'),'stateDirectory':str(new/'state')}))]:
        fd=os.open(new/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as handle:handle.write(raw)
    new_unit=old_unit.replace(str(old).encode(),str(new).encode())
    atomic(new/'pi-runner.service',new_unit)
    atomic(new/'predecessor-unit.service',old_unit)
    plan={key:value[key] for key in ('operationId','namespace','unitName','unitPath','releaseParent','port','oldSourceSha256','newSourceSha256','oldImage','newImage','channelKeySha256','windowsConfigSha256','windowsKeyFileSha256')}
    plan.update({'schemaVersion':1,'protocolVersion':VERSION,'oldConfigSha256':sha((old/'config.json').read_bytes()),
                 'oldUnitSha256':sha(old_unit),'newUnitSha256':sha(new_unit),'newConfigSha256':sha((new/'config.json').read_bytes())})
    atomic(new/'source-upgrade-plan.json',encode(plan))
    return {'prepared':True,'started':False,'plan':plan,'planSha256':sha(encode(plan)),'linuxPlanPath':str(new/'source-upgrade-plan.json')}


TRANSIENT_STATE_FILES=frozenset({'broker.lock','ledger.sqlite3-wal','ledger.sqlite3-shm'})


def checkpoint_ledger(root):
    """Checkpoint the stopped Runner ledger before hashing or copying it.

    A read-only SQLite backup creates a zero-byte -wal sidecar. The checkpoint
    makes the durable main file current; the manifest intentionally ignores
    only these transient sidecars, matching the copy ignore list.
    """
    ledger=root/'ledger.sqlite3'
    if not ledger.exists():return
    connection=sqlite3.connect(ledger)
    try:
        mode=connection.execute('PRAGMA journal_mode').fetchone()
        if mode and str(mode[0]).lower()=='wal':
            result=connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
            if result and int(result[0])!=0:raise ValueError('ledger_checkpoint_busy')
    finally:
        connection.close()
    wal=root/'ledger.sqlite3-wal'
    if wal.exists() and wal.stat().st_size:raise ValueError('ledger_wal_not_checkpointed')


def state_manifest(root):
    wal=root/'ledger.sqlite3-wal'
    if wal.exists() and wal.stat().st_size:raise ValueError('ledger_wal_not_checkpointed')
    rows=[]
    for file in sorted(root.rglob('*')):
        if file.is_symlink():raise ValueError('unsafe_runner_state')
        if file.is_file() and file.name not in TRANSIENT_STATE_FILES:
            rows.append([file.relative_to(root).as_posix(),sha(file.read_bytes())])
    return sha(encode(rows))


def check(value):
    base,unit,unit_name,port=context(value)
    new=base/value['newSourceSha256'];raw=private_file(new/'source-upgrade-plan.json').read_bytes();plan=decode(raw)
    old=base/plan['oldSourceSha256']
    if (sha(raw)!=value['planSha256'] or source_digest()!=plan['newSourceSha256']
            or sha(private_file(unit).read_bytes())!=plan['oldUnitSha256']
            or sha(private_file(old/'config.json').read_bytes())!=plan['oldConfigSha256']
            or sha(private_file(new/'config.json').read_bytes())!=plan['newConfigSha256']
            or sha(private_file(new/'channel.key').read_bytes())!=plan['channelKeySha256']):raise ValueError('prepared_upgrade_binding_changed')
    if (new/'source-upgrade-intent.json').exists():raise ValueError('source_upgrade_unknown_no_replay')
    return {'prepared':True,'checked':True,'started':False,'plan':plan,'planSha256':sha(raw),'linuxPlanPath':str(new/'source-upgrade-plan.json')}


def current(value):
    base,unit,unit_name,port=context(value);root=base/value['newSourceSha256']
    config=decode(private_file(root/'config.json').read_bytes())
    if (root/'source-upgrade-intent.json').exists():raise ValueError('source_upgrade_intent_requires_reconciliation')
    if (source_digest()!=value['newSourceSha256'] or config['image']!=value['newImage']
            or sha(private_file(root/'channel.key').read_bytes())!=value['channelKeySha256']
            or str(root).encode() not in private_file(unit).read_bytes()):raise ValueError('current_runner_binding_changed')
    from .client import command
    result=command('http://127.0.0.1:'+str(port),private_file(root/'channel.key').read_bytes(),{},timeout=5,path=HEALTH_PATH)
    if result['sourceSha256']!=value['newSourceSha256'] or result['image']!=value['newImage'] or result['namespace']!=value['namespace'] or result['closing']:
        raise ValueError('current_runner_signed_probe_failed')
    return {'prepared':True,'alreadyCurrent':True,'started':False,'sourceSha256':value['newSourceSha256'],'image':value['newImage'],'signedProbeVerified':True}


def reconcile(value):
    base,unit,unit_name,port=context(value);new=base/value['newSourceSha256']
    raw=private_file(new/'source-upgrade-plan.json').read_bytes();plan=decode(raw)
    intent=decode(private_file(new/'source-upgrade-intent.json').read_bytes());old=base/plan['oldSourceSha256']
    if (sha(raw)!=value['planSha256'] or intent['operationId']!=plan['operationId'] or intent['planSha256']!=sha(raw)
            or intent['status'] not in {'runner_verified','unknown'} or source_digest()!=plan['newSourceSha256']
            or sha(private_file(unit).read_bytes())!=plan['newUnitSha256']
            or sha(private_file(new/'config.json').read_bytes())!=plan['newConfigSha256']
            or state_manifest(old/'state')!=intent['freshStateSha256']
            or sha(private_file(new/'channel.key').read_bytes())!=plan['channelKeySha256']):raise ValueError('source_upgrade_reconciliation_unproved')
    if systemctl(unit_name,'show','--property=ActiveState','--value')!='active':raise ValueError('successor_not_verified_active')
    from .client import command
    result=command('http://127.0.0.1:'+str(port),private_file(new/'channel.key').read_bytes(),{},timeout=5,path=HEALTH_PATH)
    if (result['sourceSha256']!=plan['newSourceSha256'] or result['image']!=plan['newImage'] or result['namespace']!=plan['namespace']
            or result['activeCount'] or result['unsafeUnknownCount'] or result['closing']):raise ValueError('successor_reconciliation_unknown')
    return {'upgraded':True,'reconciled':True,'sourceSha256':plan['newSourceSha256'],'image':plan['newImage'],
        'freshStateSha256':intent['freshStateSha256'],'candidateStateSha256':intent['candidateStateSha256'],
        'operationId':plan['operationId'],'planSha256':sha(raw),'oldReleaseRetained':True}


def apply(value):
    base,unit,unit_name,port=context(value)
    new=base/value['newSourceSha256'];plan_path=new/'source-upgrade-plan.json'
    raw=private_file(plan_path).read_bytes();plan=decode(raw)
    if sha(raw)!=value['planSha256'] or plan['newSourceSha256']!=source_digest() or plan['protocolVersion']!=VERSION:
        raise ValueError('upgrade_plan_changed')
    for key in ('operationId','namespace','unitName','unitPath','releaseParent','port','oldSourceSha256','newSourceSha256'):
        if value[key]!=plan[key]:raise ValueError('upgrade_plan_changed')
    old=base/plan['oldSourceSha256'];intent_path=new/'source-upgrade-intent.json'
    if intent_path.exists():raise ValueError('source_upgrade_unknown_no_replay')
    if (sha(private_file(unit).read_bytes())!=plan['oldUnitSha256'] or sha(private_file(old/'config.json').read_bytes())!=plan['oldConfigSha256']
            or sha(private_file(new/'config.json').read_bytes())!=plan['newConfigSha256']
            or sha(private_file(new/'channel.key').read_bytes())!=plan['channelKeySha256']):raise ValueError('upgrade_predecessor_changed')
    if systemctl(unit_name,'show','--property=ActiveState','--value')!='inactive' or systemctl(unit_name,'show','--property=MainPID','--value')!='0':
        raise ValueError('old_runner_must_be_stopped')
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():continue
        try:argv=(proc/'cmdline').read_bytes().split(b'\0')
        except (PermissionError,FileNotFoundError,ProcessLookupError):continue
        if b'pi_runner.server' in argv and str(old/'config.json').encode() in argv:raise ValueError('old_runner_process_still_present')
    config=decode((old/'config.json').read_bytes())
    docker_env={**environment(),'DOCKER_CONFIG':str(old/'state/empty-docker-config')}
    ids=subprocess.run([config['docker'],'ps','-aq','--filter','label=teruisi.pi.namespace='+plan['namespace']],env=docker_env,capture_output=True,check=True,timeout=20).stdout.decode().split()
    for container_id in ids:
        meta=decode(subprocess.run([config['docker'],'inspect',container_id],env=docker_env,capture_output=True,check=True,timeout=20).stdout)[0]
        if meta['State']['Running']:raise ValueError('runner_containers_must_be_stopped')
    checkpoint_ledger(old/'state')
    fresh=state_manifest(old/'state')
    intent={'operationId':plan['operationId'],'status':'copying','freshStateSha256':fresh,'planSha256':sha(raw)}
    atomic(intent_path,encode(intent))
    # No copied lock inode or transient SQLite sidecar can become a second live
    # authority; the backup below owns the consistent ledger snapshot.
    shutil.rmtree(new/'state')
    shutil.copytree(old/'state',new/'state',ignore=shutil.ignore_patterns('broker.lock','ledger.sqlite3','ledger.sqlite3-wal','ledger.sqlite3-shm'))
    ledger=old/'state/ledger.sqlite3'
    if ledger.exists():
        source=sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True);target=sqlite3.connect(new/'state/ledger.sqlite3')
        try:
            source.backup(target)
            columns={row[1] for row in target.execute('PRAGMA table_info(sessions)')}
            if 'image' not in columns:target.execute('ALTER TABLE sessions ADD COLUMN image TEXT')
            target.execute('UPDATE sessions SET image=? WHERE image IS NULL',(plan['oldImage'],));target.commit()
        finally:source.close();target.close()
    if state_manifest(old/'state')!=fresh:raise ValueError('old_state_changed_during_copy')
    intent.update({'status':'switching','candidateStateSha256':state_manifest(new/'state')})
    atomic(intent_path,encode(intent))
    atomic(unit,(new/'pi-runner.service').read_bytes(),expected=plan['oldUnitSha256'])
    try:
        systemctl(unit_name,'daemon-reload')
        systemctl(unit_name,'start')
        from .client import command
        key=private_file(new/'channel.key').read_bytes();deadline=time.monotonic()+20
        while True:
            try:
                result=command('http://127.0.0.1:'+str(port),key,{},timeout=2,path=HEALTH_PATH)
                if (result['sourceSha256']!=plan['newSourceSha256'] or result['image']!=plan['newImage'] or result['namespace']!=plan['namespace']
                        or result['activeCount'] or result['unsafeUnknownCount'] or result['closing']
                        or result['unknownStoppedVerifiedCount']!=result['unresolvedCount']):raise ValueError('candidate_runner_identity_changed')
                break
            except (OSError,ValueError):
                if time.monotonic()>deadline:raise ValueError('source_upgrade_candidate_unknown')
                time.sleep(.2)
        # Keep the stopped copy's digest from switching. Signed health writes
        # replay-protection nonces to the live candidate ledger.
        intent['status']='runner_verified'
        atomic(intent_path,encode(intent))
        return {'upgraded':True,'sourceSha256':plan['newSourceSha256'],'image':plan['newImage'],'freshStateSha256':fresh,
                'candidateStateSha256':intent['candidateStateSha256'],'operationId':plan['operationId'],'planSha256':sha(raw),'oldReleaseRetained':True}
    except Exception:
        active=systemctl(unit_name,'show','--property=ActiveState','--value')
        pid=systemctl(unit_name,'show','--property=MainPID','--value')
        if active in {'inactive','failed'} and pid=='0':
            # The successor is definitively not alive. Restore the unchanged old
            # unit/config binding, leave it stopped, and keep both state copies.
            original_unit=private_file(new/'predecessor-unit.service').read_bytes()
            if sha(original_unit)!=plan['oldUnitSha256']:raise ValueError('upgrade_predecessor_unit_changed')
            atomic(unit,original_unit,expected=plan['newUnitSha256'])
            systemctl(unit_name,'daemon-reload')
            intent['status']='rejected_old_unit_restored';atomic(intent_path,encode(intent))
            raise ValueError('source_upgrade_rejected_old_retained')
        # Startup may have classified/stopped orphan containers. Keep both state
        # copies and exact switched unit; no automatic old Runner resurrection.
        intent['status']='unknown';atomic(intent_path,encode(intent))
        raise


def dispatch(value):
    return {'prepare':prepare,'apply':apply,'check':check,'current':current,'reconcile':reconcile}[value['action']](value)
