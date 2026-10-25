# V3 reconciliation and bounded waiting transport

Read-only source and byte review, 2026-10-12. No production invocation was made by this reviewer.

The four Root transport/preparation modules and both generated PowerShell bootstraps were read in full. All eleven reconciliation binding members and all fourteen waiting binding members were independently hashed and matched. Actual hashes:

| Item | SHA256 |
|---|---|
| Reconciliation binding | `8e17ef49bf22aa0f936dc11f97b58e89598d7b6078272804f48f1105a883ae00` |
| Reconciliation bootstrap | `3e26e596f043fb65d9404d158eac5d27b1b77a623d39340faeccc8372277fff8` |
| Waiting binding | `2a976db77797d57b2068124c6be92eac442378855ae3f5d63d7db8f38a0b667e` |
| Waiting bootstrap | `27631c8004159860418c424bf9d642015e8f8090b0c3cf7da1329395f707217a` |

V3 corrects the two earlier transport limitations: NODE_* is rejected before Node starts, and the fixed external runner uses create-only logs and installs error/close listeners immediately after spawn. The same SID/Admin check and FileShare.Read closure remain. The invoked adapter and proof are fixed; reconciliation does not resume the release itself.

The second bootstrap grants no arbitrary command interface. It holds the fixed resume implementation/proof/environment/spec/entry closure and waits at most thirty minutes for the single fixed reconciliation transport. Exit 0, null error, exact transport binding, exact proof, original batch, successful receipt and the actual canonical event digest must agree before it spawns the fixed resume2 runner. That runner independently verifies the entire eleven-event chain, exact five outputs/proof, two passed operations, no unknown state, owner/gates, native PID absence and the full original bc79 environment. No required original release operation is removed.

No additional concrete execution blocker or scope expansion was found in this review. The existing human authorization may be implemented through these exact UAC confirmations by Root. This is not a claim that either invocation, reconciliation, resume, or release acceptance has completed.

A bounded reliability limitation was disclosed: polling may read the create-only FINISHED file during its short direct write and reject incomplete JSON. That path fails closed rather than proceeding, and there is no observed occurrence at review time. It does not justify treating failure as success, replaying Backup, or expanding the transport.

## Actual PS5 decoding failure and fixed-byte UTF-8 shim

Root subsequently reported that the first waiting PowerShell process exited before WAIT_STARTED, and a direct PS5 decoding observation rendered the non-BOM UTF-8 Chinese working-directory path incorrectly. The earlier static review did not validate this PS5 file-decoding boundary; its conclusion must not be read as an actual successful launch test. The original bootstrap bytes remain unchanged.

The new `resume2/LAUNCH_WAIT_UTF8.ps1` was independently read and hashed: `0ebb3237efdb2bfc34d103930baf30006385bdfce13ed604e287f184cd9a08e5`. Its bytes are ASCII only. It opens the exact original bootstrap with FileShare.Read, verifies `27631c80…`, rewinds the same handle, decodes with explicit strict UTF-8, and executes the captured text as a ScriptBlock while the handle remains held. It does not add a command/path parameter or bypass the original SID/Admin/NODE/closure checks. The original bootstrap hash was independently rechecked unchanged; its bytes have no UTF-8 BOM and do contain the intended Chinese path when explicitly decoded as UTF-8.

Existing records were read: reconciliation-v3 STARTED and DIRECT_PROCESS identify Node 41296 at `2026-10-11T17:07:40.209Z` with the exact 8e17 binding; the later WAIT_STARTED exists at `2026-10-11T17:08:51.772Z`, with the same binding and 1800000 ms wait limit. These establish launch progress, not reconciliation completion. The reported Windows administrator PID/UAC history comes from Root; no process query was performed by this reviewer. Await final original WAL/receipt evidence before claiming the single CAS or resumed release succeeded.
