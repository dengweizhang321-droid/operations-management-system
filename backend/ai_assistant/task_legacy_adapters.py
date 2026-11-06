"""Read-only legacy observation. This does not register or reschedule old jobs."""
from .policy import current_principal


def listing(principal):
    current_principal(principal, admin=True)
    from . import dingtalk_schedules
    result = dingtalk_schedules.listing(principal)
    return {"items": [{**row, "taskId": "legacy-dingtalk:" + row["id"], "ownership": "legacy-owned",
                       "executorKind": "dingtalk_schedule", "canControlHere": False} for row in result["items"]],
            "runs": result["runs"], "n8n": {"ownership": "legacy-owned", "registrationPerformed": False,
                       "note": "既有 n8n 继续拥有采集、导入和原 errorWorkflow；统一任务不复制 cron 或补跑。"}}
