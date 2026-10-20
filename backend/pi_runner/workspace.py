"""Independent workspace controls and PTYs; no business or provider authority.

Control admission is persisted before effects. An interrupted dispatch is unknown,
never a reason to resend shell input, bash, session mutations, or package installs.
"""
import base64
import codecs
from collections import deque
import hashlib
import html
from pathlib import Path
import queue
import re
import threading
import time
import uuid

from .protocol import IDENTITY, decode, encode

BUSY = {'dispatching', 'accepted', 'running', 'settling'}
IDLE = {'idle', 'settled', 'handled', 'aborted', 'failed'}
ASYNC = {'bash', 'compact', 'resource_install', 'upgrade'}
READ = {'tree', 'stats', 'file_list', 'file_read', 'file_download'}
COMMANDS = READ | ASYNC | {'steer', 'follow_up', 'clear_queue', 'abort_bash', 'ui_response',
    'session_new', 'session_fork', 'session_clone', 'session_switch', 'session_navigate',
    'model_set', 'thinking_set', 'export_html', 'terminal_create', 'terminal_input',
    'terminal_resize', 'terminal_close', 'file_write', 'file_delete', 'file_mkdir',
    'file_rename', 'pause', 'wake', 'resource_remove', 'resource_reload','mode_set','skills_reload'}
FIELDS={'tree':set(),'stats':set(),'steer':{'message'},'follow_up':{'message'},'clear_queue':set(),
 'bash':{'command','excludeFromContext'},'abort_bash':set(),'compact':{'gateway','model','timeoutMs','customInstructions'},
 'ui_response':{'requestId','value','confirmed','cancelled'},'session_new':set(),'session_clone':set(),
 'session_fork':{'entryId'},'session_switch':{'sessionId'},'session_navigate':{'entryId'},
 'model_set':{'gateway','model'},'thinking_set':{'level'},'export_html':set(),
 'terminal_create':{'cols','rows'},'terminal_input':{'terminalId','inputId','inputSeq','data'},
 'terminal_resize':{'terminalId','cols','rows'},'terminal_close':{'terminalId'},
 'file_list':{'path'},'file_read':{'path','expectedSha256'},'file_download':{'path','expectedSha256'},
 'file_write':{'path','expectedSha256','base64'},'file_mkdir':{'path'},'file_delete':{'path','expectedSha256'},
 'file_rename':{'path','target','expectedSha256'},'pause':set(),'wake':set(),'upgrade':{'planId'},
 'resource_install':{'bundle'},'resource_remove':{'resourceId'},'resource_reload':set(),
 'mode_set':{'admission'},'skills_reload':set()}


class Rejected(ValueError):
    pass


def init_ledger(ledger):
    with ledger.lock, ledger.db:
        ledger.db.executescript('''
          CREATE TABLE IF NOT EXISTS workspace_controls (
            workspace TEXT, id TEXT, seq INTEGER, digest TEXT, command TEXT,
            status TEXT, result BLOB, PRIMARY KEY(workspace,id), UNIQUE(workspace,seq));
          CREATE TABLE IF NOT EXISTS workspace_values (
            workspace TEXT, name TEXT, value BLOB, PRIMARY KEY(workspace,name));
          CREATE TABLE IF NOT EXISTS terminal_inputs (
            workspace TEXT, terminal TEXT, id TEXT, seq INTEGER, digest TEXT, status TEXT,
            PRIMARY KEY(workspace,terminal,id), UNIQUE(workspace,terminal,seq));
          CREATE TABLE IF NOT EXISTS workspace_upgrades (
            workspace TEXT, plan TEXT, status TEXT, intent BLOB, PRIMARY KEY(workspace,plan));
          CREATE TABLE IF NOT EXISTS workspace_terminals (workspace TEXT,id TEXT,status TEXT,PRIMARY KEY(workspace,id));
          CREATE TABLE IF NOT EXISTS workspace_helpers (workspace TEXT,name TEXT,id TEXT,image TEXT,volume TEXT,status TEXT,PRIMARY KEY(workspace,name));
          CREATE TABLE IF NOT EXISTS workspace_activities (workspace TEXT,id TEXT,kind TEXT,status TEXT,deadline REAL,operation TEXT,PRIMARY KEY(workspace,id));
          CREATE TABLE IF NOT EXISTS workspace_activity_receipts (workspace TEXT,id TEXT,seq INTEGER,digest TEXT,result BLOB,PRIMARY KEY(workspace,id,seq));
        ''')
        ledger.db.execute("""UPDATE sessions SET status='unknown' WHERE status NOT IN ('disposed','frozen') AND workspace IN (
            SELECT workspace FROM workspace_controls WHERE status IN ('dispatching','accepted','queued','unknown') UNION
            SELECT workspace FROM terminal_inputs WHERE status IN ('dispatching','unknown') UNION
            SELECT workspace FROM workspace_terminals WHERE status IN ('starting','running','unknown') UNION
            SELECT workspace FROM workspace_helpers WHERE status!='complete' UNION
            SELECT workspace FROM workspace_activities WHERE status IN ('active','unknown'))""")
        ledger.db.execute("UPDATE workspace_controls SET status='unknown',result=? WHERE status IN ('dispatching','accepted','queued')",
                          (encode({'errorCode': 'broker_restart_unknown'}),))
        ledger.db.execute("UPDATE terminal_inputs SET status='unknown' WHERE status='dispatching'")
        ledger.db.execute("UPDATE workspace_terminals SET status='unknown' WHERE status IN ('starting','running')")
        ledger.db.execute("UPDATE workspace_activities SET status='unknown' WHERE status='active'")


def activities(session):
    with session.broker.ledger.lock:
        rows=session.broker.ledger.db.execute('SELECT id,kind,status,deadline,operation FROM workspace_activities WHERE workspace=? ORDER BY deadline DESC LIMIT 100',(session.key,)).fetchall()
    return [{'activityId':row[0],'kind':row[1],'status':row[2],'deadline':int(row[3]*1000),'operationId':row[4]} for row in rows]


def activity_control(session,job):
    from .admission import check
    if job['payload'].get('action')=='activity_begin':check(session,execute=True)
    payload=job['payload'];action=payload.get('action');activity_id=payload.get('activityId');seq=payload.get('activitySeq')
    begin=action=='activity_begin';expected={'action','activityId','activitySeq','kind','timeoutMs'} if begin else {'action','activityId','activitySeq'}
    if (set(payload)!=expected or not isinstance(activity_id,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}',activity_id)
            or type(seq) is not int or seq!=(1 if begin else 2)):raise Rejected('invalid_activity_control')
    ledger=session.broker.ledger;digest=hashlib.sha256(encode(job)).hexdigest()
    with session.lock,ledger.lock,ledger.db:
        old=ledger.db.execute('SELECT digest,result FROM workspace_activity_receipts WHERE workspace=? AND id=? AND seq=?',(session.key,activity_id,seq)).fetchone()
        if old:
            if old[0]!=digest:raise Rejected('activity_payload_changed')
            return {**{key:job[key] for key in IDENTITY},'activity':decode(old[1])}
        row=ledger.db.execute('SELECT kind,status,deadline,operation FROM workspace_activities WHERE workspace=? AND id=?',(session.key,activity_id)).fetchone()
        if begin:
            timeout=payload.get('timeoutMs')
            if payload.get('kind')!='dependency_fetch' or type(timeout) is not int or not 1<=timeout<=9007199254740991:raise Rejected('invalid_activity_deadline')
            if getattr(session,'workspace_version',None)!='2':raise Rejected('workspace_image_upgrade_required')
            if (row or session.phase not in IDLE or session.ui_pending or getattr(session,'workspace_maintenance',False) or getattr(session,'resource_installing',None)
                    or getattr(session,'bash_control',None) or any(t.status in {'starting','running'} for t in session.terminals.values())):raise Rejected('workspace_busy')
            if ledger.db.execute("SELECT 1 FROM workspace_activities WHERE workspace=? AND status IN ('active','unknown')",(session.key,)).fetchone():raise Rejected('workspace_busy')
            deadline=time.time()+timeout/1000
            ledger.db.execute('INSERT INTO workspace_activities VALUES (?,?,?,?,?,?)',(session.key,activity_id,'dependency_fetch','active',deadline,job['operationId']))
            result={'activityId':activity_id,'activitySeq':seq,'status':'active','kind':'dependency_fetch','deadline':int(deadline*1000)}
        else:
            if not row:raise Rejected('activity_unavailable')
            if row[1]!='active' or row[2]<=time.time():raise Rejected('activity_unknown')
            ledger.db.execute("UPDATE workspace_activities SET status='completed' WHERE workspace=? AND id=?",(session.key,activity_id))
            result={'activityId':activity_id,'activitySeq':seq,'status':'completed','kind':row[0],'deadline':int(row[2]*1000)}
        ledger.db.execute('INSERT INTO workspace_activity_receipts VALUES (?,?,?,?,?)',(session.key,activity_id,seq,digest,encode(result)))
        session.last_activity=time.monotonic()
    return {**{key:job[key] for key in IDENTITY},'activity':result}


def expire_activities(session):
    ledger=session.broker.ledger
    with ledger.lock,ledger.db:
        rows=ledger.db.execute("SELECT id FROM workspace_activities WHERE workspace=? AND status='active' AND deadline<=?",(session.key,time.time())).fetchall()
        if not rows:return False
        ledger.db.execute("UPDATE workspace_activities SET status='unknown' WHERE workspace=? AND status='active' AND deadline<=?",(session.key,time.time()))
    session.fail('activity_deadline_unknown')
    actual=session.broker.inspect(session)
    if actual['State'].get('Running'):
        if actual['State'].get('Paused'):session.broker.docker_command(['unpause',actual['Id']])
        session.broker.docker_command(['stop','--time','2',actual['Id']],timeout=10)
        if session.broker.inspect(session)['State'].get('Running'):raise ValueError('activity_stop_unknown')
    return True


def recover_helpers(broker):
    with broker.ledger.lock:
        rows=broker.ledger.db.execute("SELECT workspace,name,id,image,volume FROM workspace_helpers WHERE status!='complete'").fetchall()
    for key,name,saved_id,image,volume in rows:
        present=broker.docker_command(['ps','-aq','--filter','name=^/'+name+'$']).strip()
        if present:
            meta=decode(broker.docker_command(['inspect',name],maximum=128000))[0]
            if ((saved_id and meta['Id']!=saved_id) or meta['Image']!=image or meta['Config'].get('Labels',{}).get('teruisi.pi.file-helper')!=key
                    or [m.get('Name') for m in meta.get('Mounts',[]) if m.get('Destination')=='/workspace']!=[volume]
                    or meta['HostConfig'].get('NetworkMode')!='none' or not meta['HostConfig'].get('ReadonlyRootfs')):
                raise ValueError('workspace_helper_identity_changed')
            broker.docker_command(['rm','--force',meta['Id']])
            if broker.docker_command(['ps','-aq','--filter','id='+meta['Id']]).strip():raise ValueError('workspace_helper_stop_unknown')
        with broker.ledger.lock,broker.ledger.db:
            broker.ledger.db.execute("UPDATE workspace_helpers SET status='unknown' WHERE workspace=? AND name=?",(key,name))


def value_get(session, name, default=None):
    ledger = session.broker.ledger
    with ledger.lock:
        row = ledger.db.execute('SELECT value FROM workspace_values WHERE workspace=? AND name=?', (session.key, name)).fetchone()
    return decode(row[0]) if row else default


def value_set(session, name, value):
    ledger = session.broker.ledger
    with ledger.lock, ledger.db:
        ledger.db.execute('INSERT OR REPLACE INTO workspace_values VALUES (?,?,?)', (session.key, name, encode(value)))


def control_update(session, control_id, status, result=None, error=None):
    from .server import public_event
    ledger = session.broker.ledger
    value = {'result': public_event(result or {})}
    if error:
        value['errorCode'] = error
    with ledger.lock, ledger.db:
        ledger.db.execute('UPDATE workspace_controls SET status=?,result=? WHERE workspace=? AND id=?',
                          (status, encode(value), session.key, control_id))


def controls(session):
    ledger = session.broker.ledger
    with ledger.lock:
        rows = ledger.db.execute('SELECT id,seq,command,status,result FROM workspace_controls WHERE workspace=? ORDER BY seq DESC LIMIT 200', (session.key,)).fetchall()
    result=[]
    for row in reversed(rows):
        detail=decode(row[4]) if row[4] else {}
        if row[2] not in {'terminal_input','terminal_resize','terminal_close','steer','follow_up','ui_response','pause','wake','upgrade','model_set','thinking_set'} or len(encode(detail))>1024:
            detail={'result':{key:value for key,value in detail.get('result',{}).items() if key in {'downloadId','path','sha256','sizeBytes','terminalId','inputId','inputSeq','status','disposition'}},
                    'resultOmitted':True,'resultSha256':hashlib.sha256(encode(detail)).hexdigest(),
                    **({'errorCode':detail['errorCode']} if 'errorCode' in detail else {})}
        result.append({'controlId':row[0],'controlSeq':row[1],'command':row[2],'status':row[3],**detail})
    return result


def control_receipt(session,control_id):
    ledger=session.broker.ledger
    with ledger.lock:
        row=ledger.db.execute('SELECT seq,command,status,result FROM workspace_controls WHERE workspace=? AND id=?',(session.key,control_id)).fetchone()
    return {'controlId':control_id,'controlSeq':row[0],'command':row[1],'status':row[2],**(decode(row[3]) if row[3] else {})}


def register_session(session):
    response = session.rpc('get_state', {})
    if not response.get('success'):
        raise ValueError('session_state_unknown')
    state = response['data']
    session_id, path = state.get('sessionId'), state.get('sessionFile')
    if not isinstance(session_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session_id):
        raise ValueError('invalid_pi_session_identity')
    registry = value_get(session, 'sessions', {})
    # A brand-new Pi session can have no file until its first entry.
    if path is not None:
        if not isinstance(path, str) or not path.startswith('/workspace/sessions/') or '..' in path.split('/') or not path.endswith('.jsonl'):
            raise ValueError('unsafe_pi_session_file')
        registry[session_id] = path
        value_set(session, 'sessions', registry)
    value_set(session, 'currentSessionId', session_id)
    session.pi_state = {k: state.get(k) for k in ('sessionId', 'thinkingLevel', 'messageCount', 'pendingMessageCount', 'isStreaming', 'isCompacting')}
    available=session.rpc('get_available_thinking_levels',{})
    if not available.get('success'):raise ValueError('thinking_capabilities_unknown')
    provider=getattr(session,'provider_thinking_levels',None)
    session.supported_thinking_levels=[level for level in available.get('data',{}).get('levels',[]) if provider is None or level in provider]
    return state


class Terminal:
    LIMIT = 256 * 1024

    def __init__(self, session, terminal_id, cols, rows):
        self.session, self.id, self.cols, self.rows = session, terminal_id, cols, rows
        self.lock, self.write_lock = threading.RLock(), threading.Lock()
        self.output, self.bytes, self.seq = deque(), 0, 0
        self.status, self.exit_code = 'starting', None
        self.pending, self.next_input_seq = {}, 1
        self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        with session.broker.ledger.lock,session.broker.ledger.db:
            session.broker.ledger.db.execute('INSERT INTO workspace_terminals VALUES (?,?,?)',(session.key,self.id,'starting'))
        session.broker.inspect(session)
        self.proc = session.broker.popen(['exec', '--interactive', session.container, 'python3', '-I', '-B', '/opt/pi/terminal.py'])
        self.ready = threading.Event()
        threading.Thread(target=self.read, daemon=True).start()
        threading.Thread(target=self.stderr, daemon=True).start()
        self.send({'cols': cols, 'rows': rows})
        if not self.ready.wait(10) or self.status != 'running':
            self.status = 'unknown'
            raise ValueError('terminal_start_unknown')

    def send(self, record):
        with self.write_lock:
            self.proc.stdin.write(encode(record) + b'\n')
            self.proc.stdin.flush()

    def stderr(self):
        # The child is a fixed program. Drain without persisting shell/error text.
        while self.proc.stderr.read(4096):
            pass
        self.proc.stderr.close()

    def read(self):
        try:
            while True:
                raw = self.proc.stdout.readline(131073)
                if not raw:
                    break
                if len(raw) > 131072 or not raw.endswith(b'\n'):
                    raise ValueError('terminal_output_limit')
                record = decode(raw)
                with self.lock:
                    if record['type'] == 'ready':
                        self.status = 'running'
                        self.ready.set()
                    elif record['type'] == 'output':
                        data = base64.b64decode(record['base64'], validate=True)
                        text = self.decoder.decode(data)
                        if text:
                            self.seq += 1
                            size = len(text.encode('utf-8'))
                            self.output.append({'seq': self.seq, 'data': text, 'byteLength': size})
                            self.bytes += size
                            while self.bytes > self.LIMIT and self.output:
                                self.bytes -= self.output.popleft()['byteLength']
                    elif record['type'] == 'ack':
                        waiter = self.pending.get(record.get('id'))
                        if waiter:
                            waiter.put(True)
                    elif record['type'] == 'exit':
                        self.exit_code = record.get('exitCode')
                        self.status = 'exited'
        except Exception:
            self.status = 'unknown'
        finally:
            if self.status not in {'closed', 'exited'}:
                # EIO after a shell exit can precede waitpid; it is not proof of
                # an exit code, and no input is ever replayed to a replacement.
                self.status = 'unknown'
            self.ready.set()
            with self.session.broker.ledger.lock,self.session.broker.ledger.db:
                self.session.broker.ledger.db.execute('UPDATE workspace_terminals SET status=? WHERE workspace=? AND id=?',(self.status,self.session.key,self.id))
            self.proc.stdout.close()

    def acked(self, record):
        if self.status != 'running':
            raise Rejected('terminal_unavailable')
        ack_id = uuid.uuid4().hex
        waiter = queue.Queue(maxsize=1)
        with self.lock:
            self.pending[ack_id] = waiter
        try:
            self.send({**record, 'id': ack_id})
            try:
                waiter.get(timeout=10)
            except queue.Empty as error:
                self.status = 'unknown'
                raise ValueError('terminal_input_unknown') from error
        finally:
            with self.lock:
                self.pending.pop(ack_id, None)

    def input(self, payload):
        input_id, seq, data = payload.get('inputId'), payload.get('inputSeq'), payload.get('data')
        if (not isinstance(input_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', input_id)
                or type(seq) is not int or not isinstance(data, str) or not 1 <= len(data.encode('utf-8')) <= 32768):
            raise Rejected('invalid_terminal_input')
        ledger = self.session.broker.ledger
        digest = hashlib.sha256(encode(payload)).hexdigest()
        with ledger.lock, ledger.db:
            row = ledger.db.execute('SELECT seq,digest,status FROM terminal_inputs WHERE workspace=? AND terminal=? AND id=?', (self.session.key, self.id, input_id)).fetchone()
            if row:
                if (seq, digest) != row[:2]:
                    raise Rejected('terminal_input_changed')
                return {'inputId': input_id, 'inputSeq': seq, 'status': row[2]}
            if seq != self.next_input_seq:
                raise Rejected('terminal_input_sequence')
            ledger.db.execute('INSERT INTO terminal_inputs VALUES (?,?,?,?,?,?)', (self.session.key, self.id, input_id, seq, digest, 'dispatching'))
            self.next_input_seq += 1
        try:
            self.acked({'type': 'input', 'base64': base64.b64encode(data.encode('utf-8')).decode('ascii')})
            status = 'applied'
        except Exception:
            status = 'unknown'
            raise
        finally:
            with ledger.lock, ledger.db:
                ledger.db.execute('UPDATE terminal_inputs SET status=? WHERE workspace=? AND terminal=? AND id=?', (status, self.session.key, self.id, input_id))
        return {'inputId': input_id, 'inputSeq': seq, 'status': status}

    def close(self):
        self.status = 'closed'
        try:
            self.send({'type': 'close'})
            self.proc.stdin.close()
            self.proc.wait(timeout=5)
            with self.session.broker.ledger.lock,self.session.broker.ledger.db:
                self.session.broker.ledger.db.execute("UPDATE workspace_terminals SET status='closed' WHERE workspace=? AND id=?",(self.session.key,self.id))
        except Exception:
            self.status = 'unknown'
            raise ValueError('terminal_close_unknown')

    def snapshot(self, after=0,maximum=65536):
        if type(after) is not int or after < 0:
            raise Rejected('invalid_terminal_cursor')
        with self.lock:
            first = self.output[0]['seq'] if self.output else self.seq + 1
            output=[];size=0
            for item in self.output:
                if item['seq']<=after:continue
                if output and size+item['byteLength']>maximum:break
                output.append(item);size+=item['byteLength']
            result = {'terminalId': self.id, 'status': self.status, 'cols': self.cols, 'rows': self.rows,
                'nextInputSeq': self.next_input_seq, 'firstOutputSeq': first, 'lastOutputSeq': self.seq,
                'hasGap': after < first - 1, 'output': output,'hasMore':bool(output and output[-1]['seq']<self.seq), 'exitCode': self.exit_code}
        ledger = self.session.broker.ledger
        with ledger.lock:
            rows = ledger.db.execute('SELECT id,seq,status FROM terminal_inputs WHERE workspace=? AND terminal=? ORDER BY seq DESC LIMIT 100', (self.session.key, self.id)).fetchall()
        result['acks'] = [{'inputId': row[0], 'inputSeq': row[1], 'status': row[2]} for row in reversed(rows)]
        return result


def close_terminals(session):
    for terminal in getattr(session, 'terminals', {}).values():
        if terminal.status == 'running':
            terminal.close()


def bash_state(session):
    with session.lock:
        return [{**{key:value for key,value in run.items() if key not in {'bytes','output'}},
                 'output':[dict(item) for item in run['output']]} for run in session.bash_runs.values()]


def public_state(session, payload=None):
    from .upgrade_linux import plans
    payload = payload or {}
    cursors = payload.get('afterTerminalSeq', {})
    if not isinstance(cursors, dict):
        raise Rejected('invalid_terminal_cursor')
    registry = value_get(session, 'sessions', {})
    current = value_get(session, 'currentSessionId')
    return {'workspaceId': session.key, 'generation': session.identity['generation'], 'environmentStatus': session.phase,
        'containerId': session.container_id, 'image': session.image, 'volume': session.volume,
        'controlSeq': max([0, *[item['controlSeq'] for item in controls(session)]]), 'controls': controls(session),
        'sessions': [{'sessionId': sid, 'current': sid == current} for sid in registry],
        'piState': getattr(session, 'pi_state', {}), 'effectiveModel': getattr(session, 'effective_model', None),
        'admission':value_get(session,'admission'),'thinking':thinking_state(session),
        'pendingModel':value_get(session,'pendingModel'),
        'skills':{**getattr(session,'skills_catalog',{}),'audit':value_get(session,'skillsAudit',[])},
        'forkMessages':getattr(session,'fork_messages',[]),
        'backgroundProcessCount':getattr(session,'background_process_count',0),
        'bashRuns':bash_state(session),
        'tree': getattr(session, 'public_tree', {'tree': [], 'leafId': None}),
        'pendingUi': list(getattr(session, 'ui_pending', {}).values()),
        'uiEffects': value_get(session,'uiEffects',[]),
        'resources':value_get(session,'resources',[]),
        'activities':activities(session),'hasUnresolvedActivities':any(item['status']=='unknown' for item in activities(session)),
        'terminals': [terminal.snapshot(cursors.get(terminal.id, 0),maximum=524288//max(1,len(session.terminals))) for terminal in getattr(session, 'terminals', {}).values()],
        'upgradePlans': plans(session.broker),
        'capabilities': {'piVersion': '1.3.0', 'sessionNavigate': False, 'sessionFork': True, 'sessionClone': True,
                         'needsImageUpgrade':getattr(session,'workspace_version',None)!='2' or not getattr(session,'native_capabilities',False),
                         'nativeCapabilities':getattr(session,'native_capabilities',False),
                         'terminal': getattr(session,'workspace_version',None)=='2',
                         'files':getattr(session,'workspace_version',None)=='2',
                         'dependencies':getattr(session,'workspace_version',None)=='2',
                         'network': 'none', 'automaticInputReplay': False}}


def handle_ui(session, record):
    """Caller routes reserved gateway UI here *never*. Ordinary UI only."""
    from .server import public_event
    if record.get('title') == 'pi-gateway-v1':
        raise ValueError('internal_ui_route_forbidden')
    if record.get('method')=='setStatus' and record.get('statusKey') in {'pi-skills-v1','pi-skill-audit-v1'}:
        value=decode(record.get('statusText',''))
        if not isinstance(value,dict) or len(encode(value))>131072:raise ValueError('skill_catalog_limit')
        if record['statusKey']=='pi-skills-v1':
            session.skills_catalog=value
            value_set(session,'skillsCatalog',value)
        else:
            audit=value_get(session,'skillsAudit',[])
            item={**value,'operationId':(session.active or session.identity)['operationId'],'generation':session.identity['generation']}
            audit.append(item)
            while len(audit)>200 or len(encode(audit))>131072:audit.pop(0)
            value_set(session,'skillsAudit',audit)
            session.broker.ledger.event(session,{'type':'skill_audit',**item})
        return
    method = record.get('method')
    if method not in {'select', 'confirm', 'input', 'editor', 'notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'}:
        return
    safe = public_event(record)
    safe['requestId'] = safe.pop('id', None)
    safe['operationId'] = (session.active or session.identity)['operationId']
    safe['generation'] = session.identity['generation']
    if record.get('title')=='pi-questionnaire-v1':
        from .questionnaire import request
        questionnaire=request(decode(record.get('placeholder','')))
        safe['questionnaire']=questionnaire
        safe['toolCallId']=questionnaire['toolCallId']
    if method in {'select', 'confirm', 'input', 'editor'}:
        if not isinstance(safe['requestId'], str) or len(encode(safe)) > 65536 or len(session.ui_pending)>=20 or len(encode(session.ui_pending))+len(encode(safe))>131072:
            raise ValueError('extension_ui_limit')
        session.ui_pending[safe['requestId']] = safe
    elif len(encode(safe))>16384:
        raise ValueError('extension_ui_limit')
    event=session.broker.ledger.event(session, {**safe,'type': 'workspace_ui'})
    if method not in {'select','confirm','input','editor'}:
        effect={**safe,'effectId':'ui-'+str(event['eventSeq']),'eventSeq':event['eventSeq']}
        effects=value_get(session,'uiEffects',[])
        effects.append(effect)
        while len(effects)>40 or len(encode(effects))>131072:effects.pop(0)
        value_set(session,'uiEffects',effects)


def observe_event(session, record):
    """Only an actual user message proves a queued control was consumed."""
    if record.get('type') != 'message_start' or record.get('message', {}).get('role') != 'user':
        return
    content = record['message'].get('content', '')
    text = content if isinstance(content, str) else '\n'.join(item.get('text', '') for item in content if isinstance(item, dict) and item.get('type') == 'text')
    with session.lock:
        for control_id, message in list(session.queued_controls.items()):
            if message == text:
                session.queued_controls.pop(control_id)
                control_update(session, control_id, 'completed', {'disposition': 'processed'})
                break


def observe_bash(session,record):
    control_id=getattr(session,'bash_control',None)
    if not control_id or record.get('id')!='workspace-bash:'+control_id or not isinstance(record.get('delta'),str):return
    with session.lock:
        run=session.bash_runs.get(control_id)
        if not run:return
        data=record['delta']
        run['totalOutputBytes']+=len(data.encode('utf-8'))
        if len(data.encode('utf-8'))>131072:
            data=data.encode('utf-8')[-131072:].decode('utf-8',errors='ignore');run['hasGap']=True
        run['lastOutputSeq']+=1
        run['output'].append({'seq':run['lastOutputSeq'],'data':data})
        run['bytes']+=len(data.encode('utf-8'))
        while run['bytes']>131072 and run['output']:
            run['bytes']-=len(run['output'].pop(0)['data'].encode('utf-8'));run['hasGap']=True
        run['firstOutputSeq']=run['output'][0]['seq'] if run['output'] else run['lastOutputSeq']+1
    # The live buffer is bounded and public. Durable final result is the control
    # receipt; streaming shell output is not copied without bound into SQLite.


def cancel_queues(session):
    with session.lock:
        for control_id in list(session.queued_controls):
            control_update(session, control_id, 'completed', {'disposition': 'canceled'})
        session.queued_controls.clear()
        proc=session.proc
        cancelled=list(session.ui_pending)
        session.ui_pending.clear()
        for key in ('pendingModel','pendingThinking','pendingSkillsReload'):
            pending=value_get(session,key)
            if pending:
                control_update(session,pending['controlId'],'completed',{'disposition':'canceled'})
                value_set(session,key,None)
                session.pending_model_gateways.pop(pending['controlId'],None)
    if proc is not None:
        for request_id in cancelled:
            session.write({'type': 'extension_ui_response', 'id': request_id, 'cancelled': True},expected_proc=proc)


def checked_rpc(session, name, payload=None, timeout=30,rpc_id=None):
    result = session.rpc(name, payload or {}, timeout=timeout,rpc_id=rpc_id)
    if not result.get('success'):
        # Arbitrary Pi error strings can contain private paths/content.
        raise Rejected('pi_control_rejected')
    return result.get('data', {})


def public_tree(value):
    """Project only navigation metadata and bounded public text previews."""
    count=[0]
    def node(item):
        count[0]+=1
        if count[0]>500:return None
        entry=item.get('entry',{})
        message=entry.get('message',{})
        content=message.get('content','')
        text=content if isinstance(content,str) else '\n'.join(part.get('text','') for part in content if isinstance(part,dict) and part.get('type')=='text') if isinstance(content,list) else ''
        result={'entry':{key:entry[key] for key in ('id','parentId','type','timestamp') if key in entry},'children':[]}
        if message:result['entry']['message']={'role':message.get('role'),'text':text[:256]}
        for child in item.get('children',[]):
            projected=node(child)
            if projected is None:break
            result['children'].append(projected)
        return result
    tree=[]
    for item in value.get('tree',[]):
        projected=node(item)
        if projected is None:break
        tree.append(projected)
    return {'tree':tree,'leafId':value.get('leafId'),'truncated':count[0]>500}


def thinking_state(session):
    state=getattr(session,'pi_state',{})
    return {'requested':value_get(session,'requestedThinking',state.get('thinkingLevel')),
            'effective':state.get('thinkingLevel'),'pending':value_get(session,'pendingThinking'),
            'supported':getattr(session,'supported_thinking_levels',[])}


def apply_pending(session):
    """Apply only while Pi and its actual process tree are at a safe point."""
    with session.metadata_lock:return _apply_pending(session)


def _apply_pending(session):
    if session.phase not in IDLE:return
    if any(t.status=='running' for t in session.terminals.values()) or getattr(session,'bash_control',None):return
    if any(value_get(session,key) for key in ('pendingModel','pendingThinking','pendingSkillsReload')):
        if set(session.broker.process_inventory(session))-set(getattr(session,'baseline_processes',[])):return
        if any(item['status'] in {'active','unknown'} for item in activities(session)):return
    pending=value_get(session,'pendingModel')
    if pending:
        gateway=session.pending_model_gateways.pop(pending['controlId'],None)
        if gateway is None:
            value_set(session,'pendingModel',None)
            control_update(session,pending['controlId'],'failed',error='pending_model_binding_expired')
            return
        try:session.bind(gateway,pending['model'])
        except ValueError as error:
            if str(error) not in {'thinking_level_requires_explicit_change','unsupported_thinking_level','invalid_thinking_levels'}:raise
            value_set(session,'pendingModel',None)
            control_update(session,pending['controlId'],'failed',error=str(error))
            return
        value_set(session,'pendingModel',None)
        control_update(session,pending['controlId'],'completed',{'effectiveModel':session.effective_model})
    pending=value_get(session,'pendingThinking')
    if pending:
        level=pending['level']
        if level not in getattr(session,'supported_thinking_levels',[]):
            control_update(session,pending['controlId'],'failed',error='unsupported_thinking_level')
            value_set(session,'pendingThinking',None)
            return
        checked_rpc(session,'set_thinking_level',{'level':level})
        state=register_session(session)
        if state.get('thinkingLevel')!=level:raise ValueError('thinking_readback_unknown')
        value_set(session,'pendingThinking',None)
        control_update(session,pending['controlId'],'completed',{'thinkingLevel':level})
    pending=value_get(session,'pendingSkillsReload')
    if pending:
        session.broker.update_skills(session,session.skill_version,[s['id'] for s in session.skills],force=True)
        value_set(session,'pendingSkillsReload',None)
        control_update(session,pending['controlId'],'completed',{'skills':getattr(session,'skills_catalog',{})})


def set_mode(session, supplied):
    from .admission import install
    with session.lock:fence=install(session,supplied)
    if fence['mode']=='execute':return {'admission':fence,'drained':True}
    if session.phase=='stopped':
        if session.broker.inspect(session)['State'].get('Running'):raise ValueError('mode_stopped_identity_unknown')
        if any(a['status'] in {'active','unknown'} for a in activities(session)):raise ValueError('mode_activity_unknown')
        session.local_calls.clear()
        return {'admission':fence,'drained':True,'localCalls':0,'stoppedVerified':True}
    # The persisted fence precedes every effect. A failed stop remains fenced.
    checked_rpc(session,'clear_queue')
    cancel_queues(session)
    close_terminals(session)
    if getattr(session,'bash_control',None):checked_rpc(session,'abort_bash')
    if session.phase in BUSY:
        checked_rpc(session,'abort',timeout=20)
        deadline=time.monotonic()+20
        while session.phase in BUSY and time.monotonic()<deadline:time.sleep(.05)
        if session.phase not in IDLE:raise ValueError('mode_drain_unknown')
    deadline=time.monotonic()+20
    while getattr(session,'executing_controls',set()) and time.monotonic()<deadline:
        close_terminals(session)
        if getattr(session,'bash_control',None):checked_rpc(session,'abort_bash')
        time.sleep(.05)
    if getattr(session,'executing_controls',set()):raise ValueError('mode_control_drain_unknown')
    current=set(session.broker.process_inventory(session))
    baseline=set(getattr(session,'baseline_processes',[]))
    if current-baseline:raise ValueError('mode_background_processes_unknown')
    if any(a['status'] in {'active','unknown'} for a in activities(session)):raise ValueError('mode_activity_unknown')
    # These are actual settled/exit facts; no synthetic tool-complete event.
    session.local_calls.clear()
    return {'admission':fence,'drained':True,'localCalls':0}


def execute_control(session, job, control_id, command, payload):
    from .server import public_event
    if session.phase in {'unknown', 'frozen', 'freezing', 'disposed'}:
        raise Rejected('workspace_unknown_fenced')
    if session.phase in {'creating','updating'}:raise Rejected('workspace_busy')
    if getattr(session,'workspace_maintenance',False):raise Rejected('workspace_busy')
    from .admission import check
    supplied=payload.pop('admission',None) if command!='mode_set' else None
    if command=='mode_set':return set_mode(session,payload.get('admission'))
    execution={'bash','terminal_create','terminal_input','file_write','file_delete','file_mkdir','file_rename','resource_install','resource_remove','export_html'}
    try:check(session,supplied,execute=command in execution)
    except ValueError as error:raise Rejected(str(error)) from error
    if getattr(session,'resource_installing',None) not in {None,control_id} and command not in READ:
        raise Rejected('workspace_busy')
    leases=activities(session)
    if any(item['status']=='active' for item in leases) and command not in READ and not (command=='resource_install' and any(item['activityId']==control_id and item['status']=='active' for item in leases)):
        raise Rejected('workspace_busy')
    if getattr(session,'workspace_version',None)!='2' and (command.startswith(('file_','terminal_')) or command in {'resource_install','export_html'}):
        raise Rejected('workspace_image_upgrade_required')
    if command == 'session_navigate':
        raise Rejected('unsupported_pi_version')
    if command == 'wake':
        if session.phase == 'stopped':
            try:session.start()
            except ValueError as error:
                if str(error)!='workspace_native_image_upgrade_required':raise
                raise Rejected(str(error)) from error
            session.phase = 'idle'
            session.broker.save_session(session)
        return {'containerId': session.container_id, 'image': session.image, 'generation': session.identity['generation']}
    if command == 'pause':
        if session.phase not in IDLE:
            raise Rejected('workspace_busy')
        close_terminals(session)
        session.broker.inspect(session)
        with session.lock:
            proc, session.proc = session.proc, None
        if proc:
            proc.stdin.close()
            proc.wait(timeout=15)
        meta = decode(session.broker.docker_command(['inspect', session.container]))[0]
        if meta['Id'] != session.container_id or meta['State']['Running']:
            raise ValueError('pause_outcome_unknown')
        session.phase = 'stopped'
        session.broker.save_session(session)
        return {'containerId': session.container_id, 'stoppedVerified': True}
    if session.phase == 'stopped':
        raise Rejected('workspace_paused')
    if command in {'steer', 'follow_up'}:
        message = payload.get('message')
        if session.phase not in BUSY or session.revoked:
            raise Rejected('operation_not_active')
        if not isinstance(message, str) or not 1 <= len(message.encode()) <= 262144 or message.lstrip().startswith(('/runner-bind', '/reload')):
            raise Rejected('invalid_queued_message')
        with session.lock:
            session.queued_controls[control_id] = message
        result = checked_rpc(session, command, {'message': message})
        with session.lock:
            if result.get('disposition') == 'handled':
                session.queued_controls.pop(control_id, None)
            return result
    if command == 'clear_queue':
        result = checked_rpc(session, 'clear_queue')
        cancel_queues(session)
        return result
    if command == 'ui_response':
        request_id = payload.get('requestId')
        request = session.ui_pending.get(request_id)
        if not request or request.get('operationId') != (session.active or session.identity)['operationId']:
            raise Rejected('ui_request_unavailable')
        response = {key: payload[key] for key in ('value', 'confirmed', 'cancelled') if key in payload}
        if len(response) != 1 or (request['method'] == 'confirm' and 'cancelled' not in response and type(response.get('confirmed')) is not bool) or (request['method'] != 'confirm' and 'cancelled' not in response and (not isinstance(response.get('value'), str) or len(response['value'].encode()) > 65536)):
            raise Rejected('invalid_ui_response')
        if 'cancelled' in response and response['cancelled'] is not True:
            raise Rejected('invalid_ui_response')
        if request['method'] == 'select' and 'value' in response and response['value'] not in request.get('options', []):
            raise Rejected('invalid_ui_selection')
        if request.get('questionnaire') and 'value' in response:
            from .questionnaire import answer
            try:answer(request['questionnaire'],decode(response['value']))
            except ValueError as error:raise Rejected(str(error)) from error
        session.write({'type': 'extension_ui_response', 'id': request_id, **response})
        session.ui_pending.pop(request_id)
        return {'requestId': request_id, 'responded': True}
    if command.startswith('terminal_'):
        if command == 'terminal_create':
            if len([t for t in session.terminals.values() if t.status == 'running']) >= 4:
                raise Rejected('terminal_limit')
            for key in list(session.terminals):
                if len(session.terminals)<8:break
                if session.terminals[key].status in {'closed','exited','unknown'}:
                    session.terminals.pop(key)
            if len(session.terminals)>=8:raise Rejected('terminal_retention_limit')
            cols, rows = payload.get('cols', 100), payload.get('rows', 30)
            if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 500 or not 2 <= rows <= 300:
                raise Rejected('invalid_terminal_size')
            terminal_id = 'pty-' + uuid.uuid4().hex
            terminal = Terminal(session, terminal_id, cols, rows)
            session.terminals[terminal_id] = terminal
            return {key:value for key,value in terminal.snapshot().items() if key not in {'output','acks'}}
        terminal = session.terminals.get(payload.get('terminalId'))
        if not terminal:
            raise Rejected('terminal_unavailable')
        if command == 'terminal_input':
            return terminal.input(payload)
        if command == 'terminal_resize':
            cols, rows = payload.get('cols'), payload.get('rows')
            if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 500 or not 2 <= rows <= 300:
                raise Rejected('invalid_terminal_size')
            terminal.acked({'type': 'resize', 'cols': cols, 'rows': rows})
            terminal.cols, terminal.rows = cols, rows
        else:
            terminal.close()
        return {key:value for key,value in terminal.snapshot().items() if key not in {'output','acks'}}
    if command.startswith('file_'):
        action = command.removeprefix('file_')
        allowed={'list':{'path'},'read':{'path','expectedSha256'},'download':{'path','expectedSha256'},
                 'write':{'path','expectedSha256','base64'},'delete':{'path','expectedSha256'},
                 'rename':{'path','target','expectedSha256'},'mkdir':{'path'}}[action]
        if set(payload)-allowed:raise Rejected('invalid_file_payload')
        request={**payload,'action': 'read' if action == 'download' else action}
        if action in {'write','delete','rename','mkdir'}:
            result=session.broker.workspace_mutate(session,request)
        else:
            result = decode(session.broker.docker_command(['exec', '--interactive', session.container, 'python3', '-I', '-B', '/opt/pi/workspace-files.py'], raw=encode(request)))
        if result.get('error'):
            raise Rejected(result['error'])
        if action in {'download', 'read'}:
            # Snapshot lives outside model-writable volume. A later download uses
            # this immutable ID and cannot silently pick up newly edited bytes.
            raw = base64.b64decode(result.pop('base64'), validate=True)
            registry = value_get(session, 'downloads', {})
            previous=next((item for item in registry.values() if item['path']==result['path'] and item['sha256']==result['sha256']),None)
            if previous:result['downloadId']=previous['downloadId']
            else:
                if len(registry)>=100 or sum(item['sizeBytes'] for item in registry.values())+len(raw)>session.broker.limits['workspaceBytes']:
                    raise Rejected('download_snapshot_limit')
                downloads = session.broker.state / 'workspace-downloads'
                downloads.mkdir(mode=0o700, exist_ok=True)
                snapshot_id = 'download-' + uuid.uuid4().hex
                with (downloads / snapshot_id).open('xb') as handle:
                    handle.write(raw)
                result['downloadId'] = snapshot_id
            result['editable']=False
            if action == 'read' and len(raw) <= 262144:
                try:
                    result['text'] = raw.decode('utf-8')
                    result['editable']=True
                except UnicodeDecodeError:
                    result['binary'] = True
            elif action=='read':result['previewOmitted']=True
            registry[result['downloadId']] = {key:value for key,value in result.items() if key!='text'}
            value_set(session, 'downloads', registry)
        return result
    if command in {'tree', 'stats'}:
        if command == 'stats':
            return public_event(checked_rpc(session, 'get_session_stats'))
        result = public_tree(checked_rpc(session, 'get_tree'))
        from .server import public_event
        session.fork_messages=public_event(checked_rpc(session,'get_fork_messages')).get('messages',[])[:500]
        result['forkMessages']=session.fork_messages
        session.public_tree = result
        register_session(session)
        return result
    if command == 'abort_bash':
        return checked_rpc(session, 'abort_bash')
    if command == 'bash':
        text = payload.get('command')
        if not isinstance(text, str) or not 1 <= len(text.encode()) <= 262144:
            raise Rejected('invalid_bash_command')
        exclude = payload.get('excludeFromContext', False)
        if text.startswith('!!'):
            text, exclude = text[2:].lstrip(), True
        elif text.startswith('!'):
            text, exclude = text[1:].lstrip(), False
        if type(exclude) is not bool or not text:
            raise Rejected('invalid_bash_command')
        if getattr(session, 'bash_control', None):
            raise Rejected('bash_busy')
        session.bash_control = control_id
        with session.lock:
            while len(session.bash_runs)>=2:session.bash_runs.pop(next(iter(session.bash_runs)))
            run={'controlId':control_id,'status':'running','output':[],'bytes':0,'firstOutputSeq':1,'lastOutputSeq':0,
                 'hasGap':False,'exitCode':None,'cancelled':False,'truncated':False,'excludeFromContext':exclude,
                 'operationId':job['operationId'],'generation':job['generation'],'totalOutputBytes':0}
            session.bash_runs[control_id]=run
        try:
            result = checked_rpc(session, 'bash', {'command': text, 'excludeFromContext': exclude}, timeout=86400,rpc_id='workspace-bash:'+control_id)
            with session.lock:
                # Pi 1.3's rolling buffer can discard early chunks before its
                # final truncateTail check and then report truncated=false.
                # Compare actual streamed bytes with its final public output;
                # retain the native flag separately instead of hiding omission.
                result={**result,'nativeTruncated':result.get('truncated',False),
                    'truncated':bool(result.get('truncated') or run['totalOutputBytes']>len(result.get('output','').encode('utf-8')))}
                run.update({'status':'completed','exitCode':result.get('exitCode'),'cancelled':result.get('cancelled',False),'truncated':result.get('truncated',False)})
            register_session(session)
            return {**public_event(result), 'excludeFromContext': exclude}
        except Exception:
            run['status']='unknown'
            raise
        finally:
            session.bash_control = None
    if command == 'compact':
        if session.phase not in IDLE or job['seq'] <= session.last_seq:
            raise Rejected('compact_requires_new_operation')
        timeout = payload.get('timeoutMs')
        if type(timeout) is not int or not 1 <= timeout <= 9007199254740991:
            raise Rejected('operation_timeout_required')
        session.phase, session.revoked, session.error = 'dispatching', False, None
        session.active, session.last_seq = job, job['seq']
        session.deadline = time.monotonic() + timeout / 1000
        session.files_collected, session.terminal_receipt = False, None
        session.broker.save_session(session)
        session.bind(payload.get('gateway'), payload.get('model'))
        session.before_files = {f['fileName']: f['sha256'] for f in session.broker.transfer(session, {'action': 'export'})['files']}
        try:
            result = checked_rpc(session, 'compact', {k: payload[k] for k in ('customInstructions',) if k in payload}, timeout=timeout / 1000)
        except Rejected:
            session.error='compact_rejected'
            session.broker.ledger.event(session,{'type':'compact_failed','controlId':control_id})
            session.complete()
            raise
        session.broker.ledger.event(session, {'type': 'compact_completed', 'controlId': control_id})
        session.complete()
        return public_event(result)
    if command=='skills_reload' and session.phase in BUSY:
        previous=value_get(session,'pendingSkillsReload')
        if previous:raise Rejected('skills_reload_pending')
        value_set(session,'pendingSkillsReload',{'controlId':control_id})
        return {'disposition':'queued','pendingSkillsReload':True}
    if command in {'model_set','thinking_set'} and session.phase in BUSY:
        if command=='model_set':
            previous=value_get(session,'pendingModel')
            if previous:
                control_update(session,previous['controlId'],'completed',{'disposition':'superseded'})
                session.pending_model_gateways.pop(previous['controlId'],None)
            session.pending_model_gateways[control_id]=payload.get('gateway')
            value_set(session,'pendingModel',{'controlId':control_id,'model':payload.get('model')})
            return {'disposition':'queued','pendingModel':True}
        level=payload.get('level')
        if level not in getattr(session,'supported_thinking_levels',[]):raise Rejected('unsupported_thinking_level')
        value_set(session,'requestedThinking',level)
        previous=value_get(session,'pendingThinking')
        if previous:control_update(session,previous['controlId'],'completed',{'disposition':'superseded'})
        value_set(session,'pendingThinking',{'controlId':control_id,'level':level})
        return {'disposition':'queued','pendingThinkingLevel':level}
    if session.phase not in IDLE:
        raise Rejected('workspace_busy')
    if command == 'upgrade':
        from .upgrade_linux import apply
        return apply(session,payload.get('planId'))
    if command == 'model_set':
        try:
            with session.metadata_lock:
                if session.phase not in IDLE:raise Rejected('workspace_busy')
                session.bind(payload.get('gateway'), payload.get('model'))
        except ValueError as error:
            if str(error) not in {'thinking_level_requires_explicit_change','unsupported_thinking_level','invalid_thinking_levels'}:raise
            raise Rejected(str(error)) from error
        return {'effectiveModel': session.effective_model}
    if command == 'thinking_set':
        level = payload.get('level')
        if level not in getattr(session,'supported_thinking_levels',[]):
            raise Rejected('unsupported_thinking_level')
        value_set(session,'requestedThinking',level)
        with session.metadata_lock:
            if session.phase not in IDLE:raise Rejected('workspace_busy')
            checked_rpc(session, 'set_thinking_level', {'level': level})
            state = register_session(session)
        if state['thinkingLevel'] != level:
            raise ValueError('thinking_readback_unknown')
        return {'thinkingLevel': level}
    if command=='skills_reload':
        # update_skills restarts only a fixed launcher and selected image bundle.
        with session.metadata_lock:
            if session.phase not in IDLE:raise Rejected('workspace_busy')
            session.broker.update_skills(session,session.skill_version,[s['id'] for s in session.skills],force=True)
        return {'skills':getattr(session,'skills_catalog',{})}
    if command in {'session_new', 'session_switch', 'session_fork', 'session_clone'}:
        register_session(session)
        if command == 'session_switch':
            path = value_get(session, 'sessions', {}).get(payload.get('sessionId'))
            if not path:
                raise Rejected('unregistered_session')
            result = checked_rpc(session, 'switch_session', {'sessionPath': path})
        elif command == 'session_fork':
            messages = checked_rpc(session, 'get_fork_messages').get('messages', [])
            if payload.get('entryId') not in {message['entryId'] for message in messages}:
                raise Rejected('unregistered_fork_entry')
            result = checked_rpc(session, 'fork', {'entryId': payload['entryId']})
        else:
            result = checked_rpc(session, {'session_new': 'new_session', 'session_clone': 'clone'}[command])
        state = register_session(session)
        session.public_tree = public_tree(checked_rpc(session, 'get_tree'))
        checked_rpc(session,'clear_queue');cancel_queues(session)
        return {**result, 'sessionId': state['sessionId'],'filesReverted':False,'businessReverted':False,'delegationsInherited':False}
    if command == 'export_html':
        path = '/workspace/outputs/session-' + control_id + '.html'
        # Exercise the pinned native exporter, but its full session JSON contains
        # private provider reasoning. Deliver an explicitly public projection.
        checked_rpc(session, 'export_html', {'outputPath': '/tmp/pi-export-' + uuid.uuid4().hex + '.html'})
        messages = public_event(checked_rpc(session, 'get_messages')).get('messages', [])
        document = '<!doctype html><meta charset="utf-8"><title>Pi session</title><h1>Pi session</h1>'
        for message in messages:
            document += '<h2>' + html.escape(str(message.get('role', 'message'))) + '</h2><pre>' + html.escape(encode(message).decode()) + '</pre>'
        data = document.encode('utf-8')
        execute_control(session, job, control_id, 'file_write', {'path':path.removeprefix('/workspace/'),
            'expectedSha256':None,'base64':base64.b64encode(data).decode()})
        return execute_control(session, job, control_id, 'file_download', {'path': path.removeprefix('/workspace/')})
    if command == 'resource_install':
        result = decode(session.broker.docker_command(['exec', '--interactive', session.container, 'python3', '-I', '-B', '/opt/pi/dependency-install.py'], raw=encode(payload), timeout=300))
        if result.get('error'):
            raise Rejected(result['error'])
        installed=value_get(session,'resources',[])
        installed.append(result)
        while len(installed)>20 or len(encode(installed))>131072:installed.pop(0)
        value_set(session,'resources',installed)
        return result
    if command in {'resource_remove', 'resource_reload'}:
        raise Rejected('reviewed_resources_required')
    raise Rejected('unsupported_workspace_command')


def dispatch(session, job):
    payload = job['payload']
    if payload.get('action') in {'activity_begin','activity_end'}:return activity_control(session,job)
    if payload.get('action') == 'state':
        return {**{key: job[key] for key in IDENTITY}, 'workspace': public_state(session, payload)}
    if payload.get('action')=='receipt':
        if set(payload)!={'action','controlId'} or not isinstance(payload['controlId'],str):raise Rejected('invalid_control_receipt')
        ledger=session.broker.ledger
        with ledger.lock:
            row=ledger.db.execute('SELECT 1 FROM workspace_controls WHERE workspace=? AND id=?',(session.key,payload['controlId'])).fetchone()
        if not row:raise Rejected('control_unavailable')
        return {**{key:job[key] for key in IDENTITY},'control':control_receipt(session,payload['controlId'])}
    if payload.get('action') == 'download':
        snapshot_id = payload.get('downloadId')
        meta = value_get(session, 'downloads', {}).get(snapshot_id)
        if not meta:
            raise Rejected('download_unavailable')
        raw = (session.broker.state / 'workspace-downloads' / snapshot_id).read_bytes()
        if hashlib.sha256(raw).hexdigest() != meta['sha256']:
            raise ValueError('download_snapshot_changed')
        return {**{key: job[key] for key in IDENTITY}, 'download': {**meta, 'base64': base64.b64encode(raw).decode('ascii')}}
    if set(payload) != {'action', 'controlId', 'controlSeq', 'command', 'payload'} or payload['action'] != 'control':
        raise Rejected('invalid_workspace_control')
    control_id, seq, command, args = (payload[key] for key in ('controlId', 'controlSeq', 'command', 'payload'))
    if (not isinstance(control_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', control_id) or type(seq) is not int or not 1 <= seq <= 9007199254740991
            or command not in COMMANDS or not isinstance(args, dict)):
        raise Rejected('invalid_workspace_control')
    digest = hashlib.sha256(encode(job)).hexdigest()
    ledger = session.broker.ledger
    cached_receipt=None
    with ledger.lock, ledger.db:
        row = ledger.db.execute('SELECT digest,id,seq,command,status,result FROM workspace_controls WHERE workspace=? AND id=?', (session.key, control_id)).fetchone()
        if row:
            if row[0] != digest:
                raise Rejected('control_payload_changed')
            cached_receipt = {'controlId':row[1],'controlSeq':row[2],'command':row[3],'status':row[4],**(decode(row[5]) if row[5] else {})}
        else:
            last = ledger.db.execute('SELECT COALESCE(MAX(seq),0) FROM workspace_controls WHERE workspace=?', (session.key,)).fetchone()[0]
            if seq <= last:raise Rejected('stale_control_sequence')
            ledger.db.execute('INSERT INTO workspace_controls VALUES (?,?,?,?,?,?,NULL)', (session.key, control_id, seq, digest, command, 'dispatching'))
    if cached_receipt is not None:
        return {**{key:job[key] for key in IDENTITY},'control':cached_receipt,'workspace':public_state(session)}
    def run():
        try:
            if set(args)-(FIELDS[command]|{'admission'}):raise Rejected('invalid_file_payload' if command.startswith('file_') else 'invalid_control_payload')
            if command in {'bash','terminal_create','terminal_input','file_write','file_delete','file_mkdir','file_rename','resource_install','resource_remove','export_html'}:
                from .admission import check
                with session.lock:
                    try:check(session,args.get('admission'),execute=True)
                    except ValueError as error:raise Rejected(str(error)) from error
                    if not hasattr(session,'executing_controls'):session.executing_controls=set()
                    session.executing_controls.add(control_id)
            if command=='resource_install':
                with session.lock:
                    if (session.phase not in IDLE or getattr(session,'resource_installing',None)
                            or any(t.status in {'starting','running'} for t in session.terminals.values())
                            or getattr(session,'bash_control',None)):
                        raise Rejected('workspace_busy')
                    session.resource_installing=control_id
            result = execute_control(session, job, control_id, command, args)
            status = 'queued' if result.get('disposition')=='queued' or command in {'steer', 'follow_up'} and result.get('disposition') != 'handled' else 'handled' if result.get('disposition') == 'handled' else 'completed'
            # The real message event can race ahead of the RPC response. Never
            # overwrite proof of consumption with the earlier queued receipt.
            with session.lock:
                if command in {'steer', 'follow_up'} and control_id not in session.queued_controls and status == 'queued':
                    return
                control_update(session, control_id, status, result)
            session.last_activity = time.monotonic()
        except Rejected as error:
            control_update(session, control_id, 'failed', error=str(error))
        except Exception:
            control_update(session, control_id, 'unknown', error='control_outcome_unknown')
            session.fail('control_outcome_unknown')
        finally:
            if getattr(session,'resource_installing',None)==control_id:session.resource_installing=None
            with session.lock:getattr(session,'executing_controls',set()).discard(control_id)
    if command in ASYNC:
        control_update(session, control_id, 'accepted')
        threading.Thread(target=run, daemon=True).start()
    else:
        run()
    receipt = control_receipt(session,control_id)
    return {**{key: job[key] for key in IDENTITY}, 'control': receipt, 'workspace': public_state(session)}
