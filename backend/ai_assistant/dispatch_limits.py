"""Daily model dispatch ceilings, read from the environment on every call.

Kept out of Django settings on purpose; invalid values fall back to the default and warn once.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

DEFAULTS = {
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_GLOBAL": 4000,
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_OWNER": 2500,
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_MODEL": 4000,
}
MINIMUM, MAXIMUM = 1, 100_000
_warned: set[str] = set()


def limit(name: str) -> int:
    default = DEFAULTS[name]
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        value = None
    if value is None or not MINIMUM <= value <= MAXIMUM:
        if name not in _warned:
            _warned.add(name)
            logger.warning("%s=%r is invalid (integer %d-%d expected); using default %d", name, raw, MINIMUM, MAXIMUM, default)
        return default
    return value
