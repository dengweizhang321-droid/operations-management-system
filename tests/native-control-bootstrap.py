"""Fresh private PostgreSQL installation. No production credentials or data."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from datetime import datetime, timezone

from native_control_import import entry

ROOT, SOURCE, EVIDENCE = entry.ROOT, entry.SOURCE, entry.EVIDENCE
RUNTIME = ROOT/'django'
sys.path.insert(0, str(SOURCE/'backend'))
from pandas_runner.key_file import dpapi


def encrypted(value):
    return dpapi(value.encode('utf-16-le'), protect=True).hex()


def plain(value):
    return dpapi(bytes.fromhex(value)).decode('utf-16-le')


def run(label, args, env=None):
    with (EVIDENCE/(label+'.log')).open('xb') as out:
        result = subprocess.run(list(map(str,args)), env=env or entry.environment(), cwd=SOURCE,
            stdout=out, stderr=subprocess.STDOUT, timeout=300, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(f'{label} failed with exit {result.returncode}; original log retained')


def credentials():
    folder = RUNTIME/'secrets'
    folder.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    core = {'version': 3, 'createdAt': stamp}
    for key in ['postgresSuperuser','databaseOwner','databaseReader','databaseWriter',
                'databaseFinanceReader','databaseFinanceWriter','djangoSecretKey','internalSecret']:
        core[key] = encrypted(secrets.token_hex(32))
    (folder/'credentials.dpapi.json').write_text(json.dumps(core), encoding='utf-8')
    domains = {'netshop':'Netshop','market':'Market','products':'Products','inventory':'Inventory',
               'workflow':'Workflow','customer-service':'CustomerService','access-control':'AccessControl',
               'erp-reference':'ErpReference','ai':'Ai','bi':'Bi'}
    for name, field in domains.items():
        data = {'version':1, 'createdAt':stamp, 'database'+field+'Reader': encrypted(secrets.token_hex(32))}
        if name != 'bi':
            data['database'+field+'Writer'] = encrypted(secrets.token_hex(32))
        if name == 'ai':
            data.update(modelEncryptionKey=encrypted(secrets.token_hex(32)), modelOriginAllowlist='')
        (folder/(name+'-credentials.dpapi.json')).write_text(json.dumps(data), encoding='utf-8')
    return core


def main():
    if sys.argv[1:] in (['--complete-schema'], ['--complete-schema-r2'], ['--complete-schema-r3']):
        import psycopg
        core=json.loads((RUNTIME/'secrets/credentials.dpapi.json').read_text())
        with psycopg.connect(host='127.0.0.1',port=25432,user='postgres',password=plain(core['postgresSuperuser']),dbname='teruisi_sales',autocommit=True) as db:
            actual=db.execute("SELECT current_setting('data_directory'),inet_server_port()").fetchone()
            assert Path(actual[0]).resolve()==(RUNTIME/'postgres-data').resolve() and actual[1]==25432
            db.execute('ALTER ROLE teruisi_ai_seal_writer NOLOGIN')
            if sys.argv[1:] == ['--complete-schema-r2']:
                from psycopg import sql
                # Initial empty installation only: earlier AI schema was created
                # by the ordinary owner, later protected schema by the installer.
                # Preserve dedicated key-owner objects and align only the former.
                assert not db.execute("SELECT 1 FROM django_migrations WHERE app='ai_assistant' AND name LIKE '0052%'").fetchone()
                moved=[]
                for name,kind in db.execute("SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relname LIKE 'ai\\_%%' ESCAPE '\\' AND r.rolname='teruisi_sales_owner' AND c.relkind IN ('r','S')").fetchall():
                    if kind=='S':continue  # Owned sequences follow their table.
                    db.execute(sql.SQL('ALTER TABLE {} OWNER TO postgres').format(sql.Identifier(name)))
                    moved.append(name)
                (EVIDENCE/'PRIVATE-AI-INSTALLER-OWNERSHIP.json').write_text(json.dumps({'reason':'fresh protected schema installer ownership alignment','tables':moved,'production':False},indent=2)+'\n')
        env=entry.environment()
        env.update(TERUISI_DJANGO_ENVIRONMENT='test',DJANGO_SECRET_KEY=plain(core['djangoSecretKey']),
            TERUISI_DJANGO_INTERNAL_SECRET=plain(core['internalSecret']),TERUISI_DJANGO_PROCESS_ROLE='migration_writer')
        env['TERUISI_DJANGO_DATABASE_URL']='postgresql://postgres:'+plain(core['postgresSuperuser'])+'@127.0.0.1:25432/teruisi_sales'
        label='bootstrap-protected-ai-schema'+('' if sys.argv[1:] == ['--complete-schema'] else '-'+sys.argv[1].split('-')[-1])
        run(label, [RUNTIME/'venv/Scripts/python.exe',RUNTIME/'app/backend/manage.py','migrate','ai_assistant','0090','--noinput'],env)
        env['TERUISI_DJANGO_DATABASE_URL']='postgresql://teruisi_sales_owner:'+plain(core['databaseOwner'])+'@127.0.0.1:25432/teruisi_sales'
        run('bootstrap-ordinary-schema', [RUNTIME/'venv/Scripts/python.exe',RUNTIME/'app/backend/manage.py','migrate','--noinput'],env)
        (EVIDENCE/'BOOTSTRAP.json').write_text(json.dumps({'status':'schema_installed','database':'teruisi_sales','port':25432,
            'syntheticHistoricalPreconditions':True,'historicalMigrationExecuted':False,'schemaMigrationsExecuted':True,
            'runtimeRolesSuperuser':False,'protectedAiSchemaInstaller':'private postgres administrator',
            'originalFailedAttempt':'bootstrap-migrate.log'},indent=2)+'\n',encoding='utf-8')
        print('Private protected and ordinary schema installed; readiness fixtures pending')
        return
    if (RUNTIME/'postgres-data').exists() or (RUNTIME/'secrets/credentials.dpapi.json').exists():
        raise RuntimeError('Existing bootstrap state retained; do not replay initialization')
    core = credentials()
    pg = RUNTIME/'postgresql-17.11/bin'
    password_file = RUNTIME/'secrets/initdb-password.tmp'
    password_file.write_text(plain(core['postgresSuperuser']), encoding='utf-8')
    try:
        run('bootstrap-initdb', [pg/'initdb.exe','-D',RUNTIME/'postgres-data','-U','postgres',
            '--pwfile='+str(password_file),'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C'])
    finally:
        password_file.unlink(missing_ok=True)
    with (RUNTIME/'postgres-data/postgresql.conf').open('a', encoding='utf-8') as config:
        config.write("\nlisten_addresses='127.0.0.1'\nport=25432\nmax_connections=160\npassword_encryption='scram-sha-256'\n")
    run('bootstrap-pg-start', [pg/'pg_ctl.exe','start','-D',RUNTIME/'postgres-data','-l',ROOT/'logs/bootstrap-postgres.log','-w','-t','30'])
    import psycopg
    from psycopg import sql
    with psycopg.connect(host='127.0.0.1',port=25432,user='postgres',password=plain(core['postgresSuperuser']),dbname='postgres',autocommit=True) as db:
        actual=db.execute("SELECT current_setting('data_directory'),inet_server_port()").fetchone()
        assert Path(actual[0]).resolve()==(RUNTIME/'postgres-data').resolve() and actual[1]==25432
        role_passwords={'teruisi_sales_owner':plain(core['databaseOwner']), 'teruisi_sales_reader':plain(core['databaseReader']),
            'teruisi_sales_writer':plain(core['databaseWriter']), 'teruisi_finance_reader':plain(core['databaseFinanceReader']),
            'teruisi_finance_writer':plain(core['databaseFinanceWriter'])}
        for file in (RUNTIME/'secrets').glob('*-credentials.dpapi.json'):
            values=json.loads(file.read_text())
            domain=file.name.removesuffix('-credentials.dpapi.json').replace('-','_')
            for key,value in values.items():
                if key.startswith('database'):
                    role_passwords['teruisi_'+domain+('_reader' if key.endswith('Reader') else '_writer')]=plain(value)
        role_passwords['teruisi_ai_seal_writer']=secrets.token_hex(32)
        for role,password in role_passwords.items():
            db.execute(sql.SQL('CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
        db.execute('CREATE DATABASE teruisi_sales OWNER teruisi_sales_owner')
    env=entry.environment()
    env.update(TERUISI_DJANGO_DATABASE_URL='postgresql://teruisi_sales_owner:'+plain(core['databaseOwner'])+'@127.0.0.1:25432/teruisi_sales',
        TERUISI_DJANGO_ENVIRONMENT='test',DJANGO_SECRET_KEY=plain(core['djangoSecretKey']),
        TERUISI_DJANGO_INTERNAL_SECRET=plain(core['internalSecret']),TERUISI_DJANGO_PROCESS_ROLE='migration_writer')
    run('bootstrap-migrate', [RUNTIME/'venv/Scripts/python.exe', RUNTIME/'app/backend/manage.py','migrate','--noinput'],env)
    (EVIDENCE/'BOOTSTRAP.json').write_text(json.dumps({'status':'schema_installed','database':'teruisi_sales',
        'port':25432,'syntheticHistoricalPreconditions':True,'historicalMigrationExecuted':False,
        'schemaMigrationsExecuted':True,'runtimeRolesSuperuser':False},indent=2)+'\n',encoding='utf-8')
    print('Private PostgreSQL schema installed; readiness fixtures still pending')


if __name__=='__main__':main()
