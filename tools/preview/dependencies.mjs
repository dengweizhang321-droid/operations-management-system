import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const npmCommand = process.platform === "win32"
    ? ["cmd.exe", ["/d", "/c", "npm ci --no-audit --no-fund"]]
    : ["npm", ["ci", "--no-audit", "--no-fund"]];

function npmOutput(root, env, command) {
    try {
        return execFileSync(process.platform === "win32" ? "cmd.exe" : "npm",
            process.platform === "win32" ? ["/d", "/c", `npm ${command}`] : command.split(" "),
            { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
    }
    catch { throw new Error("无法读取 npm 安装配置或版本，停止启动（未输出配置内容）"); }
}

export function dependencyFingerprint(root, env) {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    // UI/start script edits do not change npm ci. Include all other package
    // metadata conservatively, plus the lifecycle scripts npm ci can execute.
    const { scripts = {}, ...metadata } = pkg;
    const lifecycle = Object.fromEntries(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"]
        .filter(key => key in scripts).map(key => [key, scripts[key]]));
    const files = {};
    const include = relative => {
        const absolute = path.resolve(root, relative);
        if (!absolute.startsWith(root + path.sep)) throw new Error("安装脚本输入超出当前 worktree");
        const key = path.relative(root, absolute).replaceAll(path.sep, "/");
        if (key in files) return;
        const source = readFileSync(absolute, "utf8");
        files[key] = hash(source);
        // Follow repository-local ESM dependencies of lifecycle entrypoints.
        for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/g))
            include(path.relative(root, path.resolve(path.dirname(absolute), match[1])));
    };
    for (const script of Object.values(lifecycle)) {
        for (const match of script.matchAll(/\bnode\s+["']?([^\s"']+\.(?:mjs|cjs|js))\b/g)) include(match[1]);
    }
    // Hash effective config privately: includes project/user/global npmrc and
    // tree-shaping settings (omit/include, peer deps, install strategy, scripts).
    // Neither config values nor registry credentials are persisted or printed.
    const config = JSON.parse(npmOutput(root, env, "config list --json"));
    const npmrcFiles = Object.fromEntries(["userconfig", "globalconfig"].map(key => [key,
        typeof config[key] === "string" && existsSync(config[key]) ? hash(readFileSync(config[key])) : null]));
    return hash(canonical({ version: 1, metadata, lifecycle, files,
        lock: hash(readFileSync(path.join(root, "package-lock.json"))),
        shrinkwrap: existsSync(path.join(root, "npm-shrinkwrap.json")) ? hash(readFileSync(path.join(root, "npm-shrinkwrap.json"))) : null,
        npmrc: existsSync(path.join(root, ".npmrc")) ? hash(readFileSync(path.join(root, ".npmrc"))) : null,
        config, npmrcFiles, node: process.version, abi: process.versions.modules, npm: npmOutput(root, env, "--version"), platform: process.platform, arch: process.arch }));
}

const marker = root => path.join(root, "node_modules/.teruisi-preview-dependencies.json");
function installedLock(root) { return hash(readFileSync(path.join(root, "node_modules/.package-lock.json"))); }
export function dependenciesCurrent(root, fingerprint) {
    try {
        const saved = JSON.parse(readFileSync(marker(root), "utf8"));
        return saved.version === 1 && saved.fingerprint === fingerprint && saved.installedLock === installedLock(root)
            && ["vite", "vinext", "@cloudflare/vite-plugin"].every(name => existsSync(path.join(root, "node_modules", name, "package.json")));
    }
    catch { return false; }
}
export async function synchronizeDependencies(root, env, run, before = dependencyFingerprint(root, env)) {
    if (dependenciesCurrent(root, before)) return before;
    // Invalidate before npm starts, including failed or interrupted installs.
    rmSync(marker(root), { force: true });
    console.log("正在同步此 worktree 的前端依赖（npm ci，保留生命周期脚本）…");
    await run(...npmCommand, env);
    if (dependencyFingerprint(root, env) !== before)
        throw new Error("安装期间依赖输入发生变化；未记录成功标记，请重新启动同步");
    writeFileSync(marker(root), JSON.stringify({ version: 1, fingerprint: before, installedLock: installedLock(root) }) + "\n", { mode: 0o600 });
    return before;
}
