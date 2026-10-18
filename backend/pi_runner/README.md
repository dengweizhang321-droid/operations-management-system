# Independent PiAgent runner

This package is an opt-in Linux/rootless-Docker service, not a Django worker or
a replacement for the deployed pandas broker. No service is installed or started
by importing it. Production adoption requires its own reviewed image, independent
channel key, frozen source, and explicitly installed user unit.

## Runtime and storage

Pi is the real published `@earendil-works/pi-coding-agent` **1.3.0**, pinned with
the complete npm lock. The build uses the exact Python base digest and verified
Linux Node 24.8.0/npm 11.6.2 archives in
`containers/pi-agent/runtime-lock.json`; it is not a Docker Hub Node image.
Mirror downloads are accepted only when the official registry integrity matches.
Startup never installs or pulls packages. Explicit user dependency controls
accept only outside-fetched, byte-verified offline bundles; pip, npm and the
separately pinned uv binary execute inside the networkless container.

One owner/conversation/epoch/generation has one container and one exclusively
labelled Docker named volume. There are no host bind mounts. HOME, session files,
inputs, outputs and working files live in that volume. A new generation has a
different volume. Container rootfs is read-only, user 65532, network none,
capabilities none, no-new-privileges, private IPC/cgroup namespace, default seccomp,
1 CPU, 1 GiB memory with no extra swap, 128 PIDs, 128 MiB `/tmp`, 16 MiB shm,
64 MiB per-file kernel fsize. The image cannot declare volumes or alter entrypoint.

Total workspace size (default 256 MiB), entry count (5000), session count (8) and
idle stop (30 minutes) are bounded operator settings. Workspace bytes/count use a
one-second **soft scan**, with possible overshoot during the scan window; they
are not filesystem hard quotas. Exceeding either revokes the run, precisely stops
the container and retains the frozen volume. No existing WSL partition or Docker
daemon configuration is changed.

The fixed launcher reads exactly one broker `runner_init` JSONL record before
starting `pi --mode rpc`. It never trusts workspace skill selectors. Only the
reviewed extension and explicit image skill paths load; context files, discovered
extensions/skills/templates/themes, project trust, MCP and online refresh are
disabled. Agent and provider retries and automatic compaction are disabled.
Requested model context/output/reasoning metadata comes from Django and is checked
against real Pi `get_state` after binding; it has no synthetic product defaults.

Idle restart and a terminal broker restart resume the exact Pi session ID in the
same named volume. Startup rebuilds observable references to unknown active
containers from their exact labels/name/volume/ledger binding. Those sessions
are precisely stopped (retaining the unknown outcome and volume) and accept
state/dispose, never a prompt or automatic model replay. Unregistered
containers in this namespace fail startup. Unknown containers count toward the
physical admission limit.

## Wire contract

`POST http://127.0.0.1:8123/v1/command` accepts exactly:

```json
{"operationId":"persistent-run-id","ownerId":"server-owner","conversationId":"conversation-id","epoch":1,"generation":1,"seq":1,"command":"create","payload":{}}
```

The owner is server-established and is hashed for paths. Epoch/generation remain
stable across ordinary rounds; `seq` increments per run. A run reuses the same
identity for create, prompt, state, abort, gateway_response and ack. Mutation
receipts are durable by `(operationId, command)` and payload SHA. A matching retry
reads its old receipt; unknown effects never execute again. State is read-only.
Cached receipts omit pending gateway requests and artifact base64. Event/cached
audit rows strip capabilities, private thinking and provider frames while retaining
public response/tool text and sequence numbers. Private model history remains only
in the native Pi session where it is needed for correct provider resume. Existing
pre-redaction audit rows are scrubbed at startup with secure-delete and checkpoint.

Headers are X-Timestamp (Unix seconds), X-Nonce (32 lowercase hex) and X-Signature.
HMAC-SHA256 text is `pi-runner-v1`, direction (`request`/`response`), `POST`, exact
path, timestamp, nonce and body SHA-256, joined with LF. Responses are independently
signed over the response bytes. Request nonce is persisted. `POST /v1/status`
uses the same protocol bound to that exact path and an empty object body; it
returns live Docker readiness, image/source identity and aggregate counts.

Commands:

- `create`: gateway `{url,capability}`, model `{contextWindow,maxTokens,reasoning}`,
  selected skillIds and skillVersion. It creates or resumes the same workspace.
- `prompt`: message, fresh operation-bound gateway capability, positive safe integer
  timeoutMs from the configured task deadline, optional model metadata and files.
- `state`: afterEventSeq. Events have a conversation-wide contiguous eventSeq and
  their original operation identity. Old-operation records still consume sequence.
  Pages return at most 200 events with explicit hasMore.
- `gateway_response`: requestId and response. Identical response replay is passive;
  changed/foreign responses are rejected.
- `abort`: revokes capability use, clears the Pi queue, sends abort, waits for the
  real terminal notification. An abort command response alone is not completion.
- `ack`: records application handling after a verified terminal outcome.
- `skills`: empty reads the frozen set; `{skillVersion,skillIds}` atomically changes
  an idle session's reviewed bundle and restarts Pi with the same session. Busy
  updates are rejected. Unknown versions or missing resources have no fallback.
- `dispose`: precisely removes this container and verifies absence. It retains the
  old volume and never attaches it to a different generation.

Pi's one prompt response is acceptance, not final model success. Its disposition
is `started` or `handled`; this runner never queues a second run behind an active
one. `handled` has no run and waits for no agent_settled. The real `agent_end`
remains a process event. Only real `agent_settled` followed by passive file
collection produces filesCollected=true and terminalReceipt
`{operationId,status,eventSeq,files:[sha256]}`. While collecting, phase is settling
and no terminal receipt exists. HTTP receipt, Pi response, agent_end,
agent_settled, file collection and application ack remain separate evidence.

## Gateway and files

The trusted provider uses `extension_ui_request` input title `pi-gateway-v1`;
the placeholder carries a bounded normalized request. No supplier credentials,
database connection or Docker socket enter the container. The only authentication
inside Pi is the current short operation capability, bound by an internal command
and excluded from normal events/logs. No HTTP route is reachable from the container.

State returns pendingGatewayRequests. The Windows Django worker authorizes and
durably dispatches them using the current principal and central tool registry,
then posts gateway_response. Every request carries the same operation identity
and a unique requestId. This keeps HTTP in the Windows-to-WSL direction and works
with WSL NAT. Gateway waits follow the operation's monotonic configured deadline
and check cancellation every half-second, rather than a fixed provider timeout.

Model messages are provider-neutral system/user/assistant/tool records. Central
tool calls are represented inside Pi by system_tool `{name,args}` and mapped back
to the original tool name in provider history. Opaque signed thinking frames are
preserved for the outside adapter. Raw thinking must not be displayed by the UI.

Inputs and outputs are bounded to 20 files / 8 MiB aggregate. Input objects have
id, fileName, mimeType, sha256, sizeBytes and base64. The fixed transfer program
validates the complete batch, then writes only `/workspace/inputs/<id>/<name>`.
It rejects path traversal, links, collisions and mismatched bytes. Exported files
are passive regular files under `/workspace/outputs`, with SHA and byte metadata;
old unchanged files are not attributed to a later run. A dataset-export handle
can trigger a separately authorized `kind=file` gateway request; only its local
path is returned to the model, never file base64.

## Prepare and verify

Build from the repository root:

```powershell
python containers/pi-agent/build_image.py --tag pi-test:candidate --output D:/codex-artifacts/pi-image.json
python containers/pi-agent/run_real_wsl.py --image sha256:<exact-image> --evidence D:/codex-artifacts/pi-real-tests.log
```

The real suite uses a fresh `pi-test-*` namespace, synthetic model protocol
responses, actual Pi RPC, actual rootless containers, built-in tools and skill
scripts. It does not call a paid model or alter the deployed pandas service.
Windows-specific tests use real CurrentUser DPAPI and separately injected
transport; they do not claim a production service probe.

For a formal installation, first compute `source_digest()`. Prepare its fixed
fresh directory
`/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases/<sourceSha256>` with
the independent 32-byte channel key on stdin:

```sh
python3 -B -m pi_runner.install_linux --destination <fixed-release-path> --image sha256:<exact-image> --approved-source-sha256 <sourceSha256> --namespace pi-agent-v1
```

The installer prepares source, 0700 state, 0600 channel/config and a unit file;
it neither installs the user unit nor starts/enables it. An explicitly authorized
operator can install the produced pi-runner.service as
`~/.config/systemd/user/teruisi-pi-runner.service` and daemon-reload. It has no
automatic restart or enable target.

Windows lifecycle is
`python -m pi_runner.wsl_control start|stop|probe --config <pi-agent.json> --key-file <pi-agent.dpapi.json>`.
It verifies the unit's fixed source path, image, live signed health, both
keyFileSha256 (DPAPI wrapper bytes) and channelKeySha256 (decrypted raw bytes).
Stop refuses active operations and unknown containers whose stopped identity is
not proved by a fresh Docker inspection. A safely stopped unknown operation stays
unknown in the ledger and does not block stopping services. Health reports
unsafeUnknownCount and unknownStoppedVerifiedCount from current full-ID, labels,
image, volume and Running checks. Django's worker must first fence its operations.
Installed source/image/key fingerprints cannot silently
change. No installation, service enable, production restart or production cutover
has been performed by this implementation task.

## Workspace controls (phase two)

The signed command envelope and principal/epoch/generation fences are unchanged.
The additional `workspace` command takes `{action:"state",afterTerminalSeq:{terminalId:lastSeq}}`,
`{action:"receipt",controlId}`, `{action:"download",downloadId}`, or
`{action:"control",controlId,controlSeq,command,payload}`. Control sequences strictly
increase within a workspace (gaps are permitted). Both ID and sequence are durable
and unique. Identical retries read the same receipt; changed content or reused/lower
sequences are rejected. Restart makes interrupted controls/inputs unknown and never
replays them. GET polling does not extend idle timers.

Controls are `steer`, `follow_up`, `clear_queue`, `bash`, `abort_bash`, `compact`,
`model_set`, `thinking_set`, `ui_response`, `session_new`, `session_switch`,
`session_fork`, `session_clone`, `tree`, `stats`, `export_html`, `terminal_create`,
`terminal_input`, `terminal_resize`, `terminal_close`, `file_list`, `file_read`,
`file_download`, `file_write`, `file_mkdir`, `file_rename`, `file_delete`, `pause`,
`wake`, `resource_install`, and registered `upgrade`. Unsupported operations fail
explicitly. Pi 1.3.0 has no navigation RPC: `session_navigate` reports
`unsupported_pi_version`; fork/clone/switch use real supported operations.

Steering/follow-up stay attached to the active run. Native acceptance, queueing,
actual user-message consumption (`completed/disposition=processed`), handled,
and clear/abort (`completed/disposition=canceled`) have distinct receipts. Native
bash interprets leading `!` as included in model context, `!!` as excluded.
`abort_bash` is separate from model abort. Async bash/compact/install/upgrade return
acceptance and retain their eventual receipt. Compaction binds a fresh authorized
operation/capability and completes after its real RPC result and passive file
collection; it does not invent agent_settled.

Native session paths stay in a private registry. The browser switches registered
session IDs and forks registered user entry IDs. New/clone/fork/switch read back
actual Pi state. Public trees have bounded navigation metadata/text previews.
Export invokes the native exporter in `/tmp`, then delivers a separate public HTML
projection; private thinking/provider frames never enter downloadable HTML.

Ordinary extension UI is separate from `pi-gateway-v1`. The internal route requires
the exact method/title and active private capability. Select/confirm/input/editor
have scoped request IDs, typed responses and cancellation. Notify/status/widget/
title/editor-text effects are durable and bounded. The immutable `/workspace-ui`
command exercises these controls. Prompt preflight can await ordinary UI: HTTP
returns persisted dispatch state while one original RPC wait stays alive. Refresh
does not resend that prompt.

Terminals use a fixed helper with a real Linux controlling PTY and interactive
bash in the original conversation container/UID/workspace. Four tabs can run;
eight total are retained. Input has independent inputId/inputSeq/digest and an
acknowledgement after the PTY write. Lost acknowledgements are unknown, never
replayed. UTF-8 decoding is incremental, resize uses TIOCSWINSZ, and Ctrl+C uses
the actual line discipline. Each tab retains 256 KiB with explicit sequence gaps;
state pages at most 512 KiB across tabs with hasMore. Closing stops its helper.

File paths are relative to `work`, `inputs` or `outputs`. Anchored no-follow
descriptors reject traversal, links, special files and root mutation. Write/
rename/delete require expected SHA (null means create-if-absent). Before comparing
and mutating, the broker proves exclusive owner-volume attachment, pauses every
Pi/PTY/background process, runs one constrained fixed helper on that named volume,
proves helper removal, and unpauses the exact owner. Advisory locks alone cannot
constrain arbitrary user shells. Downloads are immutable broker-private snapshots
identified by downloadId. Count/bytes are bounded; later edits cannot change them.
Large/binary reads explicitly disable editing. State history omits file bodies.

`resource_install:{bundle}` checks outside-fetched artifacts and lock digests again.
Pip/uv use the persistent workspace venv; npm uses the workspace project with
install scripts disabled. All run offline without credentials. The uv executable,
version, wheel hash and binary hash are frozen in runtime-lock.json. Receipts keep
source/version/hash/fetch timestamp. Installs are exclusive and prevent idle stop.
Pending UI, PTYs, unfinished controls and extra actual PID/start-tick identities
also prevent idle stop, including detached shell work.

## Registered sandbox upgrades

The browser supplies only `{planId}`. `python -m pi_runner.upgrade_linux --config
<private-config> --compatibility-proof <proof.json>` registers an operator-prepared
plan without changing services. It binds from/to images, immutable Runner source,
protocol and real compatibility evidence: session/history hashes, matching
workspace/package manifests, Python minor and Node ABI. The current package set
must match the tested plan. Unknown/busy work cannot upgrade. Browser-supplied
image/source paths and compatibility assertions are never accepted.

Apply persists the complete original/candidate intent before effects, stops the
exact idle container, clones its volume from a read-only mount into a fresh
candidate volume, and starts that candidate with the same owner/conversation/
generation. It checks actual Pi session/history and dependency/runtime identity.
The original stopped container and original volume remain retained; candidate
writes never touch them. Failure keeps unknown and both identities. Startup
precisely stops interrupted candidates; it never adopts or replays an unknown
upgrade. Runner source preparation remains the independent fixed `install_linux`
release and explicit user-unit lifecycle, separate from Django/Worker publication.

Existing installations use `tools/pi_agent_upgrade_runtime.py prepare|check|apply|reconcile`;
first-use `PreparePi` is never reused as an upgrade. `django-ai.ps1` exposes
`PreparePiUpgrade`, `PiUpgradeCheck`, `UpgradePi`, and `ReconcilePiUpgrade`.
Candidate preparation/check require the exact native `PiPreparedAppId` and
`PiPreparedAppSha256`; the installed predecessor, package receipt and complete
source inventory are checked before executing the frozen staging tool. Apply and
reconcile are installed-controller-only and require `PiUpgradePlanSha256`.

Online preparation leaves the old unit/config/state running. Apply requires the
old worker/unit and its containers fenced/stopped, then takes a fresh SQLite
backup and copies downloads/receipts/unknown fences into the new immutable
release. Legacy session images are explicitly recorded as their original image;
the new source does not attach an old volume to a different image. The exact
user unit is switched, signed health/readiness verified, and only then the Windows
configuration is CAS-published. The same CurrentUser DPAPI wrapper/channel key and
AI authority survive. The predecessor release/state remain retained. A known
failed, absent successor restores the old unit while leaving it stopped; unknown
startup keeps both states and blocks replay. Explicit reconciliation verifies the
same original intent, unit, signed successor and fresh-state binding, then finishes
only the Windows publication. Exact partial `.new` receipts can be promoted;
foreign fragments/configuration are retained and rejected.

Internal host dependency fetches use signed `workspace` activity_begin/end with
independent activityId and activitySeq 1/2, before any outside registry request and
after offline installation is accepted. Their deadline never renews during GET.
An active lease prevents idle stop; restart or expiry makes it unknown, precisely
stops its owner, and exposes activities/hasUnresolvedActivities for Django fencing.
These actions are not browser controls. Old images expose needsImageUpgrade and
disable helper capabilities until a separately verified registered image upgrade.
