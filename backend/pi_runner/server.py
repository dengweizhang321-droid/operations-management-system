"""Long-lived real Pi 1.3.0 RPC, outside Django and outside the sandbox.

The Docker socket is used by this unprivileged broker only. No host bind mount,
business credential, gateway secret, socket or host executable enters Pi.
"""
import argparse
import base64
import hashlib
import hmac
import os
from pathlib import Path
import queue
import re
import signal
import sqlite3
import stat
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .protocol import (HEALTH_PATH, IDENTITY, MAX_RECORD, MAX_REQUEST, MAX_RESPONSE, PATH, PORT,
                       decode, encode, signature, validate_command, validate_manifest, workspace_key)


def private(path, directory=False):
    path = Path(path)
    info = path.lstat()
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid != os.getuid() or info.st_mode & 0o077 or (not directory and info.st_nlink != 1)):
        raise ValueError("private_owned_path_required")
    return path


_DROP=object()
_PRIVATE_KEYS={'capability','thinking','thinkingsignature','reasoning_content','providerframe'}


def public_value(value):
    """Preserve public text/tool bytes, never copy private provider state to audit."""
    if isinstance(value,list):
        return [safe for item in value if (safe:=public_value(item)) is not _DROP]
    if isinstance(value,dict):
        kind=value.get('type','')
        if isinstance(kind,str) and (kind=='thinking' or kind.startswith('thinking_')):return _DROP
        result={}
        for key,item in value.items():
            if key.lower() in _PRIVATE_KEYS:continue
            safe=public_value(item)
            if safe is not _DROP:result[key]=safe
        return result
    return value


def public_event(value):
    safe=public_value(value)
    return {'type':'private_event_omitted'} if safe is _DROP else safe


def safe_receipt(value):
    result=public_event(value)
    if 'pendingGatewayRequests' in result:result['pendingGatewayRequests']=[]
    if 'events' in result:result['events']=[public_event(event) for event in result['events']]
    if isinstance(result.get('files'),list):
        result['files']=[{k:v for k,v in file.items() if k!='base64'} for file in result['files']]
    return result


class Ledger:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute('PRAGMA secure_delete=ON')
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS nonce (id TEXT PRIMARY KEY,stamp INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS commands (operation TEXT,command TEXT,digest TEXT,status TEXT,result BLOB,PRIMARY KEY(operation,command));
          CREATE TABLE IF NOT EXISTS events (workspace TEXT,event_seq INTEGER,operation TEXT,record BLOB,PRIMARY KEY(workspace,event_seq));
          CREATE TABLE IF NOT EXISTS sessions (workspace TEXT PRIMARY KEY,identity BLOB,container TEXT,volume TEXT,status TEXT,seq INTEGER);
          CREATE TABLE IF NOT EXISTS gateway (operation TEXT,request TEXT,digest TEXT,status TEXT,PRIMARY KEY(operation,request));
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT);
        """)
        if 'container_id' not in {row[1] for row in self.db.execute('PRAGMA table_info(sessions)')}:
            self.db.execute('ALTER TABLE sessions ADD COLUMN container_id TEXT')
        # A broker crash cannot be interpreted as no effect or automatic retry.
        self.db.execute("UPDATE commands SET status='unknown' WHERE status='dispatching'")
        self.db.execute("UPDATE gateway SET status='unknown' WHERE status='dispatching'")
        self.db.execute("UPDATE sessions SET status='unknown' WHERE status IN ('creating','updating','freezing','dispatching','accepted','running','settling','unknown')")
        self.db.commit()
        if self.db.execute("SELECT value FROM metadata WHERE key='audit_redaction'").fetchone()!=('1',):
            with self.db:
                for operation,command,raw in self.db.execute('SELECT operation,command,result FROM commands WHERE result IS NOT NULL').fetchall():
                    self.db.execute('UPDATE commands SET result=? WHERE operation=? AND command=?',(encode(safe_receipt(decode(raw))),operation,command))
                for workspace,seq,raw in self.db.execute('SELECT workspace,event_seq,record FROM events').fetchall():
                    self.db.execute('UPDATE events SET record=? WHERE workspace=? AND event_seq=?',(encode(public_event(decode(raw))),workspace,seq))
                self.db.execute("INSERT OR REPLACE INTO metadata VALUES ('audit_redaction','1')")
            self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            self.db.execute('VACUUM')
            self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')

    def nonce(self, nonce, stamp):
        if not re.fullmatch(r"[a-f0-9]{32}", nonce) or not re.fullmatch(r"[0-9]{10}", stamp) or abs(time.time()-int(stamp)) > 60:
            raise ValueError("invalid_request_identity")
        with self.lock, self.db:
            self.db.execute("DELETE FROM nonce WHERE stamp<?", (int(time.time())-120,))
            try:
                self.db.execute("INSERT INTO nonce VALUES (?,?)", (nonce, int(stamp)))
            except sqlite3.IntegrityError as error:
                raise ValueError("request_replayed") from error

    def reserve(self, job):
        digest = hashlib.sha256(encode(job)).hexdigest()
        with self.lock, self.db:
            old = self.db.execute("SELECT digest,status,result FROM commands WHERE operation=? AND command=?", (job['operationId'],job['command'])).fetchone()
            if old:
                if old[0] != digest:
                    raise ValueError("operation_payload_changed")
                if old[1] in {"unknown", "dispatching"}:
                    raise ValueError("operation_unknown")
                return decode(old[2])
            self.db.execute("INSERT INTO commands VALUES (?,?,?,?,NULL)", (job['operationId'],job['command'],digest,'dispatching'))
        return None

    def finish(self, job, result, status='complete'):
        with self.lock, self.db:
            self.db.execute("UPDATE commands SET status=?,result=? WHERE operation=? AND command=?", (status,encode(safe_receipt(result)),job['operationId'],job['command']))

    def event(self, session, record, job=None):
        identity = job or session.active or session.identity
        with self.lock, self.db:
            seq = self.db.execute("SELECT COALESCE(MAX(event_seq),0)+1 FROM events WHERE workspace=?", (session.key,)).fetchone()[0]
            item = {**public_event(record), **{k:identity[k] for k in IDENTITY}, 'eventSeq':seq}
            self.db.execute("INSERT INTO events VALUES (?,?,?,?)", (session.key,seq,identity['operationId'],encode(item)))
        return item


class Session:
    def __init__(self, broker, identity, container, volume, skills):
        self.broker, self.identity, self.key = broker, {k:identity[k] for k in IDENTITY}, workspace_key(identity)
        self.container, self.volume, self.skills = container, volume, skills
        self.lock, self.write_lock = threading.RLock(), threading.Lock()
        self.pending, self.active, self.proc, self.gateway = {}, None, None, None
        self.phase, self.error, self.files = 'creating', None, []
        self.revoked, self.before_files = False, {}
        self.gateway_pending, self.gateway_completed = {}, {}
        self.last_seq = 0
        self.container_id=None
        self.last_activity=time.monotonic()
        self.files_collected=False;self.terminal_receipt=None;self.deadline=None
        self.settled_event_seq=None;self.prompt_response_seq=None

    def start(self):
        self.proc = self.broker.popen(['start','--attach','--interactive',self.container])
        threading.Thread(target=self.read,daemon=True).start()
        # stderr is drained, bounded and discarded; never persisted as evidence.
        threading.Thread(target=self.drain_stderr,daemon=True).start()
        self.write({'type':'runner_init','skillVersion':self.skill_version,'skillIds':[s['id'] for s in self.skills]})
        state = self.rpc('get_state',{},timeout=35)
        if not state.get('success'):
            raise ValueError('pi_startup_failed')
        for command in [('set_auto_retry',{'enabled':False}),('set_auto_compaction',{'enabled':False})]:
            if not self.rpc(*command).get('success'):
                raise ValueError('pi_settings_rejected')
        commands = self.rpc('get_commands',{}).get('data',{}).get('commands',[])
        found = {x.get('name') for x in commands if x.get('source')=='skill'}
        if found != {'skill:'+x['id'] for x in self.skills}:
            raise ValueError('skill_discovery_failed')
        for command in commands:
            if command.get('source')=='skill' and not command.get('sourceInfo',{}).get('path','').startswith('/opt/pi/skill-bundles/'+self.skill_version+'/'):
                raise ValueError('skill_source_mismatch')
        self.commands = commands

    def drain_stderr(self):
        proc=self.proc
        size = 0
        try:
            while True:
                raw = proc.stderr.read(4096)
                if not raw:return
                size += len(raw)
                if size > 1024*1024:self.fail('pi_stderr_limit');return
        finally:proc.stderr.close()

    def write(self, record):
        raw=encode(record)+b'\n'
        if len(raw)>MAX_RECORD:
            raise ValueError('rpc_record_limit')
        with self.write_lock:
            self.proc.stdin.write(raw)
            self.proc.stdin.flush()

    def rpc(self, command, payload, timeout=15, rpc_id=None):
        rpc_id = rpc_id or 'control-'+uuid.uuid4().hex
        result = queue.Queue(maxsize=1)
        with self.lock:
            self.pending[rpc_id]=result
        try:
            self.write({'id':rpc_id,'type':command,**payload})
            try:
                return result.get(timeout=timeout)
            except queue.Empty as error:
                self.fail('rpc_result_unknown')
                raise ValueError('rpc_result_unknown') from error
        finally:
            with self.lock:
                self.pending.pop(rpc_id,None)

    def fail(self, code):
        with self.lock:
            if self.phase == 'disposed':
                return
            self.phase,self.error,self.revoked='unknown',code,True
        self.broker.save_session(self)

    def read(self):
        proc=self.proc
        try:
            while True:
                # Binary readline splits only LF, preserving U+2028 and U+2029.
                raw=proc.stdout.readline(MAX_RECORD+1)
                if not raw:
                    if self.phase not in {'disposed','frozen','freezing','stopped'} and self.proc is proc:
                        self.fail('pi_process_exited')
                    return
                if len(raw)>MAX_RECORD or not raw.endswith(b'\n'):
                    raise ValueError('rpc_record_limit')
                record=decode(raw[:-1].removesuffix(b'\r'))
                if not isinstance(record,dict) or not isinstance(record.get('type'),str):
                    raise ValueError('invalid_rpc_record')
                kind=record['type']
                if kind=='extension_ui_request':
                    if record.get('method')=='input' and record.get('title')=='pi-gateway-v1':
                        threading.Thread(target=self.gateway_call,args=(record,),daemon=True).start()
                    elif record.get('method') in {'select','input','editor','confirm'}:
                        self.write({'type':'extension_ui_response','id':record['id'],'cancelled':True})
                    continue
                if kind=='response':
                    with self.lock:
                        waiter=self.pending.get(record.get('id'))
                    if self.active and record.get('id')==self.active['operationId']+':prompt':
                        self.prompt_response_seq=self.broker.ledger.event(self,record)['eventSeq']
                    if waiter:
                        waiter.put(record)
                    continue
                if self.active:
                    item=self.broker.ledger.event(self,record)
                    if self.phase in {'disposed','frozen','freezing','unknown'}:continue
                    if kind=='agent_start':
                        self.phase='running'
                    elif kind=='message_end' and record.get('message',{}).get('role')=='assistant':
                        stop=record['message'].get('stopReason')
                        if stop in {'error','aborted'}:
                            self.error=stop
                    elif kind=='agent_settled':
                        # This is Pi's real terminal notification, never synthesized
                        # from agent_end, silence, or get_state().isStreaming.
                        self.phase='settling'
                        self.settled_event_seq=item['eventSeq']
                        threading.Thread(target=self.complete,daemon=True).start()
        except Exception:
            self.fail('rpc_protocol_unknown')
        finally:proc.stdout.close()

    def bind(self, gateway, model=None):
        if not isinstance(gateway,dict) or set(gateway)!={'url','capability'} or gateway['url']!=self.broker.gateway_url:
            raise ValueError('invalid_gateway_binding')
        if not isinstance(gateway['capability'],str) or not 16<=len(gateway['capability'])<=4096:
            raise ValueError('invalid_capability')
        self.gateway=gateway
        if model is None:model=getattr(self,'model',None)
        if not isinstance(model,dict) or any(type(model.get(k)) is not int or model[k]<1 for k in ['contextWindow','maxTokens']) or type(model.get('reasoning')) is not bool:
            raise ValueError('model_metadata_required')
        self.model={k:model[k] for k in ['contextWindow','maxTokens','reasoning']}
        arg=base64.b64encode(encode({'capability':gateway['capability'],'model':self.model})).decode()
        response=self.rpc('prompt',{'message':'/runner-bind '+arg})
        if not response.get('success') or response.get('data',{}).get('disposition')!='handled':
            raise ValueError('capability_bind_failed')
        effective=self.rpc('get_state',{}).get('data',{}).get('model',{})
        if any(effective.get(k)!=v for k,v in self.model.items()):raise ValueError('model_metadata_not_effective')
        self.effective_model={k:effective[k] for k in self.model}

    def gateway_call(self, record):
        job = self.active
        request_id = record.get('id')
        try:
            if not job or self.revoked or self.phase not in {'dispatching','accepted','running'}:
                raise ValueError('operation_revoked')
            payload=decode(record.get('placeholder',''))
            if not isinstance(payload,dict) or payload.get('capability')!=self.gateway['capability']:
                raise ValueError('capability_mismatch')
            if payload.get('kind') not in {'model','tool','file'} or not re.fullmatch(r'[a-f0-9-]{36}',payload.get('requestId','')):
                raise ValueError('invalid_gateway_request')
            allowed={'model':{'kind','model','messages','tools','options','requestId','capability'},
                     'tool':{'kind','name','args','requestId','capability'},
                     'file':{'kind','fileId','requestId','capability'}}[payload['kind']]
            if set(payload)-allowed:
                raise ValueError('invalid_gateway_request')
            wire={**{k:job[k] for k in IDENTITY},**payload}
            raw=encode(wire)
            digest=hashlib.sha256(raw).hexdigest()
            with self.broker.ledger.lock,self.broker.ledger.db:
                self.broker.ledger.db.execute('INSERT INTO gateway VALUES (?,?,?,?)',(job['operationId'],payload['requestId'],digest,'dispatching'))
            pending={'request':wire,'queue':queue.Queue(maxsize=1)}
            with self.lock:
                self.gateway_pending[payload['requestId']]=pending
            # The outside operation owns the configured timeout. Long model
            # requests are never cut down to a hardcoded local two-minute cap.
            while True:
                if self.active is not job or self.revoked:raise ValueError('operation_revoked')
                remaining=self.deadline-time.monotonic()
                if remaining<=0:raise ValueError('gateway_result_unknown')
                try:response=pending['queue'].get(timeout=min(.5,remaining));break
                except queue.Empty:continue
            if self.active is not job or self.revoked:
                raise ValueError('operation_revoked')
            if payload['kind']=='file':
                file=response.get('file',response)
                if file.get('id',payload['fileId'])!=payload['fileId']:
                    raise ValueError('file_binding_mismatch')
                file={**file,'id':payload['fileId']}
                imported=self.broker.transfer(self,{'action':'import','files':[file]})
                response=imported['files'][0]
            with self.broker.ledger.lock,self.broker.ledger.db:
                self.broker.ledger.db.execute('UPDATE gateway SET status=? WHERE operation=? AND request=?',('complete',job['operationId'],payload['requestId']))
            with self.lock:
                self.gateway_pending.pop(payload['requestId'],None)
            self.write({'type':'extension_ui_response','id':request_id,'value':encode(response).decode()})
        except Exception:
            # Requests may have reached the outside provider. Never retry under
            # another request ID, and never treat a transport failure as zero work.
            if self.active is job and not self.revoked:
                self.error='gateway_unknown'
                self.revoked=True
                self.broker.ledger.event(self,{'type':'gateway_unknown'},job)
            with self.lock:
                if isinstance(locals().get('payload'),dict):self.gateway_pending.pop(payload.get('requestId'),None)
            try:self.write({'type':'extension_ui_response','id':request_id,'value':'{"error":"gateway_unknown"}'})
            except (OSError,ValueError):pass

    def complete(self):
        if self.phase in {'disposed','frozen','unknown'}:return
        try:
            result=self.broker.transfer(self,{'action':'export'})
            self.files=[f for f in result['files'] if self.before_files.get(f['fileName'])!=f['sha256']]
            self.phase = 'unknown' if self.error=='gateway_unknown' else ('aborted' if self.revoked or self.error=='aborted' else 'failed' if self.error else 'settled')
            if self.phase!='unknown':
                self.files_collected=True
                event=self.broker.ledger.event(self,{'type':'files_collected','count':len(self.files)})
                self.terminal_receipt={'operationId':self.active['operationId'],'status':self.phase,'eventSeq':event['eventSeq'],
                    'files':[f['sha256'] for f in self.files]}
        except Exception:
            self.phase,self.error='unknown','file_collection_unknown'
        self.revoked=True
        self.last_activity=time.monotonic()
        self.broker.save_session(self)

    def snapshot(self, after=0, operation_id=None):
        if type(after) is not int or after<0:
            raise ValueError('invalid_event_cursor')
        with self.broker.ledger.lock:
            rows=self.broker.ledger.db.execute('SELECT record FROM events WHERE workspace=? AND event_seq>? ORDER BY event_seq LIMIT 201',(self.key,after)).fetchall()
        events=[decode(row[0]) for row in rows[:200]]
        return {'status':self.phase,'state':{'phase':self.phase,'error':self.error,'busy':self.phase in {'dispatching','accepted','running','settling'},'image':self.broker.image,'activeOperationId':self.active['operationId'] if self.active else None,
            'workspaceId':self.key,'skillVersion':getattr(self,'skill_version','1.0.0'),'skills':self.skills,'commands':getattr(self,'commands',[]),'model':getattr(self,'model',None),'effectiveModel':getattr(self,'effective_model',None),'restartStopVerified':getattr(self,'restart_stop_verified',False)},
            'events':events,'hasMore':len(rows)>200,'files':self.files if self.phase in {'settled','failed','aborted'} else [],
            'filesCollected':self.files_collected,'terminalReceipt':self.terminal_receipt,
            'pendingGatewayRequests':[p['request'] for p in self.gateway_pending.values()] if not self.revoked else []}


class Broker:
    def __init__(self, config):
        if os.name!='posix' or os.getuid()==0:
            raise ValueError('unprivileged_linux_required')
        if set(config)-{'docker','socket','image','keyFile','stateDirectory','gatewayUrl','namespace','limits'} or not {'docker','socket','image','keyFile','stateDirectory','gatewayUrl','namespace'}.issubset(config):
            raise ValueError('invalid_config')
        self.docker=str(Path(config['docker']).resolve(strict=True))
        if not Path(self.docker).is_file() or not re.fullmatch(r'sha256:[a-f0-9]{64}',config['image']):
            raise ValueError('pinned_image_required')
        socket=Path(config['socket'])
        if not socket.is_absolute() or not stat.S_ISSOCK(socket.lstat().st_mode) or socket.lstat().st_uid!=os.getuid():
            raise ValueError('rootless_owned_socket_required')
        self.state=private(config['stateDirectory'],True)
        self.key=private(config['keyFile']).read_bytes()
        if not 32<=len(self.key)<=128:
            raise ValueError('invalid_key')
        self.image=config['image']
        self.namespace=config['namespace']
        if not re.fullmatch(r'pi-[a-z0-9-]{3,40}',self.namespace):
            raise ValueError('invalid_namespace')
        self.gateway_url=config['gatewayUrl']
        if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{2,5}/api/ai/pi/gateway',self.gateway_url):
            raise ValueError('loopback_gateway_required')
        import fcntl
        self.lock_file=open(self.state/'broker.lock','a+b')
        fcntl.flock(self.lock_file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        empty=self.state/'empty-docker-config'
        empty.mkdir(mode=0o700,exist_ok=True)
        self.env={'PATH':'/usr/bin:/bin','DOCKER_HOST':'unix://'+str(socket),'DOCKER_CONFIG':str(empty)}
        self.sessions,self.lock={},threading.RLock()
        self.limits=config.get('limits',{'workspaceBytes':268435456,'workspaceFiles':5000,'idleSeconds':1800,'maxSessions':8})
        if (not isinstance(self.limits,dict) or set(self.limits)!={'workspaceBytes','workspaceFiles','idleSeconds','maxSessions'}
                or any(type(v) is not int for v in self.limits.values()) or not 8388608<=self.limits['workspaceBytes']<=1073741824
                or not 100<=self.limits['workspaceFiles']<=20000 or not 1<=self.limits['idleSeconds']<=86400 or not 1<=self.limits['maxSessions']<=16):
            raise ValueError('invalid_resource_limits')
        self.ledger=Ledger(self.state/'ledger.sqlite3')
        from .skills import build
        self.skill_bundles={}
        for root in (Path(__file__).parent/'bundled_skills').iterdir():
            if root.is_dir():
                actual=build(root)
                if actual!=decode((root/'manifest.json').read_bytes()):raise ValueError('runner_skill_bundle_changed')
                self.skill_bundles[actual['version']]=actual
        self.preflight()
        self.rebuild_unknown_references()
        self.stop_monitor=threading.Event()
        threading.Thread(target=self.monitor,daemon=True).start()

    def monitor(self):
        while not self.stop_monitor.wait(1):
            for session in list(self.sessions.values()):
                if session.phase in {'disposed','unknown','frozen','stopped','updating','creating'} or session.proc is None:continue
                try:
                    quota=self.transfer(session,{'action':'quota','bytes':self.limits['workspaceBytes'],'files':self.limits['workspaceFiles']})
                    if quota['exceeded']:
                        session.revoked=True
                        self.ledger.event(session,{'type':'workspace_quota_exceeded','softLimit':True})
                        session.phase='freezing';session.error='workspace_quota_exceeded'
                        self.docker_command(['stop','--time','2',session.container],timeout=10)
                        state=decode(self.docker_command(['inspect','--format','{{json .State}}',session.container],maximum=10000))
                        if state.get('Running'):raise ValueError('quota_stop_unknown')
                        session.phase='frozen'
                        self.save_session(session)
                    elif session.phase in {'idle','settled','handled','aborted','failed'} and time.monotonic()-session.last_activity>self.limits['idleSeconds']:
                        old=session.proc;session.proc=None;old.stdin.close()
                        try:old.wait(timeout=15)
                        except subprocess.TimeoutExpired as error:raise ValueError('idle_stop_unknown') from error
                        session.phase='stopped';self.save_session(session)
                except Exception:
                    if session.phase not in {'disposed','updating','stopped'}:session.fail('workspace_guard_unknown')

    def popen(self,args):
        return subprocess.Popen([self.docker,*args],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=self.env,shell=False,bufsize=0)

    def managed_containers(self):
        raw=self.docker_command(['ps','-aq','--filter','label=teruisi.pi.namespace='+self.namespace],maximum=10000)
        return raw.decode().split()

    def rebuild_unknown_references(self):
        with self.ledger.lock:
            rows=self.ledger.db.execute('SELECT workspace,identity,container,volume,status,seq,container_id FROM sessions').fetchall()
        known={row[2]:row for row in rows}
        for container_id in self.managed_containers():
            meta=decode(self.docker_command(['inspect',container_id],maximum=128000))[0]
            name=meta.get('Name','').removeprefix('/')
            row=known.get(name)
            if not row:raise ValueError('unregistered_namespace_container')
            key,raw,container,volume,status,seq,saved_id=row;identity=decode(raw)
            if key!=workspace_key(identity) or container!=self.namespace+'-'+key[:32] or volume!=container+'-workspace':raise ValueError('persisted_workspace_binding_changed')
            version=identity.get('skillVersion') or '1.0.0'
            bundle=self.skill_bundles.get(version)
            if not bundle:raise ValueError('persisted_skill_version_unavailable')
            selected=identity.get('skillIds',[s['id'] for s in bundle['skills']])
            session=Session(self,identity,container,volume,[s for s in bundle['skills'] if s['id'] in selected])
            session.container_id=saved_id
            session.skill_version=version;session.last_seq=seq
            verified=self.inspect(session)
            if verified.get('Id')!=meta.get('Id'):raise ValueError('startup_container_identity_changed')
            if status in {'unknown','frozen'}:
                session.phase=status;session.error='broker_restart_unknown' if status=='unknown' else 'workspace_quota_exceeded'
                session.active={k:identity[k] for k in IDENTITY};session.revoked=True
                if status=='unknown':
                    # A lost pipe does not stop orphaned bash descendants. Freeze
                    # the exact verified container, retaining both unknown outcome
                    # and volume; never adopt/replay its Pi or provider work.
                    if verified.get('State',{}).get('Running'):
                        self.docker_command(['stop','--time','2',verified['Id']],timeout=10)
                    stopped=decode(self.docker_command(['inspect',verified['Id']],maximum=128000))[0]
                    if stopped.get('Id')!=verified['Id'] or stopped.get('State',{}).get('Running'):
                        raise ValueError('unknown_container_stop_unverified')
                    session.restart_stop_verified=True
                    self.ledger.event(session,{'type':'unknown_container_stopped','stopVerified':True})
                self.sessions[key]=session
                self.save_session(session)

    def docker_command(self,args,raw=None,timeout=15,maximum=MAX_RESPONSE):
        proc=self.popen(args)
        chunks,errors=[],[]
        def reader():
            size=0
            while True:
                chunk=proc.stdout.read(65536)
                if not chunk: return
                size+=len(chunk)
                if size>maximum:
                    errors.append('docker_output_limit');proc.kill();return
                chunks.append(chunk)
        def stderr():
            size=0
            while True:
                chunk=proc.stderr.read(4096)
                if not chunk:return
                size+=len(chunk)
                if size>65536:errors.append('docker_stderr_limit');proc.kill();return
        def writer():
            try:
                if raw:proc.stdin.write(raw);proc.stdin.flush()
            except (OSError,ValueError):pass
            finally:proc.stdin.close()
        threads=[threading.Thread(target=f,daemon=True) for f in [reader,stderr,writer]]
        for thread in threads:thread.start()
        try:proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            proc.kill();proc.wait(timeout=2);raise ValueError('docker_result_unknown') from error
        finally:
            for thread in threads:thread.join(timeout=2)
            proc.stdout.close();proc.stderr.close()
        if any(t.is_alive() for t in threads) or errors:raise ValueError('docker_output_limit')
        if proc.returncode:raise ValueError('docker_command_failed')
        return b''.join(chunks)

    def preflight(self):
        info=decode(self.docker_command(['info','--format','{{json .}}'],maximum=128000))
        security=' '.join(info.get('SecurityOptions',[]))
        if (info.get('OSType')!='linux' or 'rootless' not in security or 'seccomp' not in security or info.get('CgroupVersion')!='2' or info.get('CgroupDriver')!='systemd'
                or any(info.get(k) is not True for k in ['MemoryLimit','SwapLimit','PidsLimit','CpuCfsQuota'])):
            raise ValueError('rootless_isolation_unavailable')
        image=decode(self.docker_command(['image','inspect',self.image],maximum=128000))[0]
        if image.get('Id')!=self.image or image.get('Os')!='linux' or image['Config'].get('Volumes') or image['Config'].get('Entrypoint')!=['node','/opt/pi/entrypoint.mjs']:
            raise ValueError('unapproved_image')

    def transfer(self,session,payload):
        raw=self.docker_command(['exec','--interactive',session.container,'python3','-I','-B','/opt/pi/file-transfer.py'],raw=encode(payload),maximum=MAX_RESPONSE)
        result=decode(raw)
        if not isinstance(result,dict) or result.get('error'):
            raise ValueError('file_transfer_rejected')
        return result

    def save_session(self,session):
        with self.ledger.lock,self.ledger.db:
            stored={**(session.active or session.identity),'skillVersion':getattr(session,'skill_version',None),'skillIds':[s['id'] for s in session.skills]}
            stored={k:v for k,v in stored.items() if k in {*IDENTITY,'skillVersion','skillIds'}}
            persisted_phase='frozen' if getattr(session,'frozen_workspace',False) and session.phase=='disposed' else session.phase
            self.ledger.db.execute('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?)',(session.key,encode(stored),session.container,session.volume,persisted_phase,session.last_seq,session.container_id))

    def inspect(self,session):
        container=decode(self.docker_command(['inspect',session.container],maximum=128000))[0]
        host=container['HostConfig'];mounts=container.get('Mounts',[])
        volumes=[m for m in mounts if m.get('Type')=='volume']
        if ((session.container_id and session.container_id!=container.get('Id')) or container.get('Name')!='/'+session.container
                or container.get('Image')!=self.image or container['Config'].get('User')!='65532:65532' or host.get('NetworkMode')!='none' or not host.get('ReadonlyRootfs')
                or host.get('Privileged') or host.get('Binds') or host.get('Devices') or set(host.get('CapDrop') or [])!={'ALL'} or host.get('SecurityOpt')!=['no-new-privileges:true']
                or host.get('IpcMode')!='private' or host.get('CgroupnsMode')!='private' or host.get('LogConfig',{}).get('Type')!='none'
                or host.get('Memory')!=1073741824 or host.get('MemorySwap')!=1073741824 or host.get('NanoCpus')!=1000000000 or host.get('PidsLimit')!=128
                or len(volumes)!=1 or volumes[0].get('Name')!=session.volume or volumes[0].get('Destination')!='/workspace'
                or any(m.get('Type') not in {'volume','tmpfs'} for m in mounts)
                or container['Config'].get('Labels',{}).get('teruisi.pi.workspace')!=session.key
                or container['Config'].get('Labels',{}).get('teruisi.pi.namespace')!=self.namespace):
            raise ValueError('container_contract_mismatch')
        volume=decode(self.docker_command(['volume','inspect',session.volume],maximum=64000))[0]
        if (volume.get('Name')!=session.volume or volume.get('Driver')!='local' or volume.get('Options')
                or volume.get('Labels',{}).get('teruisi.pi.workspace')!=session.key
                or volume.get('Labels',{}).get('teruisi.pi.namespace')!=self.namespace):raise ValueError('volume_owner_mismatch')
        session.container_id=container['Id']
        return container

    def create(self,job):
        key=workspace_key(job)
        with self.lock:
            existing=self.sessions.get(key)
            if existing:
                if existing.phase in {'unknown','disposed','frozen'}:raise ValueError('session_unavailable')
                if existing.phase=='stopped':existing.start();existing.phase='idle';existing.last_activity=time.monotonic()
                if existing.active and existing.active['operationId']!=job['operationId'] and existing.phase in {'dispatching','accepted','running','settling'}:raise ValueError('session_busy')
                selected=job['payload'].get('skillIds',[s['id'] for s in existing.skills])
                version=job['payload'].get('skillVersion',getattr(existing,'skill_version','1.0.0'))
                self.update_skills(existing,version,selected)
                return existing
            with self.ledger.lock:
                previous=self.ledger.db.execute('SELECT identity,status,workspace,seq FROM sessions').fetchall()
            restore_seq=0
            for raw,status,old_key,old_seq in previous:
                old=decode(raw)
                if old_key==key and status=='frozen':raise ValueError('frozen_workspace_requires_generation')
                if old['ownerId']==job['ownerId'] and old['conversationId']==job['conversationId'] and status not in {'disposed','frozen'}:
                    if old_key==key and status in {'idle','settled','handled','aborted','failed','stopped'}:restore_seq=old_seq
                    else:raise ValueError('unresolved_previous_session')
            name=self.namespace+'-'+key[:32];volume=name+'-workspace'
            physical=self.managed_containers()
            if len(physical)>=self.limits['maxSessions']:
                matching=self.docker_command(['ps','-aq','--filter','name=^/'+name+'$']).strip()
                if not matching:raise ValueError('session_limit')
            labels=['--label','teruisi.pi.namespace='+self.namespace,'--label','teruisi.pi.workspace='+key]
            known=self.docker_command(['volume','ls','-q','--filter','name=^'+volume+'$']).strip()
            if known:
                meta=decode(self.docker_command(['volume','inspect',volume],maximum=64000))[0]
                if meta.get('Labels',{}).get('teruisi.pi.workspace')!=key or meta.get('Labels',{}).get('teruisi.pi.namespace')!=self.namespace:raise ValueError('volume_owner_mismatch')
            else:self.docker_command(['volume','create',*labels,volume])
            args=['create','--pull=never','--name',name,*labels,'--network=none','--read-only','--user=65532:65532','--cap-drop=ALL','--security-opt=no-new-privileges:true',
                  '--cpus=1','--memory=1g','--memory-swap=1g','--pids-limit=128','--ulimit=nofile=256:256','--ulimit=core=0:0','--ulimit=fsize=67108864:67108864',
                  '--restart=no','--log-driver=none','--ipc=private','--cgroupns=private','--shm-size=16m','--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
                  '--mount','type=volume,src='+volume+',dst=/workspace','--workdir=/workspace','--interactive',self.image]
            version=job['payload'].get('skillVersion','1.0.0')
            manifest=self.skill_bundles.get(version)
            if not manifest:raise ValueError('skill_version_unavailable')
            selected=job['payload'].get('skillIds',[s['id'] for s in manifest['skills']])
            if not isinstance(selected,list) or len(set(selected))!=len(selected) or not set(selected).issubset({s['id'] for s in manifest['skills']}):raise ValueError('invalid_skill_selection')
            session=Session(self,job,name,volume,[s for s in manifest['skills'] if s['id'] in selected])
            session.skill_version=version
            session.last_seq=restore_seq
            self.sessions[key]=session;self.save_session(session)
        try:
            old_container=self.docker_command(['ps','-aq','--filter','name=^/'+name+'$']).strip()
            if old_container:
                self.inspect(session)
                self.docker_command(['rm','--force',name])
                session.container_id=None
            self.docker_command(args)
            self.inspect(session)
            # Start Pi first; get_state proves real process readiness. Manifest
            # is read only from the immutable image, not an application path.
            session.start()
            actual=validate_manifest(self.transfer(session,{'action':'manifest','version':version}))
            if actual!=manifest:raise ValueError('image_skill_bundle_changed')
            session.bind(job['payload']['gateway'],job['payload'].get('model'))
            session.phase='idle';session.last_activity=time.monotonic()
            self.save_session(session)
            return session
        except Exception:
            session.fail('session_create_unknown')
            raise

    def update_skills(self,session,version,selected):
        if session.phase not in {'idle','settled','handled','aborted','failed'}:raise ValueError('skill_update_while_busy')
        manifest=self.skill_bundles.get(version)
        if not manifest:raise ValueError('skill_version_unavailable')
        if validate_manifest(self.transfer(session,{'action':'manifest','version':version}))!=manifest:raise ValueError('image_skill_bundle_changed')
        if not isinstance(selected,list) or len(set(selected))!=len(selected) or not set(selected).issubset({s['id'] for s in manifest['skills']}):raise ValueError('invalid_skill_selection')
        if version==getattr(session,'skill_version','1.0.0') and set(selected)=={s['id'] for s in session.skills}:return
        session.phase='updating'
        old=session.proc;session.proc=None
        old.stdin.close()
        try:old.wait(timeout=15)
        except subprocess.TimeoutExpired as error:
            session.fail('skill_restart_unknown');raise ValueError('skill_restart_unknown') from error
        session.skills=[s for s in manifest['skills'] if s['id'] in selected]
        session.skill_version=version
        self.save_session(session)
        session.start()
        session.phase='idle'

    def execute(self,job):
        validate_command(job)
        command,payload=job['command'],job['payload']
        if getattr(self,'closing',False) and command in {'create','prompt','skills'}:raise ValueError('runner_stopping')
        if command not in {'state','gateway_response'}:
            cached=self.ledger.reserve(job)
            if cached is not None:
                if cached.get('error'):raise ValueError(cached['error'])
                return cached
        try:
            key=workspace_key(job)
            if command=='create':session=self.create(job)
            else:
                session=self.sessions.get(key)
                if session is None:raise ValueError('session_unavailable')
                if session.active and session.active['operationId']!=job['operationId'] and command not in {'skills','dispose','prompt'}:raise ValueError('operation_mismatch')
            if command=='prompt':
                if set(payload)-{'message','gateway','files','skillIds','skillVersion','model','timeoutMs'} or not isinstance(payload.get('message'),str) or not 1<=len(payload['message'].encode())<=262144:raise ValueError('invalid_prompt')
                timeout=payload.get('timeoutMs')
                if type(timeout) is not int or not 1<=timeout<=9007199254740991:raise ValueError('operation_timeout_required')
                if payload['message'].lstrip().startswith(('/runner-bind','/reload')):raise ValueError('reserved_command')
                with session.lock:
                    if session.phase not in {'idle','settled','handled','aborted','failed'}:raise ValueError('session_busy_or_unknown')
                    if job['seq']<=session.last_seq:raise ValueError('stale_sequence')
                    session.phase='dispatching';session.error=None;session.files=[];session.revoked=False
                    session.last_activity=time.monotonic()
                    session.deadline=session.last_activity+timeout/1000
                    session.files_collected=False;session.terminal_receipt=None;session.settled_event_seq=None;session.prompt_response_seq=None
                    session.active=job;session.last_seq=job['seq']
                    # Persist the new operation fence before capability binding,
                    # file ingress, or any Pi command can have an effect.
                    self.save_session(session)
                session.bind(payload['gateway'],payload.get('model'))
                before=self.transfer(session,{'action':'export'})
                session.before_files={f['fileName']:f['sha256'] for f in before['files']}
                imported=self.transfer(session,{'action':'import','files':payload.get('files',[])})
                session.active=job;session.last_seq=job['seq'];self.save_session(session)
                response=session.rpc('prompt',{'message':payload['message']},rpc_id=job['operationId']+':prompt')
                if not response.get('success'):
                    session.phase,session.error='failed','prompt_rejected'
                elif response.get('data',{}).get('disposition')=='handled':
                    session.phase='handled';session.revoked=True;session.files_collected=True
                    session.terminal_receipt={'operationId':job['operationId'],'status':'handled','eventSeq':session.prompt_response_seq,'files':[]}
                elif response.get('data',{}).get('disposition')=='started':
                    if session.phase=='dispatching':session.phase='accepted'
                else:session.fail('unexpected_prompt_disposition')
                session.input_files=imported['files'];self.save_session(session)
            elif command=='gateway_response':
                if set(payload)!={'requestId','response'} or not isinstance(payload['response'],dict):raise ValueError('invalid_gateway_response')
                request_id=payload['requestId']
                digest=hashlib.sha256(encode(payload['response'])).hexdigest()
                with session.lock:
                    previous=session.gateway_completed.get(request_id)
                    if previous and previous!=digest:raise ValueError('gateway_response_changed')
                    if not previous:
                        pending=session.gateway_pending.get(request_id)
                        if not pending or session.revoked:raise ValueError('gateway_request_unavailable')
                        session.gateway_completed[request_id]=digest
                        pending['queue'].put(payload['response'])
            elif command=='abort':
                if not session.active or session.active['operationId']!=job['operationId']:raise ValueError('operation_mismatch')
                session.revoked=True
                with session.lock:
                    for pending in session.gateway_pending.values():
                        if pending['queue'].empty():pending['queue'].put({'error':'aborted'})
                session.rpc('clear_queue',{})
                response=session.rpc('abort',{},timeout=20)
                self.ledger.event(session,{'type':'abort_response','success':response.get('success') is True})
                if not response.get('success'):session.fail('abort_unknown')
                # abort response confirms command handling only. The actual
                # agent_settled event remains the terminal completion evidence.
                self.save_session(session)
            elif command=='dispose':
                session.frozen_workspace=session.phase in {'unknown','frozen','freezing'}
                session.revoked=True;session.phase='disposed';self.save_session(session)
                self.docker_command(['rm','--force',session.container])
                if self.docker_command(['ps','-aq','--filter','name=^/'+session.container+'$']).strip():raise ValueError('cleanup_unknown')
                if session.proc:
                    session.proc.stdin.close();session.proc.wait(timeout=5)
                # Volume retained with immutable owner/fence identity. It is never
                # attached to a different generation, even after scope changes.
                self.sessions.pop(key,None)
            elif command=='skills':
                if session.phase not in {'idle','settled','handled','aborted','failed'}:raise ValueError('skill_update_while_busy')
                if payload:
                    if set(payload)!={'skillVersion','skillIds'}:raise ValueError('invalid_skill_update')
                    self.update_skills(session,payload['skillVersion'],payload['skillIds'])
                    self.save_session(session)
            elif command=='ack':
                if session.phase not in {'settled','handled','aborted','failed'}:raise ValueError('operation_not_terminal')
                self.ledger.event(session,{'type':'operation_handled','terminalStatus':session.phase})
            result={**{k:job[k] for k in IDENTITY},**session.snapshot(payload.get('afterEventSeq',0) if command=='state' else 0,job['operationId']),'skills':session.skills,'inputFiles':getattr(session,'input_files',[])}
            if command not in {'state','gateway_response'}:self.ledger.finish(job,result)
            return result
        except Exception as error:
            rejected={'session_busy','session_busy_or_unknown','skill_update_while_busy','stale_sequence','operation_mismatch','operation_not_terminal',
                      'invalid_prompt','reserved_command','invalid_skill_update','invalid_skill_selection','session_limit','session_unavailable',
                      'unresolved_previous_session','invalid_gateway_response','gateway_request_unavailable','gateway_response_changed'}
            known=isinstance(error,ValueError) and str(error) in rejected
            if command not in {'state','gateway_response'}:
                self.ledger.finish(job,{'error':str(error) if known else 'command_outcome_unknown'},'rejected' if known else 'unknown')
                if not known and locals().get('session') is not None:session.fail('command_outcome_unknown')
            raise

    def health(self):
        from .install_linux import source_digest
        self.preflight()
        with self.ledger.lock:
            unknown=self.ledger.db.execute("SELECT workspace,identity,container,volume,container_id FROM sessions WHERE status='unknown'").fetchall()
        safe=unsafe=0
        for key,raw,name,volume,saved_id in unknown:
            try:
                identity=decode(raw)
                if key!=workspace_key(identity) or name!=self.namespace+'-'+key[:32] or volume!=name+'-workspace':raise ValueError('unknown_binding_changed')
                present=self.docker_command(['ps','-aq','--filter','name=^/'+name+'$']).strip()
                if not present:
                    # Exact absence is safe for stopping the broker, not evidence
                    # that the original model request had no effect.
                    if saved_id and self.docker_command(['ps','-aq','--filter','id='+saved_id]).strip():raise ValueError('unknown_container_renamed')
                    safe+=1;continue
                reference=Session(self,identity,name,volume,[]);reference.container_id=saved_id
                actual=self.inspect(reference)
                if actual.get('State',{}).get('Running') is not False:raise ValueError('unknown_still_running')
                safe+=1
            except Exception:unsafe+=1
        return {'version':1,'image':self.image,'sourceSha256':source_digest(),'namespace':self.namespace,
            'activeCount':sum(s.phase in {'dispatching','accepted','running','settling','creating','updating','freezing'} for s in self.sessions.values()),
            'unresolvedCount':len(unknown),'unsafeUnknownCount':unsafe,'unknownStoppedVerifiedCount':safe,'closing':getattr(self,'closing',False)}

    def shutdown(self):
        self.closing=True;self.stop_monitor.set()
        waiting=[]
        for session in list(self.sessions.values()):
            if session.phase not in {'idle','settled','handled','aborted','failed'}:continue
            if session.proc:
                old=session.proc;session.proc=None;old.stdin.close();waiting.append((session,old))
        deadline=time.monotonic()+20
        for session,proc in waiting:
            try:
                proc.wait(timeout=max(.1,deadline-time.monotonic()))
                session.phase='stopped';self.save_session(session)
            except Exception:session.fail('shutdown_unknown')


class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.0'
    def log_message(self,*_):pass
    def do_POST(self):
        authenticated=False;broker=self.server.broker
        nonce,stamp=self.headers.get('X-Nonce',''),self.headers.get('X-Timestamp','')
        try:
            self.connection.settimeout(5)
            if self.path not in {PATH,HEALTH_PATH} or self.headers.get('Transfer-Encoding'):raise ValueError('invalid_path')
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=MAX_REQUEST:raise ValueError('request_limit')
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError('incomplete_request')
            if not hmac.compare_digest(self.headers.get('X-Signature',''),signature(broker.key,stamp,nonce,raw,path=self.path)):raise ValueError('invalid_signature')
            broker.ledger.nonce(nonce,stamp);authenticated=True
            decoded=decode(raw)
            if self.path==HEALTH_PATH:
                if not isinstance(decoded,dict) or decoded:raise ValueError('invalid_health_request')
                result=broker.health()
            else:result=broker.execute(decoded)
            status=200
        except Exception as error:
            # Codes only; no exception strings that may include secrets, paths,
            # provider errors or raw content are sent to logs/the client.
            code=str(error)
            if not re.fullmatch(r'[a-z_]{1,64}',code):code='runner_failed_closed'
            result={'error':code};status=400 if authenticated else 401
        raw=encode(result)
        if len(raw)>MAX_RESPONSE:raw=b'{"error":"response_limit"}';status=400
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)))
        if authenticated:self.send_header('X-Signature',signature(broker.key,stamp,nonce,raw,direction='response',path=self.path))
        self.end_headers();self.wfile.write(raw)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--port',type=int,default=PORT)
    args=parser.parse_args()
    if not 1024<=args.port<=65535:raise ValueError('invalid_port')
    broker=Broker(decode(private(args.config).read_bytes()))
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);server.broker=broker
    def stop(*_):threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try:server.serve_forever(poll_interval=0.5)
    finally:broker.shutdown();server.server_close()


if __name__=='__main__':main()
