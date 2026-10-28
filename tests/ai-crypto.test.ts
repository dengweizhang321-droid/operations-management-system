import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecret, encryptSecret, isAcceptableEncryptionKey } from "../lib/ai/crypto";

async function withEncryptionKey(key: string | undefined, run: () => Promise<void>) {
  const previous = process.env.AI_SECRET_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.AI_SECRET_ENCRYPTION_KEY;
  else process.env.AI_SECRET_ENCRYPTION_KEY = key;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.AI_SECRET_ENCRYPTION_KEY;
    else process.env.AI_SECRET_ENCRYPTION_KEY = previous;
  }
}

test("AI model credentials round-trip with the configured encryption key", async () => {
  // 合成测试值：32+ 字节、够高熵，不是任何真实密钥。
  await withEncryptionKey("synthetic-test-master-key-0123456789-abcdefgh", async () => {
    const encrypted = await encryptSecret("provider-api-key");
    assert.notEqual(encrypted, "provider-api-key");
    assert.doesNotMatch(encrypted, /provider-api-key/);
    assert.equal(await decryptSecret(encrypted), "provider-api-key");
  });
});

test("a too-short encryption key is rejected instead of silently accepted", async () => {
  await withEncryptionKey("too-short", async () => {
    await assert.rejects(() => encryptSecret("provider-api-key"));
  });
});

test("an empty encryption key is rejected", async () => {
  await withEncryptionKey("", async () => {
    await assert.rejects(() => encryptSecret("provider-api-key"));
  });
});

test("documented placeholder encryption keys are rejected even when 32+ bytes", async () => {
  await withEncryptionKey("changeme-changeme-changeme-changeme", async () => {
    await assert.rejects(() => encryptSecret("provider-api-key"));
  });
});

test("example-like encryption keys are rejected", async () => {
  await withEncryptionKey("example-example-example-example-key", async () => {
    await assert.rejects(() => encryptSecret("provider-api-key"));
  });
});

test("low-entropy (repeated character) encryption keys are rejected", async () => {
  await withEncryptionKey("a".repeat(40), async () => {
    await assert.rejects(() => encryptSecret("provider-api-key"));
  });
});

test("isAcceptableEncryptionKey matches the Django-side validate_secret rule", () => {
  assert.equal(isAcceptableEncryptionKey("synthetic-test-master-key-0123456789-abcdefgh"), true);
  assert.equal(isAcceptableEncryptionKey("too-short"), false);
  assert.equal(isAcceptableEncryptionKey(""), false);
  assert.equal(isAcceptableEncryptionKey("changeme-changeme-changeme-changeme"), false);
  assert.equal(isAcceptableEncryptionKey("example-example-example-example-key"), false);
  assert.equal(isAcceptableEncryptionKey("a".repeat(40)), false);
});
