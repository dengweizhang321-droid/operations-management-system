import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export const policyVersion = 'teruisi-release-impact-v2';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function requireHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error(`Invalid ${label} digest`);
  return value;
}
export async function safeRead(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Redirected evidence/source path');
  }
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 16n * 1024n * 1024n) throw new Error('Unsafe evidence/source file');
  if (path.resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error('Redirected file');
  const raw = await readFile(absolute);
  const after = await lstat(absolute, { bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(k => before[k] !== after[k])) throw new Error('File changed while reading');
  return raw;
}

export async function safeFileDigest(target) {
  const absolute = path.resolve(target);
  // safeRead's directory and leaf checks, without materializing an executable.
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Redirected executable path');
  }
  const before = await lstat(absolute, { bigint: true });
  // Windows Resource Protection legitimately hard-links this exact OS host
  // into WinSxS. It is still pinned by its full byte digest and exact path;
  // ordinary script/tool links remain forbidden.
  const systemPowerShell = absolute.toLowerCase() === path.resolve('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe').toLowerCase();
  if (!before.isFile() || (before.nlink !== 1n && !systemPowerShell)) throw new Error('Unsafe executable');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) digest.update(chunk);
  const after = await lstat(absolute, { bigint: true });
  if (['dev','ino','size','mtimeNs','ctimeNs','nlink'].some(k => before[k] !== after[k])) throw new Error('Executable changed while hashing');
  return digest.digest('hex');
}

// This proof is deliberately narrow: all executable tokens, imports, JSX
// structure and event attributes must remain identical. Text and literal
// className values still require an independently reviewed impact witness.
export function displaySkeleton(source, name = 'view.tsx') {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error('Unparseable display source');
  const spans = [];
  const localSetters = new Map();
  // Only a literal primitive React state in a network-free client component.
  // No custom imports, components, effect changes, arbitrary handler calls or
  // request/filter/permission ownership logic is covered by this extension.
  let localOnly = file.statements.some(s => ts.isExpressionStatement(s) && /^["']use client["']$/.test(s.expression.getText(file)))
    && !sensitive.test(source.replace(/\bfunction\s+(?=[A-Za-z_$])/g,'')) && !/\b(?:useEffect|useLayoutEffect|useRef|useReducer|useContext)\b/.test(source)
    && file.statements.filter(ts.isImportDeclaration).every(s => s.moduleSpecifier.text === 'react');
  if (localOnly) {
    function states(node) {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements.length === 2
        && node.name.elements.every(e => ts.isBindingElement(e) && ts.isIdentifier(e.name))
        && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'useState'
        && node.initializer.arguments.length === 1 && /^(true|false)$/.test(node.initializer.arguments[0].getText(file))) {
        localSetters.set(node.name.elements[1].name.text, node.name.elements[0].name.text);
      }
      ts.forEachChild(node, states);
    }
    states(file);
    const functions = file.statements.filter(ts.isFunctionDeclaration);
    const imports = file.statements.filter(ts.isImportDeclaration);
    const component = functions[0];
    localOnly = functions.length === 1 && localSetters.size === 1 && component.parameters.length === 0
      && !component.asteriskToken && !component.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
      && component.body?.statements.length === 2 && ts.isVariableStatement(component.body.statements[0])
      && component.body.statements[0].declarationList.declarations.length === 1 && ts.isReturnStatement(component.body.statements[1])
      && imports.length === 1 && imports[0].importClause?.namedBindings && ts.isNamedImports(imports[0].importClause.namedBindings)
      && imports[0].importClause.namedBindings.elements.length === 1
      && imports[0].importClause.namedBindings.elements[0].name.text === 'useState'
      && !imports[0].importClause.namedBindings.elements[0].propertyName
      && file.statements.length === 3;
    function calls(node) {
      if (ts.isCallExpression(node) && !['useState',...localSetters.keys()].includes(node.expression.getText(file))) localOnly = false;
      ts.forEachChild(node, calls);
    }
    calls(file);
    let returned=component?.body?.statements[1]?.expression;
    while(returned&&ts.isParenthesizedExpression(returned))returned=returned.expression;
    localOnly=localOnly&&!!returned&&(ts.isJsxElement(returned)||ts.isJsxFragment(returned)||ts.isJsxSelfClosingElement(returned));
  }
  function toggleShape(node) {
    const arrow = node.initializer?.expression;
    if (!arrow || !ts.isArrowFunction(arrow) || arrow.parameters.length || arrow.modifiers?.length
      || !ts.isCallExpression(arrow.body) || !ts.isIdentifier(arrow.body.expression) || arrow.body.arguments.length !== 1) return false;
    const setter = arrow.body.expression.text, state = localSetters.get(setter);
    if (!state || !['true', 'false', `!${state}`].includes(arrow.body.arguments[0].getText(file))) return false;
    const attributes = node.parent;
    const element = attributes.parent;
    if (!ts.isJsxOpeningElement(element) || element.tagName.getText(file) !== 'button'
      || !attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(file) === 'type' && p.initializer?.text === 'button')) return false;
    return true;
  }
  function localToggle(node) {
    if(!toggleShape(node))return false;
    const setter=node.initializer.expression.body.expression.text,state=localSetters.get(setter);
    // State cannot control resource loading, form actions or enabled writes.
    // Only passive content, aria-expanded and the proved button toggle.
    let safe = true;
    function passive(expression) {
      if(ts.isJsxElement(expression)||ts.isJsxSelfClosingElement(expression)||ts.isJsxFragment(expression))return true;
      if(ts.isIdentifier(expression))return expression.text===state;
      if(ts.isStringLiteral(expression)||ts.isNumericLiteral(expression)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(expression.kind))return true;
      if(ts.isBinaryExpression(expression))return expression.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken
        && ts.isIdentifier(expression.left)&&expression.left.text===state&&passive(expression.right);
      if(ts.isConditionalExpression(expression))return ts.isIdentifier(expression.condition)&&expression.condition.text===state
        && passive(expression.whenTrue)&&passive(expression.whenFalse);
      return false;
    }
    function usage(n) {
      if(ts.isJsxExpression(n)) {
        if(!n.expression)safe=false;
        else if(ts.isJsxAttribute(n.parent)) {
          if(n.parent.name.getText(file)==='onClick'){if(!toggleShape(n.parent))safe=false;}
          else if(n.parent.name.getText(file)!=='aria-expanded'||n.expression.getText(file)!==state)safe=false;
        } else if(!passive(n.expression))safe=false;
      }
      if (ts.isIdentifier(n) && [state,setter].includes(n.text) && !ts.isBindingElement(n.parent)) {
        let parent = n.parent;
        while (parent && !ts.isJsxExpression(parent) && !ts.isJsxAttribute(parent)) parent = parent.parent;
        if (!parent || !ts.isJsxExpression(parent)) safe = false;
        else if(ts.isJsxAttribute(parent.parent)) {
          const attribute=parent.parent;
          if(attribute.name.getText(file)==='onClick') { if(!toggleShape(attribute))safe=false; }
          else if(attribute.name.getText(file)!=='aria-expanded'||parent.expression?.getText(file)!==state)safe=false;
        }
        if (n.text === setter && (!ts.isCallExpression(n.parent) || n.parent.expression !== n)) safe = false;
      }
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag=n.tagName.getText(file);
        if (!['div','span','p','button','section','article','ul','ol','li','strong','em','small','h2','h3'].includes(tag)) safe = false;
        if(tag==='button'&&!n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='type'&&p.initializer?.text==='button'))safe=false;
        if(n.attributes.properties.some(ts.isJsxSpreadAttribute))safe=false;
        for(const attribute of n.attributes.properties) {
          if(!ts.isJsxAttribute(attribute)||!['type','className','title','role','aria-expanded','aria-label','onClick'].includes(attribute.name.getText(file)))safe=false;
          else if(!['onClick','aria-expanded'].includes(attribute.name.getText(file))&&!ts.isStringLiteral(attribute.initializer??file))safe=false;
        }
      }
      ts.forEachChild(n, usage);
    }
    usage(file);
    return safe;
  }
  function visit(node) {
    if (ts.isJsxText(node)) spans.push([node.pos, node.end, '<display-text>']);
    else if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className'
      && node.initializer && ts.isStringLiteral(node.initializer)
      && /^[a-z0-9_\s:-]*$/i.test(node.initializer.text) && !/url|content-|font-face/i.test(node.initializer.text)) {
      spans.push([node.initializer.getStart(file), node.initializer.end, '"<display-class>"']);
    } else if (localOnly && ts.isJsxAttribute(node) && node.name.getText(file) === 'onClick' && localToggle(node)) {
      spans.push([node.initializer.getStart(file), node.initializer.end, '{<local-boolean-toggle>}']);
    } else ts.forEachChild(node, visit);
  }
  visit(file);
  let result = source;
  for (const [start, end, token] of spans.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + token + result.slice(end);
  return result;
}

const strictPath = /(^|\/)(migrations?|models?|auth[^/]*|access_control|import[^/]*|automation[^/]*)(\/|\.)|^(tools|config|worker|build|drizzle|\.openai|app\/api)\/|\.sql$|(^|\/)(package(-lock)?\.json|[^/]*config\.[^/]+|\.env[^/]*|\.npmrc|\.dev\.vars|route\.[^/]+)/i;
const sensitive = /permission|principal|authoriz|scopePolicy|fetch|XMLHttpRequest|sendBeacon|mutat|importData|localStorage|sessionStorage|cookie|eval|Function|\b(PUT|POST|PATCH|DELETE|INSERT|UPDATE|ALTER|DROP|GRANT|REVOKE|CREATE|TRUNCATE)\b/i;

// Same selectors, properties and rule structure; only values of explicitly
// presentation properties may differ. External resources, custom properties,
// content, visibility, pointer-events and executable CSS remain byte-bound.
export function cssDisplaySkeleton(source) {
  const properties = new Set(('color background-color border-color border-top-color border-right-color border-bottom-color border-left-color '
    + 'font-size font-weight line-height letter-spacing text-align border-radius margin margin-top margin-right margin-bottom margin-left '
    + 'padding padding-top padding-right padding-bottom padding-left gap row-gap column-gap width min-width max-width height min-height max-height').split(' '));
  return source.replace(/([{;]\s*)([a-z-]+)(\s*:\s*)([^;{}]+)(?=[;}])/gi, (whole, prefix, prop, colon, value) => {
    if (!properties.has(prop.toLowerCase()) || /[\\@"']|url|expression|behavior|javascript|!important|\/\*/i.test(value)
      || !/^[a-z0-9#%.,()\s+*-]+$/i.test(value)) return whole;
    // var() cannot redirect resource loading through a changed URL; this list
    // contains no image/resource properties and all variable definitions bind.
    return `${prefix}${prop}${colon}<presentation-value>`;
  });
}

function validPng(value) {
  if (!value.startsWith('\u0000binary:')) return false;
  const raw = Buffer.from(value.slice(8), 'base64');
  if (raw.length > 4 * 1024 * 1024 || !raw.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return false;
  let offset = 8, image = false, header = false,width=0,height=0,pixelBytes=0;
  const compressed=[];
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  while (offset + 12 <= raw.length) {
    const length = raw.readUInt32BE(offset), kind = raw.toString('ascii',offset+4,offset+8);
    if (length > raw.length-offset-12 || !['IHDR','IDAT','IEND'].includes(kind)
      || crc32(raw.subarray(offset+4,offset+8+length))!==raw.readUInt32BE(offset+8+length)) return false;
    if (!header) {
      if (kind !== 'IHDR' || length !== 13 || !raw.readUInt32BE(offset+8) || !raw.readUInt32BE(offset+12)
        || raw.readUInt32BE(offset+8)>2048 || raw.readUInt32BE(offset+12)>2048) return false;
      width=raw.readUInt32BE(offset+8);height=raw.readUInt32BE(offset+12);
      pixelBytes=({0:1,2:3,4:2,6:4})[raw[offset+17]];
      if(raw[offset+16]!==8||!pixelBytes||raw[offset+18]!==0||raw[offset+19]!==0||raw[offset+20]!==0)return false;
      header = true;
    } else if (kind === 'IHDR') return false;
    if (kind === 'IDAT') { image = true;compressed.push(raw.subarray(offset+8,offset+8+length)); }
    offset += length+12;
    if (kind === 'IEND') {
      if(length!==0||!image||offset!==raw.length)return false;
      try {
        const pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:16*1024*1024});
        const stride=width*pixelBytes+1;
        return pixels.length===height*stride&&Array.from({length:height},(_,i)=>pixels[i*stride]).every(filter=>filter<=4);
      } catch {return false;}
    }
  }
  return false;
}
export function sourceTreeDigest(files) {
  const digest = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    if (path.posix.isAbsolute(name) || name.split('/').some(p => p === '..' || p === '.') || name.includes('\\')) throw new Error('Unsafe source inventory path');
    const raw = files[name].startsWith('\u0000binary:') ? Buffer.from(files[name].slice(8), 'base64') : Buffer.from(files[name]);
    const label = Buffer.from(name);
    const labelSize = Buffer.alloc(4); labelSize.writeUInt32BE(label.length);
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(raw.length));
    digest.update(labelSize).update(label).update(size).update(raw);
  }
  return digest.digest('hex');
}
export function sourceInventory(files) {
  return Object.fromEntries(Object.entries(files).map(([k,v]) => [k,hash(v.startsWith('\u0000binary:') ? Buffer.from(v.slice(8),'base64') : v)]));
}
// Missing filenames must not resolve to inherited Object properties, including
// after a JSON proof roundtrip has restored an ordinary object prototype.
const sourceEntry = (files, name) => Object.hasOwn(files, name) ? files[name] : undefined;
export function classifyImpact({ before, after, witness, inventory = { before:sourceInventory(before), after:sourceInventory(after) } }) {
  const changed = [...new Set([...Object.keys(inventory.before), ...Object.keys(inventory.after)])].sort().filter(k => sourceEntry(inventory.before,k) !== sourceEntry(inventory.after,k));
  const deltaSha256 = hash(changed.map(name => ({ name, before: sourceEntry(inventory.before,name) ?? null, after: sourceEntry(inventory.after,name) ?? null })));
  const closureSha256 = hash(inventory);
  const bound = witness?.deltaSha256 === deltaSha256 && witness?.closureSha256 === closureSha256
    && witness?.independent === true && witness?.status === 'passed' && typeof witness?.reviewer === 'string' && witness.reviewer.length > 0
    && ['data', 'permissions', 'writes', 'imports', 'automation', 'lifecycle', 'backup', 'dependencyBehavior'].every(k => witness.effects?.[k] === false);
  let level = 'strict';
  const reasons = [];
  if (!changed.length) reasons.push('Empty release');
  if (!bound) reasons.push('Missing or stale independent dependency/behavior witness');
  if (changed.some(k => strictPath.test(k))) reasons.push('Protected lifecycle/data/dependency surface');
  let display = changed.length > 0;
  for (const name of changed) {
    if (name.startsWith('docs/') || name === 'README.md') continue;
    const beforeEntry=sourceEntry(before,name),afterEntry=sourceEntry(after,name);
    if (beforeEntry == null || afterEntry == null || strictPath.test(name)) { display = false; continue; }
    try {
      if (name.endsWith('.css')) {
        if (cssDisplaySkeleton(beforeEntry) !== cssDisplaySkeleton(afterEntry)) display = false;
      } else if (/^public\/.+\.png$/.test(name)) {
        if (!validPng(beforeEntry) || !validPng(afterEntry)) display = false;
      } else if (name.endsWith('.tsx')) {
        if (!/^\s*["']use client["'];/.test(beforeEntry) || !/^\s*["']use client["'];/.test(afterEntry)
          || /["']use server["']|next\/server/.test(beforeEntry+afterEntry)
          || displaySkeleton(beforeEntry, name) !== displaySkeleton(afterEntry, name)) display = false;
      } else display = false;
    } catch { display = false; }
  }
  if (bound && changed.length && !changed.some(k => strictPath.test(k))) {
    if (display && witness.kind === 'display') level = 'display';
    // A non-display business change never qualifies for backup reuse. Unknown
    // dependencies, protected surfaces or changed sensitive behavior stay strict.
    else if (witness.kind === 'business' && changed.every(k => !sensitive.test(`${sourceEntry(before,k) ?? ''}\n${sourceEntry(after,k) ?? ''}`))) level = 'business';
  }
  if (level === 'strict' && !reasons.length) reasons.push('Executable or unproven impact');
  return { version: policyVersion, level, changed, deltaSha256, closureSha256, witnessSha256: witness ? hash(witness) : null, reasons };
}

export function makeImpactProof(before, after, witness) {
  const inventory = { before:sourceInventory(before), after:sourceInventory(after) };
  const changed = classifyImpact({ before, after, witness, inventory }).changed;
  return { inventory, witness: witness ?? null,
    before:Object.fromEntries(changed.filter(k => sourceEntry(before,k) != null).map(k => [k,sourceEntry(before,k)])),
    after:Object.fromEntries(changed.filter(k => sourceEntry(after,k) != null).map(k => [k,sourceEntry(after,k)])) };
}
export function verifyImpactProof(proof, binding) {
  if (!proof?.inventory?.before || !proof?.inventory?.after) throw new Error('Missing full impact inventories');
  for (const files of Object.values(proof.inventory)) for (const [name,digest] of Object.entries(files)) {
    requireHash(digest,'source inventory');
    if (path.posix.isAbsolute(name) || name.split('/').some(p => ['..','.'].includes(p)) || name.includes('\\')) throw new Error('Unsafe impact path');
  }
  if (hash(proof.inventory.after) !== binding.sourceInventorySha256 || hash(proof.inventory.before) !== binding.predecessorInventorySha256) throw new Error('Incomplete or changed impact closure');
  const changed = [...new Set([...Object.keys(proof.inventory.before),...Object.keys(proof.inventory.after)])].filter(k => sourceEntry(proof.inventory.before,k) !== sourceEntry(proof.inventory.after,k));
  for (const side of ['before','after']) {
    const actual = sourceInventory(proof[side]);
    for (const name of changed) if ((sourceEntry(actual,name) ?? null) !== (sourceEntry(proof.inventory[side],name) ?? null)) throw new Error('Impact delta bytes changed');
    if (Object.keys(actual).some(k => !changed.includes(k))) throw new Error('Extra impact delta');
  }
  return classifyImpact({ ...proof, inventory:proof.inventory });
}

export const requirements = Object.freeze({
  display: { tests: ['impact', 'ui', 'boundary', 'build', 'permissions-regression'], backup: 'reusable-or-full', switch: 'worker-only', rollback: 'compatible-application', acceptance: ['resources', 'behavior', 'permissions', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
  business: { tests: ['domain', 'contract', 'negative', 'permissions', 'boundary', 'build'], backup: 'full-pre-and-post', switch: 'prepared-app-keep-postgres', rollback: 'compatible-application-or-approved-data-restore', acceptance: ['resources', 'business-deep-equivalence', 'permissions', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
  strict: { tests: ['domain', 'contract', 'negative', 'concurrency', 'permissions', 'migration-rehearsal', 'lifecycle', 'backup-recovery', 'boundary', 'build'], backup: 'full-pre-and-post', switch: 'reviewed-maintenance-scope', rollback: 'reviewed-forward-or-approved-data-restore', acceptance: ['resources', 'business', 'permissions', 'migrations', 'writes', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
});

// Freshness limits are policy constants, never caller-controlled flags.
export const backupMaxAgeMs = 26 * 60 * 60 * 1000;
export const rehearsalMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export function backupReuseDecision({ impact, evidence, current, now = Date.now() }) {
  const reasons = [];
  const fresh = (stamp, budget) => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) && now - Date.parse(stamp) >= 0 && now - Date.parse(stamp) <= budget;
  if (impact?.level !== 'display') reasons.push('impact');
  if (evidence?.version !== 'teruisi-release-recovery-evidence-v1') reasons.push('version');
  if (current?.schedule?.active !== true || current?.schedule?.lastResult !== 'success'
    || !fresh(current?.schedule?.lastSuccessAt, backupMaxAgeMs)) reasons.push('daily-backup-not-continuous');
  if (!fresh(evidence?.backupCompletedAt, backupMaxAgeMs)) reasons.push('backup-expired');
  if (!fresh(evidence?.restoredAt, rehearsalMaxAgeMs)) reasons.push('restore-expired');
  if (evidence?.restoreStatus !== 'passed' || evidence?.cleanupStatus !== 'passed'
    || evidence?.contentEqual !== true || evidence?.rolesEqual !== true || evidence?.permissionsEqual !== true
    || evidence?.migrationsEqual !== true || evidence?.sequencesValid !== true) reasons.push('incomplete-restore');
  if (current?.pointExists !== true || current?.verifyStatus !== 'passed' || current?.retained !== true) reasons.push('point-unavailable');
  if (current?.sequencesValid !== true || current?.softwareCompatible !== true) reasons.push('current-environment-invalid');
  for (const field of ['manifestSha256', 'dumpSha256', 'environmentSha256', 'schemaSha256', 'rolesSha256', 'operatorSha256', 'retentionSha256', 'scheduleSha256']) {
    if (!/^[a-f0-9]{64}$/.test(evidence?.[field] ?? '') || evidence[field] !== current?.[field]) reasons.push(`changed-${field}`);
  }
  if (typeof evidence?.backupId !== 'string' || evidence.backupId !== current?.backupId) reasons.push('point-identity');
  return { mode: reasons.length ? 'full' : 'reuse', reasons, evidenceSha256: evidence ? hash(evidence) : null };
}

export async function readSourceTree(root) {
  // Source filenames are data. A root file named __proto__ must be an own
  // inventory entry rather than invoking Object.prototype's legacy setter.
  const files = Object.create(null);
  const names=[];
  const decode = raw => {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
    catch { return `\u0000binary:${raw.toString('base64')}`; }
  };
  let gitTree=true;
  try { await lstat(path.join(root,'.git')); }
  catch(error) { if(error.code==='ENOENT')gitTree=false;else throw error; }
  if(gitTree) {
    const { listGitSourceFiles } = await import('./worker-local-release.mjs');
    names.push(...await listGitSourceFiles(root));
    await readNames();return files;
  }
  async function walk(dir, prefix = '') {
    if ((await lstat(dir)).isSymbolicLink()) throw new Error('Redirected source tree');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (['.git', 'node_modules', 'dist', '.venv', '__pycache__', '.runtime', '.wrangler', '.vite-sites-cache', '.next', 'tmp', 'outputs', 'work', '.codex-tmp'].includes(entry.name)) continue;
      if ((entry.name.startsWith('.env') && !/\.(example|sample)$/.test(entry.name)) || entry.name === '.dev.vars' || entry.name.endsWith('.pyc')) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target, `${relative}/`);
      else {
        names.push(relative);
      }
    }
  }
  async function readNames() {
    // Preserve every safeRead check and every byte. Bound independent IO,
    // await even failed peers, and keep the existing sorted digest protocol.
    for(let start=0;start<names.length;start+=8) {
      const results=await Promise.allSettled(names.slice(start,start+8).map(async name=>{
        files[name]=decode(await safeRead(path.join(root,...name.split('/'))));
      }));
      const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    }
  }
  await walk(path.resolve(root));
  await readNames();
  return files;
}
