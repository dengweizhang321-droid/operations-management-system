import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeProductDetail, decodeProductInsights } from "../app/netshop/products/contract";

const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass the product-owned private PG wire evidence directory");
const results = [];
function readAt(value: unknown, path: (string | number)[]): unknown { for (const key of path) { if (!value || typeof value !== "object") throw new Error("Fixture path missing"); value = (value as Record<string, unknown>)[key]; } return value; }
function setAt(value: unknown, path: (string | number)[], next: unknown) { const parent = readAt(value, path.slice(0, -1)); if (!parent || typeof parent !== "object") throw new Error("Fixture mutation target missing"); (parent as Record<string, unknown>)[path.at(-1)!] = next; }
for (const [filename, detail] of [["wire-list.json", false], ["wire-detail.json", true]] as const) {
  const wire = JSON.parse(await readFile(resolve(directory, filename), "utf8"));
  const query = new URLSearchParams(wire.query);
  const decode = detail ? decodeProductDetail : decodeProductInsights;
  const payload = decode(wire.payload, query, wire.revision);
  const failureCases: string[] = [];
  const invalid = (name: string, mutate: (data: Record<string, unknown>) => void) => { const copy = structuredClone(wire.payload); mutate(copy); assert.throws(() => decode(copy, query, wire.revision)); failureCases.push(name); };
  if (detail) {
    invalid("missing snapshot structure", p => setAt(p, ["sections", "catalog", "data", "snapshots"], null));
    invalid("unverified mapping cannot release ERP money", p => setAt(p, ["sections", "erp", "data", "metrics", "netSales"], structuredClone(readAt(p, ["sections", "performance", "metrics", "payment"]))));
    invalid("daily definitions must remain a typed list", p => setAt(p, ["sections", "daily", "data", "definitions"], {}));
    invalid("daily vector cannot be arbitrary JSON", p => setAt(p, ["sections", "daily", "data", "sourceRevisions"], [{}]));
    invalid("daily vector cannot omit owning source", p => setAt(p, ["sections", "daily", "data", "sourceRevisions"], []));
    invalid("unavailable SKU cannot contain a fake child", p => { setAt(p, ["sections", "skuContribution", "items"], [readAt(p, ["sections", "performance"])]); setAt(p, ["sections", "skuContribution", "pagination", "returned"], 1); });
  } else {
    invalid("missing classification structure", p => setAt(p, ["sections", "structure", "classification"], null));
    invalid("invalid complete-set eligibility", p => setAt(p, ["sections", "structure", "qualification", "paired"], -1));
    invalid("label only cannot pretend official taxonomy", p => setAt(p, ["sections", "structure", "categories", 0, "categoryEvidence", "id"], "fake"));
    invalid("wrong visitor denominator", p => setAt(p, ["sections", "efficiency", "visitorValue", "denominatorKind"], "clicks"));
    invalid("missing metadata scope", p => setAt(p, ["sections", "metadata", "summaryScope"], "current_page"));
  }
  results.push({ filename, decoded: true, sectionToken: payload.sectionToken, failuresRejected: failureCases });
}
const evidence = resolve("E:/codex-artifacts/netshop-scheme2-20261001/products/lead", `wire-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
await writeFile(resolve(evidence, "result.json"), JSON.stringify({ source: directory, syntheticPostgres: true, results }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ evidence, results: results.map(r => ({ filename: r.filename, decoded: r.decoded, rejected: r.failuresRejected.length })) }, null, 2));
