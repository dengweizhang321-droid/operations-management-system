from copy import deepcopy
import json
from pathlib import Path
from django.test import SimpleTestCase
from netshop.errors import NetshopApiError
from netshop.sales_periods_client import read_sales_periods
from sales.auth import Principal

ROOT=Path(__file__).resolve().parents[3]/"tests/fixtures/netshop-sales-platform-series"
P=Principal("platform-series@example.test","Synthetic","admin",None)

class PlatformDecoderTests(SimpleTestCase):
    def fixture(self,grain):return json.loads((ROOT/f"platform-series-{grain}.json").read_text(encoding="utf8")),json.loads((ROOT/f"platform-series-{grain}.meta.json").read_text(encoding="utf8"))["request"]
    def read(self,body,request):return read_sales_periods(P,request,reader=lambda *_a,**_k:(body,"7:3"))[0]
    def test_actual_pg_all_grains_and_max_full_parent_envelopes(self):
        for grain in ("day","week","month"):
            body,request=self.fixture(grain);self.assertEqual(self.read(body,request),body)
        body=json.loads((ROOT/"platform-max.json").read_text(encoding="utf8"));request=json.loads((ROOT/"platform-max.meta.json").read_text(encoding="utf8"))["request"]
        self.assertEqual(len(self.read(body,request)["platformSeries"]["items"][0]["rawMembers"]),25)
        raw=json.loads((ROOT/"registered-platform-max.json").read_text(encoding="utf8"));meta=json.loads((ROOT/"registered-platform-max.meta.json").read_text(encoding="utf8"))
        self.assertEqual(self.read(raw["data"],meta["request"]),raw["data"])
    def test_complete_platform_scope_members_tuple_and_native_source_negative_matrix(self):
        body,request=self.fixture("week")
        changes=[lambda d:d["platformSeries"].update(schemaVersion=["netshop-sales-platform-series-v1"]),lambda d:d["platformSeries"]["intent"].update(platformNames=["天猫","京东"]),lambda d:d["requestedScope"]["platformSeriesIntent"].update(grain="day"),lambda d:d["platformSeries"]["items"].reverse(),lambda d:d["platformSeries"]["items"][0]["rawMembers"].pop(),lambda d:d["platformSeries"]["items"][0]["rawMembers"].__setitem__(0,d["platformSeries"]["items"][1]["rawMembers"][0]),lambda d:d["platformSeries"]["items"][0].update(rawCandidateCount=True),lambda d:d["platformSeries"]["items"][0]["current"].pop(),lambda d:d["platformSeries"]["items"][0]["current"][0][1].__setitem__(0,.25),lambda d:d["platformSeries"]["items"][0]["current"][0].__setitem__(3,True),lambda d:d["platformSeries"].update(sourceRevisions=[]),lambda d:d["platformSeries"]["basis"].update(membership="first_four_raw"),lambda d:d["platformSeries"]["items"][0]["availability"].update(status=["available"])]
        for mutate in changes:
            value=deepcopy(body);mutate(value)
            with self.assertRaises(NetshopApiError):self.read(value,request)
        with self.assertRaises(NetshopApiError):self.read(body,{key:value for key,value in request.items()if key not in {"seriesGrain","seriesPlatforms"}})
    def test_complete_explicit_platform_scope_rejects_hidden_member_omission(self):
        envelope=json.loads((ROOT/"registered-platform-max.json").read_text(encoding="utf8"));request=json.loads((ROOT/"registered-platform-max.meta.json").read_text(encoding="utf8"))["request"]
        data=deepcopy(envelope["data"]);row=next(item for item in data["platformSeries"]["items"] if item["platform"]=="京东")
        hidden=next(identity for identity in row["rawMembers"] if identity["rawShopName"]=="J24")
        self.assertFalse(any(item["identity"]==hidden for item in data["items"]));self.assertEqual(data["candidatePagination"]["candidateCount"],50)
        row["rawMembers"].remove(hidden);row["rawCandidateCount"]-=1
        self.assertEqual(sum(item["rawCandidateCount"] for item in data["platformSeries"]["items"]),49)
        with self.assertRaises(NetshopApiError):self.read(data,request)
