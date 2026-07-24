import assert from "node:assert/strict";
import test from "node:test";

import { decideLocalDirectAccess } from "../lib/auth/local-direct-access";

const allRoles = ["viewer", "analyst", "operator", "admin"];

test("local direct access stays disabled in production despite explicit opt-in", () => {
  assert.equal(
    decideLocalDirectAccess(allRoles, {
      enabled: "true",
      runtimeEnvironment: "production",
      viteDevelopment: false,
      viteProduction: true,
    }),
    "disabled",
  );

  assert.equal(
    decideLocalDirectAccess(allRoles, {
      enabled: "true",
      runtimeEnvironment: "development",
      viteDevelopment: false,
      viteProduction: true,
    }),
    "disabled",
  );

  assert.equal(
    decideLocalDirectAccess(allRoles, {
      enabled: "true",
      runtimeEnvironment: "production",
      viteDevelopment: false,
      viteProduction: true,
      localBuild: true,
    }),
    "disabled",
  );
});

test("local direct access requires explicit opt-in and verified development", () => {
  assert.equal(
    decideLocalDirectAccess(allRoles, {
      enabled: "true",
      runtimeEnvironment: "development",
      viteDevelopment: true,
      viteProduction: false,
    }),
    "allowed",
  );

  for (const enabled of [undefined, "false", "1", "yes"]) {
    assert.equal(
      decideLocalDirectAccess(allRoles, {
        enabled,
        runtimeEnvironment: "development",
        viteDevelopment: true,
        viteProduction: false,
      }),
      "disabled",
    );
  }
});

test("local admin cannot bypass the caller's allowed roles", () => {
  assert.equal(
    decideLocalDirectAccess(["viewer", "analyst"], {
      enabled: "true",
      runtimeEnvironment: "development",
      viteDevelopment: true,
      viteProduction: false,
    }),
    "role_denied",
  );
});

test("an explicitly stamped local worker build permits direct access", () => {
  assert.equal(
    decideLocalDirectAccess(allRoles, {
      enabled: "true",
      runtimeEnvironment: "development",
      viteDevelopment: false,
      viteProduction: true,
      localBuild: true,
    }),
    "allowed",
  );
});
