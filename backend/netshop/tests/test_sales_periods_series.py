from copy import deepcopy
import json
from pathlib import Path

from django.test import SimpleTestCase
from sales.auth import Principal
from netshop.sales_periods_client import read_sales_periods
from netshop.errors import NetshopApiError

ROOT=Path(__file__).resolve().parents[3]/"tests/fixtures/netshop-sales-period-series"
P=Principal("native-series@example.test","Synthetic","admin",None)


class CompleteNativeSeriesDecoderTests(SimpleTestCase):
    def fixture(self,grain):
        return json.loads((ROOT/f"sales-series-{grain}.json").read_text(encoding="utf8")),json.loads((ROOT/f"sales-series-{grain}.meta.json").read_text(encoding="utf8"))["request"]

    def read(self,data,request):return read_sales_periods(P,request,reader=lambda *_a,**_k:(data,"7:3"))[0]

    def test_actual_pg_day_week_month_and_negative_complete_shape(self):
        for grain in ("day","week","month"):
            data,request=self.fixture(grain);self.assertEqual(self.read(data,request),data)
        data,request=self.fixture("week")
        mutations=[lambda d:d["series"].update(schemaVersion=["netshop-sales-period-series-v1"]),
                   lambda d:d["series"].update(projection=["native-period-tuples-v1"]),
                   lambda d:d["series"]["metricColumns"].reverse(),
                   lambda d:d["series"]["windowColumns"].pop(),
                   lambda d:d["series"]["pointColumns"].__setitem__(0,"wrong"),
                   lambda d:d["series"]["items"][0]["current"][0].pop(),
                   lambda d:d["series"]["items"][0]["current"][0][1].pop(),
                   lambda d:d["series"]["items"][0]["current"][0].__setitem__(5,999),
                   lambda d:d["series"]["items"][0]["current"][0].__setitem__(6,True),
                   lambda d:d["series"]["intent"].update(grain=["week"]),
                   lambda d:d["series"]["items"][0]["current"].pop(),
                   lambda d:d["series"]["items"][0]["current"][0][0].__setitem__(1,"2026-09-07"),
                   lambda d:d["series"]["items"][0]["current"][0].__setitem__(3,True),
                   lambda d:d["series"]["items"][0]["current"][0][1].__setitem__(0,0.25),
                   lambda d:d["series"]["items"][0].update(identityKey="foreign"),
                   lambda d:d["series"].update(sourceRevisions=[]),
                   lambda d:d["series"]["basis"].update(completeness="complete"),
                   lambda d:d["series"]["metricMetadata"]["cost"].update(verification="verified"),
                   lambda d:d["series"]["items"][0]["current"][0].__setitem__(7,[])]
        for mutate in mutations:
            value=deepcopy(data);mutate(value)
            with self.assertRaises(NetshopApiError):self.read(value,request)
        with self.assertRaises(NetshopApiError):self.read(data,{key:value for key,value in request.items() if key not in {"seriesGrain","seriesOutlets"}})

    def test_no_records_point_cannot_become_zero_or_incorrect_period(self):
        data,request=self.fixture("day")
        for mutate in (lambda d:d["series"]["items"][0]["current"][2][1].__setitem__(0,0),lambda d:d["series"]["items"][0].update(current=d["series"]["items"][0]["baseline"]),lambda d:d["series"]["items"].append(deepcopy(d["series"]["items"][0]))):
            value=deepcopy(data);mutate(value)
            with self.assertRaises(NetshopApiError):self.read(value,request)
