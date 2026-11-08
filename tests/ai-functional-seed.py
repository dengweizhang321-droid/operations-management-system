"""Create synthetic private users/models through actual ORM; never reset data."""
import os
from ai_functional_environment import environment,network_guard,ROOT
env=environment(admin=True);os.environ.clear();os.environ.update(env);network_guard()
import django
django.setup()
from django.db import connection
from django.utils import timezone
from access_control.models import AccessRole,AppUser,AccessControlDataRevision
from access_control.policy import ROLE_CATALOG
from ai_assistant.control_models import AiDataRevision,AiWriteAuthority
from ai_assistant.models import AiModels
from ai_assistant.secrets import encrypt
with connection.cursor() as c:
    c.execute("SELECT current_setting('data_directory'),inet_server_port(),current_database()")
    d,p,n=c.fetchone()
    assert __import__('pathlib').Path(d).resolve()==(ROOT/'pg').resolve() and (p,n)==(55488,'functional_ai')
assert not AppUser.objects.filter(email__endswith='@functional.invalid').exists(),'seed already exists'
for role,definition in ROLE_CATALOG.items():
    AccessRole.objects.get_or_create(code=role,defaults=definition)
for name,role,scope in [('owner','admin',None),('other','analyst',None),('viewer','viewer',None),('scoped','analyst',{'warehouses':[],'channels':['SYNTHETIC-CHANNEL-A'],'platforms':['京东']})]:
    AppUser.objects.create(email=name+'@functional.invalid',display_name='Synthetic '+name,role_id=role,scope=scope,created_at=timezone.now(),updated_at=timezone.now())
AiDataRevision.objects.get_or_create(domain='ai-assistant')
AiWriteAuthority.objects.get_or_create(id=1)
AccessControlDataRevision.objects.get_or_create(domain='access-control')
from access_control.service import _bump_revision
from django.db import transaction
with transaction.atomic():_bump_revision()
for name in ['chat-ok','chat-delay','chat-drop','chat-429','report-a','report-b','report-429']:
    AiModels.objects.create(id='isofunc-'+name,name='Synthetic '+name,protocol='openai_compatible',model_type='text',model_name='isofunc-'+name,base_url='http://127.0.0.1:28446/v1',api_key_encrypted=encrypt('private-fixture-only-no-account'),api_key_suffix='ount',is_default_text_model=int(name=='chat-ok'),status='enabled',timeout_ms=20000,max_tokens=4096)
print('Private synthetic users/models seeded; no production data')
