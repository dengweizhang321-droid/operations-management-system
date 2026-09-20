import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveJackyunChromeProfileDirectory } from "../lib/jackyun/runtime-path";

test("Jackyun browser paths do not require process.cwd during Worker startup", () => {
  assert.equal(
    resolveJackyunChromeProfileDirectory(),
    path.join(".", ".runtime", "jackyun-chrome-profile"),
  );
  assert.equal(
    resolveJackyunChromeProfileDirectory({ configuredProfileDirectory: "worker-profile" }),
    path.normalize("worker-profile"),
  );
});

test("Jackyun browser paths remain absolute for local automation", () => {
  const cwd = path.resolve("runtime-worker-root");
  assert.equal(
    resolveJackyunChromeProfileDirectory({ cwd }),
    path.join(cwd, ".runtime", "jackyun-chrome-profile"),
  );
  assert.equal(
    resolveJackyunChromeProfileDirectory({ cwd, configuredProfileDirectory: "custom-profile" }),
    path.resolve(cwd, "custom-profile"),
  );
});
