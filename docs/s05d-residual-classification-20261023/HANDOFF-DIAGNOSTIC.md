# One-shot Task instance visibility diagnostic

Repository copies: [result](handoff-visibility-result.json) and [evidence index](handoff-visibility-evidence.json). The original immutable names below resolve under `D:/codex-artifacts/s05d-residual-classification-20261023/task-visibility-2c99fc4a-08b5-496c-905c-7e2fc34b7ea2`; the index hashes the original SUMMARY.md, not this annotated repository copy.

2026-10-23. Exactly one new empty diagnostic Task was registered, started once, and removed after completion. No old c6 Task/run or business module was invoked or modified. The frozen controller must not be replayed.

Task: `TERUISI.HandoffVisibility.Diagnostic.2c99fc4a-08b5-496c-905c-7e2fc34b7ea2`. RunEx returned `{FB208A8E-4AC4-4FD9-8688-58E916843D62}`. The Task action was System32 PowerShell PID 39352, its direct Node child PID 43804, and four PowerShell COM query children 45760/35028/29956/35476. Their actual tokens were the intended user SID, session 1, medium integrity 8192, not elevated. High observations were session 1, integrity 12288, elevated.

All four ordinary and six high observations returned 1 from the original `$t.GetInstances(0).Count`, saved collection `.Count`, and native COM reflection Count/Item. The sole visible GUID equalled the RunEx receipt. GetInstances, Count and Item HRESULTs were all zero.

Actual Task security owner was the intended user SID. SYSTEM/BA retained full access; the user received RX mask `0x1200a9`, plus Scheduler's additional FR ACE `0x120089`. The actual readback is preserved rather than described as exactly one RX ACE. LogonType=3, RunLevel=0, no triggers, no restart, single-instance ignore-new policy, 30-second execution limit.

Node exited directly with code 0 and complete stdout/stderr (both empty). Node elapsed 11.005 seconds. The action process was no longer present, Task state was Ready with zero native COM instances, and XML plus SDDL matched their registration snapshots. Only this diagnostic Task was then deleted, verified absent; evidence remains. RunEx through cleanup took approximately 15 seconds.

This supports the explicit owner/user-RX configuration in the required topology. It does **not** isolate owner versus ACE causality for the old failure, prove immediate visibility at t=0, or authorize a business retry. Fresh PowerShell startup made the requested 0/250/1000/3000ms samples sequential rather than exact offsets; RESULT.json records actual observation times. Ordinary access denial for scheduler-service ancestor tokens is retained in raw evidence; query/Node/action token reads succeeded.

`RESULT.json` is the primitive summary; `EVIDENCE-SHA256.json` hashes all prior files including this summary, frozen scripts, task XML, raw ordinary/high results, direct exit and cleanup receipts. `summarize.mjs` recomputes checks from saved evidence without invoking Task APIs. It is create-only and was run once.
