"""Private subprocess startup only; explicit new logs and PID/command binding."""
import json,os,subprocess,sys,time
from ai_functional_environment import ROOT,OUT,SOURCE,PYTHON,environment,record,run
mode=sys.argv[1]
if mode=='finish-init':
    import psycopg
    with psycopg.connect(environment()['TERUISI_DJANGO_DATABASE_URL']) as db:
        actual=db.execute("SELECT host(inet_server_addr()),inet_server_port(),current_database(),current_user,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)").fetchone()
        assert actual==('127.0.0.1',55488,'functional_ai','functional_app',False)
    record('PG-RUNTIME-IDENTITY.json',dict(zip(['address','port','database','user','superuser'],actual)))
    record('INIT-FAILURE.json',{'failedStep':'non-superuser data_directory evidence query','error':'InsufficientPrivilege','priorSteps':'initdb, migration, grants completed','resolution':'query directory as admin; actual role/endpoint as runtime','reinitialized':False})
    run('seed',[PYTHON,SOURCE/'tests/ai-functional-seed.py'],environment(admin=True))
    print('Same private database ready, first failure retained')
elif mode in ('start','resume-services','runner-services'):
    import socket
    if mode=='start':
        assert not (ROOT/'processes.json').exists(),'existing process receipt retained'
        records=[]
    else:
        records=json.loads((ROOT/'processes.json').read_text())
        for port in [28444,28447]+([28446] if mode=='runner-services' else []):
            with socket.socket() as s:s.bind(('127.0.0.1',port))
    launches=[('reader',[PYTHON,SOURCE/'tests/ai-functional-service.py','28444']),('writer',[PYTHON,SOURCE/'tests/ai-functional-service.py','28447'])]
    if mode=='start':launches += [('provider',[PYTHON,SOURCE/'tests/ai-functional-provider.py']),('edge',['node',SOURCE/'tests/ai-functional-edge.mjs'])]
    if mode=='runner-services':launches += [('provider',[PYTHON,SOURCE/'tests/ai-functional-provider.py'])]
    for name,args in launches:
        if mode=='resume-services':name+='-r2'
        if mode=='runner-services':name+='-r3'
        log=(OUT/(name+'.log')).open('xb')
        proc=subprocess.Popen(list(map(str,args)),cwd=SOURCE,env=environment(),stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        records.append({'name':name,'pid':proc.pid,'args':list(map(str,args)),'startedAt':time.time()})
        (ROOT/'processes.json').write_text(json.dumps(records,indent=2))
        time.sleep(.5)
        if proc.poll() is not None:raise RuntimeError(name+' exited; preserve partial startup and inspect')
    record('PROCESS-LAUNCH'+('-R2' if mode=='resume-services' else '-R3' if mode=='runner-services' else '')+'.json',records)
    print('Private subprocesses started; readiness not yet asserted')
else:raise SystemExit('unknown action')
