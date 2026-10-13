import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

test("historical CommonJS evidence keeps syntax checks without changing application import rules", async () => {
  const eslint = new ESLint();
  const evidence = "docs/release-integration-review/c-targeted-independent-20261011/independent-policy-seams.cjs";
  const outside = "tools/unrelated-contract.cjs";
  const ordinary = "app/lint-contract-fixture.ts";
  const code = "const fs = require('node:fs'); console.log(fs);\n";
  const [accepted] = await eslint.lintText(code,{filePath:evidence});
  assert.equal(accepted.errorCount,0);
  for(const filePath of [outside,ordinary]){
    const [rejected] = await eslint.lintText(code,{filePath});
    assert.ok(rejected.messages.some(message=>message.ruleId==="@typescript-eslint/no-require-imports"));
  }
  const [malformed] = await eslint.lintText("const = ;",{filePath:evidence});
  assert.ok(malformed.messages.some(message=>message.fatal));
});

test("the one archived Node diagnostic exemption retains the normal Next.js module rule", async () => {
  const eslint = new ESLint();
  const archived = "docs/startup-recovery-continuation-20261012/diagnose-exact-display.mjs";
  const code = "const module = {}; console.log(module);\n";
  const [accepted] = await eslint.lintText(code,{filePath:archived});
  assert.equal(accepted.errorCount,0);
  const [rejected] = await eslint.lintText(code,{filePath:"app/module-contract-fixture.ts"});
  assert.ok(rejected.messages.some(message=>message.ruleId==="@next/next/no-assign-module-variable"));
  const config = await eslint.calculateConfigForFile(archived);
  assert.equal(config.rules["@typescript-eslint/no-require-imports"][0],2);
});
