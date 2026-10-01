from copy import deepcopy
import time
import json
from pathlib import Path
from unittest.mock import patch
from django.test import SimpleTestCase
from sales.auth import Principal
from sales.netshop_periods import validate_netshop_periods, OPERATION, SCHEMA
from netshop.errors import NetshopApiError
from netshop import sales_periods_client as client
from sales.netshop_periods import read_netshop_periods, NetshopPeriodsError


REQUEST={"operation":OPERATION,"current":{"startDate":"2026-08-01","endExclusive":"2026-08-03"},"baseline":{"startDate":"2026-07-01","endExclusive":"2026-08-01"}}
P=Principal("test@example.test","Synthetic","admin",None)
def fixture():
    return json.loads((Path(__file__).resolve().parents[3]/"tests/fixtures/netshop-sales-periods/response-periods.json").read_text(encoding="utf8"))


class ClientBudgetTests(SimpleTestCase):
    def test_parent_budget_signed_expiry_and_typed_pair(self):
        calls=[]
        def read(principal,body,*,deadline):calls.append((body,deadline));return fixture(),"7:3"
        before=time.time()*1000
        value,revision=client.read_sales_periods(P,REQUEST,deadline=time.monotonic()+5,reader=read)
        self.assertEqual(revision,"7:3");self.assertGreater(calls[0][0]["expiresAtEpochMs"],before)
        self.assertLessEqual(calls[0][0]["expiresAtEpochMs"],before+5100)
        self.assertNotIn("expiresAtEpochMs",value["requestedScope"])

    def test_transport_spending_outer_allowance_rejects_late_success(self):
        clock=[0.0]
        def read(principal,body,*,deadline):clock[0]=2;return fixture(),"7:3"
        with patch.object(client.time,"monotonic",side_effect=lambda:clock[0]),self.assertRaises(NetshopApiError) as error:
            client.read_sales_periods(P,REQUEST,deadline=1,reader=read)
        self.assertEqual(error.exception.status,503)

    def test_scope_header_vector_and_external_expiry_are_not_guessed(self):
        for mutate in (lambda x:x["requestedScope"]["current"].update(endDate="2026-09-01"),lambda x:x["sourceRevisions"].clear(),lambda x:x["sourceRevisions"][0].update(kind="owning_revision"),lambda x:x["candidatePagination"].update(page=2)):
            value=fixture();mutate(value)
            with self.assertRaises(NetshopApiError):client.read_sales_periods(P,REQUEST,reader=lambda *a,**k:(value,"7:3"))
        with self.assertRaises(NetshopApiError):client.read_sales_periods(P,{**REQUEST,"expiresAtEpochMs":1},reader=lambda *a,**k:(fixture(),"7:3"))

    def test_expired_parent_makes_no_rpc(self):
        calls=[]
        with self.assertRaises(NetshopApiError):client.read_sales_periods(P,REQUEST,deadline=time.monotonic()-1,reader=lambda *a,**k:calls.append(1))
        self.assertEqual(calls,[])

    def test_actual_pg_array_enums_fraction_counts_money_and_cost_claims_fail_closed(self):
        mutations=(lambda x:x.update(scopeMode=["unrestricted"]),
                   lambda x:x["periodTotals"]["current"]["orders"]["netAmountPerOrder"].update(status=["available"],value=999),
                   lambda x:x["periodTotals"]["current"]["orders"].update(trustedOrderCount=0.5),
                   lambda x:x["periodTotals"]["current"]["values"].update(costCents=0.5),
                   lambda x:x["periodTotals"]["current"]["observations"].update(observedDateCount=0.5),
                   lambda x:x["candidatePagination"].update(candidateCount=True),
                   lambda x:x["metricMetadata"]["cost"].update(zeroCostVerification="validatedZero"))
        for mutate in mutations:
            value=fixture();mutate(value)
            with self.assertRaises(NetshopApiError):client.read_sales_periods(P,REQUEST,reader=lambda *a,**k:(value,"7:3"))

    def test_transport_time_expires_signed_body_before_remote_first_query(self):
        utc=[1000.0]
        def remote(principal,body,*,deadline):
            utc[0]+=2
            try:read_netshop_periods(principal,body)
            except NetshopPeriodsError as error:
                self.assertEqual(error.code,"source_not_ready")
                raise NetshopApiError(str(error),code=error.code,status=error.status) from error
            self.fail("Expired RPC must not reach an actor/business SQL query")
        with patch.object(client.time,"time",side_effect=lambda:utc[0]),patch.object(client.time,"monotonic",return_value=0.0),self.assertRaises(NetshopApiError):
            client.read_sales_periods(P,REQUEST,deadline=1.0,reader=remote)

    def test_legacy_none_rpc_retains_original_8_second_timeout(self):
        from netshop.sales_client import read_sales_consumer
        calls=[]
        class Reply:
            headers={"Content-Type":"application/json","X-Sales-Data-Revision":"7:3"}
            def __enter__(self):return self
            def __exit__(self,*args):return None
            def read(self,size):return b'{"operation":"freshness","data":{}}'
        def send(req,timeout):calls.append(timeout);return Reply()
        with patch.dict("os.environ",{"TERUISI_DJANGO_INTERNAL_SECRET":"synthetic-secret-only-32-characters-long","TERUISI_DJANGO_SALES_READER_BASE_URL":"http://127.0.0.1:1"}),patch("netshop.sales_client.urllib.request.urlopen",side_effect=send):
            self.assertEqual(read_sales_consumer(P,{"operation":"freshness"})[1],"7:3")
        self.assertEqual(calls,[8])
