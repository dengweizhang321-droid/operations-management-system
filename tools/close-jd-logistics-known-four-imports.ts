import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { assertLogisticsReceipt, assertLogisticsEnabledProducts, assertLogisticsExport, assertLogisticsManifest, logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_LOGISTICS_MAX_FILE_BYTES, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity, type LogisticsExportManifest } from "./jd-logistics-export";
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions, type PreexportTarget } from "./close-jd-logistics-preexport";


import { jhLogisticsExportRequest, jhLogisticsQueryRequest } from "../lib/jd/logistics-source-tasks";

// A production operator artifact for exactly 9619. It is not an installed
// helper/Worker/Django entry and cannot replay any stage or import any file.
export const jdKnownFourImportsTarget = Object.freeze<KnownFourImportsTarget>({
  "failureCode": "JD_LOGISTICS_BATCH_RECEIPT_CHANGED",
  "executionId": "9619",
  "workflowId": "JdLogisticsDaily2026",
  "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
  "planHash": "9fb35d4e622cf48667c378de940b4249ef31b1175f4d26b1b3451df88930e118",
  "activeSha256": "f6ea9ca7540ff01f0647359715a986d25fe795327190c5637631bae181d6069c",
  "manifestSha256": "5b423cfbc6dce3cba29c25716caf700dfb8787df794f0e009cf167c7be010dc9",
  "executionDataSha256": "161b85e3a20829adb46ef032f87e304517abb25953baa8f421cbcffef099b571",
  "departmentId": "jd-yiyong-4418046540089",
  "businessUnitCode": "EBU4418046540089",
  "storeKey": "jd-yiyong-director",
  "debugPort": 9224,
  "shopId": "701455",
  "profileName": "Default",
  "releaseId": "20261016T052138Z-501da6b1afc58fef",
  "releaseManifestSha256": "24e532b7ef5f2f4b0f7e2665dbbc5fbb0739f71116c703621c3bcd8d4e9d7572",
  "helperReceiptSha256": "7c3cd0f3eb5a5d61d93abefb5ebbfec7b6f5fcb286b0c4f7e5a99ae86be8881b",
  "helperTreeSha256": "d41a738ee5f7d24a7bb114e54732e1e57a380016296e3a68120e56e254660ea2",
  "exporterSha256": "ad33bd7cfa6f2ec71fb1679a155baa0c5b58978f5e9ded75282a27d4e79f8e4d",
  "pipelineSha256": "f0a3424db715bec7588b332cd0dd8bd3e1d5526f34eb3cee333332127ecbd0d5",
  "sourceConfigSha256": "34a9497443a509080f20911c6a6db56511dc95c651258f3da3994bd4bcf50a6d",
  "registrySha256": "fdaaaa1cef550ec34fb58e84cb09df4edb77e1fddc446225d20e0031dd5be332",
  "supervisorPid": 7656,
  "supervisorCreationDate": "2026-10-16T05:56:13.5558610Z",
  "helperPid": 59548,
  "helperCreationDate": "2026-10-16T05:56:21.5540430Z",
  "downloads": [
    {
      "sourceKind": "flow",
      "operationId": "33f89d5e0f620ea4cf8d10041b865346",
      "fileName": "source.csv",
      "exportManifestSha256": "ca53ca60ec7a2c269e03b54f7d9475f954a20aac363e4075121b3845e1ba0b4d",
      "rawSha256": "b5d5b0f1f140dd8d0e7633482d88f56657e4d8f4908428780b350cadd24107f8",
      "bytes": 110097,
      "rows": 215,
      "contentHash": "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
      "collectedAt": "2026-10-16T05:58:27.116Z",
      "exportMetadata": {
        "version": 2,
        "identity": "3a99ebee4eba0948c34e1739c819c6038e9aa9398240d807154a9520c29bbed1",
        "stage": "downloaded",
        "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
        "executionId": "9619",
        "operationId": "33f89d5e0f620ea4cf8d10041b865346",
        "baseline": [],
        "observedBusinessUnitCode": "EBU4418046540089",
        "expectedRowCount": 215,
        "fullScopeHash": "701a254285d78f6ac1f8794d6f73eaf7dd8df325d30c6a5ef1004d23c57b6e5a",
        "directRequestId": "11934205-0285-45e2-8ba6-c9076c3f66da",
        "queryEvidence": {
          "requestHash": "b99839c51cd6c08187d9b5ed4f84f85ca28c8edd6289bd6f6b861472c6e52d2c",
          "total": 215,
          "observedAt": "2026-10-16T05:58:25.164Z"
        },
        "submittedAt": "2026-10-16T05:58:25.773Z",
        "requestEvidence": {
          "observedBusinessUnitCode": "EBU4418046540089",
          "requestedAt": "2026-10-16T05:58:27.116Z",
          "requestHash": "b99839c51cd6c08187d9b5ed4f84f85ca28c8edd6289bd6f6b861472c6e52d2c",
          "attachmentHash": "dc76346f88c8d193b427825248b283b4ee893ebd20e15f35aa6cae4d9e22230b"
        },
        "taskIdentity": "direct:957779b6b096097a5dea0e8d0b406cf7abe56dfa9394fe101d7f1f64789c8e2f"
      },
      "receipt": {
        "batchId": "8db4cb33-0700-4ffe-b039-aebcf63ad62c",
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "sourceKind": "flow",
        "rangeStart": "2026-10-15",
        "rangeEnd": "2026-10-16",
        "warehouseCode": "",
        "rawFileHash": "b5d5b0f1f140dd8d0e7633482d88f56657e4d8f4908428780b350cadd24107f8",
        "contentHash": "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
        "rowCount": 215,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "collectedAt": "2026-10-16T13:58:27.116000+08:00",
        "sourceAsOf": "2026-10-15T23:33:46+08:00",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "executionId": "9619",
          "protocol": "jd-logistics-pipeline-v1"
        },
        "sourceStatus": null
      },
      "utcCollectedAt": "2026-10-16T05:58:27.116000+00:00",
      "readback": {
        "batchId": "8db4cb33-0700-4ffe-b039-aebcf63ad62c",
        "sourceKind": "flow",
        "sourceStatus": null,
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "rangeStart": "2026-10-15",
        "rangeEnd": "2026-10-16",
        "warehouseCode": "",
        "warehouseKey": "",
        "fileName": "source.csv",
        "rawFileHash": "b5d5b0f1f140dd8d0e7633482d88f56657e4d8f4908428780b350cadd24107f8",
        "contentHash": "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
        "rowCount": 215,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "sourceBindingVerified": false,
        "collectedAt": "2026-10-16T05:58:27.116000+00:00",
        "sourceAsOf": "2026-10-15T23:33:46+08:00",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "protocol": "jd-logistics-pipeline-v1",
          "executionId": "9619"
        },
        "createdAt": "2026-10-16T05:59:14.044496+00:00",
        "currentSelection": {
          "current": true,
          "verifiedRowCount": 215,
          "contentHash": "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
          "scopeRevision": 1
        }
      }
    },
    {
      "sourceKind": "shop_products",
      "operationId": "75544bfae0f660f514d8a364eb61f9f2",
      "fileName": "source.csv",
      "exportManifestSha256": "079f4a6cf4c3a9b1cdea762572b27efabdd20529c426861ce00b15569daf1e08",
      "rawSha256": "ebde8b0e7f7329f91f23e77e9f4a1e944f3dd25e2e730d42fbd874b706eb0175",
      "bytes": 211808,
      "rows": 906,
      "contentHash": "c23933fe03a84957cd8e2cb1c1417c81dee071568f65859a24d7a72d56e20a86",
      "collectedAt": "2026-10-16T05:58:36.298Z",
      "exportMetadata": {
        "version": 2,
        "identity": "96ca56941ae282dd57ad786d14455ebcc14382c2b44fc755b085cc6fcf91fb01",
        "stage": "downloaded",
        "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
        "executionId": "9619",
        "operationId": "75544bfae0f660f514d8a364eb61f9f2",
        "baseline": [],
        "observedBusinessUnitCode": "EBU4418046540089",
        "sourceStatus": "enabled",
        "expectedRowCount": 906,
        "fullScopeHash": "1c2344fbf05394d2f7976ddf94a54b798895f185a8d4d6e77a55e25ae4018ae8",
        "queryEvidence": {
          "requestHash": "d8f6cf261a0fec592dd6dc3c754304ae388e1eb1bf44ad452b6c2e8b8ac1a7d6",
          "total": 906,
          "observedAt": "2026-10-16T05:58:35.036Z"
        },
        "submittedAt": "2026-10-16T05:58:35.640Z",
        "requestEvidence": {
          "observedBusinessUnitCode": "EBU4418046540089",
          "requestedAt": "2026-10-16T05:58:36.298Z",
          "requestHash": "d99705a269c0b1884564605cf7c09cd00479d047698c9bbaa6dd5aaf96bb591d",
          "attachmentHash": "215a7e2021649c5feb6e265b9a94af184ece2d34a3d99f2f1ae7b2d4687f1bb7"
        },
        "taskIdentity": "products:4418061263263",
        "productTaskEvidence": {
          "id": "4418061263263",
          "deptId": "4418046540089",
          "taskStatus": "3",
          "recordCount": 906,
          "successCount": 0,
          "createTime": "2026-10-16T13:58:36.0+08:00",
          "shopSetHash": "77913b0b7754756a40e59ce7a0441101626527debc54330f6a5c1ffa9d7cca9c",
          "shopCount": 5
        }
      },
      "receipt": {
        "batchId": "bf108313-c47a-487a-a29e-6e8661609f14",
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "sourceKind": "shop_products",
        "rangeStart": "2026-10-16",
        "rangeEnd": "2026-10-17",
        "warehouseCode": "",
        "rawFileHash": "ebde8b0e7f7329f91f23e77e9f4a1e944f3dd25e2e730d42fbd874b706eb0175",
        "contentHash": "c23933fe03a84957cd8e2cb1c1417c81dee071568f65859a24d7a72d56e20a86",
        "rowCount": 906,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "collectedAt": "2026-10-16T13:58:36.298000+08:00",
        "sourceAsOf": "2026-10-16",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "executionId": "9619",
          "protocol": "jd-logistics-pipeline-v1"
        },
        "sourceStatus": "enabled"
      },
      "utcCollectedAt": "2026-10-16T05:58:36.298000+00:00",
      "readback": {
        "batchId": "bf108313-c47a-487a-a29e-6e8661609f14",
        "sourceKind": "shop_products",
        "sourceStatus": "enabled",
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "rangeStart": "2026-10-16",
        "rangeEnd": "2026-10-17",
        "warehouseCode": "",
        "warehouseKey": "",
        "fileName": "source.csv",
        "rawFileHash": "ebde8b0e7f7329f91f23e77e9f4a1e944f3dd25e2e730d42fbd874b706eb0175",
        "contentHash": "c23933fe03a84957cd8e2cb1c1417c81dee071568f65859a24d7a72d56e20a86",
        "rowCount": 906,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "sourceBindingVerified": false,
        "collectedAt": "2026-10-16T05:58:36.298000+00:00",
        "sourceAsOf": "2026-10-16",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "protocol": "jd-logistics-pipeline-v1",
          "executionId": "9619"
        },
        "createdAt": "2026-10-16T05:59:15.442548+00:00",
        "currentSelection": {
          "current": true,
          "verifiedRowCount": 906,
          "contentHash": "c23933fe03a84957cd8e2cb1c1417c81dee071568f65859a24d7a72d56e20a86",
          "scopeRevision": 1
        }
      }
    },
    {
      "sourceKind": "realtime_inventory",
      "operationId": "8d9ef7cc0dcb2f3fe2ddbad33605fcb4",
      "fileName": "source.xlsx",
      "exportManifestSha256": "098630ceda283446c379abd5f0d9dc60589e52ec8196b791fab8b8bc25003ef3",
      "rawSha256": "4705681f16112beb77401eead8d7b3c7a2b4fdd039d396be14c4c88e56accc42",
      "bytes": 41974,
      "rows": 427,
      "contentHash": "83c23ee5e0f97b3ab2d36e837d1f186e567bb5524ca2c29e295ed0dc66a7a7ba",
      "collectedAt": "2026-10-16T05:58:51.334Z",
      "exportMetadata": {
        "version": 2,
        "identity": "7a0333f2691e8783a38c8b81085d05526b0edee8065ecd27ef7c8c57f98bcf86",
        "stage": "downloaded",
        "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
        "executionId": "9619",
        "operationId": "8d9ef7cc0dcb2f3fe2ddbad33605fcb4",
        "baseline": [
          "4773820",
          "4773819",
          "4770982",
          "4770981",
          "4769815",
          "4769778",
          "4769397",
          "4769392",
          "4769386",
          "4769380"
        ],
        "observedBusinessUnitCode": "EBU4418046540089",
        "expectedRowCount": 427,
        "fullScopeHash": "c5be6c7138bf5fa1829d32498bbfcedf70bcd781ca5f7862281cc74a4a573654",
        "queryEvidence": {
          "requestHash": "2e1bab743f4bbd4efb3b875c943205dce78544965023aad3a624744119776948",
          "total": 427,
          "observedAt": "2026-10-16T05:58:49.680Z"
        },
        "submittedAt": "2026-10-16T05:58:50.665Z",
        "requestEvidence": {
          "observedBusinessUnitCode": "EBU4418046540089",
          "requestedAt": "2026-10-16T05:58:51.334Z",
          "requestHash": "1f3d13141788c00feaec2a055607f49148fd25910fb54954e8974f4f4866837f"
        },
        "taskIdentity": "jh:4773980",
        "taskEvidence": {
          "id": 4773980,
          "taskBusinessUnitCode": null,
          "bindingMode": "fresh_request_and_unique_task",
          "immutableHash": "6047e58553c20f1cd29b0725eb00e5355f6043880741e1d20d310abe516c519b"
        }
      },
      "receipt": {
        "batchId": "c3055dba-d893-4db2-a9e2-be656e60d577",
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "sourceKind": "realtime_inventory",
        "rangeStart": "2026-10-16",
        "rangeEnd": "2026-10-17",
        "warehouseCode": "",
        "rawFileHash": "4705681f16112beb77401eead8d7b3c7a2b4fdd039d396be14c4c88e56accc42",
        "contentHash": "83c23ee5e0f97b3ab2d36e837d1f186e567bb5524ca2c29e295ed0dc66a7a7ba",
        "rowCount": 427,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "collectedAt": "2026-10-16T13:58:51.334000+08:00",
        "sourceAsOf": "2026-10-16",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "executionId": "9619",
          "protocol": "jd-logistics-pipeline-v1"
        },
        "sourceStatus": null
      },
      "utcCollectedAt": "2026-10-16T05:58:51.334000+00:00",
      "readback": {
        "batchId": "c3055dba-d893-4db2-a9e2-be656e60d577",
        "sourceKind": "realtime_inventory",
        "sourceStatus": null,
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "rangeStart": "2026-10-16",
        "rangeEnd": "2026-10-17",
        "warehouseCode": "",
        "warehouseKey": "",
        "fileName": "source.xlsx",
        "rawFileHash": "4705681f16112beb77401eead8d7b3c7a2b4fdd039d396be14c4c88e56accc42",
        "contentHash": "83c23ee5e0f97b3ab2d36e837d1f186e567bb5524ca2c29e295ed0dc66a7a7ba",
        "rowCount": 427,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "sourceBindingVerified": false,
        "collectedAt": "2026-10-16T05:58:51.334000+00:00",
        "sourceAsOf": "2026-10-16",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "protocol": "jd-logistics-pipeline-v1",
          "executionId": "9619"
        },
        "createdAt": "2026-10-16T05:59:17.104245+00:00",
        "currentSelection": {
          "current": true,
          "verifiedRowCount": 427,
          "contentHash": "83c23ee5e0f97b3ab2d36e837d1f186e567bb5524ca2c29e295ed0dc66a7a7ba",
          "scopeRevision": 1
        }
      }
    },
    {
      "sourceKind": "inventory_snapshot",
      "operationId": "7848b67d31fc66ee63b43bf2aa091db2",
      "fileName": "source.xlsx",
      "exportManifestSha256": "9dab9f50e0883d1615c05291af7ae52170105d5e085ce9dc36215289c85c11e4",
      "rawSha256": "621685cfb00e3fd3c3fb04e92d4bfa246c405e0d63beda9be7099dc1f7fd7e1b",
      "bytes": 108838,
      "rows": 900,
      "contentHash": "9a8093b2971de61cac05ca94dd59a168a511d488230f8cdaf3043002fdbf91b0",
      "collectedAt": "2026-10-16T05:59:08.168Z",
      "exportMetadata": {
        "version": 2,
        "identity": "e39970c7ab6dc9ccf2a9e693a9612202d654ded639db2c28f4ae3757e187005d",
        "stage": "downloaded",
        "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
        "executionId": "9619",
        "operationId": "7848b67d31fc66ee63b43bf2aa091db2",
        "baseline": [
          "4773980",
          "4773820",
          "4773819",
          "4770982",
          "4770981",
          "4769815",
          "4769778",
          "4769397",
          "4769392",
          "4769386"
        ],
        "observedBusinessUnitCode": "EBU4418046540089",
        "expectedRowCount": 900,
        "fullScopeHash": "6579cf9f7879126bf968b8e8ac2487b3fe4da2adbad3ae9fa7cd0335cc044b38",
        "queryEvidence": {
          "requestHash": "18e92d7903c0dfbcbbc604cb8eca5b1e9cab0273a20aaea727cc404da3fc861b",
          "total": 900,
          "observedAt": "2026-10-16T05:59:05.122Z"
        },
        "submittedAt": "2026-10-16T05:59:05.967Z",
        "requestEvidence": {
          "observedBusinessUnitCode": "EBU4418046540089",
          "requestedAt": "2026-10-16T05:59:08.168Z",
          "requestHash": "c8aaf63f28699b544d34379e94fa8a7857ba738a0f426fa355840b93dbf5a506"
        },
        "taskIdentity": "jh:4773983",
        "taskEvidence": {
          "id": 4773983,
          "taskBusinessUnitCode": null,
          "bindingMode": "fresh_request_and_unique_task",
          "immutableHash": "f4782995bfd7d04da3f89cc73c0b555724694315dd8e9eb6e1170ddefbb42671"
        }
      },
      "receipt": {
        "batchId": "4f4c25ce-f7e5-48c9-936b-d4a73421eefb",
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "sourceKind": "inventory_snapshot",
        "rangeStart": "2026-10-15",
        "rangeEnd": "2026-10-16",
        "warehouseCode": "",
        "rawFileHash": "621685cfb00e3fd3c3fb04e92d4bfa246c405e0d63beda9be7099dc1f7fd7e1b",
        "contentHash": "9a8093b2971de61cac05ca94dd59a168a511d488230f8cdaf3043002fdbf91b0",
        "rowCount": 900,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "collectedAt": "2026-10-16T13:59:08.168000+08:00",
        "sourceAsOf": "2026-10-15",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "executionId": "9619",
          "protocol": "jd-logistics-pipeline-v1"
        },
        "sourceStatus": null
      },
      "utcCollectedAt": "2026-10-16T05:59:08.168000+00:00",
      "readback": {
        "batchId": "4f4c25ce-f7e5-48c9-936b-d4a73421eefb",
        "sourceKind": "inventory_snapshot",
        "sourceStatus": null,
        "departmentId": "jd-yiyong-4418046540089",
        "businessUnitCode": "EBU4418046540089",
        "rangeStart": "2026-10-15",
        "rangeEnd": "2026-10-16",
        "warehouseCode": "",
        "warehouseKey": "",
        "fileName": "source.xlsx",
        "rawFileHash": "621685cfb00e3fd3c3fb04e92d4bfa246c405e0d63beda9be7099dc1f7fd7e1b",
        "contentHash": "9a8093b2971de61cac05ca94dd59a168a511d488230f8cdaf3043002fdbf91b0",
        "rowCount": 900,
        "status": "imported",
        "referenceBatchId": "",
        "scopeRevision": 1,
        "origin": "workflow",
        "storeKey": "jd-yiyong-director",
        "sourceBindingVerified": false,
        "collectedAt": "2026-10-16T05:59:08.168000+00:00",
        "sourceAsOf": "2026-10-15",
        "collectorEvidence": {
          "runId": "jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8",
          "protocol": "jd-logistics-pipeline-v1",
          "executionId": "9619"
        },
        "createdAt": "2026-10-16T05:59:18.620905+00:00",
        "currentSelection": {
          "current": true,
          "verifiedRowCount": 900,
          "contentHash": "9a8093b2971de61cac05ca94dd59a168a511d488230f8cdaf3043002fdbf91b0",
          "scopeRevision": 1
        }
      }
    }
  ]
});
export type ImportDownloadPin = {
  sourceKind: "flow" | "shop_products" | "realtime_inventory" | "inventory_snapshot";
  operationId: string; fileName: string; exportManifestSha256: string; rawSha256: string;
  bytes: number; rows: number; contentHash: string; collectedAt: string;
  exportMetadata: Record<string, any>; receipt: Record<string, any>; utcCollectedAt: string; readback: Record<string, any>;
};
export type KnownFourImportsTarget = PreexportTarget & { pipelineSha256: string; sourceConfigSha256: string; registrySha256: string;
  shopId: string; profileName: string; downloads: ImportDownloadPin[] };
export type KnownFourImportsOptions = Omit<PreexportOptions, "target"> & { target?: KnownFourImportsTarget };
function fail(code: string): never { throw new Error(`JD_KNOWN_FOUR_IMPORTS_${code}`); }
const equal = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"];
const receiptFields = ["batchId", "departmentId", "businessUnitCode", "sourceKind", "rangeStart", "rangeEnd", "warehouseCode", "rawFileHash", "contentHash", "rowCount", "status", "referenceBatchId", "scopeRevision", "origin", "storeKey", "collectedAt", "sourceAsOf", "collectorEvidence", "warningCount", "warnings", "sourceStatus"];
const stableReceipt = (value: Record<string, any>) => Object.fromEntries(receiptFields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
// Date.parse alone drops sub-millisecond digits. This proof retains all six
// fractional digits; it is used only with the four fixed exception pairs.
export function knownImportInstantMicros(value: string): bigint {
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) fail("TIME_PAIR_INVALID");
  const milliseconds = Date.parse(parts[1] + parts[3]);
  if (!Number.isSafeInteger(milliseconds)) fail("TIME_PAIR_INVALID");
  return BigInt(milliseconds) * 1000n + BigInt((parts[2] ?? "").padEnd(6, "0"));
}
export function readJdKnownFourImportsN8n(databasePath: string, target: KnownFourImportsTarget) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const workflow = db.prepare("SELECT id,active FROM workflow_entity WHERE id=?").get(target.workflowId);
    const execution = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(target.executionId, target.workflowId);
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(target.workflowId);
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(target.executionId)?.data;
    if (!workflow || workflow.active !== 0 || !execution || execution.status !== "error" || execution.mode !== "manual" || execution.retrySuccessId !== null || execution.deletedAt !== null
      || typeof execution.startedAt !== "string" || typeof execution.stoppedAt !== "string" || !Number.isFinite(Date.parse(execution.startedAt + "Z")) || !Number.isFinite(Date.parse(execution.stoppedAt + "Z"))
      || Date.parse(execution.stoppedAt + "Z") <= Date.parse(execution.startedAt + "Z") || active?.count !== 0 || typeof data !== "string" || sha(data) !== target.executionDataSha256) fail("N8N_TERMINAL_EVIDENCE_REJECTED");
    const values = JSON.parse(data);
    if (!Array.isArray(values) || values.length > 10000) fail("N8N_DATA_INVALID");
    const deref = (v: unknown): any => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown) => io.object(deref(v));
    const arr = (v: unknown): any[] => { const a = deref(v); if (!Array.isArray(a)) fail("N8N_ARRAY_INVALID"); return a; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData), aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", cName = "C·独立核验文件精确批次和当前版本", releaseName = "失败后释放原执行 helper";
    const expected = ["手动完整运行", "领取共享 helper", "已领取执行所有权？", aName, bName, cName, releaseName, "保留证据并明确失败"];
    if (!equal(Object.keys(run).sort(), expected.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("N8N_STAGE_REJECTED");
    const tasks = (name: string, count = 1) => { const a = arr(run[name]); if (a.length !== count) fail("N8N_REPLAY_REJECTED"); return a.map(obj); };
    const output = (t: Record<string, any>, branch: number) => {
      const main = arr(obj(t.data).main), items = arr(main[branch]);
      if (items.length !== 1 || main.some((v, i) => i !== branch && arr(v).length)) fail("N8N_OUTPUT_REJECTED");
      return obj(obj(items[0]).json);
    };
    const claimTask = tasks("领取共享 helper")[0], decisionTask = tasks("已领取执行所有权？")[0];
    const claim = output(claimTask, 0), decision = output(decisionTask, 0);
    if (deref(claimTask.executionStatus) !== "success" || deref(decisionTask.executionStatus) !== "success" || !equal(claim, decision)
      || claimTask.executionIndex !== 1 || decisionTask.executionIndex !== 2 || deref(claim.ok) !== true || deref(claim.workflow) !== "jd-logistics"
      || deref(claim.coordinationStatus) !== "granted") fail("N8N_COORDINATION_REJECTED");
    const manual = tasks("手动完整运行")[0], a = tasks(aName)[0], b = tasks(bName)[0], c = tasks(cName)[0], release = tasks(releaseName)[0], final = tasks("保留证据并明确失败")[0];
    const ap = output(a, 0), bp = output(b, 0), cp = output(c, 1), rp = output(release, 0), error = obj(cp.error);
    if (deref(manual.executionStatus) !== "success" || [a, b, c, release].some(t => deref(t.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !equal([a, b, c, release, final].map(t => t.executionIndex), [3, 4, 5, 6, 7]) || deref(ap.runId) !== target.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4
      || [bp, cp].some(p => deref(p.runId) !== target.runId || deref(p.stage) !== "executed" || deref(p.status) !== "imported" || deref(p.operationCount) !== 4 || deref(p.importedCount) !== 4 || deref(p.duplicateCount) !== 0 || deref(p.verifiedCount) !== 0)
      || deref(error.status) !== 500 || !String(deref(error.message)).includes(target.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("N8N_FAILURE_OR_RELEASE_REJECTED");
    return { executionId: target.executionId, workflowId: target.workflowId, status: "error", active: false, activeExecutions: 0, preAWaits: 0,
      executionDataSha256: target.executionDataSha256, stoppedAt: execution.stoppedAt };
  } finally { db.close(); }
}
function ordered(source: string, markers: string[]) {
  let cursor = 0;
  for (const marker of markers) { const at = source.indexOf(marker, cursor); if (at < cursor) fail("INSTALLED_ORDER_UNPROVEN"); cursor = at + marker.length; }
}
async function installedBarrier(runtime: string, target: KnownFourImportsTarget) {
  const installed = await io.installedEvidence(runtime, target);
  const pipeline = await io.bytes(path.join(installed.release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"));
  const receipt = JSON.parse((await io.bytes(path.join(installed.release, "audit/helper-build-receipt.json"))).toString("utf8"));
  if (sha(pipeline) !== target.pipelineSha256 || !receipt.evidence?.inputFiles?.some((f: any) => f.relativePath === "tools/jd-logistics-n8n-pipeline.ts" && f.sha256 === target.pipelineSha256)) fail("INSTALLED_PIPELINE_CHANGED");
  ordered(pipeline.toString("utf8").slice(pipeline.toString("utf8").indexOf("export async function runJdLogisticsN8nPlan(")),
    ["for (const operation of plan.operations)", "const result = await exporter(", 'operation.stage = "validated"', "for (const operation of plan.operations)", 'operation.stage = "importing"', 'operation: "import"']);
  const verify = pipeline.toString("utf8").slice(pipeline.toString("utf8").indexOf("export async function verifyJdLogisticsN8nPlan("));
  if (!verify.includes('if (!["executed", "verified", "completed"].includes(plan.stage))')
    || !verify.includes('canonicalLogisticsJson(operation.receipt) !== canonicalLogisticsJson(receipt)')) fail("ORIGINAL_VERIFY_CONTRACT_UNPROVEN");
  return installed;
}
async function inspect(options: KnownFourImportsOptions, target: KnownFourImportsTarget, archivedActivePath?: string) {
  const directory = path.join(options.root, "outputs/jd-logistics-pipeline"), activePath = path.join(directory, "active.json");
  if (archivedActivePath) await io.absent(activePath);
  const activeBytes = await io.bytes(archivedActivePath ?? activePath), manifestBytes = await io.bytes(path.join(directory, `${target.runId}.json`));
  if (sha(activeBytes) !== target.activeSha256 || sha(manifestBytes) !== target.manifestSha256) fail("ORIGINAL_SHA_CHANGED");
  const active = JSON.parse(activeBytes.toString("utf8")), plan: JdLogisticsManifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!equal(active, { runId: target.runId, executionId: target.executionId, planHash: target.planHash })) fail("ACTIVE_IDENTITY_REJECTED");
  assertLogisticsManifest(plan, target.executionId);
  if (plan.runId !== target.runId || logisticsPlanHash(plan) !== target.planHash || plan.stage !== "failed" || plan.outcome !== "imported"
    || plan.failure?.code !== target.failureCode || plan.failure.stage !== "verify" || !equal(plan.notification, { stage: "pending" })
    || plan.notificationPlan.enabled !== false || plan.notificationPlan.departmentIds.length || plan.baseUrl !== "http://localhost:3000") fail("FAILED_STAGE_REJECTED");
  if (target.downloads.length !== 4 || !equal(target.downloads.map(d => d.sourceKind), kinds) || new Set(target.downloads.map(d => d.receipt.batchId)).size !== 4
    || plan.operations.length !== 4 || plan.operations.some((op, i) => op.sourceKind !== kinds[i] || op.stage !== "imported"
      || op.departmentId !== target.departmentId || op.businessUnitCode !== target.businessUnitCode || op.collectorStoreKey !== target.storeKey || op.initialScopeRevision !== 0
      || !op.receipt || !equal(op.receipt, target.downloads[i].receipt) || op.receipt.status !== "imported" || op.receipt.referenceBatchId !== "" || op.receipt.scopeRevision !== 1)) fail("KNOWN_IMPORTS_REJECTED");
  const sourceConfig = await io.bytes(path.join(options.root, "config/jd-logistics-sources.json")), registry = await io.bytes(path.join(options.root, "config/jd-store-accounts.json"));
  if (sha(sourceConfig) !== target.sourceConfigSha256 || sha(registry) !== target.registrySha256) fail("SOURCE_CONFIGURATION_CHANGED");
  const config = parseJdLogisticsConfig(JSON.parse(sourceConfig.toString("utf8"))), stores = validateJdStoreRegistry(JSON.parse(registry.toString("utf8")), options.root);
  const store = stores.find(s => s.storeKey === target.storeKey);
  if (!store || store.shopId !== target.shopId || store.browser.profileName !== target.profileName || store.browser.debugPort !== target.debugPort
    || config.bindings.length !== 4 || config.bindings.some(b => !b.enabled || b.departmentId !== target.departmentId || b.businessUnitCode !== target.businessUnitCode
      || b.collectorStoreKey !== target.storeKey || !equal(b.authorizedStoreKeys, [target.storeKey]))) fail("CONFIG_SCOPE_CHANGED");
  const runDirectory = path.join(directory, "downloads", target.runId); await io.ordinary(runDirectory, true);
  if (!equal((await readdir(runDirectory)).sort(), plan.operations.map(op => op.operationId).sort())) fail("DOWNLOAD_LAYOUT_CHANGED");
  const files: { relativePath: string; bytes: number; sha256: string }[] = [];
  for (let index = 0; index < 4; index++) {
    const op = plan.operations[index], pin = target.downloads[index], downloadDirectory = path.join(runDirectory, op.operationId);
    await io.ordinary(downloadDirectory, true);
    if (op.operationId !== pin.operationId || op.sourceKind !== pin.sourceKind || pin.fileName !== (index < 2 ? "source.csv" : "source.xlsx")
      || !equal((await readdir(downloadDirectory)).sort(), ["export-manifest.json", pin.fileName].sort())) fail("DOWNLOAD_FILES_CHANGED");
    const filePath = path.join(downloadDirectory, pin.fileName), exportPath = path.join(downloadDirectory, "export-manifest.json");
    const file = await io.bytes(filePath, JD_LOGISTICS_MAX_FILE_BYTES), exportBytes = await io.bytes(exportPath), exported: LogisticsExportManifest = JSON.parse(exportBytes.toString("utf8"));
    const metadata = Object.fromEntries(Object.entries(exported).filter(([key]) => !["filePath", "rawFileHash", "byteSize", "result"].includes(key)));
    const identity = logisticsExportIdentity({ ...op, sourceStatus: index === 1 ? "enabled" : undefined, root: options.root, runId: plan.runId, executionId: plan.executionId, store, downloadDirectory, assertOwner: async () => {} });
    const result = exported.result;
    if (sha(exportBytes) !== pin.exportManifestSha256 || !equal(metadata, pin.exportMetadata) || exported.version !== 2 || exported.stage !== "downloaded" || exported.identity !== identity
      || exported.runId !== target.runId || exported.executionId !== target.executionId || exported.operationId !== pin.operationId || exported.observedBusinessUnitCode !== target.businessUnitCode
      || exported.expectedRowCount !== pin.rows || exported.queryEvidence?.total !== pin.rows || exported.requestEvidence?.observedBusinessUnitCode !== target.businessUnitCode
      || exported.requestEvidence?.requestedAt !== pin.collectedAt || !result || !io.samePath(result.filePath, filePath) || !io.samePath(exported.filePath ?? "", filePath)
      || result.collectedAt !== pin.collectedAt || result.identityEvidence.observedAt !== pin.collectedAt || result.taskIdentity !== exported.taskIdentity) fail("DOWNLOAD_BINDING_REJECTED");
    if (index === 0) {
      if (!equal(exported.baseline, []) || exported.taskIdentity !== `direct:${logisticsHash({ requestId: exported.directRequestId, requestHash: exported.requestEvidence.requestHash, attachmentHash: exported.requestEvidence.attachmentHash })}`) fail("FLOW_TASK_BINDING_REJECTED");
    } else if (index === 1) {
      const task = exported.productTaskEvidence;
      if (!equal(exported.baseline, []) || op.sourceStatus !== "enabled" || exported.sourceStatus !== "enabled" || result.sourceStatus !== "enabled" || result.sourceAsOf !== op.rangeStart
        || !task || task.deptId !== target.businessUnitCode.slice(3) || task.recordCount !== pin.rows || exported.taskIdentity !== `products:${task.id}`) fail("PRODUCT_TASK_BINDING_REJECTED");
    } else {
      const task = exported.taskEvidence;
      if (!task || task.bindingMode !== "fresh_request_and_unique_task" || exported.taskIdentity !== `jh:${task.id}` || exported.baseline.includes(String(task.id))
        || task.taskBusinessUnitCode !== null && task.taskBusinessUnitCode !== target.businessUnitCode || result.sourceAsOf !== op.rangeStart
        || exported.queryEvidence.requestHash !== logisticsHash(jhLogisticsQueryRequest(op)) || exported.requestEvidence.requestHash !== logisticsHash(jhLogisticsExportRequest(op))) fail("JH_TASK_BINDING_REJECTED");
    }
    const times = [plan.createdAt, exported.queryEvidence.observedAt, exported.submittedAt, pin.collectedAt, plan.failure.at].map(v => Date.parse(v ?? ""));
    if (times.some(v => !Number.isFinite(v)) || times.some((v, i) => i > 0 && v < times[i - 1])) fail("DOWNLOAD_TIME_ORDER_REJECTED");
    assertLogisticsExport(op, result, new Date(pin.collectedAt));
    const { filePath: _filePath, ...evidence } = result;
    if (!op.export || !equal(op.export, { ...evidence, relativePath: path.relative(options.root, filePath).split(path.sep).join("/"), rawFileHash: pin.rawSha256, bytes: pin.bytes })
      || file.length !== pin.bytes || sha(file) !== pin.rawSha256 || exported.rawFileHash !== pin.rawSha256 || exported.byteSize !== pin.bytes
      || op.rowCount !== pin.rows || op.contentHash !== pin.contentHash || op.parserVersion !== "jd-logistics-workbook-v1") fail("DOWNLOAD_FILE_EVIDENCE_REJECTED");
    const rows = parseJdLogisticsWorkbook(file, pin.sourceKind, target.businessUnitCode, { collectedAt: pin.collectedAt, allowDeclaredBusinessUnit: index !== 0 });
    if (index === 1) assertLogisticsEnabledProducts(rows);
    if (rows.length !== pin.rows || logisticsContentHash(rows) !== pin.contentHash) fail("DOWNLOAD_CONTENT_REJECTED");
    assertLogisticsReceipt(op, op.receipt!);
    if (!equal(pin.receipt, stableReceipt(pin.receipt)) || knownImportInstantMicros(pin.receipt.collectedAt) !== knownImportInstantMicros(pin.utcCollectedAt)
      || knownImportInstantMicros(pin.receipt.collectedAt) !== knownImportInstantMicros(pin.collectedAt)) fail("EXACT_TIME_EXCEPTION_UNPROVEN");
    files.push({ relativePath: path.relative(options.root, filePath), bytes: file.length, sha256: sha(file) }, { relativePath: path.relative(options.root, exportPath), bytes: exportBytes.length, sha256: sha(exportBytes) });
  }
  const request = options.request ?? fetch, envelope = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, request);
  if (envelope.success !== true) fail("SETTINGS_UNAVAILABLE");
  const settings = parseJdLogisticsSettings(envelope.data), department = settings.departments[0];
  const expectedScopes = kinds.map(sourceKind => ({ departmentId: target.departmentId, sourceKind, revision: 1 }));
  const scopes = [...settings.scopeRevisions].sort((a,b) => a.sourceKind.localeCompare(b.sourceKind));
  if (settings.departments.length !== 1 || department?.id !== target.departmentId || department.businessUnitCode !== target.businessUnitCode || !equal(department.storeKeys, [target.storeKey])
    || department.logisticsEnabled !== true || department.monitorEnabled !== false || department.pushEnabled !== false || settings.notification?.enabled !== false
    || !equal(scopes, expectedScopes.sort((a,b) => a.sourceKind.localeCompare(b.sourceKind))) || Object.values(department.capabilities).some(v => v !== true)) fail("BUSINESS_SCOPE_CHANGED");
  const selected = selectJdLogisticsOperations(config, settings, stores, new Date(plan.anchorAt));
  if (selected.length !== 4 || selected.some((s, i) => s.operationId !== plan.operations[i].operationId || s.policyHash !== plan.operations[i].policyHash
    || s.storeIdentityHash !== plan.operations[i].storeIdentityHash || s.initialScopeRevision !== 1)) fail("POLICY_CHANGED");
  for (let index = 0; index < 4; index++) {
    const op = plan.operations[index], pin = target.downloads[index];
    const query = new URLSearchParams({ operation: "batches", batchId: pin.receipt.batchId, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode, sourceKind: op.sourceKind, page: "1", pageSize: "1" });
    const response = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${query}`, request), data = io.object(response.data);
    if (response.success !== true || data.total !== 1 || !Array.isArray(data.items) || data.items.length !== 1 || data.page !== 1 || data.pageSize !== 1 || data.truncated === true) fail("EXACT_BATCH_UNAVAILABLE");
    const batch = io.object(data.items[0]), receipt = stableReceipt(batch);
    // The only exception is the exact fixed original/UTC string pair. No
    // tolerant comparison or mutation is added to the original C path.
    if (!equal(batch, pin.readback) || batch.sourceBindingVerified !== false || receipt.collectedAt !== pin.utcCollectedAt
      || !equal({ ...receipt, collectedAt: pin.receipt.collectedAt }, pin.receipt)
      || !equal(batch.currentSelection, { current: true, verifiedRowCount: pin.rows, contentHash: pin.contentHash, scopeRevision: 1 })) fail("EXACT_BATCH_CHANGED");
    assertLogisticsReceipt(op, receipt as any);
  }
  await io.ordinary(options.databasePath);
  const n8n = readJdKnownFourImportsN8n(options.databasePath, target), installed = await installedBarrier(options.runtime, target);
  const processEvidence = await (options.processProbe ?? io.inspectHelperProcess)();
  const expectedCommand = `"C:\\Program Files\\nodejs\\node.exe" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (processEvidence.pid !== target.helperPid || processEvidence.creationDate !== target.helperCreationDate || processEvidence.parentPid !== target.supervisorPid
    || processEvidence.supervisorCreationDate !== target.supervisorCreationDate || processEvidence.commandLine.toLowerCase() !== expectedCommand.toLowerCase()) fail("HELPER_PROCESS_IDENTITY_REJECTED");
  const health = await io.readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null || !equal(health.storeExecutions, []) || health.drain !== null) fail("HELPER_BUSY_OR_QUARANTINED");
  if (!await (options.portProbe ?? io.portClosed)(target.debugPort)) fail("BROWSER_PORT_OPEN_OR_UNKNOWN");
  return { activeBytes, manifestBytes, processEvidence, n8n, files,
    installed: { exporterSha256: target.exporterSha256, pipelineSha256: target.pipelineSha256, helperTreeSha256: target.helperTreeSha256, helperReceiptSha256: target.helperReceiptSha256 } };
}
export async function closeJdLogisticsKnownFourImports(options: KnownFourImportsOptions, action: "inspect" | "apply" = "inspect") {
  if (![options.root, options.runtime, options.databasePath].every(p => path.isAbsolute(p)) || !["inspect", "apply"].includes(action)) fail("ABSOLUTE_PATH_AND_ACTION_REQUIRED");
  const target = options.target ?? jdKnownFourImportsTarget, directory = path.join(options.root, "outputs/jd-logistics-pipeline");
  await io.ordinary(options.root, true); await io.ordinary(directory, true);
  return withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-logistics-known-four-imports-closure", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-chromium-known-four-imports-closure", lockDirectory: defaultJdChromiumRunLockDirectory(options.root) }, async chromium => {
      const recovery = path.join(directory, `known-four-imports-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
      await io.absent(recovery); // No auto-resume, even after rename but before commit.
      const observed = await inspect(options, target);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-known-four-imports-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target,
        n8n: observed.n8n, helperProcess: { pid: observed.processEvidence.pid, creationDate: observed.processEvidence.creationDate }, installed: observed.installed,
        files: observed.files, archivePath: path.join(recovery, "active.archived.json"), originalFailureRetained: true, oldExecutionReplayAllowed: false,
        effects: { completedDownloads: kinds, businessImports: 4, knownBatchIds: target.downloads.map(d => d.receipt.batchId), originalImportsRetained: true },
        oldDownloadsDisposition: "audit_only_no_handoff_no_import_no_signed_url_reuse",
        originalExecutionDisposition: "permanent_error_no_stage_or_receipt_rewrite_no_C_replay", requiresBackendUtcRepairBeforeFreshRun: true,
        nextAction: `After the separately reviewed backend UTC repair, only a new complete n8n execution from A with four-source fresh acquisition and original business idempotency; never retry ${target.executionId}. Fresh source requests are allowed; never reuse, relabel, hand off or import either old download or its signed URL.` };
      if (action === "inspect") return intent;
      await mkdir(recovery); await io.ordinary(recovery, true);
      await io.createOnly(path.join(recovery, "intent.json"), io.jsonBytes(intent));
      await io.createOnly(path.join(recovery, "active.original.json"), observed.activeBytes);
      await io.createOnly(path.join(recovery, "manifest.original.json"), observed.manifestBytes);
      await io.createOnly(path.join(recovery, "files.original.json"), io.jsonBytes(observed.files));
      const assertRecovery = async (moved: boolean) => {
        await io.ordinary(recovery, true);
        const expected = ["intent.json", "active.original.json", "manifest.original.json", "files.original.json", ...(moved ? ["active.archived.json"] : [])].sort();
        if (!equal((await readdir(recovery)).sort(), expected)
          || sha(await io.bytes(path.join(recovery, "intent.json"))) !== sha(io.jsonBytes(intent))
          || sha(await io.bytes(path.join(recovery, "active.original.json"))) !== target.activeSha256
          || sha(await io.bytes(path.join(recovery, "manifest.original.json"))) !== target.manifestSha256
          || sha(await io.bytes(path.join(recovery, "files.original.json"))) !== sha(io.jsonBytes(observed.files))) fail("RECOVERY_EVIDENCE_CHANGED");
      };
      await options.checkpoint?.("intent_written");
      const final = await inspect(options, target);
      if (!equal(final.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned(); await options.checkpoint?.("before_move");
      await io.ordinary(recovery, true); await io.absent(intent.archivePath);
      // Full predicates, not just active SHA, must hold at the move boundary.
      const boundary = await inspect(options, target);
      if (!equal(boundary.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await assertRecovery(false);
      await pipeline.assertOwned(); await chromium.assertOwned();
      await io.moveNoReplace(path.join(directory, "active.json"), intent.archivePath);
      await options.checkpoint?.("after_move");
      const after = await inspect(options, target, intent.archivePath);
      if (!equal(after.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned(); await options.checkpoint?.("before_committed");
      const commitBoundary = await inspect(options, target, intent.archivePath);
      if (!equal(commitBoundary.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await assertRecovery(true);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const committed = { ...intent, status: "committed", committedAt: new Date().toISOString(), intentSha256: sha(io.jsonBytes(intent)) };
      await io.createOnly(path.join(recovery, "committed.json"), io.jsonBytes(committed));
      return committed;
    }));
}
async function main() {
  if (process.argv.length !== 3 || !["inspect", "apply"].includes(process.argv[2])) fail("USAGE_INSPECT_OR_APPLY_ONLY");
  console.log(JSON.stringify(await closeJdLogisticsKnownFourImports({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" }, process.argv[2] as "inspect" | "apply")));
}
if (process.argv[1] && io.samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error instanceof Error && /^(JD_KNOWN_FOUR_IMPORTS|JD_PREEXPORT)_[A-Z_]+$/.test(error.message) ? error.message : "JD_KNOWN_FOUR_IMPORTS_EVIDENCE_REJECTED");
  console.error("STOP: retain original intent/evidence. No replay or fresh execution is authorized by an uncommitted archive."); process.exitCode = 1;
});
