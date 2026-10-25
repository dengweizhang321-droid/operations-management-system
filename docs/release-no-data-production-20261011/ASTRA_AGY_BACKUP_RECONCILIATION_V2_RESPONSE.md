# Astra / AGY V2 cross-review

AGY was actually invoked in the existing conversation `d154e0e3-9d9b-4439-a580-49b627cb5670`, plan/text mode, with final V2 adapter/state/runner and Root's resume2 generator source inline. The call ran from 2026-10-11T17:03:46.557Z to 17:04:29.011Z (42.454 seconds), exited 0, and returned a nonempty response. The model's duration field describes cumulative conversation context; it is not this call's elapsed duration.

Original prompt, stream, stderr, call metadata and extracted response are retained under the production evidence directory with prefix `AGY_BACKUP_RECONCILIATION_V2_`. No production action was invoked by the review.

AGY explicitly corrected its prior “600-second timeout” claim: the actual WAL records nonzero_exit, exitCode 1 and timeoutType null. It also corrected the previously mixed 259/87 wording: V2 requires CIM absence plus OpenProcess(0x1000) failure with error 87 for both fixed PIDs; successful handles are closed and rejected, other failures remain unresolved. The exact PowerShell path/SHA with nlink 2 exception does not relax ordinary single-link checks.

Its concrete remaining finding agrees with Astra: the reviewed resume2 generator has not yet cleared NODE_* before launching the administrator-side Node runner. Root must add that check/clear in the not-yet-generated resume stage. The normal capture stage must preserve the exact original environment, which already matched bc79 with no NODE_* names. The restored entry still receives the complete original environment explicitly.

The model found no further concrete blocker in the one-event/five-output/no-replay design as supplied. This is a limited text review, not proof of production append, actual kernel-query execution, Restore or overall release success. Its phrase “kernel absence proof” is limited to the sampled fixed-PID checks: error 87 and CIM absence are not a continuous process-exclusion guarantee or a reason to weaken the original ownership/admission gates. UAC pending remains an operating-system authorization boundary and is not bypassed by this review.

At review time no reconciliation event had been reported as written; resume2 remained unexecuted. Root's independent 35/35 tests and actual original Verify are separate evidence from AGY's opinion. The original unknown WAL, releaseRetention blocked result, sealed f15 scope and all remaining required operations remain intact.
