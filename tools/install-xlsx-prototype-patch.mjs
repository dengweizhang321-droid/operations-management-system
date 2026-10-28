import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CVE-2023-30533 (xlsx "Prototype Pollution" via sheet_insert_comments): decode_cell() returns
// {c:-1, r:-1} for a ref string with no uppercase letters/digits (e.g. "__proto__"); unpatched
// code never checks for negative c/r, so dense mode writes through sheet["__proto__"] (which
// resolves to Object.prototype itself) and assigns cell.c on the prototype. Fixed upstream in
// xlsx@0.19.3 by adding a single early-return guard right after decode_cell() in
// sheet_insert_comments(); this backports exactly that one line. Not an upgrade because the
// npm registry "latest" dist-tag for xlsx is still 0.18.5 (SheetJS moved 0.19+ distribution to
// its own CDN, cdn.sheetjs.com, off the npm registry); both the CDN tarball and a vendored
// tgz-as-dependency were evaluated and ruled out because they are blocked by this project's
// release pipeline (offline install from the published dependency chain) and its hardcoded
// package manifest allowlist. A hash-locked postinstall patch keeps the dependency pinned to
// the already-reviewed 0.18.5 tree while removing the vulnerable code path.
//
// xlsx@0.18.5's package.json declares "main": "xlsx.js" and "module": "xlsx.mjs"; both files
// contain an independent copy of sheet_insert_comments() and are each reachable via import/
// require depending on resolver (Node's own `require`/`import` of this CJS-only package always
// resolves xlsx.js; xlsx.mjs is reachable through bundlers/resolvers that honor the "module"
// field). Patch both so no resolution path keeps the vulnerable code. The CDN-only dist/*
// bundles (xlsx.full.min.js etc.) are not referenced by "main"/"module" and are not imported
// anywhere in this repo, so they are out of scope.
const anchor = "\t\tvar r = decode_cell(comment.ref);\n";
const replacement = anchor + "\t\tif(r.r < 0 || r.c < 0) return;\n";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export const xlsxTargets = [
  {
    file: "xlsx.js",
    originalSha256: "f3366db1313e47985ddd23c57989a35298ca613124f2971513fd0efca9e50df6",
  },
  {
    file: "xlsx.mjs",
    originalSha256: "992eec8c1a888e7f6c9b2a3cbba014bedade473da4cbd8fc9bb95de56a87f222",
  },
];

export function patchXlsxPrototypePollution(source, originalSha256) {
  if (source.includes(replacement)) {
    // Idempotent: already patched. Still verify the reverse-restored bytes match the known
    // original digest, so a patched-looking file from an unrelated/tampered source is rejected.
    const restored = source.replace(replacement, anchor);
    if (hash(restored) !== originalSha256) {
      throw new Error("xlsx prototype pollution patch refuses an unknown dependency digest");
    }
    if (restored.split(anchor).length !== 2) throw new Error("xlsx prototype pollution patch anchor is not unique");
    return source;
  }
  if (hash(source) !== originalSha256) {
    throw new Error("xlsx prototype pollution patch refuses an unknown dependency digest");
  }
  if (source.split(anchor).length !== 2) throw new Error("xlsx prototype pollution patch anchor is not unique");
  return source.replace(anchor, replacement);
}

export async function installXlsxPrototypePatch(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const require = createRequire(path.join(root, "package.json"));
  const packagePath = require.resolve("xlsx/package.json");
  const pkgVersion = JSON.parse(await readFile(packagePath, "utf8")).version;
  if (pkgVersion !== "0.18.5") throw new Error("xlsx prototype pollution patch requires locked 0.18.5");
  const dir = path.dirname(packagePath);
  const results = [];
  for (const target of xlsxTargets) {
    const entry = path.join(dir, target.file);
    const source = await readFile(entry, "utf8");
    const patched = patchXlsxPrototypePollution(source, target.originalSha256);
    if (patched !== source) await writeFile(entry, patched);
    results.push({ file: target.file, status: patched === source ? "already_patched" : "patched", sha256: hash(patched) });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await installXlsxPrototypePatch()));
}
