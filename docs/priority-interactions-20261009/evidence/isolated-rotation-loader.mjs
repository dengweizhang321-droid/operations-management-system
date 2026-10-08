// Test-only isolation: keep the actual mutex implementation, change its pipe namespace.
// This loader is never used by production runners.
import { readFile } from 'node:fs/promises';
export async function load(url, context, nextLoad) {
  if (!new URL(url).pathname.endsWith('/tools/worker-local-release-rotation.mjs')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const original = 'TERUISI.Worker.ReleaseRotation.v1';
  const declarations = source.match(/(?:const|let|var) rotationLockPipe\s*=\s*"[^"]*TERUISI\.Worker\.ReleaseRotation\.v1";?/g);
  if (declarations?.length !== 1) throw new Error('Unexpected original rotation pipe declaration');
  return { format: 'module', shortCircuit: true, source: source.replace(declarations[0], declarations[0].replace(original, 'TERUISI.PriorityInteraction.TestOnly.20261009')) };
}
