"""Exercise the real URL admission seam; no production port is opened."""
from io import BytesIO
import json
import os
import time
import unittest
import urllib.request
from unittest.mock import Mock, patch

from bi.source_reader import _read_once
from bi.tests.test_cockpit import PRINCIPAL
from sales.tests.factories import TEST_SECRET
from netshop.bounded_consumer_http import open_bounded_bi_reader_request, open_bounded_consumer_request


class FixedBiTransportTests(unittest.TestCase):
    def test_all_four_owning_gets_pass_real_admission_and_close_response(self):
        paths={"/api/finance/erp-targets":8011,"/api/workflow/bi-status":8061,"/api/inventory/bi-cockpit":8051,"/api/netshop/bi-flow":8021}
        for path,port in paths.items():
            response=Mock();opener=Mock();opener.open.return_value=response
            request=urllib.request.Request(f"http://127.0.0.1:{port}{path}?range=month",method="GET")
            with patch("urllib.request.build_opener",return_value=opener):
                with open_bounded_bi_reader_request(request,deadline=time.monotonic()+8) as actual:self.assertIs(actual,response)
            response.close.assert_called_once()
            opener.open.assert_called_once()
    def test_foreign_origin_wrong_port_path_method_and_redirect_fragment_rejected(self):
        urls=["http://example.test:8011/api/finance/erp-targets","http://127.0.0.1:9999/api/finance/erp-targets","http://127.0.0.1:8011/api/finance/targets","https://127.0.0.1:8011/api/finance/erp-targets","http://user@127.0.0.1:8011/api/finance/erp-targets","http://127.0.0.1:8011/api/finance/erp-targets#other"]
        requests=[urllib.request.Request(url,method="GET") for url in urls]
        requests.append(urllib.request.Request("http://127.0.0.1:8011/api/finance/erp-targets",data=b"{}",method="POST"))
        with patch("urllib.request.build_opener") as factory:
            for request in requests:
                with self.assertRaises(ValueError):
                    with open_bounded_bi_reader_request(request,deadline=time.monotonic()+8):pass
            factory.assert_not_called()
    def test_original_consumer_whitelist_still_rejects_bi_get(self):
        request=urllib.request.Request("http://127.0.0.1:8011/api/finance/erp-targets",method="GET")
        with self.assertRaises(ValueError):
            with open_bounded_consumer_request(request,deadline=time.monotonic()+8):pass
    def test_signed_target_reader_uses_real_fixed_get_admission(self):
        body={"schemaVersion":"finance-erp-targets-v1","year":"2026","month":"2026-10","basis":"erp_net_sales","complete":True,"items":[]}
        response=BytesIO(json.dumps(body).encode());response.status=200
        response.headers={"Content-Type":"application/json","X-Finance-Data-Revision":"1:aaaaaaaaaaaa"}
        opener=Mock();opener.open.return_value=response
        with patch.dict(os.environ,{"TERUISI_DJANGO_FINANCE_READER_BASE_URL":"http://127.0.0.1:8011","TERUISI_DJANGO_INTERNAL_SECRET":TEST_SECRET}),patch("urllib.request.build_opener",return_value=opener):
            result=_read_once(PRINCIPAL,"targets",{"year":"2026","month":"2026-10"},deadline=time.monotonic()+8)
        self.assertEqual(result["status"],"ready")
        self.assertTrue(response.closed)
        request=opener.open.call_args.args[0]
        self.assertEqual(request.get_method(),"GET")
        self.assertTrue(request.has_header("X-teruisi-signature"))
