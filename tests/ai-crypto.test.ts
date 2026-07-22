import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecret, encryptSecret } from "../lib/ai/crypto";

test("AI model credentials round-trip with the configured encryption key", async () => {
  const previous = process.env.AI_SECRET_ENCRYPTION_KEY;
  process.env.AI_SECRET_ENCRYPTION_KEY = "unit-test-key-that-is-not-used-outside-this-process";
  try {
    const encrypted = await encryptSecret("provider-api-key");
    assert.notEqual(encrypted, "provider-api-key");
    assert.doesNotMatch(encrypted, /provider-api-key/);
    assert.equal(await decryptSecret(encrypted), "provider-api-key");
  } finally {
    if (previous === undefined) delete process.env.AI_SECRET_ENCRYPTION_KEY;
    else process.env.AI_SECRET_ENCRYPTION_KEY = previous;
  }
});
