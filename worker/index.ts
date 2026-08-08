/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runScheduledCloudAnnotations } from "../lib/market/annotation-service";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TERUISI_LOCAL_DIRECT_ACCESS?: string;
  TERUISI_RUNTIME_ENV?: string;
  IMAGES: {
    info(stream: ReadableStream): Promise<{ width?: number; height?: number }>;
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number; anim?: boolean }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

const localScheduledPath = "/_teruisi/local/market-annotation-scheduled";

function allowsLocalScheduledRequest(request: Request, env: Env) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return (hostname === "127.0.0.1" || hostname === "localhost")
    && env.TERUISI_RUNTIME_ENV === "development"
    && env.TERUISI_LOCAL_DIRECT_ACCESS === "true"
    && request.headers.get("x-teruisi-local-scheduled") === "1";
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === localScheduledPath) {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
      if (!allowsLocalScheduledRequest(request, env)) return new Response(null, { status: 404 });
      try {
        const result = await runScheduledCloudAnnotations(env.DB);
        return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "market annotation local scheduler failed";
        console.error(message.slice(0, 300));
        return Response.json({ ok: false, error: "本地云端标注调度失败" }, { status: 500, headers: { "cache-control": "no-store" } });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    void _ctx;
    try {
      await runScheduledCloudAnnotations(env.DB);
    } catch (error) {
      const message = error instanceof Error ? error.message : "market annotation scheduled runner failed";
      console.error(message.slice(0, 300));
    }
  },
};

export default worker;
