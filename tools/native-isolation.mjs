import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Explicit opt-in only. This describes a private installation, never readiness.
export function readNativeIsolation(env = process.env) {
  const file = env.TERUISI_NATIVE_ISOLATION_FILE;
  const digest = env.TERUISI_NATIVE_ISOLATION_SHA256;
  if (!file && !digest) {
    if (/\/native-control-[^/]+\//i.test(import.meta.url)) throw new Error('Private installation requires explicit isolation binding');
    return null;
  }
  if (!file || !/^[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Incomplete native isolation binding');
  const absolute = path.win32.resolve(file);
  for (let current = absolute; ; current = path.win32.dirname(current)) {
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error('Isolation binding may not traverse a link');
    if (current === path.win32.dirname(current)) break;
  }
  const bytes = readFileSync(absolute);
  if (bytes.length > 4096 || createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Isolation binding changed');
  const config = JSON.parse(bytes.toString('utf8'));
  if (Object.keys(config).sort().join(',') !== 'id,root,sourceRoot,version,wslDistribution' || config.version !== 1
      || !/^[a-z0-9-]{8,64}$/.test(config.id) || config.wslDistribution !== 'Codex-AI-Batch2-20261108') throw new Error('Invalid native isolation profile');
  const root = `D:\\codex-isolated\\native-control-${config.id}`;
  if (config.root !== root || absolute.toLowerCase() !== path.win32.join(root, 'isolation.json').toLowerCase()
      || typeof config.sourceRoot !== 'string' || !/^D:\\\.codex\\worktrees\\[a-z0-9]+\\[^\\]+$/.test(config.sourceRoot)) throw new Error('Isolation roots are not private');
  return Object.freeze({ ...config, sha256: digest });
}

export const nativeIsolation = readNativeIsolation();
const ports = new Set([3000, 5791, 5432, 8001, 8002, 8011, 8012, 8021, 8022, 8031, 8032, 8041, 8042, 8051, 8052, 8061, 8062, 8071, 8072, 8081, 8091, 8092, 8101, 8102, 8111, 8112, 8121, 8123]);
export function nativePort(port) {
  if (!ports.has(port)) throw new Error('Unknown native service port');
  return nativeIsolation ? port + 20000 : port;
}
export function nativePath(child, fallback) {
  return nativeIsolation ? path.win32.join(nativeIsolation.root, child) : fallback;
}
