"""Operator registration of a source/image/protocol-bound sandbox upgrade.

No service is stopped or started. Browser clients can select registered plan IDs;
they cannot provide image digests, source paths, or compatibility assertions.
The independent Runner source is prepared by install_linux into its immutable
release directory; installing that user unit remains a separate lifecycle action.
"""
import argparse
import hashlib
import hmac
import os
from pathlib import Path
import re
import uuid

from .install_linux import source_digest
from .protocol import VERSION, decode, encode


def plan_mac(key, plan):
    return hmac.new(key, b'pi-upgrade-plan-v1\n' + encode(plan), hashlib.sha256).hexdigest()


def register(config, proof):
    from .server import private
    if (not isinstance(proof, dict) or proof.get('schemaVersion') != 1 or proof.get('passed') is not True
            or proof.get('sourceSha256') != source_digest() or proof.get('protocolVersion') != VERSION
            or proof.get('fromImage') == proof.get('toImage')
            or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', proof.get(key, '')) for key in ('fromImage', 'toImage'))
            or proof.get('checks') != {'piSession': True, 'pythonDependencies': True, 'nodeDependencies': True, 'workspace': True}
            or not isinstance(proof.get('evidence'),dict)
            or any(not re.fullmatch(r'[a-f0-9]{64}',proof['evidence'].get(key,'')) for key in ('workspaceManifestBefore','workspaceManifestAfter','pythonPackagesBefore','pythonPackagesAfter','nodePackagesBefore','nodePackagesAfter'))
            or any(proof['evidence'].get(key+'Before')!=proof['evidence'].get(key+'After') for key in ('workspaceManifest','pythonPackages','nodePackages'))
            or not proof['evidence'].get('sessionBefore') or proof['evidence'].get('sessionBefore')!=proof['evidence'].get('sessionAfter')
            or not re.fullmatch(r'[a-f0-9]{64}',proof['evidence'].get('historyBefore','')) or proof['evidence'].get('historyBefore')!=proof['evidence'].get('historyAfter')
            or not isinstance(proof['evidence'].get('runtimeBefore'),dict) or not isinstance(proof['evidence'].get('runtimeAfter'),dict)
            or any(proof['evidence']['runtimeBefore'].get(key)!=proof['evidence']['runtimeAfter'].get(key) for key in ('pythonMinor','nodeAbi'))):
        raise ValueError('upgrade_compatibility_proof_required')
    root = private(config['stateDirectory'], True) / 'upgrade-plans'
    root.mkdir(mode=0o700, exist_ok=True)
    private(root, True)
    plan = {'schemaVersion': 1, 'planId': 'upgrade-' + uuid.uuid4().hex,
            'fromImage': proof['fromImage'], 'toImage': proof['toImage'], 'sourceSha256': proof['sourceSha256'],
            'protocolVersion': VERSION, 'compatibilitySha256': hashlib.sha256(encode(proof)).hexdigest()}
    envelope = {'plan': plan, 'signature': plan_mac(private(config['keyFile']).read_bytes(), plan), 'proof': proof}
    descriptor=os.open(root/(plan['planId']+'.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'wb') as handle:
        handle.write(encode(envelope))
    return plan


def plans(broker):
    root = broker.state / 'upgrade-plans'
    if not root.exists():
        return []
    from .server import private
    private(root, True)
    result = []
    for file in sorted(root.glob('upgrade-*.json')):
        envelope = decode(private(file).read_bytes())
        plan = envelope['plan']
        if (not hmac.compare_digest(envelope.get('signature', ''), plan_mac(broker.key, plan))
                or plan.get('planId') + '.json' != file.name or plan.get('sourceSha256') != source_digest()
                or plan.get('protocolVersion') != VERSION
                or hashlib.sha256(encode(envelope.get('proof'))).hexdigest() != plan.get('compatibilitySha256')):
            continue
        result.append(plan)
    return result


PROBE = '''import hashlib,json,pathlib,os,stat,subprocess,sys
root=pathlib.Path('/workspace'); rows=[]; python=[]; node=[]
for p in sorted(root.rglob('*')):
 info=p.lstat(); rel=str(p.relative_to(root))
 if stat.S_ISREG(info.st_mode):
  rows.append([rel,hashlib.sha256(p.read_bytes()).hexdigest()])
  if p.name=='METADATA' and '.dist-info/' in rel:
   python.append([rel,rows[-1][1]])
  if p.name=='package.json' and 'node_modules/' in rel:
   node.append([rel,rows[-1][1]])
 elif stat.S_ISLNK(info.st_mode): rows.append([rel,'link:'+os.readlink(p)])
 elif not stat.S_ISDIR(info.st_mode): raise ValueError('special_workspace_entry')
def sha(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
abi=subprocess.check_output(['node','-p','process.versions.modules'],env={'PATH':'/usr/local/bin:/usr/bin:/bin'}).decode().strip()
print(json.dumps({'workspaceManifest':sha(rows),'pythonPackages':sha(python),'nodePackages':sha(node),
 'runtime':{'pythonMinor':str(sys.version_info.major)+'.'+str(sys.version_info.minor),'nodeAbi':abi}}))
'''


def probe_volume(broker,image,volume):
    return decode(broker.docker_command(['run','--rm','--pull=never','--network=none','--read-only','--user=65532:65532',
        '--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory=256m','--memory-swap=256m','--cpus=1','--pids-limit=16',
        '--log-driver=none','--mount','type=volume,src='+volume+',dst=/workspace,readonly',
        '--entrypoint','python3',image,'-I','-B','-c',PROBE],timeout=60))


def recover_intents(broker):
    """Stop exact interrupted candidates before normal startup discovery.

    Original snapshots remain stopped. Recovery classifies unknown effects; it
    never adopts a candidate, reruns an upgrade, or labels a partial run success.
    """
    with broker.ledger.lock:
        rows=broker.ledger.db.execute('SELECT workspace,plan,status,intent FROM workspace_upgrades').fetchall()
    for key,plan_id,status,raw in rows:
        intent=decode(raw)
        observed_canonical=False;retired_meta=None
        for name,image,volume,expected_id in [(intent['retiredContainerName'],intent['fromImage'],intent['oldVolume'],intent['oldContainerId']),
                (intent['oldContainerName'],intent['toImage'],intent['newVolume'],intent.get('newContainerId'))]:
            present=broker.docker_command(['ps','-aq','--filter','name=^/'+name+'$']).strip()
            if not present:continue
            meta=decode(broker.docker_command(['inspect',name],maximum=128000))[0]
            if name==intent['oldContainerName'] and meta['Id']==intent['oldContainerId']:
                image,volume,expected_id=intent['fromImage'],intent['oldVolume'],intent['oldContainerId']
            if ((expected_id and meta['Id']!=expected_id) or meta['Image']!=image
                    or meta['Config'].get('Labels',{}).get('teruisi.pi.workspace')!=key
                    or [m.get('Name') for m in meta.get('Mounts',[]) if m.get('Destination')=='/workspace']!=[volume]):
                raise ValueError('upgrade_recovery_identity_changed')
            with broker.ledger.lock:
                identity_row=broker.ledger.db.execute('SELECT identity FROM sessions WHERE workspace=?',(key,)).fetchone()
            if not identity_row:raise ValueError('upgrade_recovery_identity_changed')
            from .server import Session
            reference=Session(broker,decode(identity_row[0]),name,volume,[])
            reference.image=image;reference.container_id=meta['Id']
            broker.inspect(reference)
            if status!='complete' and meta['State'].get('Running'):
                broker.docker_command(['stop','--time','2',meta['Id']],timeout=10)
                stopped=decode(broker.docker_command(['inspect',meta['Id']],maximum=128000))[0]
                if stopped['State'].get('Running'):raise ValueError('upgrade_recovery_stop_unknown')
            if name==intent['oldContainerName'] and status!='complete':
                observed_canonical=True
                with broker.ledger.lock,broker.ledger.db:
                    broker.ledger.db.execute('UPDATE sessions SET status=?,container=?,volume=?,container_id=?,image=? WHERE workspace=?',
                        ('unknown',name,volume,meta['Id'],image,key))
            elif name==intent['retiredContainerName']:retired_meta=meta
        if status!='complete':
            with broker.ledger.lock,broker.ledger.db:
                if not observed_canonical and retired_meta:
                    broker.ledger.db.execute('UPDATE sessions SET status=?,container=?,volume=?,container_id=?,image=? WHERE workspace=?',
                        ('unknown',intent['retiredContainerName'],intent['oldVolume'],retired_meta['Id'],intent['fromImage'],key))
                broker.ledger.db.execute('UPDATE workspace_upgrades SET status=? WHERE workspace=? AND plan=?',('unknown',key,plan_id))


def retained_reference(broker,name,container_id):
    with broker.ledger.lock:
        rows=broker.ledger.db.execute('SELECT workspace,intent FROM workspace_upgrades').fetchall()
    return any(decode(raw).get('retiredContainerName')==name and decode(raw).get('oldContainerId')==container_id for _,raw in rows)


def apply(session, plan_id):
    from .workspace import Rejected, close_terminals, register_session
    broker = session.broker
    plan = next((item for item in plans(broker) if item['planId'] == plan_id), None)
    if not plan or plan['fromImage'] != session.image:
        raise Rejected('upgrade_plan_unavailable')
    target = decode(broker.docker_command(['image', 'inspect', plan['toImage']], maximum=128000))[0]
    if (target['Id'] != plan['toImage'] or target.get('Os') != 'linux' or target['Config'].get('Volumes')
            or target['Config'].get('Entrypoint') != ['node', '/opt/pi/entrypoint.mjs']
            or target['Config'].get('Labels', {}).get('teruisi.pi.workspace') != '2'):
        raise Rejected('upgrade_image_unavailable')
    if session.phase not in {'idle', 'settled', 'handled', 'failed', 'aborted'} or getattr(session, 'bash_control', None):
        raise Rejected('workspace_busy')
    if set(broker.process_inventory(session))-getattr(session,'baseline_processes',set()):raise Rejected('workspace_busy')
    with broker.ledger.lock:
        other=broker.ledger.db.execute("SELECT 1 FROM workspace_controls WHERE workspace=? AND command!='upgrade' AND status IN ('accepted','dispatching','queued') LIMIT 1",(session.key,)).fetchone()
    if other:raise Rejected('workspace_busy')
    profile=probe_volume(broker,session.image,session.volume)
    proof=decode((broker.state/'upgrade-plans'/(plan_id+'.json')).read_bytes())['proof']['evidence']
    if (profile['pythonPackages']!=proof['pythonPackagesBefore'] or profile['nodePackages']!=proof['nodePackagesBefore'] or profile['runtime']!=proof['runtimeBefore']):
        raise Rejected('upgrade_plan_environment_changed')
    old_session = register_session(session)['sessionId']
    old_history=hashlib.sha256(encode(session.rpc('get_messages',{})['data'])).hexdigest()
    with session.lock:
        close_terminals(session)
        original = broker.inspect(session)
        old_image, old_id, old_volume = session.image, session.container_id, session.volume
        original_name = session.container
        retired = original_name + '-retired-' + uuid.uuid4().hex[:8]
        new_volume=original_name+'-upgrade-'+plan_id.removeprefix('upgrade-')[:12]
        intent={**plan,'oldContainerId':old_id,'oldContainerName':original_name,'retiredContainerName':retired,
                'oldVolume':old_volume,'newVolume':new_volume,'sessionId':old_session,'historySha256':old_history,'newContainerId':None}
        with broker.ledger.lock,broker.ledger.db:
            broker.ledger.db.execute('INSERT INTO workspace_upgrades VALUES (?,?,?,?)',(session.key,plan_id,'prepared',encode(intent)))
        session.phase = 'updating'
        session.workspace_maintenance = True
        broker.save_session(session)
    try:
        # Do not hold the RPC reader's lock across a round trip or process shutdown.
        old_proc, session.proc = session.proc, None
        if old_proc:
            old_proc.stdin.close()
            old_proc.wait(timeout=20)
        stopped = broker.inspect(session)
        if stopped['Id'] != old_id or stopped['State'].get('Running'):
            raise ValueError('upgrade_stop_unknown')
        before_probe=probe_volume(broker,old_image,old_volume)
        # Original volume is never mounted writable by the candidate. This snapshot
        # preserves old Pi/dependency bytes even if a new launcher fails after writes.
        labels=['--label','teruisi.pi.namespace='+broker.namespace,'--label','teruisi.pi.workspace='+session.key]
        broker.docker_command(['volume','create',*labels,new_volume])
        clone_code='import shutil;shutil.copytree("/source","/workspace",dirs_exist_ok=True,symlinks=True)'
        broker.docker_command(['run','--rm','--pull=never','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL',
            '--security-opt=no-new-privileges:true','--memory=256m','--memory-swap=256m','--cpus=1','--pids-limit=16','--log-driver=none',
            '--mount','type=volume,src='+old_volume+',dst=/source,readonly',
            '--mount','type=volume,src='+new_volume+',dst=/workspace','--entrypoint','python3',plan['toImage'],'-I','-B','-c',clone_code],timeout=60)
        after_probe=probe_volume(broker,plan['toImage'],new_volume)
        if before_probe!=after_probe:
            raise Rejected('upgrade_environment_incompatible')
        with broker.ledger.lock,broker.ledger.db:
            broker.ledger.db.execute('UPDATE workspace_upgrades SET status=? WHERE workspace=? AND plan=?',('snapshot',session.key,plan_id))
        broker.docker_command(['rename', old_id, retired])
        created = False
        try:
            labels = ['--label', 'teruisi.pi.namespace=' + broker.namespace, '--label', 'teruisi.pi.workspace=' + session.key]
            args = ['create', '--pull=never', '--name', original_name, *labels, '--network=none', '--read-only', '--user=65532:65532',
                    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--cpus=1', '--memory=1g', '--memory-swap=1g', '--pids-limit=128',
                    '--ulimit=nofile=256:256', '--ulimit=core=0:0', '--ulimit=fsize=67108864:67108864', '--restart=no', '--log-driver=none',
                    '--ipc=private', '--cgroupns=private', '--shm-size=16m', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
                    '--mount', 'type=volume,src=' + new_volume + ',dst=/workspace', '--workdir=/workspace', '--interactive', plan['toImage']]
            broker.docker_command(args)
            created = True
            session.image, session.container_id,session.volume = plan['toImage'], None,new_volume
            broker.inspect(session)
            intent['newContainerId']=session.container_id
            with broker.ledger.lock,broker.ledger.db:
                broker.ledger.db.execute('UPDATE workspace_upgrades SET status=?,intent=? WHERE workspace=? AND plan=?',('candidate',encode(intent),session.key,plan_id))
            broker.save_session(session)
            session.start()
            current = register_session(session)
            if current['sessionId'] != old_session:
                raise ValueError('upgrade_session_changed')
            if hashlib.sha256(encode(session.rpc('get_messages',{})['data'])).hexdigest()!=old_history:
                raise ValueError('upgrade_history_changed')
            # The operator proof has tested dependencies. This per-workspace probe
            # also proves the actual preserved environment still launches both tools.
            result = broker.docker_command(['exec', session.container, '/bin/sh', '-c',
                'python3 -c "import sys; assert sys.version_info.major == 3" && node -e "if(!process.versions.node) process.exit(1)"; if [ -x /workspace/venv/bin/python ]; then /workspace/venv/bin/python -m pip check; fi'])
            resumed_probe=probe_volume(broker,session.image,new_volume)
            if any(resumed_probe[key]!=before_probe[key] for key in ('pythonPackages','nodePackages','runtime')):
                raise ValueError('upgrade_dependencies_changed')
            preserved=decode(broker.docker_command(['inspect',old_id],maximum=128000))[0]
            if preserved['Name']!='/'+retired or preserved['State'].get('Running') or preserved['Image']!=old_image:
                raise ValueError('upgrade_original_snapshot_unknown')
            session.phase = 'idle'
            broker.save_session(session)
            with broker.ledger.lock,broker.ledger.db:
                broker.ledger.db.execute('UPDATE workspace_upgrades SET status=? WHERE workspace=? AND plan=?',('complete',session.key,plan_id))
            return {'planId': plan_id, 'fromImage': old_image, 'toImage': session.image, 'sourceSha256': plan['sourceSha256'],
                    'protocolVersion': plan['protocolVersion'], 'containerId': session.container_id, 'volume': session.volume,
                    'sessionId': old_session, 'generation': session.identity['generation'], 'preservedWorkspace': True,
                    'originalVolume':old_volume,'originalContainerId':old_id,'originalRetiredName':retired}
        except Exception:
            # Never rerun an unknown new Pi. Freeze it and preserve both immutable
            # identities and the original named volume for explicit reconciliation.
            if created:
                try:
                    broker.docker_command(['stop', '--time', '2', original_name])
                except Exception:
                    pass
            session.fail('upgrade_outcome_unknown')
            raise
        finally:
            session.workspace_maintenance = False
    except Exception:
        session.fail('upgrade_outcome_unknown')
        raise
    finally:
        session.workspace_maintenance=False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--compatibility-proof', required=True)
    args = parser.parse_args()
    from .server import private
    config = decode(private(args.config).read_bytes())
    proof = decode(Path(args.compatibility_proof).read_bytes())
    print(encode({'registered': True, 'plan': register(config, proof), 'serviceChanged': False}).decode())


if __name__ == '__main__':
    main()
