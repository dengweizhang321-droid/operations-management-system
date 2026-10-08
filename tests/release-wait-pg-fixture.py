"""Two disposable PostgreSQL clusters for release timing. No production input."""
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
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import postgres_no_key_backup
BIN=Path(r'D:\teruisi-runtime\django-sales\postgresql-17.11\bin')

def free_port():
    for port in range(55870,55999):
        with socket.socket() as s:
            try:s.bind(('127.0.0.1',port));return port
            except OSError:pass
    raise RuntimeError('No isolated port')
def native(args,env=None):
    subprocess.run(args,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120)
def start(root):
    root.mkdir(parents=True,exist_ok=False)
    secret=secrets.token_hex(24)
    pw=root/'pw.tmp';pw.write_text(secret,encoding='ascii')
    native([str(BIN/'initdb.exe'),'-D',str(root/'data'),'--username=postgres','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile',str(pw),'--encoding=UTF8','--locale=C'])
    pw.unlink();port=free_port()
    native([str(BIN/'pg_ctl.exe'),'start','-D',str(root/'data'),'-l',str(root/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port}','-w'])
    return {'port':port,'password':secret,'root':str(root)}
def connect(state):
    if not 55870<=state['port']<=55999:raise RuntimeError('Unsafe test port')
    return psycopg.connect(host='127.0.0.1',port=state['port'],user='postgres',password=state['password'],dbname='postgres',autocommit=True)
def env_for(state):
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1',PGPORT=str(state['port']),PGUSER='postgres',PGPASSWORD=state['password'],PGDATABASE='postgres')
    return env
def content(state):
    with connect(state) as db:
        rows=db.execute('SELECT id,label FROM test_fixture ORDER BY id').fetchall()
        postgres_no_key_backup.sequence_health(db)
    return hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()
def stop(state):
    root=Path(state['root']).resolve()
    if not root.name.startswith('cluster-') or 'release-wait' not in str(root.parent):raise RuntimeError('Unsafe cluster cleanup')
    native([str(BIN/'pg_ctl.exe'),'stop','-D',str(root/'data'),'-m','fast','-w'])
    import shutil
    shutil.rmtree(root/'data')
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['init','backup','restore','close']);parser.add_argument('root');args=parser.parse_args()
    root=Path(args.root).resolve()
    if 'release-wait' not in str(root) or root.drive.upper() not in ['D:','E:']:raise RuntimeError('Require explicit isolated artifact root')
    state_file=root/'fixture-private.json'
    if args.action=='init':
        source=start(root/'cluster-source')
        try:
            with connect(source) as db:
                db.execute('CREATE TABLE test_fixture(id bigserial PRIMARY KEY,label text NOT NULL)')
                db.execute("INSERT INTO test_fixture(label) SELECT repeat('synthetic-',20) FROM generate_series(1,5000)")
            state_file.write_text(json.dumps({'source':source,'expected':content(source),'restoreCount':0}),encoding='ascii')
        except Exception:
            stop(source)
            raise
        print(json.dumps({'status':'initialized','rows':5000,'productionWrites':False}));return
    state=json.loads(state_file.read_text())
    if args.action=='backup':
        target=root/'point.dump'
        native([str(BIN/'pg_dump.exe'),'-Fc','--file',str(target)],env_for(state['source']))
        state['dumpSha256']=hashlib.sha256(target.read_bytes()).hexdigest();state_file.write_text(json.dumps(state),encoding='ascii')
        print(json.dumps({'status':'passed','dumpSha256':state['dumpSha256'],'bytes':target.stat().st_size}));return
    if args.action=='restore':
        if hashlib.sha256((root/'point.dump').read_bytes()).hexdigest()!=state['dumpSha256']:raise RuntimeError('Fixture dump changed')
        state['restoreCount']+=1
        target=start(root/f"cluster-restore-{state['restoreCount']}")
        try:
            native([str(BIN/'pg_restore.exe'),'--single-transaction','--no-owner','--no-privileges','--dbname=postgres',str(root/'point.dump')],env_for(target))
            if content(target)!=state['expected']:raise RuntimeError('Fixture restore content differs')
        finally:stop(target)
        state_file.write_text(json.dumps(state),encoding='ascii');print(json.dumps({'status':'passed','contentEqual':True,'sequenceHealthVerified':True,'isolatedCleanup':True}));return
    stop(state['source']);state_file.unlink();print(json.dumps({'status':'closed','productionWrites':False}))
if __name__=='__main__':main()
