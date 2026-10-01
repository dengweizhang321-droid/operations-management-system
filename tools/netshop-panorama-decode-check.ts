/** Verify a saved isolated owning-reader response, without rewriting its data. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeStorePanorama } from "../app/netshop/panorama/contract";

const path = process.argv[2];
if (!path) throw new Error("Pass the exact isolated PostgreSQL response JSON path");
const bytes = readFileSync(path), value = JSON.parse(bytes.toString("utf8"));
const c = value.context, table = value.tableScope;
const query = new URLSearchParams({ platform: c.requestedScope.platforms[0], outlet: c.requestedScope.shopKeys[0], dimension: c.requestedScope.dimension,
  startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
  q: table.q, page: String(table.page), pageSize: String(table.pageSize), section: table.section, grain: table.grain });
const revision = c.sourceRevisions.find((item: { kind: string }) => item.kind === "owning_revision").revision;
const decoded = decodeStorePanorama(value, query, revision);
console.log(JSON.stringify({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), schemaVersion: decoded.schemaVersion,
  sourceStates: Object.fromEntries(Object.entries(decoded.sources).map(([key, source]) => [key, source.state])),
  chapterStates: Object.fromEntries(Object.entries(decoded.sections).map(([key, section]) => [key, section.state])),
  isolatedSavedResponse: true, productionVerified: false }));
