# Guard failure: independent early filesystem checks

The actual previous-reference-guard failed after Worker apply, before Django deployment. Existing WAL 000027 records unknown, head `a40e765dddd23ea17f5f5edd6eab068bf56c12d58a70d03115c96b1070f84fbc`, exit 1, elapsed 21809 ms, zero stdout and stderr length 20951 / SHA `29c2f1f204f43d2f06cf997f0ac213acd18e7f5e2253f742300feb1ecd7cfb10`. That stderr content was not retained by the original process wrapper; its size/hash alone cannot identify the failed condition. No failure category is inferred from those numbers.

The frozen guard source orders its work as: full Django before/after inventory and generated CF scope validation; preserved app.previous source/target tree verification; bounded runtime JSON reference scan; fixed native/live-reference implementation checks and live audit; final reference/WAL assertions. The original guard itself was not replayed in this review.

Two bounded normal-role read-only diagnostics used the exact candidate's exported filesystem validators after checking its collector file pins:

| Diagnostic | Actual interval UTC | Result |
|---|---|---|
| Original readToolsScopeApplication before current app / after app.deploy-1e1138…, then validateToolsNoMigrationScope with actual CF bytes | 2026-10-12T00:56:15.204Z–00:56:22.384Z | All three stages passed |
| Original hashTree of app.previous and its preserved copy | 2026-10-12T00:56:57.288Z–00:56:58.851Z | Both exactly 3468 files / fa434f8e… |

CF hashes were before `a3807b705617b7968f9a023986dffd1be8f65731bb99747805af227d3f8688f2` and after `018ee581023eef90706fde6d5c555987cedc172adee81dc054a916e0ebecbc61`. No raw CF values were logged. The preservation record raw hash `ed906e8fb5883576e9c34a37b5e972b738f0dda03c8df1654167728d4cecd504` matches the approved operation file pin. Complete tree hash is `fa434f8ec1a49dbb478f8457eda601e8089a4bb7ffbfbf8b5562797b2fd3000b` for both source and target.

Exact diagnostic scripts and results are preserved in the production evidence directory as `ASTRA_GUARD_SCOPE_DIAGNOSTIC_V1.{mjs,json}` and `ASTRA_GUARD_PRESERVATION_DIAGNOSTIC_V1.{mjs,json}`. They did not call the original guard entry, production API, lifecycle/DB action, rotation mutex, native/admin query or WAL writer. They do not claim a successful guard or release operation.

These results establish consistency at their later observation times, not the precise failure condition at 00:53:08. The existing live-reference helper already explicitly normalizes its PS5 child PSModulePath, so the earlier environment-transport incident must not be asserted as this failure's cause without new evidence.

The next useful evidence is a pinned, bounded stage diagnostic that preserves the first actual failure and its stage, distinguishing runtime references/implementation binding from live native metadata. Root owns that diagnostic and any separately required administrator interface. Any future reconciliation would require complete actual guard postconditions; neither these early passes nor a model opinion can waive a remaining reference, unknown identity, chain drift or gate.
