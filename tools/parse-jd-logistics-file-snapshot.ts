/** Read-only, private local-file input for the HTML snapshot projector. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { jdLogisticsSources, type JdLogisticsSource } from "../lib/inventory/jd-logistics-contract";

const { values } = parseArgs({ options: { manifest: { type: "string" }, output: { type: "string" } } });
if (!values.manifest || !values.output) throw new Error("需要 --manifest 私有四源文件清单和 --output 私有JSON路径");
const entries = JSON.parse(readFileSync(values.manifest, "utf8")) as Array<{ kind: JdLogisticsSource; sourcePath: string; collectedAt: string }>;
if (!Array.isArray(entries) || entries.length !== 4 || new Set(entries.map(row => row.kind)).size !== 4 || entries.some(row => !jdLogisticsSources.includes(row.kind) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(row.collectedAt))) throw new Error("四源清单或已核实采集时间无效");
const live = XLSX.read(readFileSync(entries.find(row => row.kind === "realtime_inventory")!.sourcePath), { type: "buffer" });
if (live.SheetNames.length !== 1) throw new Error("实时库存文件须为已核实的单一明细表");
const grid = XLSX.utils.sheet_to_json<unknown[]>(live.Sheets[live.SheetNames[0]], { header: 1, defval: "" });
const index = grid[0].findIndex(value => String(value).trim() === "事业部编码"), nameIndex = grid[0].findIndex(value => String(value).trim() === "事业部名称");
if (index < 0 || nameIndex < 0 || !grid[1]?.[index] || !grid[1]?.[nameIndex]) throw new Error("实时库存来源缺少事业部身份");
const clean = (value: unknown) => String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
const bu = clean(grid[1][index]), departmentName = clean(grid[1][nameIndex]);
const sources = entries.map(({ kind, sourcePath, collectedAt }) => {
  const bytes = new Uint8Array(readFileSync(sourcePath));
  const rows = parseJdLogisticsWorkbook(bytes, kind, bu, { collectedAt, allowDeclaredBusinessUnit: true });
  return { kind, name: basename(sourcePath), sourcePath: resolve(sourcePath), collectedAt, sha256: createHash("sha256").update(bytes).digest("hex"), rows };
});
mkdirSync(dirname(resolve(values.output)), { recursive: true });
writeFileSync(values.output, JSON.stringify({ bu, departmentName, sources }));
console.log(JSON.stringify({ sourceFiles: sources.length, rows: sources.map(source => ({ kind: source.kind, count: source.rows.length })), businessWrites: false }));
