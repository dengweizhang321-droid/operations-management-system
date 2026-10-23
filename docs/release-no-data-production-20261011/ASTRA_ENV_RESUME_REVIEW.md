# Exact-environment resume transport review

2026-10-12, Astra implementation-side review. This review reads frozen source, public bindings, and the specified existing WAL event only. It does not launch the entry, query production interfaces, or perform a lifecycle/database action.

## Static result

No additional concrete scope expansion was found in `prepare-exact-env-resume.mjs`, the generated `resume1/TRANSPORT_BINDING.json`, `resume1/BOOTSTRAP.ps1`, and the frozen resume runner. All 12 bound files were independently rehashed and matched: five transport source files, Node, cipher metadata manifest, original approval, original spec, original entry, and the first attempt's FINISHED/DIRECT_PROCESS records. Bootstrap holds each opened file with `FileAccess.Read` and `FileShare.Read` through the child process, and checks the exact approved Windows SID and Administrator role. The captured binding itself is hashed before JSON parsing.

Binding SHA256: `522629ca7a49688c7bcdfc8b5ee7053d985be7085398df6d70b044c2e85d4273`.

Bootstrap SHA256: `b75e7e9d1ce962b299a685b06f49a91d4556082eed09403baab46dce62fe78a1`.

The original approval `dfd9e3dc…`, spec `960c5c3e…`, entry `69898b1b…`, and batch `f15d06a1…` remain byte-bound. The runner reconstructs exactly the declared execute arguments, retaining the original approval timestamp. It verifies the known two-event failed-admission state before and after consuming the environment. It does not clear the owner or edit original WAL/gates. `active.json` is deliberately absent from the long-held file list, so this transport does not prevent the original engine from releasing ownership at completion.

The restored environment must hash to the original `bc79f88a7e7b963179fe029dccf2f605f1bad855ad29873b58d43dfb96aac609`; key casing and values are preserved, NODE_* is rejected, and only the original deadline exclusion is omitted. DPAPI ciphertext is transient; environment plaintext is carried through memory/pipes. Logs contain hashes and differing field names, not secret values. The ten isolated tests passed, and Root independently reran the same ten. The original incomplete synthetic-environment failure remains recorded; neither that test nor this static review substitutes for actual admission.

## Observed original-engine admission

Read `D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011/000003.json`. Its canonical event digest recomputes to `f6f7e4216e651f99302f1578d9640a0e9206658b7f82eaca43f54cd5b10cd865`. The event is `status=admission`, `phase=prepare`, at `2026-10-11T16:20:40.644Z`, for the exact approved batch. All 15 admission stages are passed, including both source-and-toolchain stages, full artifact/head verification, final chain/Django/journal checks, and helper process identity. Total duration is 248748.5728 ms (248.749 seconds). This event contains no operationId.

This verifies the reported successful initial admission after environment restoration. It does not establish subsequent operation success, final acceptance, or owner release; those require later original WAL and result evidence. No additional tests, scans, source/package changes, or execution interfaces were invoked for this review.
