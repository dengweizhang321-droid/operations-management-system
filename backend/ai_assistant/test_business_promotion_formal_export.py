"""Actual approved five-Agent HTML/XLSX temporary pair, without file runs."""
import io
import json
from pathlib import Path
from unittest.mock import patch
import zipfile

from django import test as djtest
from access_control.models import AppUser

from . import business_promotion_formal_export as service
from . import models as m
from . import test_business_promotion_approved_content as fixtures
from .policy import AiError, canonical, digest


@djtest.override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PromotionFormalExportTests(djtest.TransactionTestCase):
    user = fixtures.PromotionApprovedContentTests.user
    call = fixtures.PromotionApprovedContentTests.call
    collect_body = fixtures.PromotionApprovedContentTests.collect_body
    bundle = fixtures.PromotionApprovedContentTests.bundle
    input_for = fixtures.PromotionApprovedContentTests.input_for
    insert = fixtures.PromotionApprovedContentTests.insert
    seed = fixtures.PromotionApprovedContentTests.seed
    setUp = fixtures.PromotionApprovedContentTests.setUp
    request_body = fixtures.PromotionApprovedContentTests.request_body
    current_catalog = fixtures.PromotionApprovedContentTests.current_catalog
    create_fixed_report = fixtures.PromotionApprovedContentTests.create_fixed_report
    base = fixtures.PromotionApprovedContentTests.base
    read = fixtures.PromotionApprovedContentTests.read
    append = fixtures.PromotionApprovedContentTests.append
    package = fixtures.PromotionApprovedContentTests.package
    promotion = fixtures.PromotionApprovedContentTests.promotion
    complete = fixtures.PromotionApprovedContentTests.complete
    running_job = fixtures.PromotionApprovedContentTests.running_job
    five_completed = fixtures.PromotionApprovedContentTests.five_completed
    approved = fixtures.PromotionApprovedContentTests.approved

    def test_actual_approved_pair_contains_both_full_views_and_reviewed_content(self):
        report = self.five_completed(promotion_reference=True, native_reference=True)
        self.approved(report)
        before = m.AiBusinessFileRun.objects.count()
        with patch.object(service.file_tables.runtime.transport, "catalog", side_effect=self.current_catalog), patch(
                "ai_assistant.provider.turn") as model, patch("ai_assistant.transport.execute_tool") as remote:
            with service.open_files(report.id, self.admin) as prepared:
                receipt = prepared.manifest
                self.assertEqual(receipt["rendererVersion"], 7)
                self.assertFalse(receipt["deliveryAuthorized"])
                self.assertFalse(receipt["registeredRenderer"])
                self.assertFalse(receipt["authorityVerified"])
                self.assertEqual(receipt["receiptDigest"], digest({key: value for key, value in receipt.items()
                    if key != "receiptDigest"}))
                self.assertEqual(len(receipt["fileProof"]["tables"]), 2)
                self.assertFalse(receipt["fileProof"]["tableExpensesAreAdditive"])
                self.assertEqual(receipt["fileProof"]["tables"][0]["spendTotals"]["current"]["value"],
                    receipt["fileProof"]["tables"][1]["spendTotals"]["current"]["value"])
                html = prepared.path("html").read_bytes()
                xlsx = prepared.path("xlsx").read_bytes()
                self.assertIn("关键词与推广SKU".encode(), html)
                self.assertIn("调整规划与证据".encode(), html)
                self.assertEqual(len(html), receipt["files"]["html"]["bytes"])
                self.assertEqual(len(xlsx), receipt["files"]["xlsx"]["bytes"])
                with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
                    self.assertIn("teruisi-manifest.json", archive.namelist())
                    self.assertIn(b'Extension="json" ContentType="application/json"',
                        archive.read("[Content_Types].xml"))
                    embedded = json.loads(archive.read("teruisi-manifest.json"))
                    self.assertEqual([item["key"] for item in embedded["tables"][-2:]],
                        ["promotion-keyword_sku", "promotion-keyword_sku_context"])
                    self.assertEqual([item["rowCount"] for item in embedded["tables"][-2:]],
                        [item["rowCount"] for item in receipt["fileProof"]["tables"]])
                first_path = prepared.path("html")
            with self.assertRaises(AiError): prepared.path("html")
            self.assertFalse(first_path.exists())
        model.assert_not_called(); remote.assert_not_called()
        self.assertEqual(m.AiBusinessFileRun.objects.count(), before)

    def test_unapproved_or_conflicted_report_never_writes_formal_files(self):
        report = self.five_completed()
        with patch.object(service.file_tables.runtime.transport, "catalog", side_effect=self.current_catalog), patch.object(
                service.report_files, "write_pair") as writer, self.assertRaises(AiError):
            with service.open_files(report.id, self.admin): self.fail("unapproved escaped")
        writer.assert_not_called()
        self.approved(report, decision="reject")
        with patch.object(service.file_tables.runtime.transport, "catalog", side_effect=self.current_catalog), patch.object(
                service.report_files, "write_pair") as writer, self.assertRaises(AiError):
            with service.open_files(report.id, self.admin): self.fail("rejected escaped")
        writer.assert_not_called()

    def test_partial_temp_output_and_late_revocation_publish_nothing(self):
        report = self.five_completed()
        self.approved(report)
        before = m.AiBusinessFileRun.objects.count()
        paths = []
        def partial(xlsx, html, **_):
            paths.extend([Path(xlsx.name), Path(html.name)])
            xlsx.write(b"partial-xlsx"); html.write(b"partial-html")
            raise RuntimeError("synthetic writer failure")
        with patch.object(service.file_tables.runtime.transport, "catalog", side_effect=self.current_catalog), patch.object(
                service.report_files, "write_pair", side_effect=partial), self.assertRaisesRegex(RuntimeError, "writer failure"):
            with service.open_files(report.id, self.admin): self.fail("partial escaped")
        self.assertTrue(paths and all(not path.exists() for path in paths))
        with patch.object(service.file_tables.runtime.transport, "catalog", side_effect=self.current_catalog), self.assertRaises(AiError):
            with service.open_files(report.id, self.admin) as prepared:
                self.assertTrue(prepared.path("html").exists())
                AppUser.objects.filter(email=self.admin.email).update(status="disabled")
        self.assertEqual(m.AiBusinessFileRun.objects.count(), before)
