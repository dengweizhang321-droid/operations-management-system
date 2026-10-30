"""processing 回执租期与完成回执 TTL 清理；对应 2026-10-24 审查 D2-安全 #10/#11。

external=True 路径先在 mutation() 事务内建立 processing 回执并提交，随后在事务外执行
外部 handler；进程若恰好在 handler 执行期间（finish() 之前）崩溃，回执永远停在
processing，同一 request_id 之后永远 409，且写权限切换命令只要存在 processing 回执
就拒绝。租期到期后不自动重放 handler（结果未知、不确定操作不可重放），只转入
stale_manual_review 供人工对账，并释放同一 request_id 的后续请求与切换门禁。

直接驱动 views.write()，不经过具体业务 handler 的路由与前置数据搭建，隔离测试
租期与 TTL 清理本身的行为，不依赖任何无关业务域状态。
"""
import hashlib
import secrets
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4

from django import test as djtest
from django.db import connection
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from sales.auth import Principal

from . import views
from .control_models import AiDataRevision, AiWriteAuthority, AiWriteReceipt
from .database_contract import provision
from .policy import AiError
from .test_business_market_v2_material_role_bridge import session_role


def request_for(request_id, *, method="POST", path="/api/ai/write-receipt-lease-fixture"):
    request = RequestFactory().generic(method, path, b"{}", content_type="application/json")
    request.headers = {
        "X-Teruisi-Request-Id": request_id,
        "X-Teruisi-Content-SHA256": hashlib.sha256(b"{}").hexdigest(),
    }
    return request


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class WriteReceiptLeaseTestBase(TransactionTestCase):
    def setUp(self):
        AiDataRevision.objects.get_or_create(domain="ai-assistant")
        AiWriteAuthority.objects.get_or_create(id=1)
        AccessRole.objects.get_or_create(
            code="admin",
            defaults={"label": "admin", "description": "admin", "rank": 3, "permissions": []},
        )
        AppUser.objects.create(
            email="lease-fixture-admin@example.invalid",
            display_name="lease-fixture-admin",
            role_id="admin",
            scope=None,
            created_at=timezone.now(),
            updated_at=timezone.now(),
        )
        self.principal = Principal(
            "lease-fixture-admin@example.invalid", "lease-fixture-admin", "admin", None,
        )

    def write_external(self, request_id, handler, *, path="/api/ai/write-receipt-lease-fixture"):
        request = request_for(request_id, path=path)
        return views.write(request, self.principal, handler, external=True)


class ProcessingLeaseTests(WriteReceiptLeaseTestBase):
    def test_crash_during_external_handler_leaves_processing_and_blocks_replay_before_lease(self):
        def crash():
            raise RuntimeError("synthetic worker crash before finish() ever runs")

        with self.assertRaises(RuntimeError):
            self.write_external("lease-crash-1", crash)

        receipt = AiWriteReceipt.objects.get(pk="lease-crash-1")
        self.assertEqual(receipt.status, "processing")

        # Retrying the same request id immediately, still inside the lease window, must
        # keep refusing to replay the uncertain operation — unchanged existing behaviour.
        with self.assertRaises(AiError) as ctx:
            self.write_external("lease-crash-1", lambda: (_ for _ in ()).throw(
                AssertionError("must not run handler again while still leased")
            ))
        self.assertEqual(ctx.exception.code, "request_pending")
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, "processing")

    def test_stale_processing_past_lease_converts_to_manual_review_and_does_not_replay(self):
        def crash():
            raise RuntimeError("synthetic worker crash before finish() ever runs")

        with self.assertRaises(RuntimeError):
            self.write_external("lease-stale-1", crash)

        # Backdate created_at past the lease window. created_at is the lease anchor and is
        # only ever written once at creation, so this reproduces "the process crashed and
        # never came back" without needing a dedicated expires_at column.
        AiWriteReceipt.objects.filter(pk="lease-stale-1").update(
            created_at=timezone.now() - views.PROCESSING_LEASE - timedelta(seconds=1)
        )

        def must_not_run():
            raise AssertionError("stale lease takeover must not replay the handler")

        with self.assertRaises(AiError) as ctx:
            self.write_external("lease-stale-1", must_not_run)
        self.assertEqual(ctx.exception.code, "processing_lease_expired")
        self.assertEqual(ctx.exception.status, 409)

        receipt = AiWriteReceipt.objects.get(pk="lease-stale-1")
        self.assertEqual(receipt.status, "stale_manual_review")

        # A write-authority style check that filters on status="processing" must no longer
        # see this request as an outstanding blocker once it is past lease.
        self.assertFalse(AiWriteReceipt.objects.filter(status="processing").exists())

    def test_lease_boundary_one_second_inside_window_still_pending_not_yet_stale(self):
        def crash():
            raise RuntimeError("synthetic worker crash")

        with self.assertRaises(RuntimeError):
            self.write_external("lease-boundary-1", crash)

        AiWriteReceipt.objects.filter(pk="lease-boundary-1").update(
            created_at=timezone.now() - views.PROCESSING_LEASE + timedelta(seconds=1)
        )

        with self.assertRaises(AiError) as ctx:
            self.write_external("lease-boundary-1", lambda: (_ for _ in ()).throw(
                AssertionError("must not run handler again while still inside the lease window")
            ))
        self.assertEqual(ctx.exception.code, "request_pending")
        self.assertEqual(AiWriteReceipt.objects.get(pk="lease-boundary-1").status, "processing")

    def test_completed_receipt_replay_is_unaffected_by_lease_logic(self):
        result = self.write_external("lease-completed-1", lambda: ({"ok": True}, 200))
        self.assertEqual(result.status_code, 200)
        receipt = AiWriteReceipt.objects.get(pk="lease-completed-1")
        self.assertEqual(receipt.status, "completed")

        # Backdate well past the lease window; a completed receipt must still replay its
        # stored payload rather than being treated as an expired lease.
        AiWriteReceipt.objects.filter(pk="lease-completed-1").update(
            created_at=timezone.now() - views.PROCESSING_LEASE - timedelta(days=1)
        )
        replay = self.write_external(
            "lease-completed-1",
            lambda: (_ for _ in ()).throw(AssertionError("must not run handler again on completed replay")),
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.headers.get("X-Teruisi-Write-Replay"), "1")


class CompletedReceiptTtlTests(WriteReceiptLeaseTestBase):
    """2026-10-28 incident: _prune_expired_receipts() runs a real DELETE against
    ai_write_request_receipts inside write(). database_contract.WRITER_PRIVILEGES
    once granted only SELECT/INSERT/UPDATE there, so production's real
    teruisi_ai_writer role got `permission denied for table
    ai_write_request_receipts` on every write, including unrelated ones that
    happened to trigger the opportunistic prune. The Postgres owner connection
    this suite otherwise uses (DJANGO_PROCESS_ROLE="development") has no such
    restriction and could not have caught this.

    provision() is called with the real database_contract module so the grants
    are read from WRITER_PRIVILEGES itself, not re-declared here; the write
    that triggers the prune then runs under `SET SESSION AUTHORIZATION
    teruisi_ai_writer`, the same technique
    test_business_market_v2_material_role_bridge.py uses for the same purpose.
    If WRITER_PRIVILEGES regresses to omit DELETE on ai_write_request_receipts
    again, this test fails with a real DatabaseError instead of silently
    passing on owner privileges.
    """

    def setUp(self):
        super().setUp()
        if connection.vendor != "postgresql":
            self.skipTest("requires real PostgreSQL grants")
        connection.ensure_connection()
        provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))

    @contextmanager
    def real_writer_role(self):
        """Run the wrapped block as the real teruisi_ai_writer Postgres role.

        ai_runtime_write_fence() (migration 0003) additionally requires the
        write-authority epoch/cutover `set_config` values to match whenever
        current_user='teruisi_ai_writer', regardless of table-level GRANTs —
        so activating AiWriteAuthority and overriding DJANGO_PROCESS_ROLE to
        "ai_writer" (the same combination
        test_business_market_v2_material_role_bridge.py uses) is required
        alongside session_role, not a substitute for it.
        """
        AiWriteAuthority.objects.filter(id=1).update(
            status="postgres", authority_epoch=uuid4(),
            cutover_id="write-receipt-lease-isolated",
            migration_verify_run_id="write-receipt-lease-isolated",
            activated_at=timezone.now(),
        )
        authority = AiWriteAuthority.objects.get(id=1)
        with djtest.override_settings(
            DJANGO_PROCESS_ROLE="ai_writer",
            AI_WRITE_AUTHORITY_EPOCH=str(authority.authority_epoch),
            AI_WRITE_CUTOVER_ID=authority.cutover_id,
        ), session_role("teruisi_ai_writer"):
            yield
        # status='postgres' is a one-way terminal cutover (migration 0004); it
        # is never reset back to "d1" here, matching how production treats it.

    def test_completed_receipts_older_than_seven_days_are_pruned_on_next_write(self):
        first = self.write_external("ttl-old-1", lambda: ({"ok": True}, 200))
        self.assertEqual(first.status_code, 200)
        AiWriteReceipt.objects.filter(pk="ttl-old-1").update(
            completed_at=timezone.now() - views.COMPLETED_RECEIPT_TTL - timedelta(seconds=1)
        )

        # A later, unrelated write opportunistically prunes the aged-out completed receipt,
        # mirroring the lazy-cleanup-on-write template used by customer_service etc.
        # Run under the real minimal-privilege writer role: this is exactly the DELETE
        # that production's teruisi_ai_writer must be granted (2026-10-28 incident).
        with self.real_writer_role():
            second = self.write_external("ttl-old-2", lambda: ({"ok": True}, 200))
        self.assertEqual(second.status_code, 200)
        self.assertFalse(AiWriteReceipt.objects.filter(pk="ttl-old-1").exists())
        self.assertTrue(AiWriteReceipt.objects.filter(pk="ttl-old-2").exists())

    def test_completed_receipt_within_ttl_is_not_pruned(self):
        first = self.write_external("ttl-fresh-1", lambda: ({"ok": True}, 200))
        self.assertEqual(first.status_code, 200)
        AiWriteReceipt.objects.filter(pk="ttl-fresh-1").update(
            completed_at=timezone.now() - views.COMPLETED_RECEIPT_TTL + timedelta(minutes=5)
        )

        with self.real_writer_role():
            second = self.write_external("ttl-fresh-2", lambda: ({"ok": True}, 200))
        self.assertEqual(second.status_code, 200)
        self.assertTrue(AiWriteReceipt.objects.filter(pk="ttl-fresh-1").exists())

    def test_pruning_never_touches_processing_or_stale_manual_review_receipts(self):
        def crash():
            raise RuntimeError("synthetic worker crash")

        with self.assertRaises(RuntimeError):
            self.write_external("ttl-processing-1", crash)

        # Backdate created_at well past both the lease and the completed-receipt TTL, so
        # pruning would wrongly delete it too if it only checked age and ignored status.
        AiWriteReceipt.objects.filter(pk="ttl-processing-1").update(
            created_at=timezone.now() - views.COMPLETED_RECEIPT_TTL - timedelta(days=1)
        )

        with self.real_writer_role():
            second = self.write_external("ttl-processing-2", lambda: ({"ok": True}, 200))
        self.assertEqual(second.status_code, 200)
        # Still present and still "processing" — the TTL pruning only targets
        # status="completed" rows and must never silently delete a stuck processing
        # receipt; that row can only leave "processing" via the lease takeover above,
        # which requires a retry on its own request_id (covered by the lease tests).
        receipt = AiWriteReceipt.objects.get(pk="ttl-processing-1")
        self.assertEqual(receipt.status, "processing")
