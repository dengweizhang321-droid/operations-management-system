// No browser/server/network. Executes actual exported functions and callbacks.
// Run: node --import tsx docs/performance-experience-audit-20261008/tools/frontend-function-probe.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';
import { deriveGlobalSearchPresentation } from '../../../app/global-search-dialog.tsx';
import { confirmFilterText } from '../../../app/ui/filter-draft.tsx';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const result = { kind: 'actual callback/function execution with mocked hook storage; not a rendered Home/browser test', cases: [] };
const source = await readFile(path.join(root, 'app/ui/searchable-select.tsx'), 'utf8');
const compiled = await transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', sourcefile: 'app/ui/searchable-select.tsx' });
const actualReact = require('react');
let states = [], cursor = 0;
const hookMock = { ...actualReact,
  useState: value => { const index = cursor++; if (states[index] === undefined) states[index] = value; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
  useRef: value => ({ current: value }), useEffect: () => undefined,
};
const probeModule = { exports: {} };
vm.runInNewContext(compiled.code, { module: probeModule, exports: probeModule.exports, require: name => name === 'react' ? hookMock : require(name) }, { filename: 'actual-searchable-select.cjs' });
function findInput(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'input') return node;
  const children = Array.isArray(node.props?.children) ? node.props.children.flat(Infinity) : [node.props?.children];
  for (const child of children) { const found = findInput(child); if (found) return found; }
  return null;
}
for (const nativeEvent of [{ isComposing: true, keyCode: 229 }, { isComposing: false, keyCode: 229 }, { isComposing: false, keyCode: 13 }]) {
  cursor = 0; states = [true, '待确认']; let selected = null, prevented = false;
  const element = probeModule.exports.SearchableSelect({ value: '', onChange: value => { selected = value; }, options: [{ value: '', label: '当前有效计划' }, { value: 'draft', label: '待确认' }], ariaLabel: '备货计划状态' });
  const input = findInput(element);
  if (!input?.props.onKeyDown) throw new Error('Actual search input callback was not found');
  input.props.onKeyDown({ key: 'Enter', nativeEvent, preventDefault: () => { prevented = true; } });
  let protectedTextConfirmed = false;
  confirmFilterText({ key: 'Enter', shiftKey: false, repeat: false, nativeEvent, preventDefault() {} }, { composing: nativeEvent.isComposing, onConfirm: () => { protectedTextConfirmed = true; } });
  result.cases.push({ name: 'single-select-actual-key-handler', nativeEvent, selected, openAfter: states[0], prevented, existingProtectedTextConfirmed: protectedTextConfirmed });
}
result.cases.push({ name: 'search-result-scope-presentation', enteredQuery: '审查B', resultQuery: '审查A', presentation: deriveGlobalSearchPresentation('审查B', true, '', { query: '审查A', returned: 0, truncated: false, groups: [], unavailableDomains: [] }), note: 'Actual search result buttons separately set disabled={loading}; not a click-through reproduction.' });

// Extract the precise current Home selectRange callback with the TS parser.
const homeSource = await readFile(path.join(root, 'app/page.tsx'), 'utf8');
const ast = ts.createSourceFile('app/page.tsx', homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let rangeCallback, cancelCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectRange') rangeCallback = node.initializer?.getText(ast);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'StatisticalPeriodPicker') {
    const cancel = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'onCancel');
    if (cancel?.initializer && ts.isJsxExpression(cancel.initializer)) cancelCallback = cancel.initializer.expression?.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!rangeCallback || !cancelCallback) throw new Error('Actual Home callbacks were not found');
const state = { range: '本月', customStartDate: '2026-09-09', customEndDate: '2026-10-08', pickerOpen: false, urlPeriod: 'current_month' };
const sandbox = { range: state.range, customStartDate: state.customStartDate, customEndDate: state.customEndDate, customMaxDate: '2026-10-08', customMinDate: '2025-01-01',
  setRange: value => { state.range = value; }, setCustomStartDate: value => { state.customStartDate = value; }, setCustomEndDate: value => { state.customEndDate = value; }, setStatPeriodPickerOpen: value => { state.pickerOpen = value; }, replacePeriodUrl: value => { state.urlPeriod = value; } };
const callbacks = await transform(`globalThis.selectRange = ${rangeCallback}; globalThis.cancel = ${cancelCallback};`, { loader: 'tsx', format: 'cjs' });
vm.createContext(sandbox); vm.runInContext(callbacks.code, sandbox);
const before = { ...state }; sandbox.selectRange('自定义'); const beforeConfirm = { ...state }; sandbox.cancel();
result.cases.push({ name: 'actual-home-date-handlers', before, beforeConfirm, afterCancel: { ...state }, note: 'Mocks only setters; exact current callbacks executed, no React scheduling or browser network assertion.' });
const output = path.resolve(process.env.AUDIT_OUTPUT || '.runtime/frontend-function-audit');
await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, ...result }, null, 2));
