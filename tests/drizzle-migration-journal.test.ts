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

test("Drizzle migration journal registers every SQL migration in order", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const [fileNames, journalText] = await Promise.all([
    readdir(migrationDirectory),
    readFile(new URL("meta/_journal.json", migrationDirectory), "utf8"),
  ]);
  const sqlTags = fileNames
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => name.slice(0, -4));
  const journal = JSON.parse(journalText) as Journal;

  assert.equal(journal.dialect, "sqlite");
  assert.deepEqual(journal.entries.map((entry) => entry.idx), sqlTags.map((_, index) => index));
  assert.deepEqual(journal.entries.map((entry) => entry.tag), sqlTags);
  assert.equal(new Set(journal.entries.map((entry) => entry.when)).size, journal.entries.length);
  for (let index = 1; index < journal.entries.length; index += 1) {
    assert.ok(journal.entries[index]!.when > journal.entries[index - 1]!.when);
  }
});
