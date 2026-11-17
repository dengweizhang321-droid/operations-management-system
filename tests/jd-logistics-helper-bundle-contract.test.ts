import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
// @ts-expect-error plain .mjs build tool without type declarations
import { rewriteControlledImportMeta } from "../tools/build-worker-helper.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const closureFiles = ["tools/jd-logistics-zero-effect-closure.ts", "tools/jd-logistics-n8n-pipeline.ts"];
const inspectCli = "tools/jd-logistics-zero-effect-inspect";

test("helper-bundle closure files contain no import.meta and pass the helper builder contract", async () => {
  for (const relativePath of closureFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    assert.equal(/\bimport\s*\.\s*meta\b/.test(source), false, `${relativePath} must not use import.meta`);
    assert.doesNotThrow(() => rewriteControlledImportMeta(source, relativePath), relativePath);
  }
});

test("the import.meta inspect CLI is not imported by any tools/lib source (stays outside the helper closure)", async () => {
  const offenders: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) continue;
      if ((await readFile(full, "utf8")).includes(inspectCli)) offenders.push(path.relative(repoRoot, full).replaceAll("\\", "/"));
    }
  };
  await walk(path.join(repoRoot, "tools")); await walk(path.join(repoRoot, "lib"));
  assert.deepEqual(offenders, []);
});
