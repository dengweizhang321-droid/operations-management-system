import { createHash } from "node:crypto";

// Reviewed exception for execution metadata, never an allowance for SQLite
// business data or arbitrary database paths. Any source change needs review.
export const n8nMetadataReaderPath = "lib/jackyun/n8n-preflight-evidence.ts";
export const n8nMetadataReaderSourceSha256 = "4ad869e21085af4cd977b15c02aa498294c06b8158fbb379b3f289e9fb2d1fea";
export function isApprovedN8nMetadataReader(relativePath, source, reachableRoots) {
  return relativePath === n8nMetadataReaderPath
    && Array.isArray(reachableRoots) && reachableRoots.length > 0
    && reachableRoots.every(root => root === "tools/tmall-sycm-cookie-pipeline.ts")
    && createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex") === n8nMetadataReaderSourceSha256;
}

export function metadataReaderImportRoots(entries, edges, target) {
  return entries.filter(entry => {
    const pending = [entry], visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current); pending.push(...(edges.get(current) ?? []));
    }
    return false;
  });
}
