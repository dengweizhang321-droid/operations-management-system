// Tests for the dead-document-reference gate itself.
//
// The gate exists because docs/规范/文档管理.md:29 was prose with no reader, and
// was violated by the same commit that wrote it. A gate with no tests shares
// that fate: it can quietly stop finding anything and nobody notices. These
// tests build throwaway repository trees in a temp directory and assert on the
// structured result of check(), so they never depend on the real repository's
// current contents.
//
// Covered: a real dead reference is caught; each of the three noise-reduction
// rules independently suppresses something; and a non-UTF-8 file is skipped
// rather than crashing the scan or producing mojibake findings.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { check, SELF_TEST_FILE } from "../.github/workflows/check-doc-path-literals.mjs";

const temporaryRoots = [];

function buildRepository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-path-gate-"));
  temporaryRoots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (typeof contents === "string") fs.writeFileSync(absolute, contents, "utf-8");
    else fs.writeFileSync(absolute, contents);
  }
  return root;
}

after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

const tokensOf = (result) => result.findings.map((f) => f.token);

test("a dead document reference is reported with file, line and joined path", () => {
  const root = buildRepository({
    "backend/app/test_thing.py":
      "from pathlib import Path\n" +
      'doc = (Path(__file__) / "docs" / "moved-design.md").read_text(encoding="utf-8")\n',
    "docs/renamed-design.md": "# renamed\n",
  });
  const result = check(root);
  assert.equal(result.status, "failed");
  assert.equal(result.findingCount, 1);
  assert.deepEqual(result.findings, [
    { file: "backend/app/test_thing.py", line: 2, token: "docs/moved-design.md" },
  ]);
  // The independent per-file tally must corroborate the flat count.
  assert.equal(result.perFileFindingTotal, result.findingCount);
  assert.deepEqual(result.perFileCounts, { "backend/app/test_thing.py": 1 });
});

test("an existing document reference passes, relative to repo root or to the file", () => {
  const root = buildRepository({
    "tools/reader.mjs":
      'readFileSync("docs/规范/文档管理.md");\n' +
      'readFileSync("../docs/规范/文档管理.md");\n',
    "docs/规范/文档管理.md": "# 文档管理\n",
  });
  const result = check(root);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.findings, []);
});

test("the reference bug's two-line literal is joined across the line break", () => {
  // This is the exact shape of
  // backend/ai_assistant/test_business_promotion_budget_v11_limited_identity_blocker.py:44-45:
  // "docs" sits on the previous physical line, and the .md literal is a bare
  // basename. A per-physical-line scanner would see no "/" and no "docs", so
  // rule 3 would discard the one reference this gate was built to catch.
  const root = buildRepository({
    "backend/ai_assistant/test_blocker.py":
      "from pathlib import Path\n" +
      '        doc = (Path(__file__).resolve().parents[2] / "docs" /\n' +
      '            "AI_DESIGN.md").read_text(\n' +
      '                encoding="utf-8")\n',
  });
  const result = check(root);
  assert.equal(result.findingCount, 1);
  assert.equal(result.findings[0].line, 3, "reported at the .md literal's own line");
  assert.equal(result.findings[0].token, "docs/AI_DESIGN.md", "joined with the prior line's segment");
});

test("rule 1: only the four code families are scanned, and never docs/**", () => {
  const dead = 'open("docs/does-not-exist.md")\n';
  const root = buildRepository({
    // in scope
    "backend/app/reader.py": dead,
    "tools/reader.mjs": dead,
    "tests/reader.test.mjs": dead,
    ".github/workflows/ci.yml": dead,
    // out of scope: wrong family
    "app/components/Reader.tsx": dead,
    "scripts/reader.py": dead,
    // out of scope: backend, but not Python
    "backend/notes.json": dead,
    // out of scope: docs/** carries the one-off evidence JSON and scratch
    // scripts that produced ~820 of the 837 original misses
    "docs/evidence/history-comparison.json": dead,
    "docs/scratch/check.py": dead,
    "docs/tools/report.mjs": dead,
  });
  const result = check(root);
  assert.equal(result.findingCount, 4, "exactly the four in-scope families report");
  assert.deepEqual(
    result.findings.map((f) => f.file).sort(),
    [".github/workflows/ci.yml", "backend/app/reader.py", "tests/reader.test.mjs", "tools/reader.mjs"]
  );
  // Removing rule 1 would add the six out-of-scope hits above.
  assert.ok(!result.findings.some((f) => f.file.startsWith("docs/")), "docs/** never reported");
});

test("rule 2: a missing path is only flagged when its own line reads a file", () => {
  const root = buildRepository({
    "tools/mentions.mjs":
      'const DOC = "docs/missing-one.md";\n' +                       // mere mention
      'logger.info("see docs/missing-two.md for details");\n' +       // log text
      'const LIST = ["docs/missing-three.md", "docs/missing-four.md"];\n' + // data list
      'readFileSync("docs/missing-five.md");\n',                      // actually read
  });
  const result = check(root);
  assert.equal(result.findingCount, 1, "rule 2 suppresses the three non-reading lines");
  assert.equal(result.findings[0].token, "docs/missing-five.md");
  assert.equal(result.findings[0].line, 4);
  // Four literals were inspected and three dropped by rule 2. The log line's
  // "docs/missing-two.md" is not counted at all: it sits inside a longer
  // sentence, so it is not a quoted path literal. That is the intended
  // behaviour, and it means rule 2's job is suppressing mentions that *are*
  // standalone literals (lines 1 and 3 here).
  assert.equal(result.inspectedTokens, 4);
});

test("rule 2 recognises each of the four reading forms", () => {
  const root = buildRepository({
    "tools/forms.py": 'Path("docs/a/one.md").read_text()\n',
    "tools/forms.mjs": 'fs.readFileSync("docs/a/two.md");\n',
    "tools/forms2.py": 'open("docs/a/three.md")\n',
    "tools/forms.ps1": 'Get-Content "docs/a/four.md"\n',
  });
  const result = check(root);
  assert.equal(result.findingCount, 4);
  assert.deepEqual(tokensOf(result).sort(), [
    "docs/a/four.md", "docs/a/one.md", "docs/a/three.md", "docs/a/two.md",
  ]);
});

test("rule 3: a bare basename read from a runtime bundle is not flagged", () => {
  // The real shape this suppresses: backend/ai_assistant/pi_service.py:202 and
  // backend/pi_runner/skills.py:45 both read SKILL.md out of an agent-skill
  // bundle directory, not out of the repository. Same for generated report
  // names. Rule 3 drops these while keeping anything that names a path.
  const root = buildRepository({
    "backend/pi_runner/skills.py":
      'text = (bundle / "SKILL.md").read_text()\n' +
      'summary = (output_dir / "REPORT.md").read_text()\n' +
      'last = (state / "last.md").read_text()\n' +
      'quota = (state / "quota-report.md").read_text()\n' +
      'design = (repo / "docs" / "real-missing.md").read_text()\n',
  });
  const result = check(root);
  assert.equal(result.findingCount, 1, "four bare basenames dropped, the docs/ path kept");
  assert.equal(result.findings[0].token, "docs/real-missing.md");
  assert.ok(
    !tokensOf(result).some((t) => t === "SKILL.md" || t === "REPORT.md"),
    "runtime bundle basenames are never reported"
  );
});

test("a non-UTF-8 file is skipped, not decoded leniently into mojibake findings", () => {
  // The Chinese documentation tree is full of GBK-encoded paths. Decoding them
  // leniently manufactures garbage findings, so the scan skips what will not
  // decode as UTF-8 and says how many it skipped.
  const gbk = Buffer.concat([
    Buffer.from('open("docs/', "utf-8"),
    Buffer.from([0xb9, 0xe6, 0xb7, 0xb6]), // 规范 in GBK: invalid UTF-8
    Buffer.from('/missing.md")\n', "utf-8"),
  ]);
  const root = buildRepository({
    "tools/gbk-reader.py": gbk,
    "tools/utf8-reader.py": 'open("docs/规范/missing-utf8.md")\n',
  });
  const result = check(root);
  assert.equal(result.skippedUndecodable, 1, "the GBK file is skipped");
  assert.equal(result.scannedFiles, 1, "only the UTF-8 file is scanned");
  assert.equal(result.findingCount, 1);
  assert.equal(result.findings[0].file, "tools/utf8-reader.py");
  assert.equal(result.findings[0].token, "docs/规范/missing-utf8.md",
    "a genuine Chinese path still round-trips correctly");
});

test("paths that cannot be statically resolved are never flagged", () => {
  const root = buildRepository({
    "tools/dynamic.py":
      'Path(f"docs/{name}/design.md").read_text()\n' +      // f-string
      'open("docs/*/design.md")\n' +                        // glob
      'open("/opt/pi/bundles/references/report-format.md")\n' + // absolute, outside repo
      'open("C:/secret/AGENTS.md")\n' +                     // absolute Windows
      'open("../../../outside/escape.md")\n',               // escapes the repo root
  });
  const result = check(root);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.findings, []);
});

test("a path that escapes the repository root is unresolvable, not missing", () => {
  // Caught by these tests before shipping: an earlier version filtered escaping
  // candidates inside the resolve loop and then fell through to `return false`,
  // so `../../../outside/escape.md` was reported as a dead reference even
  // though CI cannot see outside the checkout. A relative path that still lands
  // inside the repo must keep working.
  const root = buildRepository({
    "tests/sub/escape.mjs": 'readFileSync("../../../outside/escape.md");\n',
    "tests/sub/inside.mjs": 'readFileSync("../fixtures/missing-inside.md");\n',
  });
  const result = check(root);
  assert.equal(result.findingCount, 1);
  assert.equal(result.findings[0].file, "tests/sub/inside.mjs",
    "an in-repo relative miss is still caught");
});

test("the gate's self-exclusion points at this file, which exists", () => {
  // This file is the gate's one scope exclusion, because its fixtures are
  // deliberately-dead reference literals. If it is ever renamed or moved
  // without updating SELF_TEST_FILE, the exclusion stops matching and the gate
  // starts reporting these fixtures as 11 real findings. This assertion is
  // exactly the kind of reader that docs/规范/文档管理.md asks for, applied to
  // the gate itself.
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  assert.equal(
    path.relative(repositoryRoot, import.meta.filename).split(path.sep).join("/"),
    SELF_TEST_FILE,
    "SELF_TEST_FILE in check-doc-path-literals.mjs no longer names this file"
  );
  assert.ok(fs.statSync(path.join(repositoryRoot, SELF_TEST_FILE)).isFile());
});

test("the gate reports a passing scan with corroborating counts", () => {
  const root = buildRepository({
    "tools/ok.mjs": 'readFileSync("docs/present.md");\n',
    "docs/present.md": "# present\n",
  });
  const result = check(root);
  assert.equal(result.status, "passed");
  assert.equal(result.scope, "read-markdown-path-literals");
  assert.equal(result.findingCount, 0);
  assert.equal(result.perFileFindingTotal, 0);
  assert.equal(result.exemptedCount, 0);
  assert.ok(result.scannedFiles > 0, "an empty scan is a failure signal, not a pass");
});
