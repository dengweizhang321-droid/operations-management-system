import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zipSync } from "fflate";
import * as XLSX from "xlsx";
import { installXlsxPrototypePatch, patchXlsxPrototypePollution, xlsxTargets } from "../tools/install-xlsx-prototype-patch.mjs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const anchor = "\t\tvar r = decode_cell(comment.ref);\n";
const guard = "\t\tif(r.r < 0 || r.c < 0) return;\n";

test("installed xlsx copies carry the decode_cell negative-coordinate guard (new code present)", async () => {
  for (const target of xlsxTargets) {
    const entry = path.join("node_modules/xlsx", target.file);
    const source = await readFile(entry, "utf8");
    // The postinstall hook should already have patched the installed copy; verify the guard
    // line exists immediately after the anchor, and the anchor is still the sole occurrence.
    assert.ok(source.includes(anchor + guard), `${target.file} is missing the CVE-2023-30533 guard line`);
    assert.equal(source.split(anchor).length, 2, `${target.file} anchor should still be unique`);
  }
});

test("patch function is a precise single-line insertion, not a broad rewrite", () => {
  const original = `function sheet_insert_comments(sheet, comments, threaded, people) {
\tvar dense = Array.isArray(sheet);
\tvar cell;
\tcomments.forEach(function(comment) {
\t\tvar r = decode_cell(comment.ref);
\t\tif(dense) {
\t\t\tif(!sheet[r.r]) sheet[r.r] = [];
`;
  const digest = sha(original);
  const patched = patchXlsxPrototypePollution(original, digest);
  assert.ok(patched.includes(anchor + guard));
  assert.equal(patched.replace(guard, ""), original);
});

test("hash guard rejects an unmatched/tampered input instead of patching blindly", () => {
  const tamperedOriginal = "\t\tvar r = decode_cell(comment.ref);\n\t\tif(dense) {\n// unexpected extra byte";
  assert.throws(
    () => patchXlsxPrototypePollution(tamperedOriginal, sha("something else entirely")),
    /unknown dependency digest/,
  );

  const fakePatchedButWrongOrigin = anchor + guard + "\t\tif(dense) {\n";
  assert.throws(
    () => patchXlsxPrototypePollution(fakePatchedButWrongOrigin, sha("not the real original")),
    /unknown dependency digest/,
  );
});

test("applying the patch twice is idempotent and produces identical bytes", async () => {
  const entry = path.join("node_modules/xlsx", xlsxTargets[0].file);
  const before = await readFile(entry, "utf8");
  const first = patchXlsxPrototypePollution(before, xlsxTargets[0].originalSha256);
  const second = patchXlsxPrototypePollution(first, xlsxTargets[0].originalSha256);
  assert.equal(first, second);
  assert.equal(first, before); // already patched in this worktree by postinstall
});

test("installXlsxPrototypePatch on a synthetic 0.18.5 tree patches then reports already_patched, and rejects a foreign version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xlsx-prototype-patch-"));
  try {
    const pkgDir = path.join(root, "node_modules/xlsx");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: "xlsx", version: "0.18.5", main: "xlsx.js", module: "xlsx.mjs" }));
    const unpatchedJs = await readFile(path.join(process.cwd(), "node_modules/xlsx/xlsx.js"), "utf8");
    const unpatchedMjs = await readFile(path.join(process.cwd(), "node_modules/xlsx/xlsx.mjs"), "utf8");
    const originalJs = unpatchedJs.includes(guard) ? unpatchedJs.replace(anchor + guard, anchor) : unpatchedJs;
    const originalMjs = unpatchedMjs.includes(guard) ? unpatchedMjs.replace(anchor + guard, anchor) : unpatchedMjs;
    await writeFile(path.join(pkgDir, "xlsx.js"), originalJs);
    await writeFile(path.join(pkgDir, "xlsx.mjs"), originalMjs);

    const first = await installXlsxPrototypePatch(root);
    assert.deepEqual(first.map((r) => r.status), ["patched", "patched"]);
    assert.ok((await readFile(path.join(pkgDir, "xlsx.js"), "utf8")).includes(anchor + guard));
    assert.ok((await readFile(path.join(pkgDir, "xlsx.mjs"), "utf8")).includes(anchor + guard));

    const second = await installXlsxPrototypePatch(root);
    assert.deepEqual(second.map((r) => r.status), ["already_patched", "already_patched"]);
    assert.deepEqual(second.map((r) => r.sha256), first.map((r) => r.sha256));

    await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: "xlsx", version: "0.19.3" }));
    await assert.rejects(installXlsxPrototypePatch(root), /locked 0.18.5/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "xlsx-prototype-patch-")));
    await rm(root, { recursive: true, force: true });
  }
});

test("CVE-2023-30533: a crafted comment ref of \"__proto__\" no longer pollutes Object.prototype", async () => {
  // Build a minimal real OOXML package with a legacy (non-threaded) comments part whose
  // comment ref is an all-lowercase string. decode_cell() on 0.18.5 returns {c:-1, r:-1} for
  // such refs (it only accumulates uppercase letters/digits); sheet_insert_comments() must
  // reject negative coordinates before using them to index into `sheet`, otherwise
  // `sheet["__proto__"]` resolves to Object.prototype itself and gets a `.c` property assigned.
  const enc = (value: string) => new TextEncoder().encode(value);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="str"><v>hello</v></c></row></sheetData>
</worksheet>`;
  const sheet1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/>
</Relationships>`;
  const maliciousComments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<authors><author>poc</author></authors>
<commentList>
<comment ref="__proto__" authorId="0"><text><t>pwned</t></text></comment>
</commentList>
</comments>`;

  const zipped = zipSync({
    "[Content_Types].xml": enc(contentTypes),
    "_rels/.rels": enc(rootRels),
    "xl/workbook.xml": enc(workbook),
    "xl/_rels/workbook.xml.rels": enc(workbookRels),
    "xl/worksheets/sheet1.xml": enc(sheet1),
    "xl/worksheets/_rels/sheet1.xml.rels": enc(sheet1Rels),
    "xl/comments1.xml": enc(maliciousComments),
  });

  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "c"), false, "test started with an already-polluted prototype");
  try {
    const wb = XLSX.read(zipped, { type: "array" });
    assert.deepEqual(wb.SheetNames, ["Sheet1"]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(Object.prototype, "c"),
      false,
      "Object.prototype.c was set by a crafted __proto__ comment ref (CVE-2023-30533 regression)",
    );
  } finally {
    // Defensive cleanup in case of an assertion failure mid-pollution: never leak into later tests.
    delete (Object.prototype as unknown as Record<string, unknown>).c;
  }
});
