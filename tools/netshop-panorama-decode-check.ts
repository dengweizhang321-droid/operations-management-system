/** Verify a saved isolated owning-reader response, without rewriting its data. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeStorePanorama } from "../app/netshop/panorama/contract";

const path = process.argv[2];
if (!path) throw new Error("Pass the exact isolated PostgreSQL response JSON path");
const bytes = readFileSync(path), value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const c = value.context, table = value.tableScope;
let query = new URLSearchParams({ platform: c.requestedScope.platforms[0], outlet: c.requestedScope.shopKeys[0], dimension: c.requestedScope.dimension,
  startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
  q: table.q, page: String(table.page), pageSize: String(table.pageSize), section: table.section, grain: table.grain });
let revision = c.sourceRevisions.find((item: { kind: string }) => item.kind === "owning_revision").revision;
const metadataPath = process.argv[3];
if (metadataPath) {
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (meta.request?.method !== "GET" || meta.request?.endpoint !== "/api/netshop/store-panorama" || !meta.request.query || typeof meta.request.query !== "object" || Array.isArray(meta.request.query) || Object.values(meta.request.query).some(field => typeof field !== "string")) throw new Error("Capture must retain the actual fixed GET query");
  if (meta.responseBytesUtf8 !== bytes.byteLength || meta.responseSha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Capture bytes do not match original wire metadata");
  revision = meta.responseHeaders?.["X-Netshop-Data-Revision"];
  if (typeof revision !== "string") throw new Error("Actual wire owning revision header is required");
  query = new URLSearchParams(meta.request.query);
}
const decoded = decodeStorePanorama(value, query, revision);
console.log(JSON.stringify({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), schemaVersion: decoded.schemaVersion,
  sourceStates: Object.fromEntries(Object.entries(decoded.sources).map(([key, source]) => [key, source.state])),
  chapterStates: Object.fromEntries(Object.entries(decoded.sections).map(([key, section]) => [key, section.state])),
  validationMode: metadataPath ? "actual_wire_query_header_bytes" : "body_derived_context", revision,
  isolatedSavedResponse: true, productionVerified: false }));
