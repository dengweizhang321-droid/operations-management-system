# Independent review and corrections

The real agy.exe CLI was invoked in conversation d154e0e3-9d9b-4439-a580-49b627cb5670 with text-only review instructions. Each invocation returned a non-empty result. Exact prompts, streams, stderr and call times are archived in evidence/ with their original names; no reviewer approval substitutes for production evidence.

AGY_STATUS_SAFETY initially reported no added blocker within the reviewed two-file scope. Its statements that the call graph was complete or behavior was entirely separated were overbroad: evidence covered seven explicit helper call sites and43 synthetic scenarios per PowerShell host, not every application caller or production behavior.

The author then noticed Action validation is case-insensitive while the first implementation used -cmatch. The final case-independent -imatch check and a lowercase status fixture were reviewed in AGY_CASE_DELTA. AGY accepted the delta and explicitly narrowed its prior wording to the tested scope.

Root subsequently found a concrete omission that both initial author tests and AGY missed: immediately throwing on incomplete CIM metadata discarded Start-ManagedProcess's existing bounded startup wait. The V1 source and test bytes were saved in V1_SOURCE_SNAPSHOT outside the repository, and its earlier review is retained without retroactive success claims.

V2 restores the default20 bounded attempts. Metadata incompleteness is remembered; a later complete instance may succeed, but exhaustion after an incomplete observation throws instead of returning null. Query errors and duplicate rows still reject immediately. The two added PS5/PS7 cases verify incomplete-then-complete and incomplete-through-budget with exact call counts, bringing coverage to45 scenarios per host.

AGY_STARTUP_WAIT_V2 reviewed the final function and exact Django c3896367… hash. Its non-empty response explicitly withdrew the premature V1 startup conclusion and found no new blocker in this correction. The result object's duration_seconds is cumulative conversation data, not this invocation's elapsed duration; use the individual CALL timestamps or step timing if timing is needed.

No AGY turn ran production tools, validated actual recovered process ownership or adopted the source. Current f15, installed packages, immutable watchdog binding/version and task remain outside these code/test changes. The source freeze and limits are in REPORT.md; prospective recovery remains a separate concrete operation scope in RECOVERY_SCOPE_DRAFT.md.
