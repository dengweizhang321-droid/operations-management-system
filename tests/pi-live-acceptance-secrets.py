"""Opt-in authorised live acceptance inputs, memory only; never print this result."""
import json
import os
from pathlib import Path
import subprocess
import urllib.request

RUNTIME = Path('D:/teruisi-runtime/django-sales')


def inputs():
    # Reuse the installed CurrentUser DPAPI envelope, without saving decrypted
    # credentials or importing lifecycle code. This child stdout is captured.
    ps = """
$ErrorActionPreference='Stop'
$v=Get-Content -Raw -LiteralPath 'D:/teruisi-runtime/django-sales/secrets/ai-credentials.dpapi.json' | ConvertFrom-Json
$o=@{}
foreach($k in @('databaseAiWriter','modelEncryptionKey')) {
 $s=ConvertTo-SecureString ([string]$v.$k)
 $o[$k]=([System.Management.Automation.PSCredential]::new('local',$s)).GetNetworkCredential().Password
}
$o['origins']=[string]$v.modelOriginAllowlist
$o | ConvertTo-Json -Compress
"""
    raw = subprocess.check_output(['powershell','-NoProfile','-Command',ps], creationflags=subprocess.CREATE_NO_WINDOW)
    vault = json.loads(raw)
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(host='127.0.0.1',port=5432,dbname='teruisi_sales',user='teruisi_ai_writer',
                          password=vault['databaseAiWriter'],row_factory=dict_row,
                          options='-c default_transaction_read_only=on -c statement_timeout=5000') as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM ai_models WHERE id=%s', ('ai-model-35ca8a89-01d4-4693-b649-04b84ed69389',))
            model = cur.fetchone()
            cur.execute('SELECT identity_json, enabled, groups_json, version FROM ai_dingtalk_settings WHERE id=1')
            policy = cur.fetchone()
    actor = json.load(urllib.request.urlopen('http://localhost:3000/api/auth/me'))['user']
    config = json.loads((RUNTIME/'config/dingtalk-ask.json').read_text(encoding='utf-8-sig'))
    assert policy and json.loads(policy['identity_json']) == {k:config[k] for k in ('profile','corpId','unifiedAppId','robotCode','robotName')}
    config.update(version=2, policyVersion=policy['version'], enabled=config['enabled'] and policy['enabled'],
                  groups=[{'id':g['id'],'name':g['name']} for g in json.loads(policy['groups_json']) if g['enabled']])
    matches = [b for b in config['bindings'] if b['ownerEmail'] == actor['email'] and b['role']==actor['role'] and b['scope'] is None]
    assert len(matches)==1, 'current principal does not have exactly one matching direct binding'
    import hashlib,base64
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv,cipher = [base64.urlsafe_b64decode(x+'='*(-len(x)%4)) for x in model['api_key_encrypted'].split('.')]
    api_key = AESGCM(hashlib.sha256(vault['modelEncryptionKey'].encode()).digest()).decrypt(iv,cipher,None).decode()
    fields = ('name','protocol','model_type','model_name','base_url','generation_options_json','status','version','is_default_text_model')
    return {'configuration':{k:model[k] for k in fields},'apiKey':api_key,'origins':vault['origins'],
            'actor':actor,'config':config,'image':json.loads((RUNTIME/'config/pi-agent.json').read_text(encoding='utf-8-sig'))['runnerImage']}


if __name__ == '__main__':
    x=inputs()
    print(json.dumps({'ready':True,'model':x['configuration']['model_name'],'modelVersion':x['configuration']['version'],
                      'uniqueCurrentPrincipalDirectBinding':True,'enabled':x['config']['enabled'],
                      'robotName':x['config']['robotName'],'policyVersion':x['config']['policyVersion']}))
