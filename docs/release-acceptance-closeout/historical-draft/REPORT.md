# 发布证据与交付报告草稿

状态：journal-completed-review-required。自动生成不等同于验收通过；须独立复核和事实检查。

批次：8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af

源码与版本：

```json
{
  "binding": {
    "artifactSha256": "72ec1670ec9c092329dc4d9712461af3ed9d78df04a32b32400b3fd150af9818",
    "configurationSha256": "02c7f7d53dbde74a4e29a08f97948c5cec33c74ea9c51d30b0858858e86e6c73",
    "dependencySha256": "486154660ca7b1c32822078584c7938ae5de172a0dc8bcd47891100563af935e",
    "djangoCandidateSha256": "237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9",
    "djangoPredecessorSha256": "121d805fc7d01f234b14304ee1db901c82485b84920328082574622211b90888",
    "djangoPreparedAppId": "d6c3fcad7380480896b1f972c84c4279",
    "djangoPreparedReceiptSha256": "d51decd7abd141e3d853c5074396926f286c1a108da503841944edb846153b65",
    "maintenanceId": "c469d46e1e9aebef34dfbe943fa57f47",
    "predecessorInventorySha256": "5fbdd9b0e75c3c7f3ff02d3a33a48fd6228246319e9ee8e171f0d149a6291944",
    "predecessorSha256": "e4ddf64e637b0868e6e46ca2daf6d5895e36a1f4d0c053155bd503ef5e38dce3",
    "predecessorSourceSha256": "f701b4be5a35c31c087c266192e130613e4edab18e80c523007c33ed745ab057",
    "sourceInventorySha256": "2af380f7c575b7d3f7cdfb265853fd4257196686b187a2a912d12bf3a65236f1",
    "sourceSha256": "ce0a7b889dddfd93f31dc860cac5de224a8d6cc08a1423daf11fd134fe1a90b9",
    "testsSha256": "f97a000e6ea7ac6979e76924cff31f37a8d555e12421448c93462dd2a8d838f9",
    "toolchainSha256": "48587c6f8ec33de52c3b4d575735ef1ca2901dd6ca0cbbba95cc36cfef67b7d8",
    "workerPlanSha256": "043feb797593ffa7b47a3cd25f561744bb8687f9ba234477ee0136b51f844d4d"
  },
  "versions": {
    "sourceCommit": "e1f384e1e348b666da30d78e35d408aa882415b8",
    "candidateReleaseId": "20261008T182600Z-f5d4b05177d17010",
    "candidateManifestSha256": "72ec1670ec9c092329dc4d9712461af3ed9d78df04a32b32400b3fd150af9818",
    "predecessorReleaseId": "20261008T103219Z-f5d9b00e432df6c0",
    "predecessorManifestSha256": "91e392b28902df8ad3aaf966411eb9f39f2017ed4d899191c49573a320721915"
  }
}
```

| 操作 | 阶段 | 状态 | 原失败/协调数 |
| --- | --- | --- | ---: |
| reuse-final-worker | prepare | passed | 0 |
| op-backup-pre | backup-pre | passed | 0 |
| op-restore-pre | restore-pre | passed | 0 |
| step-entermaintenance | drain | passed | 0 |
| step-deployapp | switch | passed | 0 |
| step-hardenacl | switch | passed | 0 |
| apply-final-worker | switch | passed | 0 |
| step-exitmaintenance | switch | passed | 0 |
| step-startworker | switch | passed | 1 |
| check-live-resources | acceptance | passed | 0 |
| check-unchanged-business-permissions | acceptance | passed | 0 |
| customer-historical-query-preserved | acceptance | passed | 2 |
| customer-four-shop-production-ui | acceptance | passed | 2 |
| step-aggregatestatus | acceptance | passed | 0 |
| step-verifystartup | acceptance | passed | 0 |
| two-new-natural-watchdogs | acceptance | passed | 0 |
| op-backup-post | backup-post | passed | 0 |
| op-restore-post | restore-post | passed | 0 |
| final-readiness-closeout | closeout | passed | 2 |

计时（毫秒）：

```json
{
  "approvedAt": "2026-10-09T00:40:46.000Z",
  "completedAt": "2026-10-09T03:03:20.676Z",
  "approvedToCompleteMs": 8554676,
  "observedApprovalSpanMs": 8554676,
  "recordedByPhase": {
    "queue": 396.9462000000002,
    "prepare": 1066904.9208999998,
    "backup-pre": 919343.545,
    "restore-pre": 869058.8252000003,
    "drain": 493183.07710000034,
    "switch": 447227.02420000033,
    "acceptance": 715460.9031,
    "backup-post": 740459.8031000001,
    "restore-post": 794984.0386999999,
    "closeout": 199199.9990999999
  },
  "recordedExecutionSumMs": 6246219.082600001,
  "executionCoveredMs": 6246206.4091796875,
  "waitingOrUninstrumentedMs": 2308469.5908203125,
  "documentCloseoutMs": 1466985,
  "approvedToDeliveryMs": 10021661,
  "reconciliations": [
    {
      "operationId": "step-startworker",
      "resolution": "passed",
      "startedToResolutionMs": 1137117,
      "unknownToResolutionMs": null
    },
    {
      "operationId": "customer-historical-query-preserved",
      "resolution": "passed",
      "startedToResolutionMs": 533837,
      "unknownToResolutionMs": 530646
    },
    {
      "operationId": "customer-four-shop-production-ui",
      "resolution": "passed",
      "startedToResolutionMs": 271142,
      "unknownToResolutionMs": 265849
    },
    {
      "operationId": "final-readiness-closeout",
      "resolution": "passed",
      "startedToResolutionMs": 297420,
      "unknownToResolutionMs": 260332
    }
  ],
  "qualification": "Durations are recorded execution; interval union prevents overlap. Residual includes coordination, waits and uninstrumented work; it is not all idle time. Coordination spans and document closeout are separate, never added twice."
}
```

备份恢复及回执：

```json
[
  {
    "operationId": "op-backup-pre",
    "receiptSha256": "5c30886de2d5053178ef85f4340b14e1c25b146fa1b97d43bc0c68738f75e420",
    "fields": {
      "status": "completed",
      "backupId": "daily-20261009T005225Z-4154918a77f9",
      "manifestSha256": "3bd5da03fffc183a3148d171e997423a41d838fe5e786ca8073b764accb0a6be",
      "dumpSha256": "b235736cd9d376c7031fd020a2d3809c4696ea9887658ef12883f157780fc2c9",
      "contentSha256": "395aba7701b133853b2795c51fa84dcdfe859f886a34cb12b4a61dd2ecf15948",
      "serviceStateChanged": false
    }
  },
  {
    "operationId": "op-backup-post",
    "receiptSha256": "e277936fa70088a65c786d3e1cd12bceaea22c98cdb044c9185516f9a995dd8b",
    "fields": {
      "status": "completed",
      "backupId": "daily-20261009T022829Z-1b2230ebb792",
      "manifestSha256": "a8b2da3fc361e78748b7dc64dfbe4bc8a112d3d4a8bbe7d8d9760f6a9f6bbc65",
      "dumpSha256": "ef11e20ac06f3e7d8a8af0846cd95206d6c23cf5eedb466070880ff759423fff",
      "contentSha256": "76528c84798b811bc67a8058b5af9c30c643bdaa0c70c276d5ade2599a1cc683",
      "serviceStateChanged": false
    }
  },
  {
    "operationId": "op-restore-pre",
    "receiptSha256": "164f0fdd699a75a4822ff85a8687fc38624dfd8cf37fde487f792201b9b3817e",
    "fields": {
      "status": "completed",
      "backupId": "daily-20261009T005225Z-4154918a77f9",
      "dumpSha256": "b235736cd9d376c7031fd020a2d3809c4696ea9887658ef12883f157780fc2c9",
      "backupManifestSha256": "3bd5da03fffc183a3148d171e997423a41d838fe5e786ca8073b764accb0a6be",
      "expectedContentSha256": "395aba7701b133853b2795c51fa84dcdfe859f886a34cb12b4a61dd2ecf15948",
      "restoredContentSha256": "395aba7701b133853b2795c51fa84dcdfe859f886a34cb12b4a61dd2ecf15948",
      "profileRestoreVerified": true,
      "sequenceHealthVerified": true,
      "productionDatabaseTouched": false,
      "serviceStateChanged": false,
      "cleanupStatus": "isolated_data_removed",
      "policySyntaxEquivalenceVerified": false
    }
  },
  {
    "operationId": "op-restore-post",
    "receiptSha256": "37dd1bbeda1ac3a9bbe329ab2d2d7839e2543b494f376033a60ddf82904d0b14",
    "fields": {
      "status": "completed",
      "backupId": "daily-20261009T022829Z-1b2230ebb792",
      "dumpSha256": "ef11e20ac06f3e7d8a8af0846cd95206d6c23cf5eedb466070880ff759423fff",
      "backupManifestSha256": "a8b2da3fc361e78748b7dc64dfbe4bc8a112d3d4a8bbe7d8d9760f6a9f6bbc65",
      "expectedContentSha256": "76528c84798b811bc67a8058b5af9c30c643bdaa0c70c276d5ade2599a1cc683",
      "restoredContentSha256": "76528c84798b811bc67a8058b5af9c30c643bdaa0c70c276d5ade2599a1cc683",
      "profileRestoreVerified": true,
      "sequenceHealthVerified": true,
      "productionDatabaseTouched": false,
      "serviceStateChanged": false,
      "cleanupStatus": "isolated_data_removed",
      "policySyntaxEquivalenceVerified": false
    }
  },
  {
    "operationId": "step-startworker",
    "receiptSha256": "c6cdf11247307879dd7f0874c0f8eb4c4b71f2ce463e8263efb169623f3a9697",
    "fields": {
      "batchSha256": "8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af",
      "operationId": "step-startworker",
      "observationsSha256": "a9dc76a76c681e9f329637a6c16bb222211d75c7dd9695475ebfcccd05f08712",
      "noReplay": true,
      "independent": true
    }
  },
  {
    "operationId": "customer-historical-query-preserved",
    "receiptSha256": "76ca2f453f715dd34d4286a04b7336f64ad5d227396715a0495743a4bc917199",
    "fields": {
      "batchSha256": "8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af",
      "operationId": "customer-historical-query-preserved",
      "observationsSha256": "3e99b4407d2428be1c5fcfcb62ad323d99a633a53f1b9b0101f9fd0ef859c21d",
      "noReplay": true,
      "independent": true
    }
  },
  {
    "operationId": "customer-four-shop-production-ui",
    "receiptSha256": "e26aa8883ddbcef518b1c0950e7097eddf072f224efbff69ff2c5a5c50978780",
    "fields": {
      "batchSha256": "8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af",
      "operationId": "customer-four-shop-production-ui",
      "observationsSha256": "9c243f82d039969bf6e1b0501c3fd9e7b01d05e615e14fb2e65b8a81bf7b01d7",
      "noReplay": true,
      "independent": true
    }
  },
  {
    "operationId": "final-readiness-closeout",
    "receiptSha256": "3ff3437aba9f45a11196e6f9dcb42acbb1586f6dea1f555bcb5cad6a94df03d4",
    "fields": {
      "batchSha256": "8f6ed5eff8f63d088b5523d71a929856445db016d1c986396376390b470462af",
      "operationId": "final-readiness-closeout",
      "observationsSha256": "fff1d0ad87524a49a4bbbbbd2c2fd7d04d8bd6b6692b4c76c773b584911ac2ea",
      "noReplay": true,
      "independent": true
    }
  }
]
```

未决：无。未执行：无。

证据缺口、未覆盖与限制：

- No new production acceptance was run by task B.
- Historical aggregate baseline cannot prove primary-key or business-content preservation.
- Real imports, business recovery, schedule changes and external sends were not executed by this release.
- Automatic report generation does not establish acceptance. Independent review and fact checking remain required.
- Immutable runtime identity must be independently observed; candidate/predecessor versions do not establish currently running versions.
- Historical missing baselines are not reconstructed. Preserved metadata does not establish that old backup payloads remain available.
- Estimated savings of 10–18 minutes for false alarms and 5–10 minutes for document closeout are unverified, not a per-batch promise.
- Historical snapshot counts 3299 versus 3302 remain original evidence; no old row baseline was invented.

完整步骤、原失败、协调、证据路径与 SHA 见同目录 report.json。
