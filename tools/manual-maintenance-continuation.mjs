/** One finite bridge for the installed pre-wait controllers; never a publisher retry. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const firstMaintenancePredecessor=Object.freeze({
 releaseId:'20261017T082953Z-c9da1765d84847d4',
 workerManifestSha256:'91a0cdce3cd59457ab3be2ae7366411fb975e1ebd07203119ff380ee568655f1',
 djangoManifestSha256:'622cb632fdf9408bfb6dc641422602a0e741aeea18d09c65f39480d203069d1a',
 workerScriptSha256:'8ef6d09c23f780657d74e8c591dea543713410783ce2d5fdf165f2093db51a1d',
 djangoScriptSha256:'2a4d3629d1f80b824ad247ef4b4ce810632090586b87be3686432f5b6aea98e0',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
const root='D:\\teruisi-runtime\\django-sales';
const hash=/^[a-f0-9]{64}$/;
// Reviewed installed native Stop capability, including its actual call site and
// 45-second receipt/control/ack contract. This is a predecessor qualification,
// not a fixed publication target or a permission to retry a failed attempt.
export const nativePiWorkspacePredecessor=Object.freeze({
 releaseId:'20261018T112936Z-f51e4f3671a64cd3',workerManifestSha256:'9eb5a75ac7d377c786bfc0fdb0ef6c0d8129698cf82e416fccfc07fbdb449fd7',
 djangoManifestSha256:'ca9c731a0843e7e01d8300f6190bca1377114f228ad5b17c16113e4028a582a9',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',djangoScriptSha256:'d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'0ab14dcbd889aacdf0d44847d59b4fd30a4bd5b02e836e6cf77d08eafe5d3d68',
 candidateAiScriptSha256:'64b2a5fe8f85a0c73463ef0f93ad1e983faa6b690bbb2e3e6b1ab041c6b9acdd'
});
// Exact current predecessor -> Pi business candidate. Full controller hashes
// qualify the unchanged lifecycle call sites, not merely a helper's presence.
export const nativePiBusinessPredecessor=Object.freeze({
 releaseId:'20261019T130904Z-6b816a5085c6a13e',
 workerManifestSha256:'70d5019b78836129779bbe51539cb0ae427da5ada550b2f901bddce28b0214af',
 djangoManifestSha256:'00058feaf2c93cd0de55a6e269dc67d73bfd1c659d72a5ea1720073a5615180b',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',
 djangoScriptSha256:'cfd1e942a0b55f5eb8aa3be484db5ece565ec39c6e6aa93ed0aea633b8936e85',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'64b2a5fe8f85a0c73463ef0f93ad1e983faa6b690bbb2e3e6b1ab041c6b9acdd',
 candidateAiScriptSha256:'3b0ae6c09b1bc49aa12fed622208fee711a387726ede709b2cd421fa1b04cad5',
 candidateDjangoScriptSha256:'d884882af114840ff1b0061c57439556cfc6a8fd7d0a751896363dd59eecde5d'
});
// Release-chain triple fix (84292c70, 2026-11-08): registers the actual
// installed -> candidate predecessor for the current native Stop capability.
// Stop-AiStack now runs every stop step and aggregates failures instead of
// abandoning later steps on the first throw, which changes django-ai.ps1's
// whole-file hash; django-local-service.ps1 gains an opt-in
// -IncludeRedactedText parameter on Get-NativeFailureSummary (default string
// unchanged) and worker-local-service.ps1 surfaces the real stderr failure
// cause (84292c70 also touches backend/pi_runner/wsl_control.py and
// tools/pandas_broker_rotation_linux.py, neither of which is a controller
// qualified here). This is registering the actual current generation, not
// re-reviewing the protocol: the Wait-PiWorkerExit -> Stop-PiRuntime and
// Stop-PiRuntime -> Read-PandasConfig function-body hashes below are
// unchanged from every earlier qualified generation, because Stop-AiStack's
// diff only wraps the existing call to Stop-PiRuntime in a try/catch at the
// orchestration level and never edits Wait-PiWorkerExit, Stop-PiRuntime or
// any line between them. Verified against the actual installed runtime
// (D:\teruisi-runtime\django-sales, release
// 20261107T052340Z-a0cedca5d42d478a) and candidate commit cf9baddf.
export const nativePiReleaseChainTripleFixPredecessor=Object.freeze({
 releaseId:'20261107T052340Z-a0cedca5d42d478a',
 workerManifestSha256:'4620f30878e57d9485096bfb8c0ae0e2c73e7deda1a924887a9cc27259e14a38',
 djangoManifestSha256:'06d27651c30ca9d513711e8d3674f6da0b5fc72a1035294b25e4c87ac4663bcf',
 workerScriptSha256:'1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e',
 djangoScriptSha256:'37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba',
 candidateAiScriptSha256:'fb4358db6b99403e8b4d44d8a44d01803d11184b0567233725bf65b422d142b5',
 candidateDjangoScriptSha256:'dc856391affa2ae5a677bdc7ca7273c301eb604b7c1de8855d0c93be3233b005',
 // Unlike nativePiBusinessPredecessor, this generation's candidate
 // worker-local-service.ps1 also differs from the installed bytes (the real
 // stderr failure cause surfaced in -Json mode); process-deadline.ps1 is
 // unchanged on both sides.
 candidateWorkerScriptSha256:'0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516'
});
// Pandas lease-timestamp fix (c7604df9..24cc8388, 1 file +33 -3, tools/django-ai.ps1
// only): registers the actual installed -> candidate predecessor for the current
// native Stop capability, left unqualified by the new Get-PandasLeaseTimestamps
// helper. That helper changes how Assert-PandasPublicationOwner reads
// release-publication-lease.json's createdAt/expiresAt (PS7's ConvertFrom-Json
// auto-detects an ISO-8601 string as a [DateTime] and re-stringifies it in the
// local time zone with no offset suffix, silently shifting a UTC instant by the
// machine's UTC offset on a later [DateTimeOffset]::Parse; -DateKind String on
// PS7, absent on PS5.1, keeps both engines reading the same field as the same
// string), which changes django-ai.ps1's whole-file hash. This is registering the
// actual current generation, not re-reviewing the protocol: the
// Wait-PiWorkerExit -> Stop-PiRuntime and Stop-PiRuntime -> Read-PandasConfig
// function-body hashes below are unchanged from every earlier qualified
// generation, because the diff is confined to Get-PandasLeaseTimestamps (a new
// function) and Assert-PandasPublicationOwner's lease-timestamp parsing, and
// never touches Wait-PiWorkerExit, Stop-PiRuntime or any line between them. The
// candidate django-local-service.ps1 and worker-local-service.ps1 bytes are
// unchanged from the installed ones (only django-ai.ps1 differs in this range),
// so this generation has no candidateDjangoScriptSha256/candidateWorkerScriptSha256
// fields, like nativePiWorkspacePredecessor. Verified against the actual
// installed runtime (D:\teruisi-runtime\django-sales, release
// 20261110T081637Z-3b276c4b744f92be) and candidate commit 24cc8388.
export const nativePiPandasLeaseFixPredecessor=Object.freeze({
 releaseId:'20261110T081637Z-3b276c4b744f92be',
 workerManifestSha256:'46da32a9c0efc9a3fd153068f1395438dd85ba56baf4f793b73e988c0e1f40d0',
 djangoManifestSha256:'49ff2e8b97ec89f9fb7f51dc7fba72ec987f029ac3a799f57e7bade4d6dfbaa9',
 workerScriptSha256:'0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516',
 djangoScriptSha256:'dc856391affa2ae5a677bdc7ca7273c301eb604b7c1de8855d0c93be3233b005',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'fb4358db6b99403e8b4d44d8a44d01803d11184b0567233725bf65b422d142b5',
 candidateAiScriptSha256:'b13cce9985ed093fe8e31c4cca5a7827af7b352aef991aeaeed1f4adcd4c39d8'
});
// Maintenance-after-failure resume, first period (A1, codex/resume-after-
// maintenance-phase1-20261111): registers the actual installed -> candidate
// predecessor for the current native Stop capability, left unqualified by
// django-ai.ps1's new Assert-PandasPublicationOwner resume branch
// (Assert-PandasResumePublicationOwner/Get-PandasResumeJsonStringField/
// Get-PandasResumeOwnerProcess/Assert-PandasOriginalPublicationOwner — the
// original branch's own predicates are unchanged, only relocated into their
// own function). This is registering the actual current generation, not
// re-reviewing the protocol: the new code starts at
// Get-PandasResumeJsonStringField, well after Read-PandasConfig in file
// order, and the diff never touches Wait-PiWorkerExit, Stop-PiRuntime,
// Read-PandasConfig or any line between them, so the Pi stop protocol
// function-body hashes below are unchanged from every earlier qualified
// generation. The candidate django-local-service.ps1 and
// worker-local-service.ps1 bytes are unchanged from the installed ones
// (only django-ai.ps1 differs in this range), so this generation has no
// candidateDjangoScriptSha256/candidateWorkerScriptSha256 fields, like
// nativePiWorkspacePredecessor and nativePiPandasLeaseFixPredecessor.
// Verified against the actual installed runtime
// (D:\teruisi-runtime\django-sales, release
// 20261110T141601Z-c459c28445ca323a) and this branch's own candidate
// tools/django-ai.ps1 (git blob bytes; -text in .gitattributes means no
// CRLF/LF conversion applies, so the git blob and working-tree bytes are
// identical here).
export const nativePiResumeAfterMaintenancePhase1Predecessor=Object.freeze({
 releaseId:'20261110T141601Z-c459c28445ca323a',
 workerManifestSha256:'c8a0de73d960a521617fa6f15478858c74ee0618bf9937e2e102a74091324767',
 djangoManifestSha256:'cd56e776b03ae027b24a459677997db00bb78030b881d2a66cbd901b8fb482f4',
 workerScriptSha256:'0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516',
 djangoScriptSha256:'dc856391affa2ae5a677bdc7ca7273c301eb604b7c1de8855d0c93be3233b005',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'b13cce9985ed093fe8e31c4cca5a7827af7b352aef991aeaeed1f4adcd4c39d8',
 candidateAiScriptSha256:'21e648d5c45b7db7752b467f21e2badcac11eec7e623f472d557f2bdcfa6a751'
});
// Every registered installed -> candidate native-Stop-capability predecessor
// that is matched by releaseId alone in the fallback branch below (not the
// directional pandasRotation/nativeIsolationRotation pairs, which are matched
// by AI-script byte pair instead), newest first so a fresh generation is
// tried before older ones. Append-only: a new generation is added here, the
// existing entries are never edited or removed, because they are predecessor
// qualifications (audit records of what was reviewed), not a current
// expectation to be kept in sync.
export const nativePiStopCapabilityPredecessors=Object.freeze([nativePiResumeAfterMaintenancePhase1Predecessor,nativePiPandasLeaseFixPredecessor,nativePiReleaseChainTripleFixPredecessor,nativePiBusinessPredecessor,nativePiWorkspacePredecessor]);
// Returns the one registered generation whose releaseId matches the actual
// head, or null when none match. Selecting by releaseId alone (not by byte
// equality) mirrors isPiMaintenancePredecessor/isFirstMaintenancePredecessor:
// the caller still asserts every pinned byte against the returned record, so
// a releaseId match with drifted bytes still fails closed via
// assertPredecessorPins. Returning null instead of guessing a record lets the
// caller refuse cleanly instead of asserting against a generation that can
// never match.
export function isNativePiStopCapabilityPredecessor(head){
 return nativePiStopCapabilityPredecessors.find(k=>head?.releaseId===k.releaseId)??null;
}
// PiNative deliberately adds its 153 gate to django-local-service.ps1 without
// changing django-ai.ps1. This reviewed candidate hash is the only same-AI
// generation in which the candidate local-service may differ from the
// installed one; any other drift still fails closed.
// S04a (2026-10-22) re-registers that generation for the A1 gate fix
// (988810cf..559e64fd, 1 file +25 -3): Assert-WranglerRuntimeFacts is split out
// of Assert-WranglerRuntimeCli as a pure JSON fact check, and the app-tree
// manifest caller uses it instead of spawning `wrangler --version`. The diff
// touches no maintenance enter/exit, maintenance lock, drain, STARTED/SUCCESS
// receipt, worker stop, process-tree termination or signal handling, and adds
// no external process. Evidence: docs/施工/S04a.md.
export const piNativeCandidateDjangoScriptSha256='65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61';
// A项 (2026-10-25) registers the descendant-verification fix. Unlike the
// entries above, this diff DOES touch process-tree walking, so it is stated
// plainly rather than claimed inert: Get-VerifiedProcessDescendants gains two
// guard lines (+13 lines total, all additions, no original line changed or
// removed) that skip an enumerated child whose CreationDate is missing or
// precedes its claimed parent's. Windows recycles PIDs, so ParentProcessId
// equality alone admitted reused-PID phantoms; the 2026-10-24 r3 incident
// stalled Django Stop for ~26 minutes when PID 14720 (readertray.exe, metadata
// unreadable) named stale parent 11412. Both guards only ever REMOVE a
// candidate from the descendant set via `continue`; they never add one, never
// widen what gets terminated, and never relax an existing assertion. The
// identity re-check at :2632, the root PID-reuse checks in
// Stop-VerifiedProcessTree, maintenance enter/exit, the maintenance lock,
// drain, STARTED/SUCCESS receipts, worker stop and signal handling are all
// untouched, and no external process is added. CreationDate is read off the
// CIM row rather than through Get-ProcessCreation because that helper casts to
// [datetime] and throws on a null — precisely the phantom case this must
// survive. Same-kind [datetime] comparison verified against live CIM rows and
// ISO-8601 snapshot strings (no timezone skew). Evidence:
// D:\teruisi-ops\release-20261025\A项-停服务误认进程-审查证据.md.
export const aDescendantCreationGuardDjangoScriptSha256='4ba1fcaf3cd1568a64098a9d2d32039f850ec2db1da4f81aa97fa3ab9530723a';
// Sales154 (d95852dd): these reviewed controller bytes add the schema-addition
// admission gate and include its three verifier modules in PrepareApp's copy list.
// A successful Sales154 gate returns before the Pi153 PowerShell branch in
// Assert-NoUnapprovedProtectedAiMigration. Pi153 lifecycle proofs are fully
// retained through sales_preflight_addition.parent_proof ->
// pi_native_addition._verify_active_with_base, plus the exact Sales-only delta.
// The independent integration_release_gate.py database invocation before migrate
// remains in place with its database protections. Keep the older descendant-guard
// qualification for the transition.
// Review and authorization: docs/sales154-controller-qualification-20261029/REPORT.md.
export const sales154SchemaAdditionDjangoScriptSha256='98028cb49195b7b145c74fdb5205e949e6152d065ce926265cd5773e8b00580b';
// Batched status enumeration (94312406 + 3cf4927f, 2026-10-30/31): these
// reviewed controller bytes add an opt-in cache of ONE Win32_Process
// enumeration, keyed by ProcessId, to cut AggregateStatus's ~20 per-PID CIM
// queries (measured 8689 ms of per-PID queries vs. 724 ms for one full
// enumeration), which is what pushed the watchdog's control stage past its
// budget. The cache defaults to $null ("no cache"), and
// Show-AggregateServiceStatus is the ONLY call site that populates it
// (:4841), inside a try whose finally clears it unconditionally (:4899), so
// no later action in the same process can observe a stale enumeration.
// Verified: every process-tree and lifecycle call site passes an explicit
// Attempts of 1 and never populates the cache, so each falls straight
// through to the live per-PID query; Resolve-OwnedProcess additionally
// forces -ReadOnly for any Status action (:2838), so the populating path
// cannot reach PID-record cleanup. Get-ProcessSnapshot's three outcomes are
// unchanged: the cache is consulted only on attempt 1 and only when
// populated, and a miss or blank-metadata row falls through to the same live
// query and retry loop, so the cache can never be what establishes absence
// or satisfies the metadata-unavailable throw. Duplicate rows for one id are
// retained so the ambiguity throw still fires, and a failed enumeration
// leaves the cache EMPTY rather than absent-looking. 3cf4927f is the
// correctness fix for the first form: @() inside each if-branch let
// PowerShell unwrap a single-element array on its way out of the
// if-expression, leaving a bare CimInstance whose .Count is $null, so every
// single-row lookup reported false absence and DeployApp refused with a
// healthy PostgreSQL on 5432. Wrapping the whole if-expression restores the
// array in both paths. Nothing in maintenance enter/exit, the maintenance
// lock, drain, STARTED/SUCCESS receipts, migration logic, the schema-addition
// admission gate, ACL/permission boundaries, worker start/stop sequencing or
// signal handling is touched; no external process is added and no assertion
// is relaxed. Both PS5.1 and PS7 parse the file (Parser.ParseFile, no
// execution); the UTF-8 BOM is retained. Keep every older generation
// qualified so a rollback is not blocked by this entry.
// Review: docs/ci-two-gates-fix-20261031/REPORT.md.
export const batchedStatusEnumerationDjangoScriptSha256='fbb62792eb0962cb91b76b0045a08812d29de0dabb0ab9056ac9ce235d76bddb';
// Workflow156: these reviewed controller bytes add the twelfth generation's
// schema-addition admission branch and list its four verifier modules in
// PrepareApp's copy list. Why this is qualifiable: the diff is 33 added lines
// and ZERO modified or removed lines. 29 of them are one new `if` block placed
// immediately before the Sales154 block in
// Assert-NoUnapprovedProtectedAiMigration; the other 4 are copy-list entries.
// The new block is reached only when this generation's own evidence version,
// operation plan or active marker is present, so with none of those on disk
// control falls through to the Sales154 branch byte-identically to before.
// Every ancestor's lifecycle proof is retained, not bypassed:
// workflow_automation_addition.parent_proof calls
// sales_preflight_addition._verify_active_with_base, which recurses through all
// eleven existing generations to bi_app_addition's published 139 parent. The
// independent integration_release_gate.py database invocation before migrate
// keeps its own protections. Nothing in maintenance enter/exit, the maintenance
// lock, drain, STARTED/SUCCESS receipts, process-tree walking or termination,
// worker start/stop sequencing, signal handling, ACL/permission boundaries or
// any existing assertion is touched, and no external process is added.
// Both PS5.1 (5.1.26100.9444) and PS7 (7.6.9) parse the file with zero errors
// (Parser.ParseFile, no execution); the UTF-8 BOM and CRLF endings are
// retained. Keep every older generation qualified so a rollback of this change
// is not blocked by its own qualification entry.
// Review: docs/workflow-automation-addition-20261031/REPORT.md.
export const workflowAutomationSchemaAdditionDjangoScriptSha256='af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c';
// B项 (2026-10-25) registers the worker controller that reports the real
// failure cause in -Json mode. The terminal catch block used to write only the
// fixed string 'Worker lifecycle result requires exact reconciliation' to
// stderr and dropped $_.Exception.Message entirely, so a -Json caller saw a
// generic failure with no cause — the reason the 2026-10-24 r2/r3 incidents
// took extra diagnosis. The non-Json branch had always printed that text.
// The reconciliation contract is preserved byte for byte: the stdout JSON key
// set is identical to the baseline (status / processEvidence / startupPhases /
// failedStartPhase), so every consumer parsing that line is unaffected. The
// cause is added to stderr ONLY and deliberately kept out of stdout, because
// publish-main.mjs:136 persists stdout verbatim to <label>.stdout.log (the
// repository already tracks ~100 such logs) while this project's own rule in
// release-readonly-retry.mjs forbids persisting arbitrary messages; some
// throws embed a bounded supervisor stderr tail. stderr keeps exactly the
// exposure the non-Json branch has always had. Nothing in maintenance
// enter/exit, the
// maintenance lock, drain, STARTED/SUCCESS receipts, worker start/stop
// sequencing, process-tree termination or signal handling is touched; no
// external process is added; no assertion is relaxed and no new failure path
// is introduced (this code runs only after a failure already happened).
export const bWorkerJsonFailureCauseScriptSha256='1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e';
// S05a (2026-10-22): qualification is per controller, never one shared
// exception. A controller name owns only its own reviewed candidate hashes; an
// unregistered name or an unlisted hash for a registered name still fails
// closed, and a candidate identical to the installed bytes needs no entry.
// The worker hash below is B1 `codex/start-timing-20261022` (2dd8f23f)
// tools/worker-local-service.ps1: startup phase budgets/observation plus an
// independent DingTalk startup observer. Evidence: docs/施工/S05a.md.
// AI158: append-only finite admission/copy-list branch; reviewed evidence lives in
// docs/ai-task-feedback-candidates-addition-20261104. Ancestor qualifications remain.
export const aiTaskFeedbackCandidatesDjangoScriptSha256='f23314bc00541d14f72584973bc5bf0560b86cac4e3427ab0307adee22efdad8';
// AI159: finite schema branch and copy-list only; PS5/PS7 AST evidence in docs/ai-p2-20261107.
export const aiUnifiedTasksDjangoScriptSha256='37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6';
// Release-chain triple fix (84292c70): Get-NativeFailureSummary's opt-in
// -IncludeRedactedText parameter (django-local-service.ps1) and the real
// stderr failure cause (worker-local-service.ps1). Same generation as
// nativePiReleaseChainTripleFixPredecessor above; registered here too so the
// same-AI/dingtalkAcl per-controller loop and the repository byte tripwire in
// tests/maintenance-controller-qualification.test.mjs admit these exact
// bytes. Installed django-local-service.ps1 for this generation is already
// aiUnifiedTasksDjangoScriptSha256 above; this is only the new candidate.
export const releaseChainTripleFixDjangoScriptSha256='dc856391affa2ae5a677bdc7ca7273c301eb604b7c1de8855d0c93be3233b005';
export const releaseChainTripleFixWorkerScriptSha256='0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516';
export const piNativeCandidateControllerSha256=Object.freeze({
 'django-local-service.ps1':Object.freeze([piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256,batchedStatusEnumerationDjangoScriptSha256,workflowAutomationSchemaAdditionDjangoScriptSha256,aiTaskFeedbackCandidatesDjangoScriptSha256,aiUnifiedTasksDjangoScriptSha256,releaseChainTripleFixDjangoScriptSha256]),
 'worker-local-service.ps1':Object.freeze(['83705551d9a9b2f3d2948d7b7eb8b41f3c6cfae5a8747949ffd8d6e3a4ee7058',bWorkerJsonFailureCauseScriptSha256,releaseChainTripleFixWorkerScriptSha256]),
 'process-deadline.ps1':Object.freeze([])
});
// Readiness helper packaging only: exact old/new controller bytes, no new stop route.
// Evidence: docs/readiness-stability-20261103/COMPATIBILITY.md.
export const readinessCopyControllerPair=Object.freeze({
 installedSha:'af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c',
 candidateSha:'c7e02ddbc55e2ff2a3790ef2dd89b76a580ef98ec479b6f40ae471c2af7fa5c0'
});
export function assertMaintenanceControllerGeneration({name,installedSha,expected,candidateSha}){
 if(installedSha===expected)return;
 if(name==='django-local-service.ps1'&&installedSha===readinessCopyControllerPair.installedSha&&candidateSha===readinessCopyControllerPair.candidateSha&&expected===candidateSha)return;
 const qualified=piNativeCandidateControllerSha256[name];
 if(qualified&&qualified.includes(candidateSha))return;
 assert.equal(installedSha,expected,'实际原生控制器代际与候选不一致：'+name);
}
export const piMaintenancePredecessor=Object.freeze({
 releaseId:'20261018T081823Z-282cee340c57bf41',workerManifestSha256:'120911425367ef3a451c40f7a9842f3c1e39fc99b38cfd602b011ae3ed0733fc',
 djangoManifestSha256:'a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',
 djangoScriptSha256:'d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2',
 djangoAiScriptSha256:'fc767f83a175642da0922db29770400e50a73d0ca00c56ba840a87d97725455b',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
export function isPiMaintenancePredecessor(head,djangoManifestSha256){
 const k=piMaintenancePredecessor;return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
// Q14 (2026-10-25): one exact installed -> candidate django-ai.ps1 pair, never a
// general exception. The candidate (33043e9d) changes only
// Assert-DingTalkScreenshotProfile and adds Test-AppContainerReadOnlyAce; the
// verifier (dingtalkScreenshotAclOnly) proves by syntax tree that every other
// function and every top-level statement is byte-identical, so the reviewed Pi
// stop protocol (Wait-PiWorkerExit / Stop-PiRuntime) is untouched. Only the
// whole-file hashes are consumed here; the function hashes belong to the
// verifier. A one-bit difference on either side, or the reverse direction,
// leaves the pair unregistered and fails closed. Evidence:
// docs/release-qual-dingtalk-screenshot-acl-20261025/REPORT.md.
export const dingtalkScreenshotAclQualification=Object.freeze({
 installedAiSha256:'f97cf7e2bc532407cdf86501de57097ce6e4f626eaf68f73ee6ab308532e0e73',
 candidateAiSha256:'55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba',
 assertProfileBeforeSha256:'e960f78453d3a08aea1d7e4299f5ccbf51c905189a5516132fa7660311abb61c',
 assertProfileAfterSha256:'a12db3ee9ef8834fedc871df5700a7e7fa820d815ee60ef70cf98364e4cec789',
 appContainerAceSha256:'801fd43a50668ae3b6f274353efd0adaec9db3ffb1936dc41ac79f81a6ab4f16'
});
export function isDingTalkScreenshotAclPair(installedAiSha256,candidateAiSha256){
 const q=dingtalkScreenshotAclQualification;
 return installedAiSha256===q.installedAiSha256&&candidateAiSha256===q.candidateAiSha256;
}
// The Pandas publication seam has its own directional qualification. Neither
// new script is admitted alone; both sides retain the reviewed Pi stop.
export const pandasRotationControllerPair=Object.freeze({
 installedAiSha256:dingtalkScreenshotAclQualification.candidateAiSha256,
 candidateAiSha256:'9ec12a53b008e5103ab27fe42f6904f74f8989bad3cc78627e512660f128312f',
 installedDjangoSha256:aiUnifiedTasksDjangoScriptSha256,
 candidateDjangoSha256:'a7f79bcb98e837e950dabbb0a5485743a774ead22bbeebf662486ec24c6abfbf',
 workerSha256:bWorkerJsonFailureCauseScriptSha256,
 transportSha256:piMaintenancePredecessor.workerTransportSha256,
});
// Exact default-production transition for the reviewed private-native adapter.
// The isolation configuration is absent in production; this is byte admission,
// never an unknown-operation recovery route or a general controller exception.
export const nativeIsolationControllerQualification=Object.freeze({
 version:'native-isolation-controller-20261108-v1',
 installedAiSha256:'55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba',
 candidateAiSha256:'1b4a95bf7b76c4f8600df49b7cc67d98cac3073fd4de48ef28bd53397b2ced42',
 controllers:Object.freeze({
  'worker-local-service.ps1':Object.freeze(['1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e','0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516']),
  'django-local-service.ps1':Object.freeze(['37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6','93741e5537b30efa5e91b6cfebd6af44addf1104cadf91f8add108f8a3753044']),
  'process-deadline.ps1':Object.freeze(['5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd','5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd']),
 }),
 helpers:Object.freeze({
  'native-isolation.ps1':'a5499003d2e269b8a3d6cdb6bce70fcd2f02434c541620ccdaa151f0c7f52343',
  'native-isolation.mjs':'b4b54d559a12e79a24112fee3818a58f79444c1b7bf126fb5dc94ab6da1e662b',
 }),
});
function assertPandasPredecessorPiStop(actual){
 const text=actual.toString('utf8').replaceAll('\r\n','\n');
 for(const [start,end,expected] of [['Wait-PiWorkerExit','Stop-PiRuntime','4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3'],['Stop-PiRuntime','Read-PandasConfig','49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6']]){
  const body=text.split('function '+start)[1]?.split('\nfunction '+end)[0];
  assert.equal(createHash('sha256').update(('function '+start+(body??'')).trimEnd()).digest('hex'),expected,'实际前驱Pi停止协议不在已审Pandas兼容资格内');
 }
}
export const maintenanceSourceNames=['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs','manual-maintenance-process.psm1','manual-maintenance-preflight.ps1'];
/** Read-only static admission; the native engine still rechecks dynamic facts. */
export async function maintenanceReadiness({source,head,djangoManifestSha256,installed='D:/teruisi-runtime/django-sales/app',runtime='D:/teruisi-runtime/teruisi-worker-sales',sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex')}={}){
 let nativeIsolationQualified=false;
 const sourcePins={};for(const name of maintenanceSourceNames)sourcePins[name]=await sha(path.join(source,'tools',name));
 const pins=Object.entries(sourcePins).map(([relative,sha256])=>({root:'source',relative,sha256}));
 const pin=async(root,relative,base,expected)=>{const sha256=await sha(path.join(base,relative));if(expected!==undefined)assert.equal(sha256,expected,'维护资格核验后工具发生变化');pins.push({root,relative,sha256});return sha256;};
 await pin('django','app/deployment.json',path.dirname(installed),djangoManifestSha256);
 for(const name of ['worker-local-service.ps1','process-deadline.ps1'])await pin('worker',`releases/${head.releaseId}/tools/${name}`,runtime);
 await pin('worker',`releases/${head.releaseId}/deployment-manifest.json`,runtime,head.manifestSha256);
 await pin('django','app/tools/django-local-service.ps1',path.dirname(installed));
 const assertPredecessorPins=k=>{
  for(const [root,relative,expected] of [['django','app/deployment.json',k.djangoManifestSha256],['django','app/tools/django-local-service.ps1',k.djangoScriptSha256],['worker',`releases/${head.releaseId}/deployment-manifest.json`,k.workerManifestSha256],['worker',`releases/${head.releaseId}/tools/worker-local-service.ps1`,k.workerScriptSha256],['worker',`releases/${head.releaseId}/tools/process-deadline.ps1`,k.workerTransportSha256]])assert.equal(pins.find(p=>p.root===root&&p.relative===relative)?.sha256,expected,'维护前驱资格与最初读取字节不一致');
 };
 const finish=async route=>{
  const result={version:'manual-maintenance-readiness-v1',preparedAt:new Date().toISOString(),releaseId:head.releaseId,route,sourcePins,pins,piWorkerReceiptSha256:null,piConfigurationSha256:null};
  if(nativeIsolationQualified)result.controllerQualification=nativeIsolationControllerQualification.version;
  for(const [field,relative] of [['piWorkerReceiptSha256','run/django-ai-pi-worker.pid.json'],['piConfigurationSha256','config/pi-agent.json']]){
   const file=path.join(path.dirname(installed),relative);
   try{await fs.access(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   result[field]=await sha(file);
   if(field==='piWorkerReceiptSha256'){
    const raw=await fs.readFile(file);assert.equal(createHash('sha256').update(raw).digest('hex'),result[field],'Pi ownership changed during readiness read');
    const pi=JSON.parse(raw);assert.equal(pi.version,2);assert.equal(pi.service,'django-ai-pi-worker');
    assert.ok(Number.isSafeInteger(pi.processId)&&pi.processId>0&&pi.processId<=2147483647);
    for(const name of ['creationDate','executablePath','commandLine'])assert.ok(typeof pi[name]==='string'&&pi[name]);
    result.piWorkerIdentity=pi;
   }
  }
  return result;
 };
 assert.equal(await sha(path.join(installed,'deployment.json')),djangoManifestSha256,'维护前Django前驱变化');
 const known=isPiMaintenancePredecessor(head,djangoManifestSha256)?piMaintenancePredecessor:isFirstMaintenancePredecessor(head,djangoManifestSha256)?firstMaintenancePredecessor:null;
 if(known){
  assertPredecessorPins(known);
  for(const [name,expected] of [['worker-local-service.ps1',known.workerScriptSha256],['process-deadline.ps1',known.workerTransportSha256]])assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'tools',name)),expected,'维护恢复前驱工具不适用：'+name);
  assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'deployment-manifest.json')),known.workerManifestSha256);
  assert.equal(await sha(path.join(installed,'tools/django-local-service.ps1')),known.djangoScriptSha256);
  if(known===piMaintenancePredecessor){
   assert.equal(await sha(path.join(installed,'tools/django-ai.ps1')),known.djangoAiScriptSha256);
   const file=path.join(path.dirname(installed),'run/django-ai-pi-worker.pid.json');
   const piWorkerReceiptSha256=await sha(file),raw=await fs.readFile(file);
   assert.equal(createHash('sha256').update(raw).digest('hex'),piWorkerReceiptSha256,'Pi ownership changed during readiness read');
   const piWorkerIdentity=JSON.parse(raw);
   assert.equal(piWorkerIdentity.version,2);assert.equal(piWorkerIdentity.service,'django-ai-pi-worker');
   assert.ok(Number.isSafeInteger(piWorkerIdentity.processId)&&piWorkerIdentity.processId>0);
   for(const name of ['creationDate','executablePath','commandLine'])assert.ok(typeof piWorkerIdentity[name]==='string'&&piWorkerIdentity[name]);
   const piConfigurationSha256=await sha(path.join(path.dirname(installed),'config/pi-agent.json'));
   await pin('django','app/tools/django-ai.ps1',path.dirname(installed),known.djangoAiScriptSha256);
   return {...await finish('pi19db'),piWorkerReceiptSha256,piWorkerIdentity,piConfigurationSha256};
  }
  return finish('legacy');
 }
 // Once this exact observer has been adopted, ordinary successors use native
 // Stop. Unknown controller generations cannot silently enter maintenance.
 const candidate=await fs.readFile(path.join(source,'tools/django-ai.ps1'),'utf8');
 const helper=candidate.replaceAll('\r\n','\n').split('function Wait-PiWorkerExit')[1]?.split('\nfunction Stop-PiRuntime')[0];
 assert.equal(createHash('sha256').update(('function Wait-PiWorkerExit'+(helper??'')).trimEnd()).digest('hex'),'4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3','没有适用于实际前驱的维护恢复材料');
 const stop=candidate.replaceAll('\r\n','\n').split('function Stop-PiRuntime')[1]?.split('\nfunction Read-PandasConfig')[0];
 assert.equal(createHash('sha256').update(('function Stop-PiRuntime'+(stop??'')).trimEnd()).digest('hex'),'49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6','Pi Stop调用、45秒和receipt/control/ack合同未在已审资格内');
 const installedAi=await sha(path.join(installed,'tools/django-ai.ps1')),candidateAi=await sha(path.join(source,'tools/django-ai.ps1'));
 // Q14: the exact DingTalk-screenshot ACL pair keeps the installed Pi stop
 // protocol, so it is judged like the same-AI generation: every other
 // controller must still be the installed bytes or a registered candidate.
 const dingtalkAcl=installedAi!==candidateAi&&isDingTalkScreenshotAclPair(installedAi,candidateAi);
 const pandas=pandasRotationControllerPair;
 const pandasRotation=installedAi===pandas.installedAiSha256&&candidateAi===pandas.candidateAiSha256;
 const nativeQualification=nativeIsolationControllerQualification;
 const nativeIsolationRotation=installedAi===nativeQualification.installedAiSha256&&candidateAi===nativeQualification.candidateAiSha256;
 const pandasControllers={
  'worker-local-service.ps1':[pandas.workerSha256,pandas.workerSha256],
  'process-deadline.ps1':[pandas.transportSha256,pandas.transportSha256],
  'django-local-service.ps1':[pandas.installedDjangoSha256,pandas.candidateDjangoSha256],
 };
 for(const [name,root,relative] of [['worker-local-service.ps1','worker',`releases/${head.releaseId}/tools/worker-local-service.ps1`],['process-deadline.ps1','worker',`releases/${head.releaseId}/tools/process-deadline.ps1`],['django-local-service.ps1','django','app/tools/django-local-service.ps1']]){
  const expected=await pin('source',name,path.join(source,'tools'));
  const installedSha=pins.find(p=>p.root===root&&p.relative===relative)?.sha256;
  if(pandasRotation||nativeIsolationRotation){
   const [before,after]=(nativeIsolationRotation?nativeQualification.controllers:pandasControllers)[name];
   assert.equal(installedSha,before,'Pandas维护前驱控制器不在已审兼容资格内：'+name);
   assert.equal(expected,after,'Pandas候选控制器不在已审兼容资格内：'+name);
  }else if(installedAi===candidateAi||dingtalkAcl)assertMaintenanceControllerGeneration({name,installedSha,expected,candidateSha:await sha(path.join(source,'tools',name))});
 }
 if(nativeIsolationRotation){
  for(const [name,expected] of Object.entries(nativeQualification.helpers))await pin('source',name,path.join(source,'tools'),expected);
  nativeIsolationQualified=true;
 }
 if(pandasRotation||nativeIsolationRotation){
  const actual=await fs.readFile(path.join(installed,'tools/django-ai.ps1'));
  assert.equal(createHash('sha256').update(actual).digest('hex'),installedAi,'维护资格核验后工具发生变化');
  assert.equal(createHash('sha256').update(candidate).digest('hex'),candidateAi,'维护资格核验后工具发生变化');
  assertPandasPredecessorPiStop(actual);
 }
 if(dingtalkAcl){
  // The installed bytes must still be the qualified ones and still carry the
  // reviewed Pi exit-observation and Stop protocol (the candidate was checked above).
  const actual=await fs.readFile(path.join(installed,'tools/django-ai.ps1'));
  assert.equal(createHash('sha256').update(actual).digest('hex'),installedAi,'维护资格核验后工具发生变化');
  const text=actual.toString('utf8').replaceAll('\r\n','\n');
  for(const [start,end,expected] of [['Wait-PiWorkerExit','Stop-PiRuntime','4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3'],['Stop-PiRuntime','Read-PandasConfig','49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6']]){
   const body=text.split('function '+start)[1]?.split('\nfunction '+end)[0];
   assert.equal(createHash('sha256').update(('function '+start+(body??'')).trimEnd()).digest('hex'),expected,'实际前驱Pi停止协议不在已审兼容资格内');
  }
 }
 if(!dingtalkAcl&&!pandasRotation&&!nativeIsolationRotation&&installedAi!==candidateAi){
  // Unlike isPiMaintenancePredecessor/isFirstMaintenancePredecessor above,
  // there was no null branch here: an unmatched releaseId used to fall
  // through to nativePiWorkspacePredecessor by default and fail for the
  // wrong reason (a pin mismatch against a generation that could never
  // apply) instead of being refused as "no qualified generation applies". A
  // real head that does not match any registered generation must be refused
  // here, not silently admitted.
  const k=isNativePiStopCapabilityPredecessor(head);
  assert.ok(k,'没有适用于实际前驱的原生Stop能力资格');
  assertPredecessorPins(k);
  assert.equal(head?.releaseId,k.releaseId,'没有适用于实际前驱的原生Stop能力资格');assert.equal(head?.manifestSha256,k.workerManifestSha256);assert.equal(djangoManifestSha256,k.djangoManifestSha256);
  for(const [name,expected] of [['worker-local-service.ps1',k.workerScriptSha256],['process-deadline.ps1',k.workerTransportSha256]])assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'tools',name)),expected);
  assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'deployment-manifest.json')),k.workerManifestSha256);
  assert.equal(await sha(path.join(installed,'tools/django-local-service.ps1')),k.djangoScriptSha256);
  assert.equal(installedAi,k.djangoAiScriptSha256,'实际前驱缺少已验证的Pi退出观察器');assert.equal(candidateAi,k.candidateAiScriptSha256,'候选Pi控制器不在已审兼容资格内');
  // k.candidateDjangoScriptSha256 is only present on generations whose
  // candidate django-local-service.ps1 differs from the installed bytes
  // (nativePiBusinessPredecessor and nativePiReleaseChainTripleFixPredecessor);
  // nativePiWorkspacePredecessor has no such field and skips this extra check.
  if(k.candidateDjangoScriptSha256){
   // candidateWorkerScriptSha256 defaults to the installed hash (no change on
   // the candidate side) for generations such as nativePiBusinessPredecessor
   // that never declared it.
   for(const [name,expected] of [['worker-local-service.ps1',k.candidateWorkerScriptSha256??k.workerScriptSha256],['process-deadline.ps1',k.workerTransportSha256],['django-local-service.ps1',k.candidateDjangoScriptSha256]])assert.equal(sourcePins[name]??pins.find(p=>p.root==='source'&&p.relative===name)?.sha256,expected,'候选生命周期控制器不在已审兼容资格内：'+name);
   const actual=await fs.readFile(path.join(installed,'tools/django-ai.ps1'));
   assert.equal(createHash('sha256').update(actual).digest('hex'),installedAi,'维护资格核验后工具发生变化');
   const text=actual.toString('utf8').replaceAll('\r\n','\n');
   for(const [start,end,expected] of [['Wait-PiWorkerExit','Stop-PiRuntime','4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3'],['Stop-PiRuntime','Read-PandasConfig','49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6']]){
    const body=text.split('function '+start)[1]?.split('\nfunction '+end)[0];
    assert.equal(createHash('sha256').update(('function '+start+(body??'')).trimEnd()).digest('hex'),expected,'实际前驱Pi停止协议不在已审兼容资格内');
   }
  }
 }
 await pin('django','app/tools/django-ai.ps1',path.dirname(installed),installedAi);
 await pin('source','django-ai.ps1',path.join(source,'tools'),candidateAi);
 return finish('native-exit-observer');
}
export function assertPiMaintenanceContinuation(snapshot,admission,{requireFresh=true}={}){
 assert.equal(snapshot.version,'manual-maintenance-pi-continuation-v1');
 for(const [key,value] of Object.entries(piMaintenancePredecessor))assert.equal(snapshot[key],value);
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);
 for(const field of ['sourceBound','rotationOwnerBound','originalActorBound','originalActorExited','piStopBound','piWorkerAbsent','workerReceiptAbsent','postgresPreservedReady','nativeStopIdentityGatePreserved'])assert.equal(snapshot[field],true,field);
 assert.deepEqual(snapshot.controlParticipants,[]);assert.deepEqual(snapshot.downstreamEffects,[]);
 assert.match(snapshot.piStopBinding?.controlSha256??'',hash);assert.match(snapshot.piStopBinding?.ackSha256??'',hash);
 assert.ok(Number.isFinite(Date.parse(snapshot.at)),'独立观察时间无效');
 if(requireFresh)assert.ok(Date.now()-Date.parse(snapshot.at)>=0&&Date.now()-Date.parse(snapshot.at)<120000,'独立观察已过期');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,admission.maintenanceId);assert.equal(record.keepPostgres,true);assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.ok(snapshot.maintenance.drainedStopped===undefined||typeof snapshot.maintenance.drainedStopped==='boolean');
 if(snapshot.maintenance.drainedStopped===true){assert.equal(snapshot.fullNativeStopScopeVerified,true);assert.equal(snapshot.durableCompleteCommit,true);return 'coordinate-completed';}
 assert.equal(snapshot.fullNativeStopScopeVerified,false);return 'enter-same-id-once';
}
export async function continuePiMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 await recheck();const expected={...admission,admissionSha256,originalFailureSha256};
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256,'-Route','pi19db'];
 const observed=await step('独立核实Pi维护',script,'Check',extra);
 assertPiMaintenanceContinuation(observed.snapshot,expected);assert.match(observed.observationSha256??'',hash);
 assert.equal(path.dirname(path.resolve(observed.observationPath)),path.resolve(admission.attempt));
 assert.match(path.basename(observed.observationPath),/^maintenance-pi-observation-[a-f0-9]{32}\.json$/);
 await recheck();
 const result=await step('续接Pi维护',script,'EnterMaintenance',[...extra,'-ObservationPath',observed.observationPath,'-ObservationSha256',observed.observationSha256]);
 assert.equal(result.observationSha256,observed.observationSha256,'续接未绑定原独立观察');
 // before records admission at the native call boundary, not a new observation
 // after a potentially long native Stop. The PS adapter checked freshness there.
 assert.equal(result.continuationDecision,assertPiMaintenanceContinuation(result.before,expected,{requireFresh:false}));
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
export function isFirstMaintenancePredecessor(head,djangoManifestSha256){
 const k=firstMaintenancePredecessor;
 return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
export function assertFirstMaintenanceContinuation(snapshot,admission){
 const k=firstMaintenancePredecessor;
 assert.equal(snapshot.version,'manual-maintenance-continuation-v1');
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 for(const [key,value] of Object.entries(k))assert.equal(snapshot[key],value,'限定前驱变化：'+key);
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);assert.match(snapshot.maintenanceId??'',/^[a-f0-9]{32}$/);
 assert.equal(snapshot.sourceBound,true);assert.equal(snapshot.rotationOwnerBound,true);assert.equal(snapshot.originalActorBound,true);
 assert.equal(snapshot.originalActorExited,true);assert.deepEqual(snapshot.controlParticipants,[],'原控制参与者仍在或身份未知');
 assert.equal(snapshot.fullNativeStopScopeVerified,true,'完整原停止范围未验证');
 assert.equal(snapshot.workerStatus?.state,'stopped');assert.equal(snapshot.workerStatus?.releaseId,k.releaseId);assert.equal(snapshot.workerStatus?.manifestSha256,k.workerManifestSha256);
 assert.equal(snapshot.workerReceiptAbsent,true);assert.deepEqual(snapshot.applicationProcesses,[]);assert.equal(snapshot.postgresPreservedReady,true);
 assert.deepEqual(snapshot.downstreamEffects,[],'已有后续发布动作');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,snapshot.maintenanceId);assert.equal(typeof record.runtimeRoot,'string');
  assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());assert.equal(record.keepPostgres,true);
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.equal(typeof snapshot.pandasConfigured,'boolean');
 if(snapshot.pandasConfigured){assert.equal(snapshot.pandas?.distribution,'TERUISI-Pandas');assert.equal(snapshot.pandas?.user,'teruisi-pandas');assert.equal(snapshot.pandas?.unit,'teruisi-pandas.service');assert.equal(snapshot.pandas?.activeState,'inactive');assert.equal(snapshot.pandas?.subState,'dead');assert.equal(snapshot.pandas?.mainPid,0);assert.equal(snapshot.pandas?.controlPid,0);assert.deepEqual(snapshot.pandas?.containers,[]);}
 const stopped=snapshot.maintenance.drainedStopped;
 assert.ok(stopped===undefined||typeof stopped==='boolean','drainedStopped类型不正确');
 if(stopped===true){assert.equal(snapshot.durableCompleteCommit,true,'原完成提交证据缺失');return 'coordinate-completed';}
 assert.equal(snapshot.durableCompleteCommit,false,'原提交与维护对象矛盾');
 return 'enter-same-id-once';
}

export async function continueFirstMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 // The caller keeps its original rotation lease and call stack. A new publisher
 // invocation still rejects STARTED without SUCCESS before reaching this code.
 await recheck();
 const expected={...admission,admissionSha256,originalFailureSha256};
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256];
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const snapshot=await step('核实首次维护',script,'Check',extra);
 const decision=assertFirstMaintenanceContinuation(snapshot,expected);
 await recheck();
 const result=await step('续接首次维护',script,'EnterMaintenance',extra);
 assert.equal(result.continuationDecision,decision);assertFirstMaintenanceContinuation(result.before,expected);
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
