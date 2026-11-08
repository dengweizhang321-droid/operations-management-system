"""Complete synthetic access-control initialization, never a production repair."""
from ai_functional_http import user
from access_control.models import AccessRole,AccessControlDataRevision
from access_control.policy import ROLE_CATALOG
from access_control.service import _bump_revision
from ai_functional_environment import record
from django.db import transaction
before=AccessControlDataRevision.objects.get(domain='access-control')
assert before.revision==0 and before.source_digest=='0'*64,'unexpected state; no repair'
for role,definition in ROLE_CATALOG.items():
    AccessRole.objects.filter(code=role).update(**definition)
with transaction.atomic():row=_bump_revision()
record('ACCESS-SEED-COMPLETION.json',{'reason':'synthetic initial revision omitted; actual background service correctly refused','revision':row.revision,'sourceDigest':row.source_digest,'fixedRoleCatalog':True,'applicationChanged':False})
