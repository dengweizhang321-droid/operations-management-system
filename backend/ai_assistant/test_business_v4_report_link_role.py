"""Isolated PostgreSQL negative role target for closed 0071 report links."""
from importlib import import_module

import psycopg
from django.db import connection
from django.test import TransactionTestCase, override_settings

from . import business_v4_report_link_sql as link, models as m
from .test_business_integrated_guard import BusinessIntegratedGuardTests as fixture


@override_settings(DJANGO_PROCESS_ROLE="development",
    DJANGO_ENVIRONMENT="test")
class V4ReportLinkRoleTarget(TransactionTestCase):
    user = fixture.user
    call = fixture.call
    bundle = fixture.bundle
    input_for = fixture.input_for
    insert = fixture.insert
    seed = fixture.seed
    collect_body = fixture.collect_body
    setUp = fixture.setUp

    def database(self):
        item = connection.settings_dict
        return psycopg.connect(host=item["HOST"], port=item["PORT"],
            dbname=item["NAME"], user=item["USER"],
            password=item["PASSWORD"], autocommit=True)

    def test_old_report_cannot_be_backfilled_and_reader_has_no_direct_rows(self):
        if connection.vendor != "postgresql":
            self.skipTest("requires isolated PostgreSQL 0071")
        migration = import_module(
            "ai_assistant.migrations.0071_business_v4_report_source_link")
        with connection.cursor() as cursor:
            migration.verify_catalog(cursor)
        report, _ = self.seed()
        with connection.cursor() as cursor:
            for table in (link.INTENTS, link.LINKS):
                cursor.execute("SELECT count(*) FROM " + table)
                self.assertEqual(cursor.fetchone(), (0,))
        with self.database() as db:
            db.execute("SET SESSION AUTHORIZATION teruisi_ai_writer")
            with self.assertRaises(psycopg.Error):
                db.execute("SELECT " + link.ISSUE.split("(",1)[0] +
                    "(%s,%s,%s,%s,%s,%s)", [report.id, "missing-v4",
                    self.admin.email, self.parent.id,
                    "a" * 64, "b" * 64])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                db.execute("SELECT * FROM " + link.INTENTS)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                db.execute("INSERT INTO " + link.LINKS +
                    " (report_id) VALUES ('forbidden')")
        with self.database() as db:
            db.execute("SET SESSION AUTHORIZATION teruisi_ai_reader")
            with self.assertRaises(psycopg.Error):
                db.execute("SELECT " + link.READ.split("(",1)[0] +
                    "(%s,%s,%s)",
                    [report.id, self.admin.email, 1])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                db.execute("SELECT * FROM " + link.LINKS)
        with connection.cursor() as cursor:
            for table in (link.INTENTS, link.LINKS):
                cursor.execute("SELECT count(*) FROM " + table)
                self.assertEqual(cursor.fetchone(), (0,))
            migration.verify_catalog(cursor)
        self.assertEqual(m.AiReportRun.objects.get(pk=report.id).snapshot_json,
            report.snapshot_json)
