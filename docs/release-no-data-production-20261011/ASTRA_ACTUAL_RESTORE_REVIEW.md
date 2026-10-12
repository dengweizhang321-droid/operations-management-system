# Actual installed-consumer Restore readback

Independent file readback passed on 2026-10-12. This records the completed isolated Restore, not completion of the remaining release operations. No SQL, native/process/port query, service action, second Restore, build or full source/dependency/dump scan was performed by this reviewer.

The original operator audit ef627746ece34ad88a066d5af4083fe2 reports completed / restore_cleanup at 01:56:55.9691099 UTC, with no failure. Its result exactly equals the result file completed at 01:56:55.9417664 UTC. Result raw SHA256 is 0ab553b56878aadf67d1e7b0aa118ea2e74b8dee8b6f0ce76b392993e9631f1d and matches its sidecar. Canonical result SHA256 is 45bd52d2e4edb7c1b3d47da534dc563e664fa2a0f39eb7cdd1624b3c08386342, matching the passed WAL receipt.

WAL 000042.json at 01:56:56.034 UTC has event SHA c0b89f1c2589eb03c7b2106cbe98d020547a7f87f154452de760b9eeb68b3d3b, operation restore-installed, status passed and exitCode 0. Its canonical bytes and event hash were recomputed; its previous hash links to the real started record 000041. Records 000039–000042 were checked consecutively. The operator audit result serialized with the original compact JSON plus CRLF yields exactly 946 bytes and SHA cca4a387e69e91b2a6024e99915661f28623499437828d4160b4fb293d13d79b, matching the original captured stdout digest. This reconstructs the digest relationship; it does not recover the deleted original stdout file. Stderr was 9653 bytes, not empty; only its original recorded hash is available in this readback, so no claim is made about its contents. timeoutType is null.

The result consumes the same confirmed backup outputs from WAL 000010:

- Backup daily-20261011T162958Z-49bdf7f519aa; manifest a46097b7b68a3967527c4fc101063d557089fc97228012c3b0fe8f42e6d598ed.
- Dump e88b7cbbae5b2aa30449373a21de7e3d7400912718132088d07e4166a169b148.
- Expected and restored content both f261acde08c84455f4f8c75b99486130e4b17f26dbde6c9a29933a1940fc2c83.
- Rehearsal 0d2c8cfba17c, isolated port 55433; productionDatabaseTouched=false, serviceStateChanged=false, cleanupStatus=isolated_data_removed, profileRestoreVerified=true and sequenceHealthVerified=true. All six approved operation assertions pass.

The original operator uses the distinct E:/TERUISI-Postgres-Rehearsals/restore-0d2c8cfba17c/data and .postgres-password.tmp paths. Metadata-only lstat returned ENOENT for both; neither contents nor other rehearsal data were read. The audit records sufficient capacity for the isolated restore. productionDatabaseTouched=false describes isolation of restore writes; it is not a claim that admission performed no production read connections.

The optional policySyntaxEquivalenceVerified is false, with an empty witness SHA. This readback does not establish full RLS policy syntax equivalence. The approved operation does not require that optional assertion. Snapshot content equality also does not imply that naturally evolving live production content still equals the earlier backup.

Installed deployment.json independently hashes to 85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09. The sealed restore command's entire 74-file list was read: 73 installed tools plus the exact System32 PowerShell binary. Each expected SHA, physical ancestor/realpath, regular-file type, link count and bracketed dev/ino/nlink/size/mtime/ctime identity matched; identities were checked again after the small closure pass. All installed tools also match the complete sealed after-inventory entries. Generic files remain single-link; only the fixed PowerShell path uses its original exact two-link contract. The installed verifier and rotation bytes are respectively 3c18a8641b1364e3eee8fa7506f9bac0e2f57ec7f529a2d69a00a4410156bfce and ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a. The unchanged PostgreSQL operator is 542e4fb67ed96a680f76f1de9f4b124bfb7f039094ff664fe25595b4a8fb48e6.

Before Restore, installed-recovery-consumer passed in WAL 000039 at 01:44:40.269 UTC, naming actual new Worker 20261011T090355Z-21c2645a63247749 and chain bc87c4d60408ecb9b8ca5855bdd2a39c684a39c2d3ec29dafef8434216aead6c. It exercised the newly installed read-only retention planner after deployment and ACL hardening. Planner compatibility is not execution of payload cleanup, and no such cleanup is claimed.

Reproducible readback source: [archive-actual-restore.mjs](archive-actual-restore.mjs). Nine non-sensitive records were saved create-only under [evidence/actual-restore](evidence/actual-restore/): original audit, result, sidecar, five WAL records and the readback/74-file identity summary. [MANIFEST.json](evidence/actual-restore/MANIFEST.json) SHA256 is 43df648232d7ead7c346ca68637b7b13f10127e34e6989e56890bf647cae3b00. No backup payload, password, environment secret or raw business rows were archived. Prior failures and reconciliations remain intact.

ExitMaintenance, StartWorker and remaining acceptance/closeout must still be assessed from their actual original receipts. This successful Restore does not independently release ownership or declare the nineteen-operation batch complete.
