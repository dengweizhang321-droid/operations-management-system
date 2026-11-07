"""Bounded, passive DAG timings from the existing execution ledger.

Dispatch windows include local preparation/receipt persistence, not just vendor
compute time. Parallel windows are unioned; node effort is never called elapsed
wall time. Missing/invalid timestamps remain unknown, including legacy runs.
"""

import json

from . import models as m


def milliseconds(start, end):
    if start is None or end is None or end < start:
        return None
    return int((end - start).total_seconds() * 1000)


def union_milliseconds(windows):
    intervals = sorted((start, end) for start, end in windows
                       if start is not None and end is not None and end >= start)
    total, previous = 0, None
    for start, end in intervals:
        if previous is None or start > previous:
            total += milliseconds(start, end)
        elif end > previous:
            total += milliseconds(previous, end)
        previous = max(previous, end) if previous is not None else end
    return total


def summarize(row, nodes):
    """Called only after the original workflow ownership check, for detail GET."""
    node_ids = {node.agent_job_id for node in nodes if node.agent_job_id}
    jobs = {job.id: job for job in m.AiAgentJobs.objects.filter(
        workflow_run_id=row.id, id__in=node_ids).only(
            "id", "created_at", "started_at", "completed_at")[:24]}
    providers = list(m.AiAgentProviderDispatches.objects.filter(job_id__in=jobs)
                     .only("id", "job_id", "state", "reserved_at", "completed_at")
                     .order_by("reserved_at", "id")[:481])
    tools = list(m.AiAgentToolDispatches.objects.filter(job_id__in=jobs)
                 .only("id", "job_id", "state", "reserved_at", "completed_at")
                 .order_by("reserved_at", "id")[:961])
    bounded = len(providers) <= 480 and len(tools) <= 960
    # Never describe a partial result as a full timing total.
    providers, tools = providers[:480], tools[:960]
    by_key = {node.node_key: node for node in nodes}
    items = []
    windows = {"provider": [], "tool": [], "human": []}
    unknown_dispatches = 0
    for node in nodes:
        job = jobs.get(node.agent_job_id)
        try:
            dependencies = [by_key[key] for key in json.loads(node.depends_on_json)]
            ready_at = (max(dependency.completed_at for dependency in dependencies)
                        if dependencies and all(d.completed_at for d in dependencies)
                        else row.created_at if not dependencies else None)
        except (TypeError, ValueError, KeyError):
            ready_at = None
        # _fail writes a local completed_at while preserving state=unknown.
        # That timestamp is not proof that the external call completed.
        model_windows = [(d.reserved_at, d.completed_at if d.state in {"succeeded", "failed"} else None) for d in providers
                         if job is not None and d.job_id == job.id]
        tool_windows = [(d.reserved_at, d.completed_at if d.state in {"succeeded", "failed"} else None) for d in tools
                        if job is not None and d.job_id == job.id]
        windows["provider"].extend(model_windows)
        windows["tool"].extend(tool_windows)
        missing = sum(milliseconds(start, end) is None for start, end in
                      model_windows + tool_windows)
        unknown_dispatches += missing
        human = node.node_type == "human_review"
        if human:
            windows["human"].append((node.started_at, node.reviewed_at))
        items.append({
            "nodeKey": node.node_key,
            "nodeId": node.id,
            "jobId": job.id if job is not None else None,
            "dependencyReadyToStartMs": milliseconds(ready_at, node.started_at),
            "initialQueueToClaimMs": milliseconds(job.created_at, job.started_at) if job else None,
            "providerDispatchWindowMs": union_milliseconds(model_windows) if bounded and not missing else None,
            "toolDispatchWindowMs": union_milliseconds(tool_windows) if bounded and not missing else None,
            "humanReviewMs": milliseconds(node.started_at, node.reviewed_at) if human else None,
            "childCompletionToObservationMs": milliseconds(job.completed_at, node.completed_at) if job else None,
            "unknownDispatches": missing,
        })
    all_nodes_done = bool(nodes) and all(node.completed_at for node in nodes)
    return {
        "version": "existing-dag-timing-v1",
        "basis": "persisted_timestamps_dispatch_windows_include_local_overhead",
        "wallMs": milliseconds(row.created_at, row.completed_at),
        "providerDispatchUnionMs": union_milliseconds(windows["provider"]) if bounded and not unknown_dispatches else None,
        "toolDispatchUnionMs": union_milliseconds(windows["tool"]) if bounded and not unknown_dispatches else None,
        "humanReviewUnionMs": (union_milliseconds(windows["human"])
                               if all(milliseconds(a, b) is not None for a, b in windows["human"]) else None),
        "finalObservationToCompletionMs": milliseconds(
            max(node.completed_at for node in nodes), row.completed_at) if all_nodes_done else None,
        "unknownDispatches": unknown_dispatches,
        "truncated": not bounded,
        "additive": False,
        "nodes": items,
    }
