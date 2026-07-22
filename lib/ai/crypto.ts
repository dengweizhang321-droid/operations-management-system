const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  if (!key) throw new Error("AI 凭证加密服务尚未初始化，请联系部署管理员配置后重试");
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
