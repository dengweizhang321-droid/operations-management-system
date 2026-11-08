"""Opt-in private functional environment. Never imports a production env file."""
from pathlib import Path
import base64, hashlib, ipaddress, json, os, secrets, socket, subprocess, sys

SOURCE = Path(__file__).resolve().parents[1]
ROOT = Path('D:/codex-isolated/ai-functional-20261108')
OUT = Path('D:/codex-artifacts/ai-isolated-functional-20261108')
PYTHON = Path('D:/codex-isolated/native-control-ai-20261108/django/venv/Scripts/python.exe')
PGBIN = Path('D:/codex-isolated/native-control-ai-20261108/django/postgresql-17.11/bin')
PORTS = {55488,28444,28445,28446,28447,28121,28123,28112}

def record(name, value):
    OUT.mkdir(parents=True,exist_ok=True)
    with (OUT/name).open('x',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False,indent=2,default=str)

def clean_environment():
    names = ['SystemRoot','WINDIR','ComSpec','PATHEXT','PATH','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','ProgramData']
    env = {n:os.environ[n] for n in names if n in os.environ}
    env.update(TEMP=str(ROOT/'scratch'),TMP=str(ROOT/'scratch'),HOME=str(ROOT/'home'),PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',PYTHONIOENCODING='utf-8',
      PYTHONPATH=str(SOURCE/'tests')+os.pathsep+str(SOURCE/'backend'),DJANGO_SETTINGS_MODULE='teruisi_backend.settings',DJANGO_DEBUG='false',DJANGO_ALLOWED_HOSTS='127.0.0.1,localhost',
      TERUISI_DJANGO_ENVIRONMENT='development',TERUISI_DJANGO_PROCESS_ROLE='development',TERUISI_LOCAL_DIRECT_ACCESS='false',AI_ALLOW_LOCAL_MODEL_ENDPOINTS='true',
      TERUISI_DJANGO_AI_EDGE_BASE_URL='http://127.0.0.1:28445',TERUISI_N8N_STATUS_DATABASE_PATH='',WRANGLER_SEND_METRICS='false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false',DO_NOT_TRACK='1',CI='true')
    return env

def keys():
    sys.path.insert(0,str(SOURCE/'backend'))
    from pandas_runner.key_file import dpapi
    encrypted=json.loads((ROOT/'private.dpapi.json').read_text())
    return json.loads(dpapi(base64.b64decode(encrypted['ciphertext'])).decode())

def environment(*,admin=False):
    k=keys(); env=clean_environment()
    env.update(DJANGO_SECRET_KEY=k['django'],TERUISI_DJANGO_INTERNAL_SECRET=k['internal'],AI_SECRET_ENCRYPTION_KEY=k['encryption'])
    role='postgres' if admin else 'functional_app'
    env['TERUISI_DJANGO_DATABASE_URL']=f"postgresql://{role}:{k[role]}@127.0.0.1:55488/functional_ai"
    runner=Path('D:/codex-isolated/native-control-ai-functional-runners-20261108')
    profile=runner/'isolation.json'
    if profile.exists():
        sha=hashlib.sha256(profile.read_bytes()).hexdigest()
        if sha!='e6d1584bfb7856386d1a11869772151b73063c4a12491cdd4c434aefb77ff7d0':raise RuntimeError('runner profile binding changed')
        env.update(TERUISI_NATIVE_ISOLATION_FILE=str(profile),TERUISI_NATIVE_ISOLATION_SHA256=sha,
          PI_RUNNER_HMAC_KEY_FILE=str(runner/'pi.dpapi.json'),TERUISI_PANDAS_RUNNER_KEY_FILE=str(runner/'pandas.dpapi.json'),
          TERUISI_PANDAS_RUNNER_IMAGE='sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580',PI_SKILL_VERSION='1.3.0')
    return env

def network_guard():
    """CPython audit gate: actual socket/DNS boundary, no business replacement."""
    def audit(event,args):
        if event=='socket.getaddrinfo':
            host,port=args[:2]
            if host not in ('127.0.0.1','localhost','::1') or int(port) not in PORTS:
                raise PermissionError('functional egress rejected: unlisted DNS/port')
        elif event=='socket.connect':
            address=args[1]
            if not isinstance(address,tuple) or len(address)<2:
                raise PermissionError('functional egress rejected: non-IP socket')
            local=address[0] in ('127.0.0.1','::1')
            if not local or int(address[1]) not in PORTS:
                raise PermissionError('functional egress rejected: unlisted endpoint')
    sys.addaudithook(audit)

def run(label,args,env,timeout=300):
    with (OUT/(label+'.log')).open('xb') as log:
        result=subprocess.run([str(a) for a in args],cwd=SOURCE,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode: raise RuntimeError(label+' failed; see preserved log')

def initialize():
    if ROOT.exists(): raise RuntimeError('private root exists; inspect, never replay init')
    for p in [ROOT,ROOT/'scratch',ROOT/'home',OUT]:p.mkdir(parents=True,exist_ok=True)
    for port in [55488,28444,28445,28446]:
        with socket.socket() as s:s.bind(('127.0.0.1',port))
    sid=subprocess.check_output(['powershell','-NoProfile','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],creationflags=subprocess.CREATE_NO_WINDOW).decode().strip()
    run('private-acl',['icacls',ROOT,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],clean_environment())
    sys.path.insert(0,str(SOURCE/'backend'))
    from pandas_runner.key_file import dpapi
    k={n:secrets.token_hex(32) for n in ['postgres','functional_app','django','internal','encryption']}
    (ROOT/'private.dpapi.json').write_text(json.dumps({'ciphertext':base64.b64encode(dpapi(json.dumps(k).encode(),protect=True)).decode()}))
    pw=ROOT/'scratch/init-password';pw.write_text(k['postgres'])
    env=environment(admin=True)
    try:run('initdb',[PGBIN/'initdb.exe','-D',ROOT/'pg','-U','postgres','--pwfile='+str(pw),'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],env)
    finally:pw.unlink(missing_ok=True)
    with (ROOT/'pg/postgresql.conf').open('a') as f:f.write("\nlisten_addresses='127.0.0.1'\nport=55488\nmax_connections=64\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
    run('pg-start',[PGBIN/'pg_ctl.exe','-D',ROOT/'pg','-l',ROOT/'postgres.log','-w','-t','30','start'],env)
    import psycopg
    from psycopg import sql
    with psycopg.connect(host='127.0.0.1',port=55488,user='postgres',password=k['postgres'],dbname='postgres',autocommit=True) as db:
        identity=db.execute("SELECT current_setting('data_directory'),inet_server_port(),current_database()").fetchone()
        assert Path(identity[0]).resolve()==(ROOT/'pg').resolve() and identity[1]==55488
        db.execute('CREATE DATABASE functional_ai')
        domains=['sales','finance','netshop','market','products','inventory','workflow','customer_service','access_control','erp_reference','ai','bi']
        roles=['teruisi_sales_owner','teruisi_ai_seal_writer']+[f'teruisi_{d}_{r}' for d in domains for r in ['reader','writer'] if not(d=='bi' and r=='writer')]
        for role in roles:db.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS').format(sql.Identifier(role)))
        db.execute(sql.SQL('CREATE ROLE functional_app LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS PASSWORD {}').format(sql.Literal(k['functional_app'])))
    with psycopg.connect(env['TERUISI_DJANGO_DATABASE_URL']) as db:
        target=db.execute("SELECT current_setting('data_directory'),inet_server_port(),current_database()").fetchone()
        assert Path(target[0]).resolve()==(ROOT/'pg').resolve() and target[1:]==(55488,'functional_ai')
    record('PG-IDENTITY.json',{'dataDirectory':target[0],'port':target[1],'database':target[2],'bootstrapDatabase':identity[2],'syntheticOnly':True,'source':str(SOURCE)})
    run('schema-migrate',[PYTHON,'-c',"from ai_functional_environment import network_guard; network_guard(); from django.core.management import execute_from_command_line; execute_from_command_line(['manage.py','migrate','--noinput'])"],env,600)
    with psycopg.connect(env['TERUISI_DJANGO_DATABASE_URL'],autocommit=True) as db:
        # Development-only role, not a claim about production SQL-role qualification.
        db.execute('GRANT CONNECT ON DATABASE functional_ai TO functional_app')
        db.execute('GRANT USAGE ON SCHEMA public TO functional_app')
        db.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO functional_app')
        db.execute('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO functional_app')
    with psycopg.connect(environment()['TERUISI_DJANGO_DATABASE_URL']) as db:
        actual=db.execute("SELECT host(inet_server_addr()),inet_server_port(),current_database(),current_user,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)").fetchone()
        assert actual==('127.0.0.1',55488,'functional_ai','functional_app',False)
    record('PG-RUNTIME-IDENTITY.json',dict(zip(['address','port','database','user','superuser'],actual)))
    record('ENVIRONMENT.json',{'ports':sorted(PORTS),'provider':'loopback HTTP fixture only','runtimeRole':'functional_app (non-superuser development)','normalLoginValidated':False,'localDirectAccess':False,'schemaMigrationExit':0})
    print('Private PostgreSQL/schema ready; secrets remain DPAPI-only')

if __name__=='__main__':
    if sys.argv[1:]!=['initialize']:raise SystemExit('explicit initialize required')
    initialize()
