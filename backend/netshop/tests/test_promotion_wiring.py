"""Real signed promotion HTTP wrappers on the private synthetic owning-reader."""
import importlib
import hashlib
import os
import types
from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import urlencode

from django.test import TestCase, override_settings
from django.db.models import F
from django.urls import clear_url_caches, include, path
from django.utils import timezone

from access_control.models import AppUser
from netshop.models import NetshopDataRevision
from sales.tests.factories import TEST_SECRET, signed_headers
from .promotion_insights_fixtures import add_day


@contextmanager
def process_role(role):
    import netshop.urls as netshop_urls
    with override_settings(DJANGO_PROCESS_ROLE=role):
        importlib.reload(netshop_urls)
        urls = types.ModuleType("promotion_wiring_" + role)
        urls.urlpatterns = [path("api/netshop/", include(netshop_urls.urlpatterns))]
        with override_settings(ROOT_URLCONF=urls):
            clear_url_caches()
            yield
    importlib.reload(netshop_urls)
    clear_url_caches()


@patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class PromotionWiringTests(TestCase):
    def setUp(self):
        self.counter = 0
        self.email = "promotion-wiring@example.test"
        self.user = AppUser.objects.create(
            email=self.email, display_name="Synthetic", role_id="viewer",
            status="active", scope=None, version=1,
            created_at=timezone.now(), updated_at=timezone.now())
        NetshopDataRevision.objects.update_or_create(
            domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        add_day(self)
        add_day(self, promotion=False)
        self.params = {"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01"}

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(
            revision=F("revision") + 1,
            source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def url(self, detail=False, extra=None):
        params = {**self.params, **(extra or {})}
        endpoint = "/api/netshop/promotion-insights" + ("/detail" if detail else "")
        return endpoint + "?" + urlencode(params)

    def signed(self, url, *, scope=None, method="GET", body=""):
        return signed_headers(url, email=self.email, display_name="Synthetic",
                              role="viewer", scope=scope, method=method, body=body)

    def assert_read_response(self, response):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        payload = response.json()
        owning = next(item["revision"] for item in payload["context"]["sourceRevisions"]
                      if item["domain"] == "netshop" and item["kind"] == "owning_revision")
        self.assertEqual(response["X-Netshop-Data-Revision"], owning)
        return payload

    def summary(self):
        url = self.url()
        return self.assert_read_response(self.client.get(url, headers=self.signed(url)))

    def test_signed_reader_returns_actual_summary_and_owning_header(self):
        with process_role("netshop_reader"):
            payload = self.summary()
            self.assertEqual(payload["columnVersion"], "netshop-promotion-v1")
            self.assertEqual(payload["sections"]["summary"]["spend"]["value"], 200)
            self.assertEqual(len(payload["sections"]["items"]), 1)

    def test_signed_detail_uses_real_list_identity_and_section_token(self):
        with process_role("netshop_reader"):
            summary = self.summary()
            item = summary["sections"]["items"][0]
            url = self.url(True, {"objectKind": "product", "objectId": item["rowKey"],
                                 "shopKey": item["shopKey"], "sectionToken": summary["sectionToken"]})
            payload = self.assert_read_response(self.client.get(url, headers=self.signed(url)))
            self.assertEqual(payload["sections"]["item"]["rowKey"], item["rowKey"])
            self.assertEqual(payload["sections"]["item"]["shopKey"], item["shopKey"])

    def test_unsigned_readers_reject_before_business_read(self):
        with process_role("netshop_reader"):
            for detail in (False, True):
                response = self.client.get(self.url(detail))
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response["Cache-Control"], "no-store")

    def test_live_platform_scope_denies_other_platform(self):
        scope = {"platforms": ["天猫"], "channels": [], "warehouses": []}
        self.user.scope = scope
        self.user.version += 1
        self.user.save(update_fields=["scope", "version"])
        with process_role("netshop_reader"):
            for detail in (False, True):
                extra = {} if not detail else {
                    "objectKind": "product", "objectId": "b" * 64,
                    "shopKey": "京东\x1fA", "sectionToken": "c" * 64}
                url = self.url(detail, extra)
                response = self.client.get(url, headers=self.signed(url, scope=scope))
                self.assertEqual(response.status_code, 403)

    def test_duplicate_and_unknown_query_parameters_are_400(self):
        with process_role("netshop_reader"):
            for suffix in ("&platform=%E4%BA%AC%E4%B8%9C", "&unregistered=1"):
                for detail in (False, True):
                    url = self.url(detail) + suffix
                    response = self.client.get(url, headers=self.signed(url))
                    self.assertEqual(response.status_code, 400)

    def test_detail_requires_token_and_rejects_stale_owning_revision(self):
        with process_role("netshop_reader"):
            summary = self.summary()
            item = summary["sections"]["items"][0]
            identity = {"objectKind": "product", "objectId": item["rowKey"], "shopKey": item["shopKey"]}
            url = self.url(True, identity)
            self.assertEqual(self.client.get(url, headers=self.signed(url)).status_code, 400)
            NetshopDataRevision.objects.filter(domain="netshop").update(revision=2, source_digest="d" * 64)
            url = self.url(True, {**identity, "sectionToken": summary["sectionToken"]})
            self.assertEqual(self.client.get(url, headers=self.signed(url)).status_code, 409)

    def test_post_is_not_allowed_for_both_readers(self):
        with process_role("netshop_reader"):
            for detail in (False, True):
                url = self.url(detail)
                response = self.client.post(url, data="{}", content_type="application/json",
                                            headers=self.signed(url, method="POST", body="{}"))
                self.assertEqual(response.status_code, 405)

    def test_writer_process_does_not_register_promotion_readers(self):
        with process_role("netshop_writer"):
            for detail in (False, True):
                url = self.url(detail)
                self.assertEqual(self.client.get(url, headers=self.signed(url)).status_code, 404)
