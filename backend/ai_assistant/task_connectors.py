"""Connector/readiness disclosure. No secrets, implicit identity or enablement."""
import json
from .policy import current_principal


def listing(principal):
    current_principal(principal, admin=True)
    return {"items": [
        {"id": "dingtalk", "status": "existing_channel_not_bound_to_unified_tasks",
         "capabilities": ["verified_message_ingress", "approved_group_delivery", "self_person_delivery"],
         "identityBindingRequired": True, "credentialLocation": "trusted_server_only"},
        {"id": "netshop", "status": "existing_single_shop_readers",
         "capabilities": ["single_shop_authorized_read"], "automaticDependencyAdapterReady": False},
        {"id": "wechat", "status": "awaiting_account_type_and_api_permission", "capabilities": []}],
        "executionEnabled": False}


def readiness(row, principal):
    from .task_definitions import revision_for, normalize
    from .task_models import TaskGrant
    from . import configuration
    from django.utils import timezone
    current_principal(principal, admin=True)
    revision = revision_for(row)
    spec = json.loads(revision.spec_json)
    blockers = []
    try:
        normalize(spec, principal)
        model = configuration.resolve_model(spec["modelId"])
        if model.version != spec["modelVersion"]:
            blockers.append("model_version_changed")
    except Exception as error:
        from .policy import AiError
        if not isinstance(error, AiError):
            raise
        blockers.append(error.code)
    if not TaskGrant.objects.filter(revision=revision, owner_email=row.owner_email,
            revoked_at__isnull=True, expires_at__gt=timezone.now()).exists():
        blockers.append("long_term_authorization_missing")
    if spec["skill"]["kind"] == "library_guidance":
        blockers.append("library_guidance_is_not_pi_runtime_skill")
    blockers.extend(["unified_pi_executor_not_adopted", "recurring_cost_authorization_not_bound"])
    if spec["trigger"]["kind"] != "time":
        blockers.append("trusted_trigger_adapter_not_bound")
    if spec["dataDependencies"]:
        blockers.append("trusted_dependency_reader_not_bound")
    if spec["deliveryTargets"]:
        blockers.append("principal_and_delivery_binding_not_bound")
    return {"ready": False, "blockers": list(dict.fromkeys(blockers)),
            "saveDoesNotEnable": True, "legacyOwnershipChanged": False}
