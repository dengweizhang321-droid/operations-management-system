"""Exact signed reserved-edge compatibility; ordinary finance fences remain."""
import base64,hashlib,hmac,json,time,uuid
from unittest.mock import patch

from django.test import TestCase,override_settings
from django.urls import path
from django.utils import timezone

from access_control.models import AppUser
from finance import netshop_reads as reads, views
from finance.annual_progress import annual_progress
from finance.errors import FinanceApiError
from sales.auth import Principal

urlpatterns=[path('api/finance/consumers/query',views.consumer_query)]
SECRET='isolated-finance-edge-compatibility-only-secret-0123456789'
ENDPOINT='/api/finance/consumers/query'
REQUEST={'operation':'netshop_finance_read_v1','shopKeys':['["京东","合成店"]'],'months':['2026-09'],'year':'2026'}

@override_settings(ROOT_URLCONF=__name__)
class NetshopFinanceReservedEdgeTests(TestCase):
    def setUp(self):
        self.edge=Principal('local-admin@teruisi.local','Synthetic reserved','admin',None)
        now=timezone.now()
        self.user=AppUser.objects.create(email='finance-normal@example.invalid',display_name='Synthetic',role_id='viewer',status='active',scope=None,version=1,created_at=now,updated_at=now)
        self.normal=Principal(self.user.email,'Synthetic','viewer',None)

    def signed(self,principal,*,bad_signature=False,body=None):
        raw=json.dumps(REQUEST if body is None else body,ensure_ascii=False,separators=(',',':')).encode()
        actor=json.dumps({'email':principal.email,'displayName':principal.display_name,'role':principal.role,'scope':principal.scope},ensure_ascii=False,separators=(',',':')).encode()
        envelope=base64.urlsafe_b64encode(actor).rstrip(b'=').decode()
        timestamp=str(int(time.time()));request_id=str(uuid.uuid4());digest=hashlib.sha256(raw).hexdigest()
        text='\n'.join(['v1',timestamp,request_id,'POST',ENDPOINT,'',digest,envelope])
        signature=hmac.new(SECRET.encode(),text.encode(),hashlib.sha256).hexdigest()
        if bad_signature:signature='0'*64
        with patch.dict('os.environ',{'TERUISI_DJANGO_INTERNAL_SECRET':SECRET}):
            return self.client.post(ENDPOINT,data=raw,content_type='application/json',headers={
                'X-Teruisi-Principal':envelope,'X-Teruisi-Timestamp':timestamp,'X-Teruisi-Request-Id':request_id,
                'X-Teruisi-Content-SHA256':digest,'X-Teruisi-Signature':'v1='+signature})

    def test_exact_reserved_actor_has_original_f_identity_without_user_write_or_read(self):
        from netshop.insights_common import actor_fence
        before=AppUser.objects.count()
        with patch.object(reads.AppUser.objects,'filter',side_effect=AssertionError('reserved must not query/create user')):
            self.assertEqual(reads._actor(self.edge),actor_fence(self.edge))
        self.assertEqual(AppUser.objects.count(),before)
        self.assertFalse(AppUser.objects.filter(email=self.edge.email).exists())

    def test_reserved_wrong_role_and_any_scope_fail_closed(self):
        for role in ('viewer','analyst','operator'):
            with self.assertRaises(FinanceApiError) as error:
                reads._actor(Principal(self.edge.email,'Synthetic',role,None))
            self.assertEqual(error.exception.status,403)
        for scope in ({'warehouses':[],'channels':[],'platforms':[]},{'warehouses':[],'channels':[],'platforms':['京东']}):
            with self.assertRaises(FinanceApiError):reads._actor(Principal(self.edge.email,'Synthetic','admin',scope))

    def test_lookalike_and_missing_ordinary_user_never_gain_reserved_fallback(self):
        for email in ('LOCAL-ADMIN@TERUISI.LOCAL','local-admin@teruisi.local.example','missing@example.invalid'):
            with self.assertRaises(FinanceApiError):reads._actor(Principal(email,'Synthetic','admin',None))

    def test_ordinary_disabled_downgraded_scope_and_version_keep_original_semantics(self):
        original=reads._actor(self.normal)
        self.assertNotIn('kind',original)
        for change in ({'status':'inactive'},{'role_id':'operator'},{'scope':{'warehouses':[],'channels':[],'platforms':['京东']}}):
            with self.subTest(change=change):
                AppUser.objects.filter(pk=self.user.pk).update(**change)
                with self.assertRaises(FinanceApiError):reads._actor(self.normal)
                AppUser.objects.filter(pk=self.user.pk).update(status='active',role_id='viewer',scope=None)
        AppUser.objects.filter(pk=self.user.pk).update(version=2)
        self.assertNotEqual(reads._actor(self.normal),original)

    def test_real_registered_hmac_reserved_positive_and_bad_signature_negative(self):
        before=AppUser.objects.count()
        response=self.signed(self.edge)
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(response.json()['operation'],'netshop_finance_read_v1')
        self.assertTrue(response.headers['X-Finance-Data-Revision'])
        self.assertEqual(AppUser.objects.count(),before)
        denied=self.signed(self.edge,bad_signature=True)
        self.assertEqual(denied.status_code,401,denied.content)

    def test_signed_wrong_role_scoped_and_missing_ordinary_are_rejected(self):
        for principal in [Principal(self.edge.email,'Synthetic','viewer',None),
                          Principal(self.edge.email,'Synthetic','admin',{'warehouses':[],'channels':[],'platforms':['京东']}),
                          Principal('missing@example.invalid','Synthetic','admin',None)]:
            response=self.signed(principal)
            self.assertEqual(response.status_code,403,response.content)

    def test_signed_ordinary_existing_user_retains_original_access(self):
        response=self.signed(self.normal)
        self.assertEqual(response.status_code,200,response.content)
        self.assertNotIn('kind',reads._actor(self.normal))

    def test_signed_ordinary_admin_downgrade_and_disable_are_rejected(self):
        admin=Principal(self.user.email,'Synthetic','admin',None)
        AppUser.objects.filter(pk=self.user.pk).update(role_id='admin')
        self.assertEqual(self.signed(admin).status_code,200)
        for change in ({'role_id':'viewer'},{'role_id':'admin','status':'inactive'}):
            AppUser.objects.filter(pk=self.user.pk).update(**change)
            response=self.signed(admin)
            self.assertEqual(response.status_code,403,response.content)

    def test_late_ordinary_actor_version_change_rejects_without_success_body(self):
        def changed(year,page,size,*,shop_pairs):
            result=annual_progress(year,page,size,shop_pairs=shop_pairs)
            AppUser.objects.filter(pk=self.user.pk).update(version=9)
            return result
        with self.assertRaises(FinanceApiError) as error:
            reads.read_netshop_finance(self.normal,REQUEST,annual_provider=changed)
        self.assertEqual(error.exception.status,403)

    def test_reserved_deployment_fence_change_rejects_final_check(self):
        def changed(year,page,size,*,shop_pairs):
            result=annual_progress(year,page,size,shop_pairs=shop_pairs)
            # Same precise identity is re-evaluated before publishing. A
            # changed deployment fence is not silently accepted/cached.
            altered={'email':self.edge.email,'role':'admin','scope':None,'kind':'reserved_edge','version':'changed'}
            replacement=patch('netshop.insights_common.actor_fence',return_value=altered)
            replacement.start();self.addCleanup(replacement.stop)
            return result
        with self.assertRaises(FinanceApiError) as error:
            reads.read_netshop_finance(self.edge,REQUEST,annual_provider=changed)
        self.assertEqual(error.exception.status,403)
