"""Prepare private startup configuration using the shipped provisioning SQL.

Only fixture setup uses extracted, digest-recorded SQL; native lifecycle calls
remain the actual controllers. No Start/Stop implementation is copied here.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from datetime import datetime, timezone

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('native-control-bootstrap.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
core=json.loads((b.RUNTIME/'secrets/credentials.dpapi.json').read_text())
fixture=json.loads((b.EVIDENCE/'SYNTHETIC-PRECONDITIONS.json').read_text())
admin_url='postgresql://postgres:'+b.plain(core['postgresSuperuser'])+'@127.0.0.1:25432/teruisi_sales'
owner_url='postgresql://teruisi_sales_owner:'+b.plain(core['databaseOwner'])+'@127.0.0.1:25432/teruisi_sales'
env=b.entry.environment()
env.update(PYTHONPATH=str(b.RUNTIME/'app/backend'),DJANGO_SETTINGS_MODULE='teruisi_backend.settings',
    DJANGO_ALLOWED_HOSTS='127.0.0.1,localhost',DJANGO_DEBUG='false',
    TERUISI_DJANGO_ENVIRONMENT='production',DJANGO_SECRET_KEY=b.plain(core['djangoSecretKey']),
    TERUISI_DJANGO_INTERNAL_SECRET=b.plain(core['internalSecret']),TERUISI_DJANGO_PROCESS_ROLE='migration_writer',
    TERUISI_PROVISION_DATABASE_URL=admin_url)
records=[]
domains={'netshop':'Netshop','market':'Market','products':'Products','inventory':'Inventory','workflow':'Workflow',
    'customer-service':'CustomerService','access-control':'AccessControl','erp-reference':'ErpReference','ai':'Ai','bi':'Bi'}
for domain,field in [('core',''),*domains.items()]:
    name='django-local-service.ps1' if domain=='core' else ('django-'+domain+('.ps1' if domain in {'ai','access-control','erp-reference','customer-service'} else '-service.ps1'))
    path=b.RUNTIME/'app/tools'/name
    source=path.read_text(encoding='utf-8-sig')
    if domain=='core':
        block=source.split('function Invoke-DjangoMigrations(',1)[1].split('$grantCode = @\'',1)[1].split("\n'@",1)[0]
        child_env={**env,'TERUISI_DJANGO_DATABASE_URL':owner_url}
        block='import django\ndjango.setup()\n'+block
    else:
        match=re.search(r'function Provision-[^{]+\{',source)
        assert match,domain
        block=source[match.end():].split("$code = @'",1)[1].split("\n'@",1)[0]
        values=json.loads((b.RUNTIME/'secrets'/(domain+'-credentials.dpapi.json')).read_text())
        child_env={**env,'TERUISI_DJANGO_DATABASE_URL':admin_url}
        for role in ['Reader','Writer']:
            key='database'+field+role
            if key in values:child_env['TERUISI_PROVISION_'+domain.replace('-','_').upper()+'_'+role.upper()+'_PASSWORD']=b.plain(values[key])
    script=b.ROOT/'scratch'/('provision-'+domain+'.py')
    script.write_text(block,encoding='utf-8')
    reused=sys.argv[1:]==['--resume-customer'] and domain in {'core','netshop','market','products','inventory','workflow'}
    if reused:
        assert (b.EVIDENCE/('provision-'+domain+'-r2.log')).is_file()
    else:
        b.run('provision-'+domain+'-r2',[b.RUNTIME/'venv/Scripts/python.exe','-B',script],child_env)
    records.append({'domain':domain,'controllerSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'sqlCodeSha256':hashlib.sha256(block.encode()).hexdigest(),'exitCode':0,'reusedPriorCompletedStep':reused})

stamp=datetime.now(timezone.utc).isoformat()
config={'version':6,'backend':'django-postgresql','configuredAt':stamp,'configuredFrom':str(b.SOURCE),
    'readerAddress':'127.0.0.1:28001','writerAddress':'127.0.0.1:28002',
    'financeReaderAddress':'127.0.0.1:28011','financeWriterAddress':'127.0.0.1:28012',
    'customerServiceReaderAddress':'127.0.0.1:28071','customerServiceWriterAddress':'127.0.0.1:28072',
    'postgresAddress':'127.0.0.1:25432','erpSourceD1':''}
(b.RUNTIME/'service.json').write_text(json.dumps(config),encoding='utf-8')
for domain in domains:
    if domain=='bi':
        data={'version':1,'migrationRunId':fixture['bi']['id'],'sourceDigest':fixture['bi']['sourceDigest'],'enabledAt':stamp}
    else:
        authority=fixture['authorities']['ai-apply' if domain=='ai' else domain]
        data={'version':1,'authorityEpoch':authority['authority_epoch'],'cutoverId':authority['cutover_id'],
              'migrationRunId':authority['migration_verify_run_id'],'enabledAt':stamp}
        if domain=='workflow':
            ops=fixture['authorities']['workflow-ops']
            data.update(version=2,operationsAuthorityEpoch=ops['authority_epoch'],operationsCutoverId=ops['cutover_id'],operationsMigrationRunId=ops['migration_verify_run_id'])
    suffix='-enabled.json' if domain in {'ai','access-control','erp-reference'} else '-service-enabled.json'
    (b.RUNTIME/(domain+suffix)).write_text(json.dumps(data),encoding='utf-8')
(b.EVIDENCE/'PRIVATE-PROVISION.json').write_text(json.dumps({'status':'provisioned','steps':records,'startupMarkers':'synthetic-private-only','persistentSchedulesEnabled':False},indent=2)+'\n')
print('Private roles provisioned with original SQL; synthetic startup markers written')
