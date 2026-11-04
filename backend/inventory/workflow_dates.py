"""Calendar metadata for newly frozen workflow collections; old imports retain Shanghai."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def collection_timezone(evidence, *, workflow):
    if "datePolicy" not in evidence and "timeZone" not in evidence:
        return ZoneInfo("Asia/Shanghai")
    zone = evidence.get("timeZone")
    if (not workflow or evidence.get("datePolicy") != "host_local_calendar_v1"
            or not isinstance(zone, str) or not zone or zone != zone.strip()):
        raise ValueError("Invalid workflow collection date context")
    try:
        return ZoneInfo(zone)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("Invalid workflow collection time zone") from exc
