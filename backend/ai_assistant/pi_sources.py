"""One finished task's evidence: what it read, what it did, what it produced.

Assembles the records that already exist — export provenance, the stage event
stream, artifact rows and the operation's own identity — into the citation a
Skill candidate needs. Nothing here is a new source of truth, and nothing is
recomputed: if a field was not proven when the task ran, it stays absent.

The stage list is deliberately a skeleton. The event stream holds message and
tool payloads, and copying them here would turn an evidence view into a second
transcript; callers that need a payload read the event stream itself under its
own bounds.
"""
import json

from .pi_models import PiEvent, PiExport, PiFile, PiOperation
from .policy import AiError, digest, fields, identifier

#: Stage events worth citing as "what happened". Message deltas and payload
#: carrying types are excluded: this view proves sequence, not content.
STAGE_TYPES = (
    "tool_start", "tool_end", "tool_execution_start", "tool_execution_end",
    "file_ready", "completed", "error",
    "task_feedback_confirmed", "task_feedback_superseded", "task_feedback_withdrawn",
)
MAX_STAGES = 200
MAX_SOURCES = 50
MAX_FILES = 50


def _owned(operation_id, principal):
    row = (PiOperation.objects.select_related("session")
           .filter(id=identifier(operation_id)).first())
    if row is None or row.session.owner_email.lower() != principal.email.lower():
        raise AiError("任务不存在或不属于当前账号", "not_found", 404)
    return row


def _sources(operation):
    items = []
    for export in (PiExport.objects.filter(operation=operation)
                   .order_by("created_at")[:MAX_SOURCES]):
        manifest = json.loads(export.manifest_json or "{}")
        items.append({
            "exportId": export.id,
            "status": export.status,
            "dataset": manifest.get("dataset"),
            "sourceDomain": manifest.get("sourceDomain"),
            "domainRevisions": manifest.get("domainRevisions", []),
            "fields": manifest.get("fields", []),
            "units": manifest.get("units", {}),
            # Kept verbatim from the manifest. A page being complete is not the
            # same as a snapshot being atomic across pages, and the owning
            # exporter is the only thing that can say which held.
            "snapshotComplete": manifest.get("snapshotComplete", False),
            "warnings": manifest.get("warnings", []),
            "fileId": export.file_id,
            "errorCode": export.error_code or None,
            "manifestDigest": digest(manifest) if manifest else None,
        })
    return items


def _stages(operation):
    rows = (PiEvent.objects.filter(operation=operation, event_type__in=STAGE_TYPES)
            .order_by("event_seq")[:MAX_STAGES])
    return [{"eventSeq": row.event_seq, "type": row.event_type,
             "createdAt": row.created_at.isoformat()} for row in rows]


def _artifacts(operation):
    rows = (PiFile.objects.filter(operation=operation)
            .order_by("created_at")[:MAX_FILES])
    return [{"fileId": row.id, "fileName": row.file_name, "mimeType": row.mime_type,
             "sizeBytes": row.size_bytes, "sha256": row.sha256,
             "direction": row.direction} for row in rows]


def _corrections(operation):
    from . import models as m
    rows = (m.AiTaskFeedback.objects.filter(operation=operation)
            .order_by("confirmed_at", "id")[:MAX_STAGES])
    return [{"feedbackId": row.id, "targetKind": row.target_kind,
             "targetRef": row.target_ref, "appliesTo": row.applies_to,
             "source": row.source, "status": row.status} for row in rows]


def evidence(operation_id, params, principal):
    """The report version plus the three reference lists behind it."""
    fields(params, set())
    operation = _owned(operation_id, principal)
    sources, artifacts = _sources(operation), _artifacts(operation)
    corrections = _corrections(operation)
    confirmed = [item["feedbackId"] for item in corrections
                 if item["status"] == "confirmed"]
    # Every identifier below is an existing field. The server composes them;
    # a caller cannot submit a report version of its own.
    version = {
        "operationId": operation.id,
        "generation": operation.generation,
        "epoch": operation.epoch,
        "status": operation.status,
        "modelId": operation.model_id or None,
        "modelVersion": operation.model_version,
        "capabilityHash": operation.capability_hash or None,
        "skills": json.loads(operation.skills_json or "[]"),
        "sourceManifestDigests": [item["manifestDigest"] for item in sources
                                  if item["manifestDigest"]],
        "fileShas": [item["sha256"] for item in artifacts],
        "confirmedFeedbackIds": confirmed,
    }
    # Coverage is reported, never inferred: a warning from any source, or a
    # source that did not prove an atomic snapshot, keeps this false.
    complete = bool(sources) and all(
        not item["warnings"] and item["status"] == "succeeded" for item in sources)
    return {
        "reportVersion": version,
        "reportVersionDigest": digest(version),
        "sources": sources,
        "stages": _stages(operation),
        "artifacts": artifacts,
        "corrections": corrections,
        "coverage": {
            "sourcesComplete": complete,
            "anySnapshotComplete": any(item["snapshotComplete"] for item in sources),
            "truncated": {
                "sources": PiExport.objects.filter(operation=operation).count() > MAX_SOURCES,
                "artifacts": PiFile.objects.filter(operation=operation).count() > MAX_FILES,
            },
        },
        # An unsettled or unknown operation can still be inspected, but its
        # evidence is not a finished report and must not be cited as one.
        "citable": operation.status == "succeeded",
    }


def events_after(operation_id, params, principal):
    """Stage skeleton past a cursor, for a caller following a running task."""
    from .pi_service import number
    fields(params, {"after"})
    operation = _owned(operation_id, principal)
    after = number(params.get("after", "0"), "after", 0, 2 ** 53 - 1)
    rows = (PiEvent.objects.filter(operation=operation, event_type__in=STAGE_TYPES,
                                   event_seq__gt=after)
            .order_by("event_seq")[:MAX_STAGES])
    items = [{"eventSeq": row.event_seq, "type": row.event_type,
              "createdAt": row.created_at.isoformat()} for row in rows]
    return {"items": items, "after": after, "returned": len(items),
            "operationId": operation.id}
