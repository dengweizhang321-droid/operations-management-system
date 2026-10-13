# Recovery integration failure contract

This new recovery is separate from the failed original Start. It does not replay that batch operation, remove its unknown event, create historical fingerprints, run another Backup/Restore, or release the batch owner.

The ordered stages are exact-context preflight, new own maintenance intent, the original actual automation drain, held-handle stopping of the declared 23 roots and 69 approved descendants, original Worker EnterMaintenance with PostgreSQL preserved, original stopped-state ExitMaintenance, original Start, bounded restoration of the original supervisor, readiness, original diagnostic installation and installation readback. The original watchdog mutex remains owned by the same PowerShell thread across these stages. The original installer takes its reentrant lease itself; no child process substitutes for that call.

Failure before the first mutation leaves admission unchanged. After any attempted mutation, the wrapper verifies or create-only restores its exact approved maintenance marker; it never clears a foreign gate. An ExitMaintenance call is considered capable of clearing admission before it returns, so even an error from that call requires containment. The marker does not assert stopped/drained. The result reports a failure to restore containment explicitly; a held mutex is not an operating-system-wide exclusion guarantee.

Partial instance termination remains partial and is recorded. No catch block replays stops, starts services, clears a gate, removes ownership, edits a WAL, or chooses a different instance. A deadline limits normal operations; failure containment is a separate bounded emergency write that must be included in the exact approval, not skipped just because the operation deadline expired.

Installation success still leaves natural checks and the original Start postcondition reconciliation / remaining batch acceptance outstanding. The immutable task version, task Action, installation record and installer transaction writes require their own precise approved scope; triggers, principal and RunLevel remain unchanged. A currently running legacy check is not terminated by the mutex or marker.

The fixed adapter, plan/source binding, actual descendant metadata, same-thread module isolation, lifecycle transport, stage predicates, failure fence and actual install plan are now prepared and isolated-tested. They are not production acceptance. The public template can only be sealed after exact new approval; no production launch was performed during this development.
