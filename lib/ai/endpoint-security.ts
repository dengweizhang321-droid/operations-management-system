export function normalizeAiEndpointUrl(value: string, target: "model" | "channel"): string {
  const input = value.trim();
  if (!input) throw new Error(target === "model" ? "模型地址不能为空" : "Webhook 地址不能为空");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(target === "model" ? "模型地址格式无效" : "Webhook 地址格式无效");
  }

  const allowLocalModel = globalThis.process?.env?.AI_ALLOW_LOCAL_MODEL_ENDPOINTS === "true";
  const isLocal = isLocalOrPrivateHost(url.hostname);
  const isLocalHttp = target === "model" && allowLocalModel && url.protocol === "http:" && isLocal;
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error(target === "model" ? "模型地址必须使用 HTTPS；本地调试需显式设置 AI_ALLOW_LOCAL_MODEL_ENDPOINTS=true" : "Webhook 地址必须使用 HTTPS");
  }
  if (url.username || url.password) throw new Error("地址中不能包含用户名或密码");
  if (isLocal && !isLocalHttp) throw new Error("地址不能指向 localhost、内网或保留网段");
  if (url.hash) url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** Never expose a usable webhook URL. Paths and query strings can both contain credentials. */
export function maskWebhookUrl(value: string): string {
  if (!value) return "未配置";
  try {
    const url = new URL(value);
    const suffix = value.slice(-4);
    return `${url.protocol}//${url.host}/•••${url.search ? "?…" : ""} ••••${suffix}`;
  } catch {
    return "已配置 ••••";
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  if (host.startsWith("::ffff:")) return isPrivateIpv4(host.slice(7));
  return isPrivateIpv4(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part > 255)) return true;
  const [a, b] = numbers;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
