"""Private PostgreSQL row-lock proof. No real HTTP, provider, Runner or production."""
import os
import json
import secrets
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from unittest.mock import patch
from contextlib import contextmanager

ROOT = Path('D:/worktrees/pi-phase1-closeout-20261018')
OUT = Path('D:/codex-artifacts/pi-phase1-closeout-20261018/review')
TMP = OUT / ('pg-proof-' + uuid.uuid4().hex[:10])
TMP.mkdir(parents=True)
BIN = Path('D:/teruisi-runtime/django-sales/postgresql-17.11/bin')
PORT = 55547
with socket.socket() as sock:
    sock.bind(('127.0.0.1', PORT))
password = secrets.token_hex(32)
pw = TMP / 'password'
pw.write_text(password)
env = {k: v for k, v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE'}}
env.update(PGHOST='127.0.0.1', PGPORT=str(PORT), PGUSER='pi_review_fixture', PGPASSWORD=password, PGDATABASE='postgres')
def command(args, label):
    with (TMP / (label + '.log')).open('wb') as log:
        result = subprocess.run([str(v) for v in args], env=env, stdout=log, stderr=log, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(label + ' failed; see private log')
started = False
evidence = {'port': PORT, 'productionTouched': False, 'database': 'private minimal-schema PostgreSQL', 'networkAndRunner': 'not used', 'cases': []}
try:
    command([BIN/'initdb.exe','-D',TMP/'data','-U','pi_review_fixture','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile',pw], 'init')
    with (TMP/'data/postgresql.conf').open('a') as file:
        file.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=15\nshared_buffers=16MB\n")
    command([BIN/'pg_ctl.exe','-D',TMP/'data','-l',TMP/'postgres.log','-w','-t','30','start'], 'start')
    started = True
    for key in list(os.environ):
        if key.startswith(('TERUISI_DJANGO_', 'PI_', 'AI_')) or key in {'DJANGO_SETTINGS_MODULE','DJANGO_SECRET_KEY','DJANGO_DEBUG'}:
            os.environ.pop(key, None)
    os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test', TERUISI_DJANGO_PROCESS_ROLE='development', DJANGO_SETTINGS_MODULE='teruisi_backend.settings', TERUISI_DJANGO_DATABASE_URL=f'postgresql://pi_review_fixture:{password}@127.0.0.1:{PORT}/postgres', AI_SECRET_ENCRYPTION_KEY='synthetic-private-review-key-123456789012345678901234567890')
    os.environ.update(DJANGO_SECRET_KEY=secrets.token_hex(32), TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32))
    sys.path.insert(0, str(ROOT/'backend'))
    import django
    django.setup()
    from django.db import connection, connections
    from ai_assistant import models as m, pi_gateway as gateway, pi_service as service, pi_exports, pi_worker as worker
    from ai_assistant.control_models import AiDataRevision, AiWriteAuthority
    from ai_assistant.pi_models import PI_MODELS, PiDispatch, PiOperation, PiExport, PiSession, PiFile
    from access_control.models import AccessRole, AppUser
    from ai_assistant.test_pi_runtime import PiRuntimeTests
    from ai_assistant.policy import mutation, canonical
    assert connection.vendor == 'postgresql' and int(connection.settings_dict['PORT']) == PORT
    with connection.schema_editor() as editor:
        for model in [AiDataRevision,AiWriteAuthority,AccessRole,AppUser,m.AiModels,*PI_MODELS]:
            editor.create_model(model)
    test = PiRuntimeTests()
    test.setUp()
    def wait(event):
        assert event.wait(10), 'private barrier timed out'
    def spawn(function):
        outcome = {}
        def run():
            try:
                outcome['value'] = function()
            except Exception as error:
                outcome['error'] = type(error).__name__
                outcome['code'] = getattr(error, 'code', '')
            finally:
                connections.close_all()
        thread = threading.Thread(target=run)
        thread.start()
        return thread, outcome
    def join(thread):
        thread.join(15)
        assert not thread.is_alive(), 'private thread failed to finish'
    def export(op, actor):
        record = pi_exports.consumer({'operation':'pi-export-start','sessionId':op.session_id,'dataset':'pi_netshop_promotion','queryJson':canonical({'platform':'京东','shop':'合成店','limit':20})}, actor, 'review-export')
        return PiExport.objects.get(pk=record['id'])
    def page(*args, **kwargs):
        return {'source':{'domain':'netshop'},'dataCutoffDate':'2026-10-16','data':{'items':[{'id':1}],'sourceRevision':'fixture-v1','units':{'id':'identifier'},'pagination':{'page':1,'pageSize':20,'total':1,'returned':1,'hasMore':False},'filtersApplied':{'platforms':['京东'],'shop':'合成店'}}}

    # Stop holds the real authority row; dispatch must wait, then see committed cancellation.
    op, token = test.running()
    stop_locked, release_stop, dispatch_entered = threading.Event(), threading.Event(), threading.Event()
    def stop_first():
        with mutation():
            service.abort(op.session_id, {'clientRequestId':'review-lock-stop'}, test.owner)
            stop_locked.set()
            wait(release_stop)
    original_mutation = gateway.mutation
    @contextmanager
    def observed_mutation(*args, **kwargs):
        dispatch_entered.set()
        with original_mutation(*args, **kwargs):
            yield
    stopper, stopped = spawn(stop_first)
    wait(stop_locked)
    with patch.object(gateway, 'mutation', observed_mutation), patch.object(gateway, '_tool') as tool:
        dispatcher, dispatched = spawn(lambda: gateway.execute(test.request(op,token,kind='tool',name='synthetic_read',args={}), secrets.token_hex(16)))
        wait(dispatch_entered)
        time.sleep(.2)
        assert dispatcher.is_alive() and not tool.called
        release_stop.set()
        join(stopper); join(dispatcher)
        assert not tool.called
    assert 'error' not in stopped and dispatched['code'] == 'pi_operation_canceled'
    assert not PiDispatch.objects.filter(operation=op,kind='tool').exists()
    evidence['cases'].append({'case':'stop commit before admission','newDispatches':0,'actualToolCalls':0,'result':dispatched['code']})

    # Admission commits before slow read; stop can commit while that read runs.
    op, token = test.running()
    read_started, release_read = threading.Event(), threading.Event()
    entry = {'name':'synthetic_read','risk':'read_only'}
    def slow_read(*args, **kwargs):
        read_started.set(); wait(release_read)
        return {'data':{'rows':[1]},'auditStatus':'recorded'}
    with patch.object(gateway,'catalog',return_value=([entry],[entry])), patch.object(gateway.transport,'execute_tool',side_effect=slow_read) as actual:
        dispatcher, dispatched = spawn(lambda:gateway.execute(test.request(op,token,kind='tool',name='synthetic_read',args={}),secrets.token_hex(16)))
        wait(read_started)
        service.abort(op.session_id,{'clientRequestId':'review-inflight-stop'},test.owner)
        assert PiOperation.objects.get(pk=op.pk).cancel_requested
        release_read.set(); join(dispatcher)
        assert actual.call_count == 1
    assert 'error' not in dispatched and PiDispatch.objects.get(operation=op,kind='tool').status == 'completed'
    evidence['cases'].append({'case':'admission first, known read returns after stop','actualToolCalls':1,'dispatchStatus':'completed','stopDidNotWaitForRead':True})

    actor = test.user('review-export@example.invalid','admin',None)
    # Final file publication owns the authority row before stop, so succeeded is retained.
    op, _ = test.running(actor=actor)
    row = export(op, actor)
    file_locked, release_file, stop_attempted = threading.Event(), threading.Event(), threading.Event()
    original_save = service.save_file
    def held_save(*args, **kwargs):
        file_locked.set(); wait(release_file)
        return original_save(*args, **kwargs)
    def delayed_stop():
        stop_attempted.set()
        return service.abort(op.session_id,{'clientRequestId':'review-file-first-stop'},actor)
    with patch.object(pi_exports.datasets,'query',side_effect=page), patch.object(service,'save_file',side_effect=held_save):
        exporter, exported = spawn(lambda:pi_exports.perform(row))
        wait(file_locked)
        stopper, stopped = spawn(delayed_stop)
        wait(stop_attempted); time.sleep(.2)
        assert stopper.is_alive()
        release_file.set(); join(exporter); join(stopper)
    assert 'error' not in exported and 'error' not in stopped
    row.refresh_from_db()
    assert row.status == 'succeeded' and row.file_id and PiFile.objects.filter(operation=op).count() == 1
    evidence['cases'].append({'case':'final publication commits before stop','exportStatus':row.status,'publishedFiles':1})

    # Stop commits before final publication; no complete file may appear.
    op, _ = test.running(actor=actor)
    row = export(op, actor)
    before_final, release_final = threading.Event(), threading.Event()
    original_digest = pi_exports.digest
    def hold_before_final(value):
        if isinstance(value,list):
            before_final.set(); wait(release_final)
        return original_digest(value)
    with patch.object(pi_exports.datasets,'query',side_effect=page), patch.object(pi_exports,'digest',side_effect=hold_before_final):
        exporter, exported = spawn(lambda:pi_exports.perform(row))
        wait(before_final)
        service.abort(op.session_id,{'clientRequestId':'review-stop-before-file'},actor)
        release_final.set(); join(exporter)
    assert 'error' not in exported
    row.refresh_from_db()
    assert (row.status,row.error_code,row.file_id)==('failed','pi_operation_canceled',None)
    assert not PiFile.objects.filter(operation=op).exists()
    evidence['cases'].append({'case':'stop commits before final publication','exportStatus':row.status,'errorCode':row.error_code,'publishedFiles':0})

    # A page returns after the canceled operation has settled and a new run owns the session.
    op, _ = test.running(actor=actor)
    row = export(op, actor)
    page_started, release_page = threading.Event(), threading.Event()
    def late_page(*args,**kwargs):
        page_started.set(); wait(release_page)
        return page()
    with patch.object(pi_exports.datasets,'query',side_effect=late_page) as reads:
        exporter, exported = spawn(lambda:pi_exports.perform(row))
        wait(page_started)
        service.abort(op.session_id,{'clientRequestId':'review-late-page-stop'},actor)
        worker.ingest(op,{'events':[{**worker.identity(op),'eventSeq':1,'type':'agent_settled'}]})
        assert worker.complete(op,{'status':'aborted','filesCollected':True,'files':[],'terminalReceipt':{'operationId':op.id,'status':'aborted','eventSeq':1,'files':[]}})
        next_record = test.prompt(op.session_id,actor=actor,clientRequestId='review-next-round')
        next_op = worker.claim()
        assert next_op.id == next_record['operation']['id']
        release_page.set(); join(exporter)
        assert reads.call_count == 1
    assert 'error' not in exported
    row.refresh_from_db()
    current_session = PiSession.objects.get(pk=op.session_id)
    assert (row.status,row.error_code,row.file_id)==('failed','pi_operation_canceled',None)
    assert PiOperation.objects.get(pk=next_op.pk).status == 'running'
    assert current_session.active_operation_id == next_op.id and current_session.status == 'running'
    assert not PiDispatch.objects.filter(operation=next_op,kind='control:freeze').exists()
    evidence['cases'].append({'case':'late page after canceled terminal and next run','pageReads':1,'futurePageReads':0,'exportStatus':'failed','nextRunStatus':'running','sameGeneration':op.generation==next_op.generation,'nextRunFrozen':False})
    evidence['passed'] = True
finally:
    try:
        from django.db import connections
        connections.close_all()
    except Exception:
        pass
    if started:
        command([BIN/'pg_ctl.exe','-D',TMP/'data','-m','fast','-w','-t','30','stop'], 'stop')
        evidence['privatePostgresStopped'] = True
    pw.unlink(missing_ok=True)
    (OUT/'pg-concurrency-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(evidence, ensure_ascii=True))
