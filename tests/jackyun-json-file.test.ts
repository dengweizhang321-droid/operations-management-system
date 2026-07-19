import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";

test("shared JSON reader accepts a UTF-8 BOM and writer never emits one", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-json-test-"));
  try {
    const filePath = path.join(directory, "event.json");
    await writeFile(filePath, `\uFEFF${JSON.stringify({ ok: true })}`, "utf8");
    assert.deepEqual(await readJsonFile(filePath), { ok: true });
    await writeJsonAtomic(filePath, { ok: "written" });
    const bytes = await readFile(filePath);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.deepEqual(await readJsonFile(filePath), { ok: "written" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
