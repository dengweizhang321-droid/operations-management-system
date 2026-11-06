#!/usr/bin/env node
// CI gate: a Markdown path literal that code actually reads must exist.
//
// Why this exists
// ---------------
// docs/规范/文档管理.md:29 already requires that moving a document also update
// 「代码中的文档路径字面量」. That requirement was prose only, so nothing read it:
// f5da8fb3 both introduced the rule and broke it in the same 472-file tidy-up,
// renaming docs/AI_BUSINESS_PROMOTION_BUDGET_V11_LIMITED_IDENTITY_DESIGN.md
// (R100) without updating the hardcoded path in
// backend/ai_assistant/test_business_promotion_budget_v11_limited_identity_blocker.py:45.
// That test has been ERRORing ever since. This gate is the reader the rule
// never had.
//
// Zero tolerance, no baseline constant
// ------------------------------------
// The one real dead reference is fixed, so the honest baseline is 0. A
// committed number would be a maintenance burden with nothing to track, and
// (unlike the lint gate, which sits on 56 pre-existing errors that are out of
// scope) there is nothing here that cannot be fixed. If a legitimate exception
// ever appears, add it to EXEMPTIONS below with a dated reason rather than
// raising a blanket count — an allowlist entry says which reference is
// forgiven and why; a count forgives whichever one happens to break next.
//
// Scope, and why it is this narrow
// --------------------------------
// A full-repo sweep of 15 code extensions finds 4086 `.md` path tokens, 1238
// of which do not resolve. Almost all of that is noise: one-off evidence JSON
// and scratch scripts under docs/ (docs/.../history-comparison.json alone
// contributes hundreds of GBK-mojibake strings). Three filters, each measured
// against origin/main @ 142becaf, cut 1238 down to exactly 1 — the real bug:
//
//   R1  only four code families, and never docs/**   1238 -> 26
//   R2  the token's own line must actually read it      26 -> 3
//   R3  the token must contain "/" or "docs"             3 -> 1
//
// R3 removes two instances of the same shape: a bare basename resolved against
// a runtime directory, not the repo (pi_service.py:202 and skills.py:45 both
// read SKILL.md out of an agent-skill bundle). R2 and R3 are deliberately
// crude: this gate is for literals a reader can see are repository documents,
// and it would rather miss a dynamic reference than cry wolf on a runtime one.
//
// Multi-line literals
// -------------------
// The reference bug matters here. Its path is split over two physical lines:
//
//     doc = (Path(__file__).resolve().parents[2] / "docs" /
//         "AI_BUSINESS_PROMOTION_BUDGET_V11_LIMITED_IDENTITY_DESIGN.md").read_text(
//
// The `.md` literal on line 45 is a bare basename; "docs" is on line 44. So a
// scanner that treats one physical line as one token sees no "/" and no
// "docs", and R3 drops the very reference this gate was built for (measured:
// it reports the three unrelated survivors and not the bug). This script
// therefore walks backwards across `/`-chained string literals, including over
// a line break, and tests the joined path. Only `/` is followed — chaining on
// `,` as well was tried and glued unrelated arguments together
// ("agents.md/claude.md"), inflating full-repo misses from 1238 to 1570.
//
// Encoding
// --------
// Files are decoded as strict UTF-8 and skipped if they do not decode. The
// Chinese documentation tree is full of GBK-mojibake paths; decoding those
// leniently manufactures garbage findings. (Both files that currently fail to
// decode live under docs/ and are already out of scope, so this is
// defence in depth, not load-bearing today.)
//
// Known blind spots, stated honestly rather than papered over:
// - Dynamically constructed paths. backend/pi_runner/test_real.py:357-359
//   builds its paths from a loop variable; nothing here sees them.
// - f-strings, template literals, and any token holding "*", "$" or "{" are
//   treated as unresolvable and never flagged (this is also why the glob-based
//   fix for the reference bug passes).
// - Paths assembled from a variable prefix, read through a helper on another
//   line, or read in a different function than the literal appears in.
// - Documents referenced only from prose/Markdown. Out of scope by design.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".mjs", ".js", ".cjs", ".jsx",
  ".ps1", ".psm1", ".yml", ".yaml", ".json", ".toml", ".sh",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules", "__pycache__", ".git", "dist", ".next",
  ".runtime", ".codex-tmp", ".vite-sites-cache", "outputs", "tmp",
]);

// This gate's own test file is excluded, and it is the only such exclusion.
// That file necessarily contains deliberately-dead reference literals as
// fixture text ("docs/moved-design.md" and friends); scanning it makes the
// gate report its own test data and fail permanently. Verified: without this,
// a run on origin/main @ 142becaf reported 12 findings, 11 of them fixtures.
// The fixtures are written as string literals on purpose, so the test file
// reads like the code it is modelling. tests/doc-path-literal-gate.test.mjs
// asserts this path still exists, so renaming the test file fails a test with
// a clear message instead of silently re-enabling the self-report.
export const SELF_TEST_FILE = "tests/doc-path-literal-gate.test.mjs";

// R1: the four code families, with docs/** excluded everywhere.
function inScope(relativePath) {
  if (relativePath.startsWith("docs/")) return false;
  if (relativePath === SELF_TEST_FILE) return false;
  return (
    (relativePath.startsWith("backend/") && relativePath.endsWith(".py")) ||
    relativePath.startsWith("tools/") ||
    relativePath.startsWith("tests/") ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(relativePath)
  );
}

// R2: the line holding the literal must itself be reading a file.
const READS_A_FILE = /read_text|readFile|open\(|Get-Content/;

// R3: the literal must look like a repository document reference.
function looksLikeRepositoryDocument(token) {
  return token.includes("/") || token.includes("docs");
}

// Dated allowlist. Each entry must say which reference is exempt and why it
// cannot simply be fixed. Empty: as of 2026-11-06 nothing needs forgiving.
const EXEMPTIONS = [
  // { file: "<repo-relative path>", line: <number>, token: "<joined path>",
  //   reason: "<why this cannot be fixed, with a date>" },
];

const MARKDOWN_LITERAL = /(['"`])([^'"`\n\r]*?\.md)\1/gi;
// A string literal immediately followed by a path-join `/` at end of text.
const CHAINED_SEGMENT = /(['"`])([^'"`\n\r]+?)\1\s*\/\s*(?:Path\s*\(\s*)?$/;
const MAX_CHAIN_STEPS = 8;

function collectFiles(root, directory, found) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) collectFiles(root, absolute, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (inScope(relative)) found.push({ absolute, relative });
  }
  return found;
}

// Returns true (resolves to a file), false (does not), or null (not statically
// resolvable, so never reported).
function resolveDocument(root, relativeFile, token) {
  const candidate = token.replace(/\\/g, "/");
  if (/[*?${}]/.test(candidate)) return null;
  if (!candidate.toLowerCase().endsWith(".md")) return null;
  if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return null;
  const rootAbsolute = path.resolve(root);
  const attempts = [
    path.resolve(rootAbsolute, candidate),
    path.resolve(rootAbsolute, path.dirname(relativeFile), candidate),
  ].filter((attempt) => attempt.startsWith(rootAbsolute + path.sep));
  // Every interpretation lands outside the repository, so this gate has no
  // business asserting anything about it. Reporting it as missing would be a
  // false positive about a file CI cannot see.
  if (attempts.length === 0) return null;
  for (const attempt of attempts) {
    try {
      if (fs.statSync(attempt).isFile()) return true;
    } catch {
      // keep trying the next interpretation
    }
  }
  return false;
}

// Join `/`-chained literals backwards from the `.md` literal, across lines.
function joinChainedLiteral(lines, lineIndex, literal, matchIndex) {
  let joined = literal;
  let prefix = lines[lineIndex].slice(0, matchIndex);
  let cursor = lineIndex;
  for (let step = 0; step < MAX_CHAIN_STEPS; step += 1) {
    const chained = CHAINED_SEGMENT.exec(prefix);
    if (chained) {
      joined = chained[2].replace(/[/\\]+$/, "") + "/" + joined;
      prefix = prefix.slice(0, chained.index);
      continue;
    }
    // Nothing but whitespace/open-paren left: the chain continues on the
    // previous physical line (this is the reference bug's shape).
    if (/^[\s(]*$/.test(prefix) && cursor > 0) {
      cursor -= 1;
      prefix = lines[cursor];
      continue;
    }
    break;
  }
  return joined;
}

export function check(root) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = collectFiles(root, root, []);
  const findings = [];
  const perFileCounts = new Map();
  let scannedFiles = 0;
  let skippedUndecodable = 0;
  let inspectedTokens = 0;
  let exemptedCount = 0;

  for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    let text;
    try {
      text = decoder.decode(fs.readFileSync(file.absolute));
    } catch {
      skippedUndecodable += 1;
      continue;
    }
    scannedFiles += 1;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.toLowerCase().includes(".md")) continue;
      for (const match of line.matchAll(MARKDOWN_LITERAL)) {
        inspectedTokens += 1;
        if (!READS_A_FILE.test(line)) continue;                              // R2
        const token = joinChainedLiteral(lines, i, match[2], match.index);
        if (!looksLikeRepositoryDocument(token)) continue;                   // R3
        if (resolveDocument(root, file.relative, token) !== false) continue;
        const finding = { file: file.relative, line: i + 1, token };
        if (EXEMPTIONS.some((e) => e.file === finding.file && e.line === finding.line && e.token === finding.token)) {
          exemptedCount += 1;
          continue;
        }
        findings.push(finding);
        perFileCounts.set(file.relative, (perFileCounts.get(file.relative) ?? 0) + 1);
      }
    }
  }

  return {
    status: findings.length === 0 ? "passed" : "failed",
    scope: "read-markdown-path-literals",
    scannedFiles,
    skippedUndecodable,
    inspectedTokens,
    exemptedCount,
    findingCount: findings.length,
    // Independent second tally, aggregated per file rather than from the flat
    // list. The 2026-10-25 lint-gate incident came from a gate that scraped a
    // number out of text and silently reported the wrong one; here the two
    // counts are derived differently and disagreeing is itself a failure.
    perFileFindingTotal: [...perFileCounts.values()].reduce((sum, n) => sum + n, 0),
    perFileCounts: Object.fromEntries([...perFileCounts.entries()].sort()),
    findings,
  };
}

function main() {
  const flagIndex = process.argv.indexOf("--root");
  const root = flagIndex === -1
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
    : path.resolve(process.argv[flagIndex + 1]);

  const result = check(root);

  if (result.findingCount !== result.perFileFindingTotal) {
    console.error(
      "Internal inconsistency: flat finding count and per-file totals disagree " +
      `(${result.findingCount} vs ${result.perFileFindingTotal}). Failing loudly ` +
      "rather than reporting a number this script cannot corroborate."
    );
    return 1;
  }
  if (result.findings.length !== result.findingCount) {
    console.error("Internal inconsistency: findings array length does not match findingCount.");
    return 1;
  }
  if (result.scannedFiles === 0) {
    console.error(
      "No files were scanned. The scope filter or the repository layout changed; " +
      "treating an empty scan as a failure instead of a silent pass."
    );
    return 1;
  }

  console.log(
    `doc path literals: scanned ${result.scannedFiles} files, ` +
    `${result.inspectedTokens} .md literals, ` +
    `${result.skippedUndecodable} skipped (not UTF-8), ` +
    `${result.exemptedCount} exempted, ` +
    `${result.findingCount} dead reference(s)`
  );

  if (result.findings.length === 0) {
    console.log("PASS: every read Markdown path literal resolves to a file.");
    return 0;
  }

  console.error("--- dead Markdown path literals ---");
  for (const finding of result.findings) {
    console.error(`${finding.file}:${finding.line}  ${finding.token}`);
  }
  console.error(
    "FAIL: the code above reads a Markdown file that does not exist. " +
    "docs/规范/文档管理.md requires updating 代码中的文档路径字面量 when a document " +
    "moves. Point the literal at the document's current path, or match it by " +
    "filename glob so a future rename does not break it again. If a reference " +
    "genuinely cannot be fixed, add it to EXEMPTIONS in " +
    ".github/workflows/check-doc-path-literals.mjs with a dated reason."
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
