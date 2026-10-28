const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 与 backend/teruisi_backend/settings.py 的 SECRET_PLACEHOLDERS /
// validate_secret 保持同一套黑名单与规则，两侧 fail-closed 判断必须一致。
const SECRET_PLACEHOLDERS = new Set([
  "unsafe-local-development-key",
  "replace-me",
  "replace-with-at-least-32-random-bytes",
  "change-me",
  "changeme",
  "placeholder",
]);
const PLACEHOLDER_PATTERN = /^(?:replace|change|example|sample|test|secret|password)[-_a-z0-9]*$/i;

/**
 * Fail-closed check for the AI secret-encryption master key: at least 32
 * bytes, not a documented placeholder, and not an obviously low-entropy or
 * example-looking value. Mirrors backend/teruisi_backend/settings.py's
 * validate_secret() so both sides reject the same inputs.
 */
export function isAcceptableEncryptionKey(value: string): boolean {
  const normalized = value.trim();
  if (encoder.encode(normalized).length < 32) return false;
  if (SECRET_PLACEHOLDERS.has(normalized.toLowerCase())) return false;
  if (new Set(normalized).size < 4) return false;
  if (PLACEHOLDER_PATTERN.test(normalized)) return false;
  return true;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function configuredEncryptionKey() {
  const processValue = globalThis.process?.env?.AI_SECRET_ENCRYPTION_KEY;
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();
  try {
    const { env } = await import("cloudflare:workers");
    const workerValue = env.AI_SECRET_ENCRYPTION_KEY;
    return typeof workerValue === "string" ? workerValue.trim() : "";
  } catch {
    return "";
  }
}

async function getKeyMaterial() {
  const key = await configuredEncryptionKey();
  if (!key || !isAcceptableEncryptionKey(key)) {
    throw new Error("AI 凭证加密服务尚未初始化，请联系部署管理员配置后重试");
  }
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string) {
  if (!value) return "";
  const key = await getKeyMaterial();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(value: string) {
  if (!value) return "";
  const key = await getKeyMaterial();
  const [ivEncoded, payloadEncoded] = value.split(".");
  const iv = base64UrlDecode(ivEncoded);
  const payload = base64UrlDecode(payloadEncoded);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return decoder.decode(plaintext);
}

export function maskSecret(value?: string | null) {
  if (!value) return "";
  return `••••${value.slice(-4)}`;
}
