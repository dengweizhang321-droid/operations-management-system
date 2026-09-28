"""Schema-only diagnostic in a new loopback cluster; never authorizes release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import psycopg
from psycopg import sql

ROOT=Path(__file__).resolve().parents[1]
BIN=Path(r'D:\teruisi-runtime\django-sales\postgresql-17.11\bin')
sys.path.insert(0,str(ROOT/'tools'))
import postgres_no_key_backup as profile


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--backup',type=Path,required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--port',type=int,required=True)
    args=parser.parse_args()
    if not 55440<=args.port<=55999: raise RuntimeError('isolated port required')
    manifest_path=args.backup/'backup-manifest.json'
    raw=manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=args.sha256: raise RuntimeError('manifest changed')
    manifest=json.loads(raw)
    archive=args.backup/'teruisi-sales.dump'
    expected=profile.read_manifest(manifest_path,args.sha256,archive,'teruisi_sales')
    with socket.socket() as listener: listener.bind(('127.0.0.1',args.port))
    root=Path(r'E:\TERUISI-Postgres-Rehearsals')/('catalog-diagnostic-'+secrets.token_hex(6))
    root.mkdir()
    for path in (root,*root.parents):
        if path.is_symlink() or getattr(path,'is_junction',lambda:False)(): raise RuntimeError('redirected root')
    password=secrets.token_hex(32)
    environment={k:v for k,v in os.environ.items() if not k.startswith(('PG','TERUISI_','DJANGO_'))}
    environment.update(PGHOST='127.0.0.1',PGPORT=str(args.port),PGUSER='postgres',PGPASSWORD=password,
        PGDATABASE='teruisi_sales',PYTHONUTF8='1')
    def native(command):
        log=root/('native-'+secrets.token_hex(4)+'.log')
        with log.open('wb') as output:
            result=subprocess.run([str(v) for v in command],env=environment,cwd=ROOT,stdout=output,
                stderr=output,timeout=600,creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode: raise RuntimeError('diagnostic native command failed; '+hashlib.sha256(log.read_bytes()).hexdigest())
    def connect(database='teruisi_sales'):
        return psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',password=password,
            dbname=database,autocommit=True)
    pw=root/'.temporary-db-credential';pw.write_text(password,encoding='ascii')
    data=root/'data';started=False
    print(json.dumps({'root':str(root),'productionWrites':False}),flush=True)
    try:
        native([BIN/'initdb.exe','-D',data,'-U','postgres','--auth=scram-sha-256','--locale=C','--encoding=UTF8','--pwfile',pw])
        pw.unlink()
        with (data/'postgresql.conf').open('a') as output:
            output.write(f"\nlisten_addresses='127.0.0.1'\nport={args.port}\nmax_connections=10\nmax_locks_per_transaction=256\n")
        native([BIN/'pg_ctl.exe','-D',data,'-l',root/'postgres.log','-w','-t','60','start']);started=True
        with connect('postgres') as db:
            profile.provision_restore_roles(db,expected['roles'],expected_database='teruisi_sales',expected_port=args.port)
            db.execute('CREATE DATABASE teruisi_sales OWNER teruisi_sales_owner')
            profile.apply_restore_role_settings(db,expected['roles'],'teruisi_sales')
        native([BIN/'pg_restore.exe','--schema-only','--dbname','teruisi_sales','--single-transaction','--exit-on-error',archive])
        native([BIN/'pg_restore.exe','--data-only','--table=django_migrations','--dbname','teruisi_sales','--single-transaction','--exit-on-error',archive])
        with connect() as db:
            db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
            actual=profile.collect(db,legacy_catalog="functionAttributes" not in expected['catalog'])
            result={'schemaOnly':True,'productionWrites':False,'roleContractEqual':actual['roles']==expected['roles'],
                'catalogDifferences':[key for key in expected['catalog'] if expected['catalog'][key]!=actual['catalog'].get(key)],
                'expectedCatalog':expected['catalog'],'actualCatalog':actual['catalog']}
            result['schemaAcl']=db.execute("SELECT nspname,pg_get_userbyid(nspowner),nspacl::text FROM pg_namespace WHERE nspname='public'").fetchall()
            result['defaultAcl']=db.execute("SELECT pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype,d.defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3").fetchall()
            result['extensions']=db.execute('SELECT extname,extversion,pg_get_userbyid(extowner) FROM pg_extension ORDER BY extname').fetchall()
            policies=db.execute('SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies ORDER BY 1,2,3').fetchall()
            from postgres_restore_semantics import normalize_dump_expression
            source_policies=json.loads(Path(r'E:\codex-artifacts\upstream-integration-20260927\production-rls-policy-catalog-20260928.json').read_text(encoding='utf-8-sig'))['policies']
            def normalized(rows):
                return [[*row[:6],*(normalize_dump_expression(value) if value is not None else None for value in row[6:])] for row in rows]
            result['sourcePoliciesBoundToBackup']=profile.digest(source_policies)==expected['catalog']['policies']
            result['normalizedPolicyDefinitionsEqual']=normalized(policies)==normalized(source_policies)
            result['policyRolesAndCommandsEqual']=[list(row[:6]) for row in policies]==[row[:6] for row in source_policies]
            db.execute('SAVEPOINT ordinary_revoke_probe')
            try:
                db.execute('SET LOCAL ROLE teruisi_sales_owner')
                db.execute('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM teruisi_sales_reader')
                result['ordinaryOwnerGlobalRevokeSqlstate']=None
            except psycopg.Error as error:
                result['ordinaryOwnerGlobalRevokeSqlstate']=error.sqlstate
            finally:
                db.execute('ROLLBACK TO SAVEPOINT ordinary_revoke_probe')
            db.execute('ROLLBACK')
        # Exercise the exact production grant block, including repeat startup,
        # under the ordinary owner in this disposable schema-only database.
        from django.conf import settings
        settings.configure(DATABASES={'default':{'ENGINE':'django.db.backends.postgresql',
            'HOST':'127.0.0.1','PORT':args.port,'NAME':'teruisi_sales',
            'USER':'postgres','PASSWORD':password}},INSTALLED_APPS=[])
        import django
        django.setup()
        from django.db import connection, transaction
        sys.path.insert(0,str(ROOT/'backend'))
        service=(ROOT/'tools/django-local-service.ps1').read_text(encoding='utf-8-sig')
        grant_code=service.split("    $grantCode = @'",1)[1].split("\n'@",1)[0]
        with transaction.atomic():
            with connection.cursor() as c:
                c.execute("SET LOCAL ROLE teruisi_sales_owner")
            exec(compile(grant_code,'production-runtime-grants','exec'),{})
            exec(compile(grant_code,'production-runtime-grants','exec'),{})
            result['ordinaryOwnerExactGrantBlockRepeated']=True
            with connection.cursor() as c:
                c.execute("RESET ROLE")
                c.execute("SELECT r.relname FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace "
                          "WHERE n.nspname='public' AND r.relkind='r' AND "
                          "r.relowner <> (SELECT oid FROM pg_roles WHERE rolname='teruisi_sales_owner') ORDER BY r.relname LIMIT 1")
                protected=c.fetchone()[0]
                c.execute(sql.SQL('GRANT SELECT ON public.{} TO teruisi_sales_reader').format(sql.Identifier(protected)))
                c.execute("SET LOCAL ROLE teruisi_sales_owner")
            try:
                exec(compile(grant_code,'production-runtime-grants-negative','exec'),{})
            except RuntimeError as error:
                if str(error) != 'Runtime role has unexpected access to a protected relation': raise
                result['unexpectedProtectedGrantRejected']=True
            else:
                raise AssertionError('protected access was silently accepted')
            transaction.set_rollback(True)
        connection.close()
        (root/'result.json').write_bytes(profile.canonical(result))
        print(json.dumps(result,ensure_ascii=True),flush=True)
    finally:
        pw.unlink(missing_ok=True)
        if started: native([BIN/'pg_ctl.exe','-D',data,'-m','fast','-w','-t','60','stop'])


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'failed','errorType':type(error).__name__,'errorSha256':hashlib.sha256(str(error).encode()).hexdigest()}))
        raise SystemExit(1)
