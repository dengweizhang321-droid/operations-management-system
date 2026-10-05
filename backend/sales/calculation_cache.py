"""Bounded, revision-fenced reuse of sales query work across page projections.

This holds only sales-domain calculations, never browser responses or permissions.
The outer HTTP reader still checks its complete response revision.
"""
from collections import OrderedDict
from copy import deepcopy
import hashlib
import json
import pickle
from threading import Lock
import time

from django.conf import settings
from django.apps import apps
from django.db import connection

from .query import revision_token

MAX_ENTRIES = 32
MAX_BYTES = 4 * 1024 * 1024
MAX_ENTRY_BYTES = 1024 * 1024
_entries = OrderedDict()
_bytes = 0
_guard = Lock()
# Fixed stripes cannot evict an in-use singleflight lock.
_stripes = [Lock() for _ in range(32)]


def clear():
    global _bytes
    with _guard:
        _entries.clear()
        _bytes = 0


def context_identity(principal):
    database = connection.settings_dict
    # Sales reader is intentionally NOT granted sales_write_authority SELECT.
    # Bind its immutable runtime epoch/cutover, and use the ERP control object
    # already in the established reader grant. Never expand reader privileges.
    authority = None
    if apps.is_installed("erp_reference"):
        from erp_reference.models import ErpReferenceWriteAuthority
        authority = ErpReferenceWriteAuthority.objects.filter(id=1).values(
            "status", "authority_epoch", "cutover_id"
        ).first()
    return {
        "database": [connection.alias, *(str(database.get(k, "")) for k in ("ENGINE", "HOST", "PORT", "NAME", "USER"))],
        "authority": authority,
        "runtimeAuthority": [settings.SALES_WRITE_AUTHORITY_EPOCH, settings.SALES_WRITE_CUTOVER_ID,
            settings.ERP_WRITE_AUTHORITY_EPOCH, settings.ERP_WRITE_CUTOVER_ID],
        "actor": [principal.email, principal.role, principal.scope] if principal is not None else None,
    }


def reuse(operation, scope, principal, loader):
    global _bytes
    ttl = min(30, settings.SALES_READ_CACHE_SECONDS)
    if connection.in_atomic_block or not connection.get_autocommit() or ttl <= 0:
        return loader()
    before = revision_token()
    context = context_identity(principal)
    material = json.dumps([operation, scope, context, before], sort_keys=True, ensure_ascii=False, default=str)
    key = hashlib.sha256(material.encode()).hexdigest()
    with _stripes[int(key[:8], 16) % len(_stripes)]:
        now = time.monotonic()
        with _guard:
            for expired in [k for k, entry in _entries.items() if entry[0] <= now]:
                _bytes -= _entries.pop(expired)[2]
            entry = _entries.get(key)
            if entry:
                _entries.move_to_end(key)
                value = deepcopy(entry[1])
        if entry and revision_token() == before and context_identity(principal) == context:
            return value
        value = loader()
        # Concurrent commits are rejected by the outer read fence, and must
        # never leave an apparently reusable intermediate calculation.
        if revision_token() != before or context_identity(principal) != context:
            return value
        size = len(pickle.dumps(value, protocol=5))
        if size <= MAX_ENTRY_BYTES and size <= MAX_BYTES:
            with _guard:
                previous = _entries.pop(key, None)
                if previous:
                    _bytes -= previous[2]
                while _entries and (len(_entries) >= MAX_ENTRIES or _bytes + size > MAX_BYTES):
                    _, evicted = _entries.popitem(last=False)
                    _bytes -= evicted[2]
                _entries[key] = (time.monotonic() + ttl, deepcopy(value), size)
                _bytes += size
        return value
