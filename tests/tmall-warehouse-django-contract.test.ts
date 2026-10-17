import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseTmallWarehouseWorkbook } from "../lib/inventory/tmall-warehouse-workbook";

const python = process.env.TERUISI_TEST_PYTHON;
test("real XLSX parser output reaches Django normalization with missing-owner scope and provenance intact", { skip: !python || !existsSync(python) }, () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["货品ID", "货品名称", "货品编码", "仓Code", "仓名称", "实仓可销", "实仓总数", "采购在途", "调拨在途", "供应商名称"], ["001", "合成商品", "SKU-1", "W1", "合成仓", 0, 3, 1, 0, "合成供应商"]]), "导出数据");
  const parsed = parseTmallWarehouseWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  const payload = { owner: "合成货主", snapshotDate: "2026-10-16", collectedAt: "2026-10-16T12:00:00+08:00", sourceDate: null, expectedScopeRevision: 0, rawFileHash: "a".repeat(64), fileName: "synthetic.xlsx", rows: parsed.rows };
  const environment: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1", DJANGO_SETTINGS_MODULE: "teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT: "test", TERUISI_DJANGO_PROCESS_ROLE: "development", TERUISI_DJANGO_SQLITE_PATH: ":memory:" };
  delete environment.TERUISI_DJANGO_DATABASE_URL;
  const script = `import django,json,sys\ndjango.setup()\nfrom inventory.tmall_warehouse import normalize\np=json.load(sys.stdin)\nr=normalize(p)\nassert r[0]=='合成货主' and len(r[5])==1\nassert r[5][0]['availableQuantity']==0\nassert r[5][0]['sales30dQuantity'] is None\nprint('normalized')\n`;
  const result = spawnSync(python!, ["-c", script], { cwd: fileURLToPath(new URL("../backend", import.meta.url)), env: environment, input: JSON.stringify(payload), encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), "normalized");
});
