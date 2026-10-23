# Exact Restore and closeout readback scope

This is a readback plan prepared from existing records and installed source. No Restore completion is asserted here. No process/native/port query, production API, test, build or full source/dependency scan was executed by this reviewer.

## Fixed evidence paths

- Original batch journal: D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011/.
- Installed consumer passed: 000039.json, 2026-10-12T01:44:40.269Z, duration189526.4766ms, receipt1619a67c…, head new21c, chainbc87c4d6…, version teruisi-release-payload-retention-v1. This invokes the newly installed read-only planner and validates its receipt/installed bytes/chain before and after; it does not execute payload cleanup.
- Restore admission: 000040.json; Restore start: 000041.json at 2026-10-12T01:45:49.209Z.
- Actual operator audit: D:/teruisi-runtime/django-sales/audits/postgres-operations/ef627746ece34ad88a066d5af4083fe2.json. At this read it was running/restore_data, with startedAt01:45:55.7939766 and updatedAt01:46:22.6687753 UTC; result/failure were null.
- Expected final result: E:/TERUISI-Postgres-Rehearsals/restore-0d2c8cfba17c/rehearsal-result.json and rehearsal-result.json.sha256. The operator writes these atomically in its finally path, including on failures; existence alone is not success.
- Original recovery point: E:/运营管理系统业务数据/daily-20261011T162958Z-49bdf7f519aa/. Use the already bound manifest/dump/content hashes; do not create a new backup or rerun a restore for this readback.

## Required result checks after Root reports completion

Recompute the result file SHA and exact sidecar binding. Require original version teruisi-postgres-restore-rehearsal-v1, completed status, rehearsalId0d2c8cfba17c and isolatedPort55433. Tie backupId49bdf7f519aa to the exact prior confirmed backup, backupManifestSha256 a46097b7…, dumpSha256 e88b7cbb…, and both expected/restored content SHA f261acde…. Compare the operator audit result, original batch receipt hash and available captured stdout digest without manufacturing missing raw output.

Enforce the original approved assertions: productionDatabaseTouched=false, serviceStateChanged=false, cleanupStatus=isolated_data_removed, profileRestoreVerified=true and sequenceHealthVerified=true. Read the profile/policy-syntax fields as actually emitted. Do not add a new requirement that optional policySyntaxEquivalenceVerified must always be true when the original approved operation does not require that assertion. Content equality is equality to this immutable backup snapshot, not an assumption that naturally evolving production data must equal its earlier contents.

The installed operator path is D:/teruisi-runtime/django-sales/app/tools/django-postgres-maintenance.ps1; its original logic is unchanged. The new installed Worker verifier/rotation consumer was exercised only after Worker apply, Django DeployApp and HardenAcl passed. The new Django deployment is85cf, while the recovery point was created under the predecessor. The original Restore resolver intentionally does not require current deployment equality for an old approved archive; it still enforces exact archive identity and complete evidence.

The E rehearsal root is private and distinct from production data, with port55433 rather than5432. Its original preflight checks the port, ACL/root, tool/role identities and capacity; it sets isolated connection variables and creates a new, nonreusable rehearsalId directory. Cleanup requires exact isolated ownership/port checks before data removal. Later readback may check existence/metadata of its data directory and temporary password pathname, but must not read either data files or password contents. A new native port query is outside this readback request and remains Root's responsibility if independently necessary.

productionDatabaseTouched=false means the restore targets the isolated database; it must not be rewritten as zero production connections. The original admission/readiness/identity checks can perform authorized read-only production checks.

## Subsequent nineteen-operation completion

After actual Restore success, independently follow original ExitMaintenance, StartWorker, display/permission observations, unchanged business closure, startup/status/natural watchdog and final closeout records. Recompute the complete journal chain and latest status for all nineteen approved operations; preserve every historic failure/reconciliation. Require the original completed closeout and ownership release, actual final candidate/component identities and bounded acceptance evidence. Wrapper exit0 alone, service reachability alone, or this result plan alone is insufficient. Preserve the documented sampling gap and do not turn reused watcher snapshots into extra successful rounds.
