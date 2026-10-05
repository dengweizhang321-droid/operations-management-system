"""Inventory-only, bounded complete base reuse. HTTP responses remain no-store.

Values never leave this process or accept external serialized input. Independent
copies protect callers that suppress recommendations or enrich current-page rows.
"""
from collections import OrderedDict
import json
import hashlib
import pickle
from threading import RLock
from time import monotonic

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .errors import InventoryApiError
from .revisions import revision_value
from sales.models import SalesDataRevision


class InventoryReadCache:
    def __init__(self, capacity=8, maximum_bytes=32 * 1024 * 1024, ttl=60):
        self.entries = OrderedDict()
        self.bytes = 0
        self.capacity, self.maximum_bytes, self.ttl = capacity, maximum_bytes, ttl
        self.lock = RLock()

    def clear(self):
        with self.lock:
            self.entries.clear()
            self.bytes = 0

    def read(self, key, loader, validate):
        if not self.lock.acquire(timeout=5):
            raise InventoryApiError("库存公共计算正在更新，请稍后重试", status=503, code="service_unavailable")
        try:
            now = monotonic()
            for old in list(self.entries):
                if self.entries[old][0] <= now:
                    self.bytes -= self.entries.pop(old)[1]
            entry = self.entries.get(key)
            if entry is not None:
                value = pickle.loads(entry[2])
                validate()
                self.entries.move_to_end(key)
                return value
            value = loader()
            encoded = pickle.dumps(value, protocol=5)
            validate()
            size = len(encoded)
            if size <= self.maximum_bytes:
                while self.entries and (len(self.entries) >= self.capacity or self.bytes + size > self.maximum_bytes):
                    _, old = self.entries.popitem(last=False)
                    self.bytes -= old[1]
                self.entries[key] = (monotonic() + self.ttl, size, encoded)
                self.bytes += size
            return value
        finally:
            self.lock.release()


cache = InventoryReadCache()


def snapshot():
    upstream = tuple(SalesDataRevision.objects.filter(domain__in=["sales", "erp"]).order_by("domain").values_list("domain", "revision"))
    # BI's existing reader intentionally cannot read inventory write authority.
    # The process is bound to immutable authority epochs by runtime readiness;
    # include those bindings without adding database permissions to consumers.
    authority = tuple(str(getattr(settings, k, "")) for k in (
        "INVENTORY_WRITE_AUTHORITY_EPOCH", "SALES_WRITE_AUTHORITY_EPOCH", "ERP_WRITE_AUTHORITY_EPOCH"))
    return revision_value(), upstream, authority, timezone.localdate().isoformat()


def cached_base(kind, principal, scope, loader):
    # None-principal legacy consumers keep their existing behavior and never
    # share a principal's cache. Uncommitted imports/tests always bypass reuse.
    if principal is None or connection.in_atomic_block or not connection.get_autocommit():
        return loader()
    db = connection.settings_dict
    identity = tuple(str(db.get(k, "")) for k in ("ENGINE", "HOST", "PORT", "NAME", "USER"))
    role = ()
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user, current_setting('role')")
            role = tuple(cursor.fetchone())
    epochs = tuple(str(getattr(settings, k, "")) for k in (
        "INVENTORY_WRITE_AUTHORITY_EPOCH", "SALES_WRITE_AUTHORITY_EPOCH", "ERP_WRITE_AUTHORITY_EPOCH"))
    before = snapshot()
    scope_digest = hashlib.sha256(json.dumps(scope, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    permission_digest = hashlib.sha256(json.dumps(principal.scope, sort_keys=True).encode()).hexdigest()
    key = (kind, identity, role, epochs, principal.email, principal.role,
           permission_digest, scope_digest, before)
    def validate():
        if snapshot() != before:
            raise InventoryApiError("库存或来源版本在计算期间发生变化，请刷新重试", status=503, code="service_unavailable")
    return cache.read(key, loader, validate)
