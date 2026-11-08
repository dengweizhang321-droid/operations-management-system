"""Prepare only private mutable bindings for the original Worker Deploy."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('native-control-bootstrap.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
core=json.loads((b.RUNTIME/'secrets/credentials.dpapi.json').read_text())
mutable=b.ROOT/'vars';mutable.mkdir(exist_ok=True)
persist=b.ROOT/'persist';persist.mkdir(exist_ok=True)
source_db=persist/'native-bootstrap.sqlite'
if source_db.exists():
    assert sys.argv[1:]==['--resume-before-deploy'] and not (b.ROOT/'worker/current-deployment.json').exists()
    with sqlite3.connect(source_db) as db:assert db.execute('SELECT version FROM native_installation_fixture').fetchall()==[(1,)]
else:
    with sqlite3.connect(source_db) as db:db.execute('CREATE TABLE native_installation_fixture (version INTEGER NOT NULL)');db.execute('INSERT INTO native_installation_fixture VALUES (1)')
env=b.entry.environment()
paths=json.loads(subprocess.check_output(['node','--input-type=module','-e',
    "import {workerGuardEntrypointPaths} from './tools/worker-local-release.mjs'; console.log(JSON.stringify(workerGuardEntrypointPaths))"],cwd=b.SOURCE,env=env))
manifest={}
for relative in paths:
    original=b.SOURCE/relative;target=mutable/relative
    if relative=='.runtime/worker-release-activation-fence.json':continue  # Copy the actual generated fence after Deploy.
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(original,target)
    manifest[relative]=hashlib.sha256(target.read_bytes()).hexdigest()
variables={'TERUISI_RUNTIME_ENV':'production','TERUISI_LOCAL_DIRECT_ACCESS':'false',
    'TERUISI_DJANGO_INTERNAL_SECRET':b.plain(core['internalSecret'])}
ports={'SALES':28001,'FINANCE':28011,'NETSHOP':28021,'MARKET':28031,'PRODUCTS':28041,'INVENTORY':28051,
       'WORKFLOW':28061,'CUSTOMER_SERVICE':28071,'BI':28081,'ERP':28091,'ACCESS_CONTROL':28101,'AI':28111}
for domain,port in ports.items():
    variables['TERUISI_DJANGO_'+domain+'_READER_BASE_URL']='http://127.0.0.1:'+str(port)
    if domain!='BI':variables['TERUISI_DJANGO_'+domain+'_WRITER_BASE_URL']='http://127.0.0.1:'+str(port+1)
(mutable/'.dev.vars').write_text('\n'.join(key+'='+json.dumps(value) for key,value in variables.items())+'\n',encoding='utf-8')
(b.EVIDENCE/'WORKER-PRIVATE-BINDINGS.json').write_text(json.dumps({'source':str(b.SOURCE),'mutableRoot':str(mutable),'persistRoot':str(persist),
    'legacySourceFixture':str(source_db),'guardFiles':manifest,'pendingGeneratedFence':True,'variableNames':sorted(variables),'realCloudOrProviderCredentials':False},indent=2)+'\n')
print('Private Worker bindings prepared; original Deploy not yet called')
