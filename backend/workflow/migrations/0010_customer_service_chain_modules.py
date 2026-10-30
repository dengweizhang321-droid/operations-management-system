# Generated for B4-prep: register 京东客服链 (JdCustomerService2026) modules.
#
# These three rows are code-side registry data (see automation_models.py's
# AutomationModule docstring — "not a user-editable table"), not business
# data: module_key/platform/chain_key/domain/dataset are all plain code
# tokens validated by validate_code_token, matching the existing
# conventions workflow.0002_seed_control_rows established for this app's
# other control rows.
#
# Scope per docs/自动化/京东/jd-customer-service-workflow.md: the device
# store (`jd-yiyong-director` / 志高商用设备旗舰店) runs three modules a
# day — session Excel export, chat LOG export, and the paired daily
# import that reconciles them. evidence_requirement="pairing" (not
# "batch") because CustomerServiceImportBatch has no date_min/date_max;
# see automation_gates.read_customer_service_evidence's docstring and
# this task's point 2/3 discussion of why session_only/chat_only/
# ambiguous counts must be consulted, not just "a batch exists".

from django.db import migrations


CUSTOMER_SERVICE_MODULES = [
    {
        "module_key": "jd_customer_service.session_excel",
        "label": "京东客服·会话 Excel 导出",
        "platform": "京东",
        "chain_key": "jd_customer_service",
        "domain": "customer_service",
        "dataset": "customer_service",
        "date_policy": "rolling_30d",
        "depends_on": [],
        "imports_data": False,
        "evidence_requirement": "pairing",
        "allowed_actions": [],
        "schedulable": True,
    },
    {
        "module_key": "jd_customer_service.chat_log",
        "label": "京东客服·聊天记录 LOG 导出",
        "platform": "京东",
        "chain_key": "jd_customer_service",
        "domain": "customer_service",
        "dataset": "customer_service",
        "date_policy": "rolling_30d",
        "depends_on": [],
        "imports_data": False,
        "evidence_requirement": "pairing",
        "allowed_actions": [],
        "schedulable": True,
    },
    {
        "module_key": "jd_customer_service.paired_daily_import",
        "label": "京东客服·分天配对导入",
        "platform": "京东",
        "chain_key": "jd_customer_service",
        "domain": "customer_service",
        "dataset": "customer_service",
        "date_policy": "rolling_30d",
        "depends_on": ["jd_customer_service.session_excel", "jd_customer_service.chat_log"],
        "imports_data": True,
        "evidence_requirement": "pairing",
        "allowed_actions": [],
        "schedulable": True,
    },
]


def seed_customer_service_modules(apps, _schema_editor):
    AutomationModule = apps.get_model("workflow", "AutomationModule")
    for row in CUSTOMER_SERVICE_MODULES:
        AutomationModule.objects.get_or_create(
            module_key=row["module_key"],
            defaults={key: value for key, value in row.items() if key != "module_key"},
        )


def remove_customer_service_modules(apps, _schema_editor):
    AutomationModule = apps.get_model("workflow", "AutomationModule")
    AutomationModule.objects.filter(
        module_key__in=[row["module_key"] for row in CUSTOMER_SERVICE_MODULES]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("workflow", "0009_automation_projection_b1")]
    operations = [migrations.RunPython(seed_customer_service_modules, remove_customer_service_modules)]
