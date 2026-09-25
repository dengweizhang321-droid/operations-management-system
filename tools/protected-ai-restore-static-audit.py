"""Read-only, conservative audit of the protected AI logical restore contract.

This script never connects to PostgreSQL. A zero exit code only means that the
static blockers it knows about are absent; it never certifies a restore.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROTECTED_ROLES = {
    "teruisi_ai_budget_v11_attestor",
    "teruisi_ai_budget_v11_key_owner",
    "teruisi_ai_budget_v11_publisher",
    "teruisi_ai_market_paid_adopter",
    "teruisi_ai_market_paid_reserver",
    "teruisi_ai_market_paid_starter",
    "teruisi_ai_budget_v11_attest_login",
    "teruisi_ai_budget_v11_sign_login",
    "teruisi_ai_budget_v11_publish_login",
    "teruisi_ai_market_rate_proposer",
    "teruisi_ai_market_cap_proposer",
    "teruisi_ai_market_proposal_revoker",
}


def audit(root: Path = ROOT) -> dict[str, object]:
    helper = (root / "tools/postgres-consistent-backup.py").read_text(encoding="utf-8")
    operator = (root / "tools/django-postgres-maintenance.ps1").read_text(encoding="utf-8")
    migration = (root / "backend/ai_assistant/migrations/0068_business_promotion_budget_v11_verifier_receipt.py").read_text(encoding="utf-8")
    installer = (root / "tools/django-local-service.ps1").read_text(encoding="utf-8")
    issues: list[str] = []

    roles_block = re.search(r"\$MaintenanceRehearsalRoles\s*=\s*@\((.*?)\)", operator, re.S)
    actual_roles = set(re.findall(r'"(teruisi_[a-z0-9_]+)"', roles_block.group(1))) if roles_block else set()
    missing = sorted(PROTECTED_ROLES - actual_roles)
    if missing:
        issues.append("isolated restore lacks protected NOLOGIN role preflight: " + ",".join(missing))
    if re.search(r'\^teruisi_\[a-z_\]', operator) and any(
            not re.fullmatch(r"teruisi_[a-z_]{1,64}", role)
            for role in PROTECTED_ROLES):
        issues.append("restore role-name validator rejects versioned protected roles")

    backup = helper.partition("def run_backup(")[2].partition("def run_probe(")[0]
    restore = helper.partition("def run_restore(")[2].partition("def build_parser(")[0]
    dump_flags = re.search(r"FORMAL_DUMP_FLAGS\s*=\s*\((.*?)\)", helper, re.S)
    restore_flags = re.search(r"FORMAL_RESTORE_FLAGS\s*=\s*\((.*?)\)", helper, re.S)
    if ('"--no-privileges"' in backup or
            (dump_flags and '"--no-privileges"' in dump_flags.group(1)
             and "*FORMAL_DUMP_FLAGS" in backup)):
        issues.append("custom backup suppresses ACL entries")
    if ('"--no-owner"' in restore or '"--no-privileges"' in restore or
            (restore_flags and "*FORMAL_RESTORE_FLAGS" in restore and
             ('"--no-owner"' in restore_flags.group(1) or
              '"--no-privileges"' in restore_flags.group(1)))):
        issues.append("restore suppresses recorded object owners or ACLs")
    if ("PGUSER = \"teruisi_sales_owner\"" in operator
            and "ALTER TABLE " + '" + KEY_TABLE + " OWNER TO "' in migration
            and "GRANT SELECT ON " + '" + KEY_TABLE' not in migration):
        issues.append("backup owner has no proven SELECT on isolated verifier key table")
    if ("NOCREATEROLE" in installer and "CREATE ROLE " in migration
            and "GRANT " + '" + KEY_OWNER + " TO "' in migration):
        issues.append("ordinary migration owner cannot create or temporarily grant protected role")
    if "REVOKE " + '" + KEY_OWNER + " FROM "' in migration and "SELECT count(*) FROM " in migration:
        issues.append("0068 installer reads private key table after revoking its temporary membership")

    return {
        "scope": "static source only; no database connection or restore",
        "status": "blocked" if issues else "requires_isolated_cross_cluster_rehearsal",
        "issues": issues,
    }


if __name__ == "__main__":
    result = audit()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    raise SystemExit(2 if result["issues"] else 0)
