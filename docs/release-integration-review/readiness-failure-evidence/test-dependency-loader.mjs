// Test-only resolve anchor; read existing development dependencies without moving,
// installing, linking or changing any production or workspace dependency files.
import {pathToFileURL} from 'node:url';
const workspace=pathToFileURL('D:/.codex/worktrees/release-ab-ui-acceptance/运营管理系统/').href;
const anchor=pathToFileURL('D:/.codex/worktrees/release-integration-review/运营管理系统/test-resolve-anchor.mjs').href;
export function resolve(specifier,context,nextResolve){
  const bare=!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.startsWith('node:')&&!specifier.startsWith('file:')&&!specifier.startsWith('#')&&!/^[A-Za-z]:/.test(specifier);
  return nextResolve(specifier,bare&&context.parentURL?.startsWith(workspace)?{...context,parentURL:anchor}:context);
}
