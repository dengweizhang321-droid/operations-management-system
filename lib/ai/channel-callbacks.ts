const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fixedTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** DingTalk group-bot signing: HMAC-SHA256(timestamp + "\n" + secret), Base64 encoded. */
export async function createDingTalkSignature(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}\n${secret}`));
  return toBase64(new Uint8Array(bytes));
}

export async function verifyDingTalkSignature(input: { timestamp: string; signature: string; secret: string }): Promise<boolean> {
  if (!input.timestamp || !input.signature || !input.secret) return false;
  return fixedTimeEqual(await createDingTalkSignature(input.timestamp, input.secret), input.signature);
}

/** Enterprise WeChat callback signing: SHA1(sort(token, timestamp, nonce, encrypt)). */
export async function createWeComSignature(input: { token: string; timestamp: string; nonce: string; encrypt: string }): Promise<string> {
  const payload = [input.token, input.timestamp, input.nonce, input.encrypt].sort().join("");
  const digest = await crypto.subtle.digest("SHA-1", encoder.encode(payload));
  return toHex(new Uint8Array(digest));
}

export async function verifyWeComSignature(input: { token: string; timestamp: string; nonce: string; encrypt: string; signature: string }): Promise<boolean> {
  if (!input.token || !input.timestamp || !input.nonce || !input.encrypt || !input.signature) return false;
  return fixedTimeEqual(await createWeComSignature(input), input.signature.toLowerCase());
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

/**
 * Decrypts an Enterprise WeChat callback envelope without interpreting it as a command.
 * The caller is responsible for signature validation before calling this helper.
 */
export async function decryptWeComEnvelope(input: { encodingAesKey: string; encrypted: string; expectedReceiverId?: string }): Promise<string> {
  const keyBytes = fromBase64(`${input.encodingAesKey.trim().replace(/=/g, "") }=`);
  if (keyBytes.length !== 32) throw new Error("企业微信 EncodingAESKey 无效");
  const ciphertext = fromBase64(input.encrypted);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) throw new Error("企业微信回调密文无效");
  const key = await crypto.subtle.importKey("raw", asArrayBuffer(keyBytes), { name: "AES-CBC" }, false, ["decrypt"]);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: asArrayBuffer(keyBytes.slice(0, 16)) }, key, asArrayBuffer(ciphertext)));
  } catch {
    throw new Error("企业微信回调解密失败");
  }
  if (plaintext.length < 20) throw new Error("企业微信回调内容无效");
  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const messageLength = view.getUint32(16, false);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageLength < 0 || messageEnd > plaintext.length) throw new Error("企业微信回调消息长度无效");
  const receiverId = decoder.decode(plaintext.slice(messageEnd));
  if (input.expectedReceiverId && receiverId !== input.expectedReceiverId) throw new Error("企业微信回调接收方校验失败");
  return decoder.decode(plaintext.slice(messageStart, messageEnd));
}

/** Extracts a simple XML node value; callback XML is not treated as executable markup. */
export function extractXmlElement(xml: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = new RegExp(`<${escapedName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapedName}>|<${escapedName}>([\\s\\S]*?)<\\/${escapedName}>`, "i").exec(xml);
  return (matched?.[1] ?? matched?.[2] ?? "").trim();
}
