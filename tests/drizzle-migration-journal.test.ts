import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

test("Drizzle journal registers normal migrations and excludes operator-only post-cutover DDL", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const [fileNames, journalText] = await Promise.all([
    readdir(migrationDirectory),
    readFile(new URL("meta/_journal.json", migrationDirectory), "utf8"),
  ]);
  const sqlTags = fileNames
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => name.slice(0, -4))
    .filter((tag) => ![
      "0092_sales_domain_retirement",
      "0093_finance_write_authority",
    ].includes(tag));
  const journal = JSON.parse(journalText) as Journal;

  assert.equal(journal.dialect, "sqlite");
  assert.equal(fileNames.includes("0092_sales_domain_retirement.sql"), true);
  assert.equal(journal.entries.some((entry) => entry.tag === "0092_sales_domain_retirement"), false);
  assert.equal(fileNames.includes("0093_finance_write_authority.sql"), true);
  assert.equal(journal.entries.some((entry) => entry.tag === "0093_finance_write_authority"), false);
  assert.deepEqual(journal.entries.map((entry) => entry.idx), sqlTags.map((_, index) => index));
  assert.deepEqual(journal.entries.map((entry) => entry.tag), sqlTags);
  assert.equal(new Set(journal.entries.map((entry) => entry.when)).size, journal.entries.length);
  for (let index = 1; index < journal.entries.length; index += 1) {
    assert.ok(journal.entries[index]!.when > journal.entries[index - 1]!.when);
  }
});
