// Reviewed f641685b producer closure; unknown code generations fail closed.
// S16 (2026-10-26) appends a second closure: worker-local-release-rotation.mjs
// gains log-only preparation stage timing (timePreparationStage wraps each
// awaited step, returns the original value and rethrows the original error;
// a failing logger is swallowed). The other two producer files are unchanged,
// so only the rotation digest differs between the two closures. The first
// closure stays first so an installed pre-S16 producer generation remains
// qualified and a rollback is not blocked by this entry itself.
// C 项第二步 (2026-10-27) appends a third closure: the same log-only timing now
// also wraps the 15 awaited steps of applyApprovedRotationPlanCore, so the
// release-side cutover reports per-stage elapsed times the way the preparation
// side already does. The three timing helpers are byte-identical to the second
// closure's generation — only call sites were added — and the other two producer
// files are again unchanged, so only the rotation digest moves. Both earlier
// closures stay in place and in order, so an installed pre-S16 or S16 producer
// generation remains qualified and a rollback is not blocked by this entry.
export default {"closures":[{"publish-prepared-main.mjs":"e50f8112e0ae6553a4f66632ebfc95a76fba1030041c6d9d96af4273d98ae6d1","worker-local-release-rotation.mjs":"b33b0b8b2a3ff603a902845c7f3191adbe7d39907e529f18870e195abeb50776","worker-local-release.mjs":"6dcd3016f6164a0c897c94ae26ec300b82f69ad122739ea1ba5b843ca95a8333"},{"publish-prepared-main.mjs":"e50f8112e0ae6553a4f66632ebfc95a76fba1030041c6d9d96af4273d98ae6d1","worker-local-release-rotation.mjs":"c90f6c9b5ce126089527d668e3fee884193554e4a4ded91e392a1a2df98b2072","worker-local-release.mjs":"6dcd3016f6164a0c897c94ae26ec300b82f69ad122739ea1ba5b843ca95a8333"},{"publish-prepared-main.mjs":"e50f8112e0ae6553a4f66632ebfc95a76fba1030041c6d9d96af4273d98ae6d1","worker-local-release-rotation.mjs":"5171f54839b42a64d986db919770aa3f72d76dce77babb8abea250a02b8b6037","worker-local-release.mjs":"6dcd3016f6164a0c897c94ae26ec300b82f69ad122739ea1ba5b843ca95a8333"}],"version":"teruisi-cleaned-producer-qualification-v1"};
