import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  currentMasterSnapshot,
  importTmallProductMasterFile,
  inspectTmallMasterFile,
  productManagerFloatingClusterKey,
  runTmallProductMasterStage,
  scoreChatSendCandidate,
  scoreImportantNoticeCloseCandidate,
  scoreProductManagerCandidate,
  scoreProductManagerFloatingCandidate,
} from "../tools/tmall-product-master-export";

function masterWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["发布模板"],
    [null],
    [
      "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
      "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
      "生产日期（年/月/日）", "保质期",
    ],
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM-1", 2, 15, "颜色:红", null, null, "20001", "9.90", 5, "SKU-1", null, null],
  ]), "发布模板");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

test("当天完成的受控天猫货品快照才允许跳过导出", () => {
  const batch = {
    id: "batch-1",
    source: "tmall_product_master",
    dataset: "product_master",
    platform: "天猫",
    shopName: "天猫-志高亿玖专卖店",
    snapshotDate: "2026-08-04",
    status: "completed",
    rowCount: 1,
  };
  assert.equal(currentMasterSnapshot(batch, "2026-08-04", "天猫-志高亿玖专卖店"), true);
  assert.equal(currentMasterSnapshot({ ...batch, snapshotDate: "2026-08-03" }, "2026-08-04", "天猫-志高亿玖专卖店"), false);
  assert.equal(currentMasterSnapshot({ ...batch, shopName: "天猫-其他店" }, "2026-08-04", "天猫-志高亿玖专卖店"), false);
  assert.equal(currentMasterSnapshot({ ...batch, status: "failed" }, "2026-08-04", "天猫-志高亿玖专卖店"), false);
});

test("商品管家入口接受右下角文字或图标属性并拒绝无关候选", () => {
  const candidate = {
    text: "商品管家",
    attributes: "",
    tag: "button",
    role: "button",
    left: 1320,
    top: 720,
    width: 96,
    height: 40,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  assert.ok(scoreProductManagerCandidate(candidate) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, tag: "span", role: "" }) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "title 商品管家" }) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "product-manager-entry" }) > 0);
  assert.equal(scoreProductManagerCandidate({ ...candidate, text: "商品搜索" }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "generic-floating-entry" }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, left: 200 }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, top: 120 }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, width: 500 }), -1);
});

test("无标签商品管家只接受右侧下半区唯一固定悬浮图标", () => {
  const candidate = {
    text: "",
    attributes: "floating-entry",
    tag: "div",
    role: "button",
    left: 1380,
    top: 720,
    width: 60,
    height: 60,
    viewportWidth: 1440,
    viewportHeight: 900,
    position: "fixed",
    cursor: "pointer",
  };
  assert.ok(scoreProductManagerFloatingCandidate(candidate) > 0);
  assert.equal(
    productManagerFloatingClusterKey(candidate),
    productManagerFloatingClusterKey({ ...candidate, left: 1398, top: 738, width: 24, height: 24 }),
  );
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, left: 900 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, top: 300 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, position: "absolute" }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, width: 300 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, text: "返回顶部" }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, text: "商品巡检" }), -1);
});

test("商品管家发送键必须位于聊天输入框右侧附近", () => {
  const input = { left: 1120, right: 1390, top: 760, bottom: 820 };
  const send = { label: "ant-sender-actions-btn arrow-up", left: 1350, top: 770, width: 48, height: 40 };
  assert.ok(scoreChatSendCandidate(send, input) > 0);
  assert.equal(scoreChatSendCandidate({ ...send, label: "发送", left: 800 }, input), -1);
  assert.equal(scoreChatSendCandidate({ ...send, top: 600 }, input), -1);
  assert.equal(scoreChatSendCandidate({ ...send, width: 180 }, input), -1);
});

test("重要通知或商品巡检只允许右下角安全关闭动作", () => {
  const notice = {
    text: "重要通知",
    attributes: "",
    tag: "div",
    role: "",
    left: 1120,
    top: 650,
    width: 160,
    height: 32,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  const close = {
    text: "",
    attributes: "ant-notice-close 关闭",
    tag: "button",
    role: "button",
    left: 1350,
    top: 620,
    width: 28,
    height: 28,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  assert.ok(scoreImportantNoticeCloseCandidate(close, notice) > 0);
  assert.ok(scoreImportantNoticeCloseCandidate({
    ...close,
    text: "忽略",
    attributes: "next-btn",
    width: 180,
  }, { ...notice, text: "商品巡检" }) > 0);
  assert.equal(scoreImportantNoticeCloseCandidate({
    ...close,
    text: "去优化",
    attributes: "next-btn",
    width: 60,
  }, { ...notice, text: "商品巡检" }), -1);
  assert.equal(scoreImportantNoticeCloseCandidate({ ...close, left: 200, top: 120 }, notice), -1);
  assert.equal(scoreImportantNoticeCloseCandidate(close, { ...notice, left: 100, top: 100 }), -1);
});

test("n8n 货品前置阶段命中当天批次时不启动浏览器", async () => {
  const request = (async () => Response.json({
    items: [{
      id: "batch-current",
      source: "tmall_product_master",
      dataset: "product_master",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      snapshotDate: "2026-08-04",
      status: "completed",
      rowCount: 212,
      warningCount: 0,
    }],
  })) as typeof fetch;
  const result = await runTmallProductMasterStage({
    storeKey: "tmall-yijiu",
    baseUrl: "http://127.0.0.1:3000",
    snapshotDate: "2026-08-04",
    request,
  });
  assert.equal(result.status, "skipped_current_snapshot");
  assert.equal(result.batchId, "batch-current");
  assert.equal(result.rowCount, 212);
});

test("下载文件必须位于店铺独立目录并通过发布模板结构校验", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-master-export-"));
  const downloadDir = path.join(root, "tmall-yijiu");
  await mkdir(downloadDir);
  const filePath = path.join(downloadDir, "master.xlsx");
  await writeFile(filePath, masterWorkbook());
  const store = {
    shopName: "天猫-志高亿玖专卖店",
    browser: { profileDir: "unused", debugPort: 9999, downloadDir },
  };
  try {
    const evidence = await inspectTmallMasterFile(filePath, store, "2026-08-04");
    assert.equal(evidence.rowCount, 1);
    assert.equal(evidence.uniqueProductCount, 1);
    assert.equal(evidence.uniqueSkuCount, 1);
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);

    const outsidePath = path.join(root, "outside.xlsx");
    await writeFile(outsidePath, masterWorkbook());
    await assert.rejects(inspectTmallMasterFile(outsidePath, store, "2026-08-04"), /独立下载目录/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("货品导入要求精确批次身份和落库行数回查", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-master-import-"));
  const filePath = path.join(root, "master.xlsx");
  await writeFile(filePath, masterWorkbook());
  const evidence = {
    fileName: "master.xlsx",
    filePath,
    fileSizeBytes: (await stat(filePath)).size,
    sha256: "0".repeat(64),
    rowCount: 1,
    uniqueProductCount: 1,
    uniqueSkuCount: 1,
  };
  try {
    const received: { form: FormData | null } = { form: null };
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      received.form = init?.body as FormData;
      return Response.json({
        ok: true,
        status: "imported",
        batch: {
          id: "batch-1",
          source: "tmall_product_master",
          dataset: "product_master",
          platform: "天猫",
          shopName: "天猫-志高亿玖专卖店",
          snapshotDate: "2026-08-04",
          status: "completed",
          rowCount: 1,
          warningCount: 0,
        },
        verification: {
          verified: true,
          parsedRowCount: 1,
          readbackRowCount: 1,
          dataset: "product_master",
          platform: "天猫",
          shopName: "天猫-志高亿玖专卖店",
        },
      }, { status: 201 });
    }) as typeof fetch;
    const result = await importTmallProductMasterFile({
      baseUrl: "http://127.0.0.1:3000",
      store: { shopName: "天猫-志高亿玖专卖店" },
      snapshotDate: "2026-08-04",
      evidence,
      request,
    });
    assert.equal(result.status, "imported");
    assert.ok(received.form);
    assert.equal(received.form.get("source"), "tmall_product_master");
    assert.equal(received.form.get("shop_name"), "天猫-志高亿玖专卖店");
    assert.equal(received.form.get("snapshot_date"), "2026-08-04");

    const badReadback = (async () => Response.json({
      ok: true,
      status: "imported",
      batch: {
        id: "batch-2", source: "tmall_product_master", dataset: "product_master", platform: "天猫",
        shopName: "天猫-志高亿玖专卖店", snapshotDate: "2026-08-04", status: "completed", rowCount: 1, warningCount: 0,
      },
      verification: {
        verified: true, parsedRowCount: 1, readbackRowCount: 0, dataset: "product_master", platform: "天猫", shopName: "天猫-志高亿玖专卖店",
      },
    }, { status: 201 })) as typeof fetch;
    await assert.rejects(importTmallProductMasterFile({
      baseUrl: "http://127.0.0.1:3000",
      store: { shopName: "天猫-志高亿玖专卖店" },
      snapshotDate: "2026-08-04",
      evidence,
      request: badReadback,
    }), /导入或落库回查失败/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
