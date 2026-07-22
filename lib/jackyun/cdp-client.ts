import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CdpEventHandler = (params: Record<string, unknown>) => void;

/**
 * The controller can use either the legacy raw DevTools client or a Playwright
 * page backed client.  Keeping this small contract lets download provenance
 * continue to use CDP events while page interaction moves to Playwright.
 */
export type BrowserAutomationClient = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(method: string, handler: CdpEventHandler): () => void;
  close(): void;
};

export type ChromeTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();

  private constructor(private readonly socket: WebSocket) {}

  static async connect(webSocketUrl: string, timeoutMs = 10_000) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("连接 Chrome DevTools 超时。")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("无法连接 Chrome DevTools。"));
      }, { once: true });
    });
    const client = new CdpClient(socket);
    socket.addEventListener("message", (event) => client.handleMessage(String(event.data)));
    socket.addEventListener("close", () => client.rejectAll(new Error("Chrome DevTools 连接已关闭。")));
    return client;
  }

  on(method: string, handler: CdpEventHandler) {
    const current = this.handlers.get(method) ?? new Set<CdpEventHandler>();
    current.add(handler);
    this.handlers.set(method, current);
    return () => current.delete(handler);
  }

  async send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools 调用超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }

  private handleMessage(text: string) {
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
    };
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "未知 Chrome DevTools 错误。"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {});
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function listChromeTargets(port: number): Promise<ChromeTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`读取 Chrome targets 失败：HTTP ${response.status}。`);
  return await response.json() as ChromeTarget[];
}

export async function connectChromeBrowser(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`读取 Chrome 版本端点失败：HTTP ${response.status}。`);
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) throw new Error("Chrome 版本端点缺少浏览器 WebSocket 地址。");
  return CdpClient.connect(version.webSocketDebuggerUrl);
}

export async function waitForChrome(port: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await listChromeTargets(port);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`专用 Chrome 未在 ${timeoutMs}ms 内开放调试端口 ${port}。`);
}

export async function launchDedicatedChrome(options: {
  executablePath: string;
  profileDirectory: string;
  port: number;
  startUrl: string;
  headless?: boolean;
  visible?: boolean;
}) {
  try {
    await listChromeTargets(options.port);
    return null;
  } catch {
    // Launch below.
  }
  await mkdir(options.profileDirectory, { recursive: true });
  const args = [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    options.startUrl,
  ];
  if (options.headless) args.unshift("--headless=new");
  const child: ChildProcess = spawn(options.executablePath, args, { detached: true, stdio: "ignore", windowsHide: !options.visible });
  child.unref();
  await waitForChrome(options.port);
  return child;
}

export async function connectJackyunTarget(port: number) {
  const targets = await listChromeTargets(port);
  const target = targets.find((item) => item.type === "page" && /jackyun\.com/i.test(item.url))
    ?? targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("专用 Chrome 中没有可控制的吉客云页面。");
  return { target, client: await CdpClient.connect(target.webSocketDebuggerUrl) };
}

export async function evaluateValue<T>(client: BrowserAutomationClient, expression: string, timeoutMs = 60_000): Promise<T> {
  const response = await client.send<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "页面脚本执行失败。");
  }
  return response.result.value as T;
}
