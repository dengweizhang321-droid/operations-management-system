"""Bounded process-local complete base calculation; no browser/HTTP cache."""
from collections import OrderedDict
import json
from threading import Lock
from time import monotonic

from django.conf import settings
from django.db import connection

from .errors import ProductsApiError


class SummaryCache:
    def __init__(self, *, capacity=4, maximum_bytes=16 * 1024 * 1024, ttl=120):
        self.lock = Lock()
        self.entries = OrderedDict()
        self.capacity, self.maximum_bytes, self.ttl = capacity, maximum_bytes, ttl
        self.bytes = 0

    def read(self, key, loader, validate, *, with_status=False):
        # Same-process regions share a single complete calculation. No lock or
        # database timeout is extended; waiting is bounded and fails locally.
        if not self.lock.acquire(timeout=5):
            raise ProductsApiError("商品公共数据正在更新，请稍后重试", code="service_unavailable", status=503)
        try:
            now = monotonic()
            for old_key in list(self.entries):
                if self.entries[old_key][0] <= now:
                    self.bytes -= self.entries.pop(old_key)[1]
            if key in self.entries:
                validate()
                self.entries.move_to_end(key)
                value = json.loads(self.entries[key][2])
                return (value, True) if with_status else value
            value = loader()
            validate()
            encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            size = len(encoded)
            if size <= self.maximum_bytes:
                while self.entries and (len(self.entries) >= self.capacity or self.bytes + size > self.maximum_bytes):
                    _, entry = self.entries.popitem(last=False)
                    self.bytes -= entry[1]
                # Store immutable bytes: hit decoding and size accounting are
                # bounded, and callers cannot mutate another region's rows.
                self.entries[key] = (monotonic() + self.ttl, size, encoded)
                self.bytes += size
            return (value, size <= self.maximum_bytes) if with_status else value
        finally:
            self.lock.release()


cache = SummaryCache()


def cached_base(principal, options, snapshot, loader, validate, *, with_status=False):
    # Never leak uncommitted test/import rows into a reader's process cache.
    if connection.in_atomic_block or not connection.get_autocommit():
        value = loader()
        validate()
        return (value, False) if with_status else value
    db = connection.settings_dict
    identity = tuple(str(db.get(k, "")) for k in ("ENGINE", "HOST", "PORT", "NAME", "USER"))
    authority = tuple(str(getattr(settings, k, "")) for k in (
        "SALES_WRITE_AUTHORITY_EPOCH", "ERP_WRITE_AUTHORITY_EPOCH", "PRODUCTS_WRITE_AUTHORITY_EPOCH"))
    scope = {k:options[k] for k in ("range", "rangeExplicit", "startDate", "endDate", "days", "platforms", "shops")}
    key = (identity, authority, principal.email, principal.role,
        json.dumps(principal.scope, sort_keys=True), json.dumps(scope, sort_keys=True), snapshot)
    return cache.read(key, loader, validate, with_status=with_status)
