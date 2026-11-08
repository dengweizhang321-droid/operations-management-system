"""Inspect one blocked private migration predecessor without bypassing it."""
import hashlib
import importlib
import importlib.util
import json
import sys
from pathlib import Path
import psycopg
from psycopg import sql

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('native-control-bootstrap.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
core=json.loads((b.RUNTIME/'secrets/credentials.dpapi.json').read_text())
module=importlib.import_module('ai_assistant.migrations.0058_business_promotion_budget_v10_publish_gate')
signatures=['public.ai_business_file_chunk_guard()','public.ai_business_volume_chunk_guard()',
    'public.ai_business_volume_manifest_check(text,integer,text,boolean,text)',
    'public.ai_business_files_guard()','public.ai_business_volume_complete_guard()']
with psycopg.connect(host='127.0.0.1',port=25432,user='postgres',password=b.plain(core['postgresSuperuser']),dbname='teruisi_sales') as db:
    assert Path(db.execute("SHOW data_directory").fetchone()[0]).resolve()==(b.RUNTIME/'postgres-data').resolve()
    table_owner=db.execute("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.ai_business_promotion_budget_v10_attestations'::regclass").fetchone()[0]
    rows=[]
    for i,(signature,definition) in enumerate(zip(signatures,module.NEW_SQL)):
        oid,body,secdef,config,language,owner,acl=db.execute("SELECT p.oid,p.prosrc,p.prosecdef,p.proconfig,l.lanname,pg_get_userbyid(p.proowner),p.proacl::text FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(%s)",[signature]).fetchone()
        rows.append({'signature':signature,'oid':oid,'definitionMatches':body==definition.split('$$',2)[1],
            'securityMatches':secdef is (i==4),'configMatches':{s.replace(' ','') for s in config or []}=={'search_path=pg_catalog,public'},
            'language':language,'owner':owner,'ownerMatchesTable':owner==table_owner,'bodySha256':hashlib.sha256(body.encode()).hexdigest(),'acl':acl})
    result={'private':True,'tableOwner':table_owner,'functions':rows}
    if sys.argv[1:] == ['--repair-exact-owner']:
        assert table_owner=='postgres' and all(r['definitionMatches'] and r['securityMatches'] and r['configMatches'] and r['language']=='plpgsql' for r in rows)
        assert rows[4]['owner']=='teruisi_sales_owner' and not rows[4]['ownerMatchesTable']
        grants_sql="SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure(%s) AND a.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('postgres','teruisi_sales_owner')) ORDER BY 1,2,3"
        prior_grants=db.execute(grants_sql,[signatures[4]]).fetchall()
        db.execute('ALTER FUNCTION public.ai_business_volume_complete_guard() OWNER TO postgres')
        after=db.execute("SELECT oid,prosrc,prosecdef,proconfig,pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(%s)",[signatures[4]]).fetchone()
        assert after[0]==rows[4]['oid'] and hashlib.sha256(after[1].encode()).hexdigest()==rows[4]['bodySha256'] and after[2] is True and after[4]=='postgres'
        assert db.execute(grants_sql,[signatures[4]]).fetchall()==prior_grants
        with db.cursor() as cursor: module.verify_catalog(cursor)
        result['after']={'oid':after[0],'bodySha256':hashlib.sha256(after[1].encode()).hexdigest(),'securityDefiner':after[2],'config':after[3],'owner':after[4],'nonOwnerPermissionsUnchanged':True}
        result['originalVerifyCatalog']='passed'
        result['repair']='one exact function owner only'
        db.commit()
        label='PRIVATE-SCHEMA-OWNER-REPAIR.json'
    else:
        db.rollback()
        label='PRIVATE-SCHEMA-OWNER-INSPECTION.json'
    (b.EVIDENCE/label).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'tableOwner':table_owner,'functions':[{'signature':r['signature'],'body':r['definitionMatches'],'security':r['securityMatches'],'config':r['configMatches'],'owner':r['owner']} for r in rows]}))
