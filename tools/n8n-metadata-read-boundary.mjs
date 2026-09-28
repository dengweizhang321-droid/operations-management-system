import { createHash } from "node:crypto";

// Reviewed exception for execution metadata, never an allowance for SQLite
// business data or arbitrary database paths. Any source change needs review.
export const n8nMetadataReaderPath = "lib/jackyun/n8n-preflight-evidence.ts";
export const n8nMetadataReaderSourceSha256 = "43a16066afb52a5f8eb36396f4e40b4764bb37657751965de91d04f5876137a6";
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
