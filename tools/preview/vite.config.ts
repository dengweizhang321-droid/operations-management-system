import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig(({ command }) => {
    if (command !== "serve" || process.env.TERUISI_PREVIEW_SESSION !== "1") {
        throw new Error("Use npm run preview:isolated in an isolated worktree");
    }
    const { port } = JSON.parse(readFileSync(".runtime/preview/session.json", "utf8"));
    if (!Number.isInteger(port) || port < 3100 || port > 3900) {
        throw new Error("Invalid preview session port");
    }
    const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 5000,
    }).trim();
    return {
        envDir: path.resolve(".runtime/preview"),
        cacheDir: "node_modules/.vite-preview-cache",
        // Expose only banner fields, never the session token or local paths.
        define: {
            "import.meta.env.VITE_TERUISI_PREVIEW": JSON.stringify("true"),
            "import.meta.env.VITE_TERUISI_PREVIEW_PORT": JSON.stringify(String(port)),
            "import.meta.env.VITE_TERUISI_PREVIEW_BRANCH": JSON.stringify(branch),
        },
        server: {
            host: "127.0.0.1", port, strictPort: true,
            watch: { ignored: ["**/.runtime/**", "**/.wrangler/**"] },
            headers: {
                "Content-Security-Policy": `connect-src 'self' ws://127.0.0.1:${port}; frame-src 'none'; form-action 'none'; img-src 'self' data: blob:; object-src 'none'`,
            },
        },
        plugins: [vinext(), cloudflare({
                configPath: path.resolve(".runtime/preview/wrangler.json"),
                viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
                inspectorPort: false, remoteBindings: false, tunnel: false,
                persistState: { path: path.resolve(".runtime/preview/r2") },
            })],
    };
});
