// 结构迁移「代际」枚举一致性绊线。
//
// 每加一代结构迁移（addition），同一份代际信息要手抄到多个文件；漏抄一处，
// 发布会在某道闸上被拒，往往到上线当口才暴露。把枚举合并成单一来源是另一项
// 工作（会改动受资格化约束的控制器字节）。本测试只做便宜的那一半：只读源码文本，
// 各处枚举不一致时在合并前就红。不改 tools/、config/、backend/ 任何文件。
//
// 设计要点（防空转）：
// - 每个 extract* 函数提取为空直接抛错；各集合的数量另有不低于实测值的下限断言，
//   提取器失效不会让「子集」恒真。
// - 每个 check* 是「快照进、违规列表出」的纯函数；文件末尾对每条关系都有反向用例：
//   把真实文本删掉/改坏一项，断言恰好报出那一项。
// - 违规信息写明：哪个名称、缺在哪个文件、该去补什么。
//
// 本文件的正则刻意不用反斜杠（用字符类与 fromCharCode 代替），避免经过 heredoc/JSON
// 转义时被吃掉；Windows 路径先统一成正斜杠再匹配。
//
// 设置 ENUM_TRIPWIRE_REPORT=1 运行可打印每个抄写位置的实测集合（测量表）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as release from '../tools/main-schema-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BS = String.fromCharCode(92);
const Q = String.fromCharCode(34);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BOM = String.fromCharCode(0xfeff);

// 实测下限（a264880f）。再加代际只会变大；变小或为空说明提取器失效，必须失败。
const MIN = {
  specs: 11,
  kinds: 10,
  recipeFiles: 11,
  biLists: 5,
  biPairs: 14,
  biAppNames: 14,
  gateVerifyPairs: 15,
  gateDbPairs: 15,
  localPairs: 15,
  backupInstalled: 10,
  backupReturnPairs: 14, // 实测：return 链 15 项，末项是无条件兜底，其余 14 项都是「N if x_installed」配对
  // 146、147 两代永远是 `==`（它们不是 finite[] 终止代数）；最新代可写成 == 也可写成元组，所以不把它计入下限。
  backupEquals: 2,
  localChain: 15,
  localMarkers: 15,
  localCopy: 140,
  gateVerify: 15,
  gateVerifyMarkers: 15,
  gateDb: 15,
  gateDbMarkers: 15,
  digestEntries: 10,
  backupGenerations: 13,
  backupCatalogs: 14,
  publishList: 6,
};

// 关系 6（Pi 运行账本权限清单）的显式例外表：kind -> 原因与证据位置（必须是非空文字）。
// 当前为空：没有已知的合法例外。只有读懂 aiRolesChanged 与 ProvisionRoles 后确认
// 某代 ai_assistant 迁移确实不需要重算授权，才允许在这里登记，并写清证据。
// 例外必须对应一个迁移在 backend/ai_assistant/migrations/ 的代际，且该代际确实不在名单里；
// 否则（名单已补上、不是 ai_assistant 代际、已无此规格）checkProvisionList 报错要求删除。
export const PROVISION_LIST_EXCEPTIONS = {};

function normalize(text) {
  const plain = text.startsWith(BOM) ? text.slice(1) : text;
  return plain.split(CR).join('');
}
function readRepo(rel) {
  return normalize(fs.readFileSync(path.join(root, rel), 'utf8'));
}
function slashes(text) {
  return text.split(BS).join('/');
}
function lineOf(text, index) {
  return text.slice(0, index).split(NL).length;
}
function region(text, start, label) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, label + ': 找不到起点 ' + start + '（文件被改动或提取失效）');
  const ends = [text.indexOf(NL + 'def ', from + 1), text.indexOf(NL + 'function ', from + 1)].filter((i) => i >= 0);
  return text.slice(from, ends.length ? Math.min(...ends) : text.length);
}
// 提取器内只硬断言「非空」；与实测下限的比较记入 floorLog，由「提取数量下限」那条测试统一断言。
// 这样真实文本里少了一项时，先看到带名称的具体违规，而不是一条笼统的数量错误。
const floorLog = [];
function atLeast(label, size, min) {
  assert.ok(size >= 1, label + ': 提取为空（提取器失效或文件被大改，请先修提取器，不要放宽断言）');
  floorLog.push({label, size, min});
}
function replaceNth(text, needle, replacement, n = 0) {
  let index = -1;
  for (let i = 0; i <= n; i += 1) {
    index = text.indexOf(needle, index + 1);
    assert.ok(index >= 0, '反向用例找不到第 ' + n + ' 处 ' + needle);
  }
  return text.slice(0, index) + replacement + text.slice(index + needle.length);
}
const removeNth = (text, needle, n = 0) => replaceNth(text, needle, '', n);
const sorted = (list) => [...list].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stemOf = (spec) => spec.binder.replace('_candidate.py', '');

// ---------------------------------------------------------------- 规格表

function resolveToken(token, mod) {
  const t = token.trim();
  if (t.startsWith("'")) return t.slice(1, -1);
  assert.ok(t in mod, 'main-schema-release.mjs 未导出 ' + t + '，测试无法解析 finite[]');
  return mod[t];
}
function resolveList(expr, mod) {
  const t = expr.trim();
  const inner = t.startsWith('[') ? t.slice(1, -1) : t;
  return inner.split(',').flatMap((token) => [].concat(resolveToken(token, mod)));
}

/** finite[] 没有导出：读源码文本，名称再经已有导出解析。 */
export function parseFinite(mainText, mod) {
  const start = mainText.indexOf('const finite=[');
  assert.ok(start >= 0, 'main-schema-release.mjs: 找不到 const finite=[');
  const end = mainText.indexOf(NL + '];', start);
  assert.ok(end > start, 'main-schema-release.mjs: 找不到 finite[] 结尾');
  const block = mainText.slice(start, end);
  const entry = /[{]schema:([A-Za-z0-9_]+),migrations:(.+?),recipe:(.+?),binder:'([^']+)',evidence:'([^']+)'[}]/g;
  const specs = [...block.matchAll(entry)].map((m) => {
    const schema = mod[m[1]];
    assert.ok(schema, 'main-schema-release.mjs 未导出 ' + m[1]);
    return {
      name: m[1],
      kind: schema.additionKind,
      from: schema.fromGeneration,
      to: schema.toGeneration,
      steps: schema.steps,
      migrations: resolveList(m[2], mod),
      recipe: resolveToken(m[3], mod),
      binder: m[4],
      evidence: m[5],
    };
  });
  const declared = block.split('{schema:').length - 1;
  assert.equal(specs.length, declared, 'finite[] 有 ' + declared + ' 条但只解析出 ' + specs.length + ' 条：新条目的写法超出了提取器，请更新提取器');
  atLeast('finite[] 规格', specs.length, MIN.specs);
  atLeast('finite[] 代际名称', new Set(specs.map((x) => x.kind)).size, MIN.kinds);
  return specs;
}

function snapshot() {
  const specs = parseFinite(readRepo('tools/main-schema-release.mjs'), release);
  const recipeDir = 'config/main-schema-releases';
  const recipeFiles = fs.readdirSync(path.join(root, recipeDir)).filter((n) => n.endsWith('.json')).map((n) => recipeDir + '/' + n);
  const recipes = {};
  for (const file of recipeFiles) recipes[file] = JSON.parse(readRepo(file));
  const candidates = new Set();
  for (const spec of specs) {
    for (const m of spec.migrations) candidates.add(m);
    for (const name of [spec.binder, stemOf(spec) + '_addition.py', stemOf(spec) + '_catalog.py']) candidates.add('tools/' + name);
  }
  const exists = new Set([...candidates].filter((p) => fs.existsSync(path.join(root, p))));
  // 全部 tools/*_addition.py（含不在 finite[] 里的更早代际），按去掉后缀的名称索引。
  const additions = {};
  for (const name of fs.readdirSync(path.join(root, 'tools')).filter((n) => n.endsWith('_addition.py'))) {
    additions[name.replace('_addition.py', '')] = readRepo('tools/' + name);
  }
  return {
    specs,
    recipeFiles,
    recipes,
    exists,
    additions,
    biAdopt: slashes(readRepo('tools/bi-app-adopt.ps1')),
    digest: readRepo('tools/check_schema_code_digest.py'),
    local: slashes(readRepo('tools/django-local-service.ps1')),
    gate: readRepo('tools/integration_release_gate.py'),
    backup: readRepo('tools/postgres_no_key_backup.py'),
    publish: readRepo('tools/publish-prepared-main.mjs'),
  };
}

const kindsOf = (s) => [...new Set(s.specs.map((x) => x.kind))];
const stemOfKind = (s, kind) => stemOf(s.specs.find((x) => x.kind === kind));
const activeOf = (s, stem) => (s.additions[stem] ?? '').match(/^ACTIVE = .([a-z0-9-]+[.]json)./m)?.[1];

/**
 * 该代 *_addition.py 的 CODE_FILES 里「直接写出」的 tools/ 与 config/ 路径。
 * 多数代是 tuple(dict.fromkeys((*parent.CODE_FILES, "...", ...))) 继承上一代再追加；
 * 这里只取本代自己写出的字面量，继承来的部分由上一代自己的条目负责
 * （不在 finite[] 里的更早代际不在本规则范围内）。取不到则返回 null，调用方必须报错。
 */
export function codeFilesOf(s, stem) {
  const text = s.additions[stem];
  if (!text) return null;
  const m = text.match(/^CODE_FILES = [\s\S]*?"[)]/m);
  if (!m) return null;
  const files = [...m[0].matchAll(/"([A-Za-z0-9_.-]+[/][^"]+)"/g)].map((x) => x[1]);
  return files.length ? files : null;
}

// CODE_FILES 里各路径前缀进入应用包的方式（依据 django-local-service.ps1 Prepare-Application）：
// - tools/、config/、automation/：逐文件列在复制清单里（automation/n8n/pi-business 六个文件见该函数的清单），纳入规则。
// - backend/：Copy-ApplicationTree 整目录递归复制（跳过 tests、__pycache__ 等），不需逐文件检查。
// 其它前缀（例如 tests/）没有已知的入包方式，遇到必须报错要求人工判断，不能默认放过。
export const PER_FILE_PREFIXES = ['tools', 'config', 'automation'];
export const WHOLE_TREE_PREFIXES = ['backend'];

// ---------------------------------------------------------------- 提取器

function extractBi(s) {
  const lists = [];
  for (const m of s.biAdopt.matchAll(/(?:ValidateSet|@)[(]([^()]*)[)]/g)) {
    const items = [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]);
    if (items.includes('JdProductMonitoring')) lists.push({line: lineOf(s.biAdopt, m.index), items});
  }
  const gateLine = s.biAdopt.split(NL).find((l) => l.includes('$biGateName='));
  assert.ok(gateLine, 'bi-app-adopt.ps1: 找不到 $biGateName= 映射行');
  const pairs = [...gateLine.matchAll(/AdditionKind -ceq '([A-Za-z0-9_]+)'[)][{]'tools[/]([a-z0-9_]+[.]py)'[}]/g)].map((m) => ({kind: m[1], file: m[2]}));
  const nameLine = s.biAdopt.split(NL).find((l) => l.includes('$biApplicationName=if('));
  assert.ok(nameLine, 'bi-app-adopt.ps1: 找不到 $biApplicationName= 映射行');
  const appNames = [...nameLine.matchAll(/AdditionKind -ceq '([A-Za-z0-9_]+)'[)][{]'(teruisi_[a-z0-9_]+)'[}]/g)].map((m) => ({kind: m[1], name: m[2]}));
  atLeast('bi-app-adopt.ps1 名单', lists.length, MIN.biLists);
  atLeast('bi-app-adopt.ps1 kind->addition 映射', pairs.length, MIN.biPairs);
  atLeast('bi-app-adopt.ps1 $biApplicationName 映射', appNames.length, MIN.biAppNames);
  return {lists, pairs, appNames};
}

function extractLocal(s) {
  const chainRegion = region(s.local, 'function Assert-NoUnapprovedProtectedAiMigration', 'django-local-service.ps1');
  const chain = new Set([...chainRegion.matchAll(/Join-Path [$]candidateRoot 'tools[/]([A-Za-z0-9_]+_addition)[.]py'/g)].map((m) => m[1]));
  const markers = new Set([...chainRegion.matchAll(/'([a-z0-9-]+-addition-active[.]json)'/g)].map((m) => m[1]));
  // 复制清单用完整相对路径（tools/x、config/x）。
  const copyRegion = region(s.local, 'function Prepare-Application', 'django-local-service.ps1');
  const copy = new Set([...copyRegion.matchAll(new RegExp(Q + '((?:tools|config|automation)[/][^' + Q + ']+)' + Q, 'g'))].map((m) => m[1]));
  // 有序「标记 -> 模块」对。每个 $xGate = Join-Path $candidateRoot 'tools\x_addition.py' 定义一个变量；
  // 标记归属于它前面「最后一次被引用的闸变量」（BI 的 $biAdditionGate 定义在链顶部，但在自己的 if 条件里被引用）。
  const gateVars = new Map([...chainRegion.matchAll(/[$]([A-Za-z0-9]+) = Join-Path [$]candidateRoot 'tools[/]([A-Za-z0-9_]+)_addition[.]py'/g)].map((m) => [m[1], m[2]]));
  const refs = [...chainRegion.matchAll(/[$]([A-Za-z0-9]+)/g)].filter((m) => gateVars.has(m[1])).map((m) => ({pos: m.index, module: gateVars.get(m[1])}));
  const pairs = [...chainRegion.matchAll(/'([a-z0-9-]+-addition-active[.]json)'/g)].map((m) => {
    const owner = refs.filter((x) => x.pos < m.index).pop();
    assert.ok(owner, 'django-local-service.ps1: 标记 ' + m[1] + ' 前面没有引用任何 *_addition.py 闸变量（提取失效）');
    return {marker: m[1], module: owner.module};
  });
  atLeast('django-local-service.ps1 闸链', chain.size, MIN.localChain);
  atLeast('django-local-service.ps1 active 标记', markers.size, MIN.localMarkers);
  atLeast('django-local-service.ps1 标记-模块对', pairs.length, MIN.localPairs);
  atLeast('django-local-service.ps1 复制清单', copy.size, MIN.localCopy);
  return {chain, markers, copy, pairs};
}

function extractGate(s) {
  const verify = region(s.gate, 'def verify_release(', 'integration_release_gate.py');
  const db = region(s.gate, 'def verify_database_complete(', 'integration_release_gate.py');
  const names = (text, fn) => new Set([...text.matchAll(new RegExp('from ([A-Za-z0-9_]+_addition) import ' + fn, 'g'))].map((m) => m[1]));
  const markers = (text) => new Set([...text.matchAll(new RegExp(Q + '([a-z0-9-]+-addition-active[.]json)' + Q, 'g'))].map((m) => m[1]));
  // 有序「标记 -> 模块」对：每条分支是「标记存在就用该模块」，第一个命中的分支返回，所以顺序就是优先级。
  const pairsOf = (text, fn) => [...text.matchAll(new RegExp(Q + '([a-z0-9-]+-addition-active[.]json)' + Q + '[^' + NL + ']*' + NL + '[ ]*from ([A-Za-z0-9_]+)_addition import ' + fn, 'g'))].map((m) => ({marker: m[1], module: m[2]}));
  const result = {
    verify: names(verify, 'verify_active'),
    verifyMarkers: markers(verify),
    verifyPairs: pairsOf(verify, 'verify_active'),
    db: names(db, 'complete_database'),
    dbMarkers: markers(db),
    dbPairs: pairsOf(db, 'complete_database'),
  };
  atLeast('integration_release_gate.py verify_release 标记-模块对', result.verifyPairs.length, MIN.gateVerifyPairs);
  atLeast('integration_release_gate.py verify_database_complete 标记-模块对', result.dbPairs.length, MIN.gateDbPairs);
  atLeast('integration_release_gate.py verify_release 链', result.verify.size, MIN.gateVerify);
  atLeast('integration_release_gate.py verify_release 标记', result.verifyMarkers.size, MIN.gateVerifyMarkers);
  atLeast('integration_release_gate.py verify_database_complete 链', result.db.size, MIN.gateDb);
  atLeast('integration_release_gate.py verify_database_complete 标记', result.dbMarkers.size, MIN.gateDbMarkers);
  return result;
}

function extractDigest(s) {
  const block = region(s.digest, 'SPECS = {', 'check_schema_code_digest.py');
  const end = block.indexOf(NL + '}');
  const body = end > 0 ? block.slice(0, end) : block;
  const entry = new RegExp(Q + '([A-Za-z0-9_]+)' + Q + ':[ ]*[(]' + Q + '([a-z0-9_]+)' + Q + ',[ ]*[(]([0-9, ]+)[)],[ ]*([0-9]+),', 'g');
  const entries = [...body.matchAll(entry)].map((m) => ({
    kind: m[1],
    module: m[2],
    froms: m[3].split(',').map((x) => x.trim()).filter(Boolean).map(Number),
    to: Number(m[4]),
  }));
  atLeast('check_schema_code_digest.py SPECS', entries.length, MIN.digestEntries);
  return entries;
}

function extractBackup(s) {
  const body = region(s.backup, 'def verify_receipt_generation(', 'postgres_no_key_backup.py');
  const generations = new Set([...body.matchAll(/^[ ]*generation([0-9]+) = sorted[(]/gm)].map((m) => Number(m[1])));
  const catalogs = new Set([...body.matchAll(/from ([a-z0-9_]+_catalog) import/g)].map((m) => m[1]));
  // 判定元组：`<x>_installed = receipts in (generationA, ...)` 与 `if receipts in (...)`。
  const numbersOf = (list) => [...list.matchAll(/(?:generation|parent)([0-9]+)/g)].map((m) => Number(m[1]));
  const tuples = [...body.matchAll(/^[ ]*(if receipts|[a-z_]+ = receipts) in [(]([^)]*)[)]/gm)].map((m) => ({label: m[1].replace(' = receipts', '').replace('if receipts', 'if receipts in (...)'), line: lineOf(body, m.index), gens: numbersOf(m[2])}));
  // 末尾 `return 159 if x_installed else 158 if ... else 140` 链。
  const returnLine = body.split(NL).find((l) => /^[ ]*return [0-9]+ if /.test(l));
  assert.ok(returnLine, 'postgres_no_key_backup.py: verify_receipt_generation 里找不到 return N if ... 链');
  const returnParts = returnLine.trim().slice('return '.length).split(' else ');
  const returnChain = returnParts.map((part) => Number(part.split(' ')[0]));
  assert.ok(returnChain.every((n) => Number.isInteger(n)), 'postgres_no_key_backup.py: return 链解析出非整数 ' + JSON.stringify(returnChain));
  // `N if <x>_installed` 配对（末项是无条件兜底，没有变量）。
  const returnPairs = returnParts.map((part) => part.match(/^([0-9]+) if ([a-z_]+)$/)).filter(Boolean).map((m) => ({n: Number(m[1]), variable: m[2]}));
  // 相等判定：`<x>_installed = receipts == generationN`（只表示「恰好是这一代」）。
  const equals = [...body.matchAll(/^[ ]*([a-z_]+) = receipts == generation([0-9]+)$/gm)].map((m) => ({variable: m[1], gen: Number(m[2]), line: lineOf(body, m.index)}));
  atLeast('postgres_no_key_backup.py generation 定义', generations.size, MIN.backupGenerations);
  atLeast('postgres_no_key_backup.py catalog 导入', catalogs.size, MIN.backupCatalogs);
  atLeast('postgres_no_key_backup.py 判定元组', tuples.length, MIN.backupInstalled);
  atLeast('postgres_no_key_backup.py return 链', returnChain.length, MIN.backupInstalled);
  atLeast('postgres_no_key_backup.py return 链配对', returnPairs.length, MIN.backupReturnPairs);
  atLeast('postgres_no_key_backup.py 相等判定', equals.length, MIN.backupEquals);
  return {generations, catalogs, tuples, returnChain, returnPairs, equals};
}

function extractPublish(s) {
  const marker = '.includes(schema.additionKind)||aiRolesChanged';
  const at = s.publish.indexOf(marker);
  assert.ok(at >= 0, 'publish-prepared-main.mjs: 找不到 Pi 运行账本权限条件 ' + marker);
  const open = s.publish.lastIndexOf('[', at);
  const items = [...s.publish.slice(open, at).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  atLeast('publish-prepared-main.mjs 运行账本权限清单', items.length, MIN.publishList);
  return items;
}

// ---------------------------------------------------------------- 关系检查（纯函数）

/** 关系 1a：recipe 文件存在，其名称/起止代数/步骤与规格相等；无孤儿 recipe。 */
export function checkRecipes(s) {
  const v = [];
  for (const spec of s.specs) {
    const recipe = s.recipes[spec.recipe];
    if (!recipe) {
      v.push(spec.kind + ': recipe ' + spec.recipe + ' 不存在。补：在 config/main-schema-releases/ 新增该 recipe（finite[] 的 recipe 字段指向它）');
      continue;
    }
    for (const [field, want] of [['additionKind', spec.kind], ['fromGeneration', spec.from], ['toGeneration', spec.to], ['steps', spec.steps]]) {
      if (!same(recipe[field], want)) {
        v.push(spec.kind + ': ' + spec.recipe + ' 的 ' + field + '=' + JSON.stringify(recipe[field]) + '，finite[] 为 ' + JSON.stringify(want) + '。补：让两处一致');
      }
    }
    if (!same(sorted(Object.keys(recipe.stepFiles ?? {})), sorted(spec.migrations))) {
      v.push(spec.kind + ': ' + spec.recipe + ' 的 stepFiles 键与 finite[] 的 migrations 不一致。补：recipe 为每个迁移文件登记摘要');
    }
  }
  for (const file of s.recipeFiles) {
    if (!s.specs.some((x) => x.recipe === file)) {
      v.push(file + ': 没有任何 finite[] 条目引用这个 recipe（孤儿）。补：在 tools/main-schema-release.mjs 的 finite[] 登记，或确认应删除');
    }
  }
  return v;
}

/** 关系 1b：迁移步骤与迁移文件一致且存在；binder、addition、catalog 文件存在。 */
export function checkFiles(s) {
  const v = [];
  for (const spec of s.specs) {
    const derived = spec.steps.map((step) => {
      const dot = step.indexOf('.');
      return 'backend/' + step.slice(0, dot) + '/migrations/' + step.slice(dot + 1) + '.py';
    });
    if (!same(sorted(derived), sorted(spec.migrations))) {
      v.push(spec.kind + ': finite[] 的 schema.steps 推出的迁移文件 ' + JSON.stringify(derived) + ' 与 migrations ' + JSON.stringify(spec.migrations) + ' 不一致。补：改成一致');
    }
    for (const file of spec.migrations) {
      if (!s.exists.has(file)) v.push(spec.kind + ': 迁移文件 ' + file + ' 不存在');
    }
    if (!/^[a-z0-9_]+_candidate[.]py$/.test(spec.binder)) {
      v.push(spec.kind + ': binder ' + spec.binder + ' 不是 <x>_candidate.py 形式，各处按此约定派生 <x>_addition.py');
    }
    for (const file of ['tools/' + spec.binder, 'tools/' + stemOf(spec) + '_addition.py', 'tools/' + stemOf(spec) + '_catalog.py']) {
      if (!s.exists.has(file)) v.push(spec.kind + ': ' + file + ' 不存在。补：新增该文件（每代需要 candidate/addition/catalog 三件套）');
    }
  }
  return v;
}

/** 关系 2：代际链连续；终止减起始等于步骤数；同一 kind 共用 binder。 */
export function checkChain(s) {
  const v = [];
  const minFrom = Math.min(...s.specs.map((x) => x.from));
  const tos = new Set(s.specs.map((x) => x.to));
  for (const spec of s.specs) {
    if (spec.to - spec.from !== spec.steps.length) {
      v.push(spec.kind + ': ' + spec.from + '->' + spec.to + ' 但 steps 有 ' + spec.steps.length + ' 步。补：核对代数与步骤');
    }
    if (spec.from !== minFrom && !tos.has(spec.from)) {
      v.push(spec.kind + ': 起始代数 ' + spec.from + ' 既不是链起点 ' + minFrom + '，也不是任何规格的终止代数。补：核对 finite[] 的父链');
    }
    const first = s.specs.find((x) => x.kind === spec.kind);
    if (first !== spec && first.binder !== spec.binder) v.push(spec.kind + ': 同一 kind 的两条规格使用了不同 binder');
  }
  return v;
}

/** 关系 3：bi-app-adopt.ps1 的每份名单包含全部 kind，且 kind->addition 映射正确。 */
export function checkBiAdopt(s) {
  const v = [];
  const {lists, pairs, appNames} = extractBi(s);
  for (const kind of kindsOf(s)) {
    if (!appNames.some((x) => x.kind === kind)) {
      v.push(kind + ': 缺在 tools/bi-app-adopt.ps1 的 $biApplicationName 映射。补：加 elseif 分支（漏写会落到默认值 teruisi_bi_goal_append，只影响连接应用名标签）。');
    }
    for (const list of lists) {
      if (!list.items.includes(kind)) {
        v.push(kind + ': 缺在 tools/bi-app-adopt.ps1 第 ' + list.line + ' 行的名单。补：把 ' + kind + ' 加进该名单（ValidateSet 与各 -cin 名单都要）');
      }
    }
    const want = stemOfKind(s, kind) + '_addition.py';
    const pair = pairs.find((p) => p.kind === kind);
    if (!pair) v.push(kind + ': 缺在 tools/bi-app-adopt.ps1 的 $biGateName 映射。补：加 elseif 分支指向 tools/' + want);
    else if (pair.file !== want) v.push(kind + ': tools/bi-app-adopt.ps1 的 $biGateName 映射到 ' + pair.file + '，应为 ' + want);
  }
  return v;
}

/** 关系 4a：django-local-service.ps1 的闸链与复制清单。 */
export function checkLocalService(s) {
  const v = [];
  const {chain, markers, copy} = extractLocal(s);
  for (const kind of kindsOf(s)) {
    const stem = stemOfKind(s, kind);
    if (!chain.has(stem + '_addition')) {
      v.push(kind + ': tools/' + stem + '_addition.py 不在 django-local-service.ps1 的 Assert-NoUnapprovedProtectedAiMigration 闸链。补：照相邻代际加一段同构代码');
    }
    const active = activeOf(s, stem);
    if (!active) v.push(kind + ': tools/' + stem + '_addition.py 里没读到 ACTIVE 标记文件名');
    else if (!markers.has(active)) v.push(kind + ': 标记文件 ' + active + ' 不在 django-local-service.ps1 闸链。补：闸链用它判定该代是否生效');
    // 真正的约束：摘要计算读的是准备好的应用目录，所以该代 CODE_FILES 写出的 tools/ 与 config/ 文件都必须在复制清单。
    const files = codeFilesOf(s, stem);
    if (!files) {
      v.push(kind + ': 读不到 tools/' + stem + '_addition.py 的 CODE_FILES 字面量（提取失效或写法变了，请先修提取器）');
      continue;
    }
    for (const file of files) {
      const prefix = file.split('/')[0];
      if (WHOLE_TREE_PREFIXES.includes(prefix)) continue;
      if (!PER_FILE_PREFIXES.includes(prefix)) {
        v.push(kind + ': ' + file + '（' + stem + '_addition.py 的 CODE_FILES）前缀 ' + prefix + '/ 不在已知入包方式里（逐文件：' + PER_FILE_PREFIXES.join('/') + '；整目录：' + WHOLE_TREE_PREFIXES.join('/') + '）。补：读 Prepare-Application 确认该前缀怎样进包，再登记到 PER_FILE_PREFIXES/WHOLE_TREE_PREFIXES');
        continue;
      }
      if (!copy.has(file)) v.push(kind + ': ' + file + '（' + stem + '_addition.py 的 CODE_FILES）不在 django-local-service.ps1 Prepare-Application 复制清单。补：加进清单，否则准备好的应用目录缺文件、摘要算不出');
    }
  }
  return v;
}

/** 关系 4b：integration_release_gate.py 两条代际分支链与 ACTIVE 标记。 */
export function checkGate(s) {
  const v = [];
  const g = extractGate(s);
  for (const kind of kindsOf(s)) {
    const stem = stemOfKind(s, kind);
    if (!g.verify.has(stem + '_addition')) v.push(kind + ': 缺在 tools/integration_release_gate.py 的 verify_release 分支链。补：加 from ' + stem + '_addition import verify_active 分支');
    if (!g.db.has(stem + '_addition')) v.push(kind + ': 缺在 tools/integration_release_gate.py 的 verify_database_complete 分支链。补：加 from ' + stem + '_addition import complete_database 分支');
    const active = activeOf(s, stem);
    if (!active) continue;
    if (!g.verifyMarkers.has(active)) v.push(kind + ': 标记文件 ' + active + ' 不在 integration_release_gate.py 的 verify_release。补：分支条件用该文件名');
    if (!g.dbMarkers.has(active)) v.push(kind + ': 标记文件 ' + active + ' 不在 integration_release_gate.py 的 verify_database_complete。补：分支条件用该文件名');
  }
  return v;
}

/** 关系 5：check_schema_code_digest.py 的 SPECS 覆盖全部 kind 且与规格一致。 */
export function checkDigest(s) {
  const v = [];
  const entries = extractDigest(s);
  for (const kind of kindsOf(s)) {
    const entry = entries.find((e) => e.kind === kind);
    if (!entry) {
      v.push(kind + ': 缺在 tools/check_schema_code_digest.py 的 SPECS。补：加一项 (候选模块, 起始代数元组, 终止代数, 检查集名)');
      continue;
    }
    const mine = s.specs.filter((x) => x.kind === kind);
    if (entry.module !== stemOfKind(s, kind) + '_candidate') v.push(kind + ': SPECS 里的模块 ' + entry.module + '，应为 ' + stemOfKind(s, kind) + '_candidate');
    if (!same(sorted(entry.froms), sorted(mine.map((x) => x.from)))) v.push(kind + ': SPECS 起始代数 ' + JSON.stringify(entry.froms) + ' 与 finite[] ' + JSON.stringify(mine.map((x) => x.from)) + ' 不一致');
    if (!mine.every((x) => x.to === entry.to)) v.push(kind + ': SPECS 终止代数 ' + entry.to + ' 与 finite[] ' + JSON.stringify(mine.map((x) => x.to)) + ' 不一致');
  }
  for (const entry of entries) {
    if (!kindsOf(s).includes(entry.kind)) v.push(entry.kind + ': SPECS 里有但 finite[] 没有（多余或 finite[] 漏登记）');
  }
  return v;
}

/** 关系 5b：postgres_no_key_backup.py 认得每个终止代数，并导入每代 catalog。 */
export function checkBackup(s) {
  const v = [];
  const {generations, catalogs, tuples, returnChain, returnPairs, equals} = extractBackup(s);
  const tos = [...new Set(s.specs.map((x) => x.to))].sort((a, b) => a - b);
  const kindsAt = (to) => s.specs.filter((x) => x.to === to).map((x) => x.kind).join('/');
  for (const to of tos) {
    if (!generations.has(to)) {
      v.push('generation' + to + '（' + kindsAt(to) + '）: 缺在 tools/postgres_no_key_backup.py 的 verify_receipt_generation。补：加 generation' + to + ' 定义并纳入各 *_installed 判定');
    }
  }
  // 规则 A（由代码形状得出）：每个 `receipts in (...)` 元组表示「从最早那一代起的全部后续代」，所以元组必须包含
  // 所有 ≥ 其最小元素的 finite[] 终止代数。某代上线后若有元组没列它，备份会报
  // no-key backup migration catalogue is not a reviewed generation。
  for (const t of tuples) {
    const floor = Math.min(...t.gens);
    for (const to of tos.filter((x) => x >= floor && generations.has(x))) {
      if (!t.gens.includes(to)) {
        v.push('generation' + to + '（' + kindsAt(to) + '）: 缺在 tools/postgres_no_key_backup.py 第 ' + t.line + ' 行判定元组（' + t.label + '）。补：把 generation' + to + ' 加进该元组（元组需包含最早代之后的全部代数）');
      }
    }
  }
  // 规则 B：末尾 return 链必须包含每个 finite[] 终止代数，且首项是最新一代、严格递减。
  for (const to of tos) {
    if (!returnChain.includes(to)) {
      v.push('generation' + to + '（' + kindsAt(to) + '）: 缺在 tools/postgres_no_key_backup.py 末尾 return 链。补：加 `' + to + ' if <x>_installed else`');
    }
  }
  if (returnChain[0] !== tos[tos.length - 1]) {
    v.push('tools/postgres_no_key_backup.py 末尾 return 链首项是 ' + returnChain[0] + '，应为最新一代 ' + tos[tos.length - 1] + '（链是「第一个成立的返回」，最新代必须排最前）');
  }
  if (!returnChain.every((n, i) => i === 0 || returnChain[i - 1] > n)) {
    v.push('tools/postgres_no_key_backup.py 末尾 return 链不是严格递减：' + JSON.stringify(returnChain));
  }
  // 规则 C：`<x>_installed = receipts == generationN` 只认「恰好是 N」。N 若是 finite[] 的终止代数，它必须是最新一代：
  // 否则更新一代上线后该判定变假（应改成 `receipts in (...)` 元组）。146/147 这类不是 finite[] 终止代数的不受约束。
  const latestTo = tos[tos.length - 1];
  for (const e of equals) {
    if (tos.includes(e.gen) && e.gen !== latestTo) {
      v.push('generation' + e.gen + '（' + kindsAt(e.gen) + '）: tools/postgres_no_key_backup.py 第 ' + e.line + ' 行 ' + e.variable + ' 用 == generation' + e.gen + '，但最新一代是 generation' + latestTo + '。补：改成 receipts in (generation' + e.gen + ', ..., generation' + latestTo + ') 元组（否则新一代上线后备份失败）');
    }
  }
  // 规则 D：return 链里与 N 配对的变量，其定义的最小代数必须正好是 N（元组取最小元素，== 判定取其代数）。
  const minGenOf = (variable) => {
    const mins = [...tuples.filter((t) => t.label === variable).map((t) => Math.min(...t.gens)), ...equals.filter((e) => e.variable === variable).map((e) => e.gen)];
    return mins.length ? Math.min(...mins) : null;
  };
  for (const to of tos) {
    const pair = returnPairs.find((p) => p.n === to);
    if (!pair) {
      // 链里没有这个代数：规则 B 已报。链里有、却没解析出配对：写法超出提取器，不能静默放过（否则备份可能把旧库报成这一代）。
      if (returnChain.includes(to)) {
        v.push('generation' + to + '（' + kindsAt(to) + '）: tools/postgres_no_key_backup.py 末尾 return 链里 ' + to + ' 这一项不是「' + to + ' if <单个变量名>_installed」的形状（例如带括号或 and 组合），提取器识别不了配对。补：改成 `' + to + ' if <x>_installed`，把组合条件先赋给一个 *_installed 变量');
      }
      continue;
    }
    const min = minGenOf(pair.variable);
    if (min === null) {
      v.push('generation' + to + '（' + kindsAt(to) + '）: tools/postgres_no_key_backup.py return 链里 ' + to + ' 配的 ' + pair.variable + ' 找不到定义（写法超出提取器）');
    } else if (min !== to) {
      v.push('generation' + to + '（' + kindsAt(to) + '）: tools/postgres_no_key_backup.py return 链里 ' + to + ' 配的是 ' + pair.variable + '，它定义的最小代数是 ' + min + '。补：换成最小代数恰为 ' + to + ' 的那个 *_installed');
    }
  }
  for (const kind of kindsOf(s)) {
    if (!catalogs.has(stemOfKind(s, kind) + '_catalog')) {
      v.push(kind + ': tools/postgres_no_key_backup.py 没有导入 ' + stemOfKind(s, kind) + '_catalog。补：导入该代 STEPS 并纳入判定');
    }
  }
  return v;
}

/**
 * 关系 6：迁移在 backend/ai_assistant/migrations/ 的代际，其 kind 必须在
 * publish-prepared-main.mjs 触发「配置Pi运行账本权限」的名单里（或在例外表登记）。
 * 这是推断出的绊线：名单之外还有 aiRolesChanged（database_contract.py 变更）兜底，
 * 所以例外表允许登记确实不需要重算授权的代际。
 */
export function checkProvisionList(s, exceptions = PROVISION_LIST_EXCEPTIONS) {
  const v = [];
  const list = extractPublish(s);
  const aiKinds = kindsOf(s).filter((kind) => s.specs.some((x) => x.kind === kind && x.migrations.some((m) => m.startsWith('backend/ai_assistant/migrations/'))));
  atLeast('ai_assistant 代际', aiKinds.length, 6);
  for (const kind of aiKinds) {
    if (!list.includes(kind) && !(kind in exceptions)) {
      v.push(kind + ': 迁移在 backend/ai_assistant/migrations/，但不在 tools/publish-prepared-main.mjs 的「配置Pi运行账本权限」名单。补：加进名单（否则授权不会重算，writer 可能 503）；若确不需要，在测试的 PROVISION_LIST_EXCEPTIONS 登记原因与证据');
    }
  }
  // 例外失效检测：必须是 ai_assistant 代际、确实不在名单里、并带原因文字，否则要求删除。
  for (const [kind, reason] of Object.entries(exceptions)) {
    if (!kindsOf(s).includes(kind)) v.push(kind + ': PROVISION_LIST_EXCEPTIONS 里的例外已不对应任何规格，请删除');
    else if (!aiKinds.includes(kind)) v.push(kind + ': PROVISION_LIST_EXCEPTIONS 里的例外不是 ai_assistant 迁移代际（本来就不在检查范围），请删除');
    else if (list.includes(kind)) v.push(kind + ': 已在 tools/publish-prepared-main.mjs 的名单里，PROVISION_LIST_EXCEPTIONS 的例外已失效，请删除');
    else if (typeof reason !== 'string' || reason.trim() === '') v.push(kind + ': PROVISION_LIST_EXCEPTIONS 的例外没有原因文字，必须写明原因与证据位置');
  }
  return v;
}

/**
 * 关系 7：三条「第一个存在的标记命中就返回」的分支链（integration_release_gate.py 的 verify_release、
 * verify_database_complete，django-local-service.ps1 的 Assert-NoUnapprovedProtectedAiMigration）的顺序与配对。
 * 标记文件永久累积，所以最新一代必须排在最前。
 * - 每对里标记文件名等于该模块自己声明的 ACTIVE。
 * - finite[] 各代按终止代数从大到小排列；不属于 finite[] 的更早代际必须全部排在它们之后（不臆造它们的代数）。
 * - 三条链里所有代际的相对顺序一致。
 */
export function checkChainOrder(s) {
  const v = [];
  const g = extractGate(s);
  const l = extractLocal(s);
  const chains = [
    {name: 'integration_release_gate.py verify_release', pairs: g.verifyPairs},
    {name: 'integration_release_gate.py verify_database_complete', pairs: g.dbPairs},
    {name: 'django-local-service.ps1 Assert-NoUnapprovedProtectedAiMigration', pairs: l.pairs},
  ];
  const toOf = new Map(kindsOf(s).map((kind) => [stemOfKind(s, kind), s.specs.find((x) => x.kind === kind).to]));
  const kindOfStem = new Map(kindsOf(s).map((kind) => [stemOfKind(s, kind), kind]));
  for (const chain of chains) {
    chain.pairs.forEach((p, i) => {
      const active = activeOf(s, p.module);
      if (!active) v.push(chain.name + ' 第 ' + (i + 1) + ' 分支：读不到 tools/' + p.module + '_addition.py 的 ACTIVE 标记文件名');
      else if (active !== p.marker) v.push(chain.name + ' 第 ' + (i + 1) + ' 分支：标记 ' + p.marker + ' 配的是模块 ' + p.module + '_addition，但该模块自己的 ACTIVE 是 ' + active + '。补：标记与模块要成对');
    });
    let previous = null;
    let sawOlder = null;
    for (const p of chain.pairs) {
      const to = toOf.get(p.module);
      if (to === undefined) {
        if (!sawOlder) sawOlder = p.module;
        continue;
      }
      if (sawOlder) {
        v.push(chain.name + ': finite[] 代际 ' + kindOfStem.get(p.module) + '（' + p.module + '）排在不属于 finite[] 的更早代际 ' + sawOlder + ' 之后。补：最新代排最前（第一个存在的标记命中就返回）');
      }
      if (previous && previous.to <= to) {
        v.push(chain.name + ': ' + kindOfStem.get(p.module) + '（终止代数 ' + to + '）排在 ' + kindOfStem.get(previous.module) + '（终止代数 ' + previous.to + '）之后，顺序应从大到小。补：把代数更大的分支排到前面（第一个存在的标记命中就返回）');
      }
      previous = {module: p.module, to};
    }
  }
  const base = chains[0].pairs.map((p) => p.module);
  for (const chain of chains.slice(1)) {
    const mine = chain.pairs.map((p) => p.module);
    if (!same(mine, base)) {
      const at = mine.findIndex((m, i) => m !== base[i]);
      v.push(chain.name + ' 的代际顺序与 ' + chains[0].name + ' 不一致（首个差异在第 ' + ((at < 0 ? Math.min(mine.length, base.length) : at) + 1) + ' 项：' + mine[at] + ' vs ' + base[at] + '）');
    }
  }
  return v;
}

const RELATIONS = {checkRecipes, checkFiles, checkChain, checkBiAdopt, checkLocalService, checkGate, checkDigest, checkBackup, checkProvisionList, checkChainOrder};

// ---------------------------------------------------------------- 测试

const s = snapshot();
const spec = (kind) => s.specs.find((x) => x.kind === kind);
// 按终止代数从大到小的 kind。反向用例需要「最新一代」时从这里取，不写死 159 之类的字面文本，否则合法新增一代后反向用例自己会失效。
const kindsDesc = [...new Set([...s.specs].sort((a, b) => b.to - a.to).map((x) => x.kind))];
const latestSpec = [...s.specs].sort((a, b) => b.to - a.to)[0];
const latestKind = latestSpec.kind;
const prevTo = Math.max(...s.specs.filter((x) => x.to < latestSpec.to).map((x) => x.to));
// 取完整定义：`==` 写法到行尾；`in (` 写法到匹配的右括号（可折成多行，口径与 extractBackup 的元组正则一致）。
const backupDefOf = (variable) => {
  const m = s.backup.match(new RegExp('^[ ]*' + variable + ' = receipts (?:==.*$|in [(][^)]*[)])', 'm'));
  assert.ok(m, '反向用例找不到 ' + variable + ' 的定义行');
  return m[0];
};
const pairVarOf = (to) => {
  const p = extractBackup(s).returnPairs.find((x) => x.n === to);
  assert.ok(p, '反向用例找不到 return 链里 ' + to + ' 的配对');
  return p.variable;
};

test('测量表（ENUM_TRIPWIRE_REPORT=1 时打印各抄写位置的实测集合）', () => {
  const bi = extractBi(s);
  const local = extractLocal(s);
  const gate = extractGate(s);
  const digest = extractDigest(s);
  const backup = extractBackup(s);
  const publish = extractPublish(s);
  if (!process.env.ENUM_TRIPWIRE_REPORT) return;
  const table = {
    'finite[] 规格': s.specs.map((x) => x.kind + ' ' + x.from + '->' + x.to + ' steps=' + x.steps.length + ' recipe=' + x.recipe + ' binder=' + x.binder),
    'recipe 文件': s.recipeFiles,
    'bi-app-adopt 名单(行:数量)': bi.lists.map((l) => l.line + ':' + l.items.length),
    'bi-app-adopt 映射': bi.pairs.map((p) => p.kind + '=' + p.file),
    'local 闸链': [...local.chain].sort(),
    'local active 标记': [...local.markers].sort(),
    'local 复制清单数量': [local.copy.size],
    'gate verify_release': [...gate.verify].sort(),
    'gate verify 标记数': [gate.verifyMarkers.size],
    'gate verify_database_complete': [...gate.db].sort(),
    'gate db 标记数': [gate.dbMarkers.size],
    'digest SPECS': digest.map((e) => e.kind + ' ' + e.module + ' ' + JSON.stringify(e.froms) + '->' + e.to),
    'backup generation': [...backup.generations].sort((a, b) => a - b),
    'backup catalogs': [...backup.catalogs].sort(),
    'publish 运行账本权限名单': publish,
  };
  for (const [name, value] of Object.entries(table)) console.log('## ' + name + ' (' + value.length + ')' + NL + value.join(NL));
});

for (const [name, check] of Object.entries(RELATIONS)) {
  test(name + ': 当前主干无违规', () => {
    assert.deepEqual(check(s), []);
  });
}

test('提取数量不低于实测下限（a264880f）', () => {
  floorLog.length = 0;
  parseFinite(readRepo('tools/main-schema-release.mjs'), release);
  extractBi(s);
  extractLocal(s);
  extractGate(s);
  extractDigest(s);
  extractBackup(s);
  extractPublish(s);
  floorLog.push({label: 'config/main-schema-releases recipe 文件', size: s.recipeFiles.length, min: MIN.recipeFiles});
  assert.ok(floorLog.length >= 15, '下限记录本身应有足够多项，实际 ' + floorLog.length);
  const low = floorLog.filter((x) => x.size < x.min).map((x) => x.label + ': ' + x.size + ' < ' + x.min);
  assert.deepEqual(low, [], '某个提取集合变少：指向源文件被删项或提取器失效。先查是否真删了代际，再决定是否下调下限');
});

test('提取器遇到空文本必须失败而不是返回空集合', () => {
  const empty = {...s, biAdopt: '', local: '', gate: '', digest: '', backup: '', publish: ''};
  for (const [name, fn] of [['bi', extractBi], ['local', extractLocal], ['gate', extractGate], ['digest', extractDigest], ['backup', extractBackup], ['publish', extractPublish]]) {
    assert.throws(() => fn(empty), undefined, name + ' 对空文本没有失败');
  }
  assert.throws(() => parseFinite('', release));
});

test('parseFinite 遇到未识别的新条目写法必须失败', () => {
  const text = readRepo('tools/main-schema-release.mjs');
  const broken = replaceNth(text, '{schema:aiUnifiedTasksSchema,migrations:', '{schema:aiUnifiedTasksSchema ,migrations:');
  assert.throws(() => parseFinite(broken, release), /超出了提取器/);
});

function hit(violations, ...needles) {
  assert.ok(violations.some((x) => needles.every((n) => x.includes(n))), '期望至少一条违规同时包含 ' + JSON.stringify(needles) + '，实际: ' + JSON.stringify(violations));
}

function only(violations, ...needles) {
  assert.equal(violations.length, 1, '期望恰好 1 条违规，实际: ' + JSON.stringify(violations));
  for (const needle of needles) assert.ok(violations[0].includes(needle), '违规信息缺少 ' + needle + ': ' + violations[0]);
}

test('反向 1a：缺 recipe / recipe 字段不一致 / 孤儿 recipe', () => {
  const target = spec('PiNative');
  const missing = {...s, recipes: {...s.recipes}};
  delete missing.recipes[target.recipe];
  only(checkRecipes(missing), 'PiNative', target.recipe);
  const drift = {...s, recipes: {...s.recipes, [target.recipe]: {...s.recipes[target.recipe], toGeneration: target.to + 1}}};
  only(checkRecipes(drift), 'PiNative', 'toGeneration');
  const orphan = {...s, recipeFiles: [...s.recipeFiles, 'config/main-schema-releases/zz-orphan.json']};
  only(checkRecipes(orphan), 'zz-orphan.json', '孤儿');
});

test('反向 1b：迁移/binder/addition/catalog 文件缺失，steps 与 migrations 不一致', () => {
  const target = spec('PiNative');
  const without = (file) => ({...s, exists: new Set([...s.exists].filter((p) => p !== file))});
  only(checkFiles(without(target.migrations[0])), 'PiNative', target.migrations[0]);
  only(checkFiles(without('tools/' + target.binder)), 'PiNative', target.binder);
  only(checkFiles(without('tools/pi_native_addition.py')), 'PiNative', 'pi_native_addition.py');
  only(checkFiles(without('tools/pi_native_catalog.py')), 'PiNative', 'pi_native_catalog.py');
  const drift = {...s, specs: s.specs.map((x) => (x.kind === 'PiNative' ? {...x, migrations: []} : x))};
  only(checkFiles(drift), 'PiNative', 'steps');
});

test('反向 2：步骤数与代数差不符，起始代数接不上链', () => {
  // 用链尾（没有后继以它的终止代数为起点），改动它不会连带影响别的规格。
  // 最新一代从规格表取（不写死代际名），按对象身份改。
  const edit = (patch) => ({...s, specs: s.specs.map((x) => (x === latestSpec ? {...x, ...patch} : x))});
  only(checkChain(edit({steps: []})), latestKind, 'steps');
  only(checkChain(edit({from: 999, to: 999 + latestSpec.steps.length})), latestKind, '999');
  const binder = {...s, specs: s.specs.map((x) => (x.recipe === 'config/main-schema-releases/inventory-0017-from148.json' ? {...x, binder: 'pi_native_candidate.py'} : x))};
  only(checkChain(binder), 'TmallWarehouse', 'binder');
});

test('反向 3：bi-app-adopt.ps1 名单漏项（首尾两份）与映射缺失/错配', () => {
  const needle = "'PiNative',";
  only(checkBiAdopt({...s, biAdopt: removeNth(s.biAdopt, needle, 0)}), 'PiNative', '名单');
  const count = s.biAdopt.split(needle).length - 1;
  assert.ok(count >= 2, '期望 PiNative 在多份名单里出现，实际 ' + count);
  only(checkBiAdopt({...s, biAdopt: removeNth(s.biAdopt, needle, count - 1)}), 'PiNative', '名单');
  const branch = "elseif($biRequest.AdditionKind -ceq 'PiNative'){'tools/pi_native_addition.py'}";
  only(checkBiAdopt({...s, biAdopt: removeNth(s.biAdopt, branch)}), 'PiNative', '映射');
  only(checkBiAdopt({...s, biAdopt: replaceNth(s.biAdopt, "'PiNative'){'tools/pi_native_addition.py'}", "'PiNative'){'tools/pi_business_addition.py'}")}), 'PiNative', 'pi_business_addition.py');
});

test('反向 4a：闸链、active 标记、复制清单缺项', () => {
  only(checkLocalService({...s, local: replaceNth(s.local, "'tools/pi_agent_addition.py'", "'tools/pi_agent_additionX.py'")}), 'PiAgent', '闸链');
  only(checkLocalService({...s, local: replaceNth(s.local, "'pi-agent-addition-active.json'", "'xx-addition-active.json'")}), 'PiAgent', 'pi-agent-addition-active.json');
  // 复制清单：该代 CODE_FILES 写出的 tools/ 与 config/ 文件都必须在清单里。
  const quoted = (name) => Q + name + Q;
  for (const name of ['tools/pi_agent_addition.py', 'tools/pi_agent_candidate.py', 'tools/main-schema-release.mjs', 'config/integration-migration-policy-v3.json']) {
    const violations = checkLocalService({...s, local: s.local.split(quoted(name)).join(quoted('x_' + name))});
    assert.ok(violations.length >= 1 && violations.every((x) => x.includes(name) && x.includes('复制清单')), name + ' 从复制清单改坏后应只报该文件，实际: ' + JSON.stringify(violations));
    assert.ok(violations.some((x) => x.startsWith('PiAgent')), name + ' 应报到 PiAgent');
  }
  // pi_agent_catalog 只在 PiAgent/PiWorkspace 的 CODE_FILES 里，不在任何模块自己的名字下：删掉后两个模块都报。
  const catalog = checkLocalService({...s, local: s.local.split(quoted('tools/pi_agent_catalog.py')).join(quoted('tools/x_pi_agent_catalog.py'))});
  assert.deepEqual(catalog.map((x) => x.split(':')[0]).sort(), ['PiAgent', 'PiWorkspace']);
  // 提取器失效也要报：CODE_FILES 读不到时不能默认通过。
  const blind = {...s, additions: {...s.additions, pi_agent: s.additions.pi_agent.replace('CODE_FILES = ', 'CODE_LIST = ')}};
  only(checkLocalService(blind), 'PiAgent', 'CODE_FILES');
});

test('codeFilesOf 在真实文件上取到完整字面量', () => {
  // 继承型（dict.fromkeys + parent）与纯元组型（JdMonitorPreferences）各验一个。
  assert.ok(codeFilesOf(s, 'pi_agent').includes('tools/django-ai.ps1'), 'pi_agent 的跨行字面量没取全');
  assert.ok(codeFilesOf(s, 'pi_agent').includes('tools/pi_agent_candidate.py'));
  assert.ok(codeFilesOf(s, 'tmall_warehouse').includes('config/integration-migration-policy-v4-netshop-presence.json'));
  assert.ok(codeFilesOf(s, 'jd_monitor_preferences').includes('tools/jd_monitor_preferences_catalog.py'));
  for (const kind of kindsOf(s)) assert.ok(codeFilesOf(s, stemOfKind(s, kind)), kind + ' 的 CODE_FILES 取不到');
});

test('反向 7：分支链顺序、标记-模块配对、跨链一致（纯函数，文本副本）', () => {
  // 把 text 中从 startA 到 startB、从 startB 到 startC 的相邻两段对调（startA/B/C 是各段的起始文本）。
  const swapAdjacent = (text, startA, startB, startC, from = 0) => {
    const a = text.indexOf(startA, from);
    const b = text.indexOf(startB, a);
    const c = text.indexOf(startC, b);
    assert.ok(a >= 0 && b > a && c > b, '反向用例找不到起止点: ' + startA);
    return text.slice(0, a) + text.slice(b, c) + text.slice(a, b) + text.slice(c);
  };
  const lineStartOf = (text, needle, from = 0) => {
    const at = text.indexOf(needle, from);
    assert.ok(at >= 0, '反向用例找不到 ' + needle);
    return text.slice(text.lastIndexOf(NL, at) + 1, at) + needle;
  };
  // py 链：每个分支是「if ... marker.exists():」+「from X import fn」两行，以 if 行起始。
  // 不写死代际名：取 finite[] 里终止代数最大的前三个 kind（链顶部三段），新增一代后自动跟着变。
  const [k1, k2, k3] = kindsDesc;
  const [stem1, stem2, stem3] = [k1, k2, k3].map((k) => stemOfKind(s, k));
  const markerOf = (stem) => activeOf(s, stem);
  const gateSwap = (region, before, after, third) => {
    const base = s.gate.indexOf(region);
    const startOf = (stem) => lineStartOf(s.gate, Q + markerOf(stem) + Q, base);
    return swapAdjacent(s.gate, startOf(before), startOf(after), startOf(third), base);
  };
  // 相邻对调：第 1、2 代（AiUnifiedTasks / AiTaskFeedbackCandidates）在 verify_release。
  const verifyOrder = gateSwap('def verify_release(', stem1, stem2, stem3);
  hit(checkChainOrder({...s, gate: verifyOrder}), 'verify_release', stem2);
  const dbOrder = gateSwap('def verify_database_complete(', stem1, stem2, stem3);
  hit(checkChainOrder({...s, gate: dbOrder}), 'verify_database_complete', stem2);
  // ps1 闸链：同样把前两代的整段对调（变量定义随段走，配对不变，只破坐顺序）。
  const varOf = (stem) => {
    const m = s.local.match(new RegExp('[$]([A-Za-z0-9]+) = Join-Path [$]candidateRoot ' + String.fromCharCode(39) + 'tools[/]' + stem + '_addition[.]py'));
    assert.ok(m, '反向用例找不到 ' + stem + ' 的闸变量定义');
    return '$' + m[1] + ' = Join-Path';
  };
  const localSwap = swapAdjacent(s.local, varOf(stem1), varOf(stem2), varOf(stem3));
  assert.notEqual(localSwap, s.local);
  hit(checkChainOrder({...s, local: localSwap}), 'Assert-NoUnapprovedProtectedAiMigration', stem2);
  // 最新代整个挪到 bi_app 之后（链尾）：会同时触发「比 finite[] 更早代际在前」和跨链不一致。
  const latest = (() => {
    const base = s.gate.indexOf('def verify_release(');
    const a = s.gate.lastIndexOf(NL, s.gate.indexOf(Q + markerOf(stem1) + Q, base)) + 1;
    const b = s.gate.lastIndexOf(NL, s.gate.indexOf(Q + markerOf(stem2) + Q, base)) + 1;
    const e = s.gate.indexOf(NL, s.gate.indexOf('from bi_app_addition import verify_active', base)) + 1;
    return s.gate.slice(0, a) + s.gate.slice(b, e) + s.gate.slice(a, b) + s.gate.slice(e);
  })();
  const moved = checkChainOrder({...s, gate: latest});
  assert.ok(moved.some((x) => x.includes('verify_release') && x.includes(k1)), '最新代挪到链尾应被抓到: ' + JSON.stringify(moved));
  assert.ok(moved.some((x) => x.includes('不一致')), '跨链顺序不一致应被抓到: ' + JSON.stringify(moved));
  // 标记与模块配对对调（形式上顺序不变）。
  const pa = Q + 'pi-agent-addition-active.json' + Q;
  const pw = Q + 'pi-workspace-addition-active.json' + Q;
  const crossed = s.gate.replace(pa, '@@A').replace(pw, pa).replace('@@A', pw);
  const crossedViolations = checkChainOrder({...s, gate: crossed});
  assert.ok(crossedViolations.length >= 1 && crossedViolations.every((x) => x.includes('verify_release') && x.includes('成对')), JSON.stringify(crossedViolations));
  // 更早代际排到 finite[] 之前（ai_schedule 上移到最前）。
  const gateText = s.gate;
  const base = gateText.indexOf('def verify_release(');
  const sa = gateText.lastIndexOf(NL, gateText.indexOf(Q + 'ai-schedule-addition-active.json' + Q, base)) + 1;
  const se = gateText.lastIndexOf(NL, gateText.indexOf(Q + 'jackyun-audit-addition-active.json' + Q, base)) + 1;
  const firstBranch = gateText.lastIndexOf(NL, gateText.indexOf(Q + markerOf(stem1) + Q, base)) + 1;
  const older = gateText.slice(0, firstBranch) + gateText.slice(sa, se) + gateText.slice(firstBranch, sa) + gateText.slice(se);
  const olderViolations = checkChainOrder({...s, gate: older});
  assert.ok(olderViolations.some((x) => x.includes('ai_schedule') && x.includes('更早代际')), JSON.stringify(olderViolations));
});

test('反向 4b：integration_release_gate.py 两条分支链与标记缺项', () => {
  const marker = Q + 'pi-agent-addition-active.json' + Q;
  only(checkGate({...s, gate: replaceNth(s.gate, 'from pi_agent_addition import verify_active', 'from pi_agent_additionX import verify_active')}), 'PiAgent', 'verify_release');
  only(checkGate({...s, gate: replaceNth(s.gate, 'from pi_agent_addition import complete_database', 'from pi_agent_additionX import complete_database')}), 'PiAgent', 'verify_database_complete');
  only(checkGate({...s, gate: replaceNth(s.gate, marker, Q + 'xx-addition-active.json' + Q, 0)}), 'PiAgent', 'verify_release');
  only(checkGate({...s, gate: replaceNth(s.gate, marker, Q + 'xx-addition-active.json' + Q, 1)}), 'PiAgent', 'verify_database_complete');
});

test('反向 5：digest SPECS 缺项、代数错、模块错', () => {
  const line = Q + 'PiAgent' + Q + ': (' + Q + 'pi_agent_candidate' + Q + ', (149,), 150, None),';
  only(checkDigest({...s, digest: removeNth(s.digest, line)}), 'PiAgent', 'SPECS');
  only(checkDigest({...s, digest: replaceNth(s.digest, line, line.replace('150', '151'))}), 'PiAgent', '终止代数');
  only(checkDigest({...s, digest: replaceNth(s.digest, line, line.replace('pi_agent_candidate', 'pi_workspace_candidate'))}), 'PiAgent', 'pi_agent_candidate');
  const extra = line.replace('PiAgent', 'Ghost');
  only(checkDigest({...s, digest: replaceNth(s.digest, line, line + NL + '    ' + extra)}), 'Ghost');
});

test('反向 5b：postgres_no_key_backup.py 缺 generation 或 catalog 导入', () => {
  only(checkBackup({...s, backup: replaceNth(s.backup, 'generation153 = sorted(', 'generation153X = sorted(')}), 'generation153', 'PiNative');
  only(checkBackup({...s, backup: replaceNth(s.backup, 'from pi_native_catalog import', 'from pi_native_catalogX import')}), 'PiNative', 'pi_native_catalog');
});

test('反向 6：ai_assistant 代际不在 Pi 运行账本权限名单；例外表可豁免', () => {
  const text = replaceNth(s.publish, "'PiNative','AiTaskFeedbackCandidates'", "'AiTaskFeedbackCandidates'");
  only(checkProvisionList({...s, publish: text}), 'PiNative', 'PROVISION_LIST_EXCEPTIONS');
  assert.deepEqual(checkProvisionList({...s, publish: text}, {PiNative: '测试用例：假设性豁免'}), []);
  only(checkProvisionList(s, {Ghost: 'x'}), 'Ghost');
  // 例外失效检测：名单里已有、不是 ai_assistant 代际、没有原因文字，都要报。
  only(checkProvisionList(s, {PiNative: '无意义例外'}), 'PiNative', '已失效');
  only(checkProvisionList(s, {TmallWarehouse: '无意义例外'}), 'TmallWarehouse', '不是 ai_assistant');
  only(checkProvisionList({...s, publish: text}, {PiNative: ''}), 'PiNative', '原因文字');
});

test('反向 5c：备份判定元组与 return 链必须纳入最新代', () => {
  // 只从某一个判定元组里去掉最新代（tmall_installed 那行）。
  // 最新一代的代数从规格表取，判定行从备份文件里现读（不写死 159）。
  const latest = 'generation' + latestSpec.to;
  const line = backupDefOf('tmall_installed');
  assert.ok(new RegExp('\\b' + latest + '\\b').test(line), 'tmall_installed 元组里应已有 ' + latest);
  // 对折行与尾逗号都稳健：连同前后至多一个逗号和空白一起删，并断言确实删掉了。
  const withoutLatest = line.replace(new RegExp(',?\\s*' + latest + '\\b,?'), '');
  assert.ok(!new RegExp('\\b' + latest + '\\b').test(withoutLatest), '去掉 ' + latest + ' 失败');
  const dropped = replaceNth(s.backup, line, withoutLatest);
  only(checkBackup({...s, backup: dropped}), latest, '判定元组');
  // 只从 return 链里去掉最新代。
  const lead = 'return ' + latestSpec.to + ' if ' + pairVarOf(latestSpec.to) + ' else ';
  hit(checkBackup({...s, backup: replaceNth(s.backup, lead, 'return ')}), latest, 'return 链');
});

test('反向 5d：备份 == 判定必须是最新一代；return 链配对的判定变量必须匹配', () => {
  // 最新代、上一代的代数与它们在 return 链里配的变量都现取，不写死；定义行可能是 == 也可能是元组，新增一代后会变。
  const latestN = latestSpec.to;
  const eqLatest = backupDefOf(pairVarOf(latestN));
  const tupleLine = backupDefOf(pairVarOf(prevTo));
  const indentOf = (l) => l.slice(0, l.length - l.trimStart().length);
  // 最新代的 == 判定改成上一代。
  // 会同时触发规则 C（== 判定不是最新代）和规则 D（return 链 159 配的变量最小代数是 158），两条都要报。
  const asEq = (line, n) => indentOf(line) + line.trim().split(' = ')[0] + ' = receipts == generation' + n;
  const edited = checkBackup({...s, backup: replaceNth(s.backup, eqLatest, asEq(eqLatest, prevTo))});
  assert.equal(edited.length, 2, JSON.stringify(edited));
  hit(edited, 'generation' + prevTo, '== generation' + prevTo, '最新一代是 generation' + latestN);
  hit(edited, 'generation' + latestN, 'return 链', '最小代数是 ' + prevTo);
  //一条元组判定改成 == 且 N 不是最新代（审查者的注入）。
  hit(checkBackup({...s, backup: replaceNth(s.backup, tupleLine, asEq(tupleLine, prevTo))}), 'generation' + prevTo, '== generation' + prevTo);
  // 146/147 不是 finite[] 终止代数，不受约束（当前主干即如此，无违规）。
  assert.deepEqual(checkBackup(s), []);
  // return 链：156 配的变量换成相邻一代的判定。
  only(checkBackup({...s, backup: replaceNth(s.backup, '156 if workflow_automation_installed', '156 if sales_preflight_installed')}), 'generation156', 'sales_preflight_installed', '最小代数是 154');
  // 配对变量没有定义：不能默认通过。
  only(checkBackup({...s, backup: replaceNth(s.backup, '156 if workflow_automation_installed', '156 if ghost_installed')}), 'generation156', 'ghost_installed', '找不到定义');
});

test('反向 5e：return 链里的配对写法超出提取器时必须报错，不能静默跳过', () => {
  // 审查者的注入：158 改配成带括号的变量。数字 158 仍在链里（规则 B 通过），但超出「N if 单个变量名」的形状。
  only(checkBackup({...s, backup: replaceNth(s.backup, '158 if feedback_candidates_installed', '158 if (workflow_automation_installed)')}), 'generation158', 'return 链', '形状');
  // and 组合形状。
  only(checkBackup({...s, backup: replaceNth(s.backup, '154 if sales_preflight_installed', '154 if sales_preflight_installed and native_installed')}), 'generation154', 'return 链', '形状');
  // 最新一代的配对同样要报（现取，不写死）。
  const lastVar = pairVarOf(latestSpec.to);
  only(checkBackup({...s, backup: replaceNth(s.backup, latestSpec.to + ' if ' + lastVar, latestSpec.to + ' if (' + lastVar + ')')}), 'generation' + latestSpec.to, '形状');
  // 代数整个不在链里：只报规则 B，不重复报「形状」。
  const gone = checkBackup({...s, backup: replaceNth(s.backup, '154 if sales_preflight_installed else ', '')});
  assert.ok(gone.length >= 1 && gone.every((x) => !x.includes('形状')), JSON.stringify(gone));
});

test('反向 4c：automation/ 逐文件复制清单缺项；未知前缀必须报错；backend/ 整目录不逐文件检查', () => {
  const quoted = (name) => Q + name + Q;
  const file = 'automation/n8n/pi-business/tmall-masitu-pi-business.candidate.workflow.json';
  const broken = checkLocalService({...s, local: s.local.split(quoted(file)).join(quoted('x_' + file))});
  assert.ok(broken.length === 1 && broken[0].startsWith('PiBusiness') && broken[0].includes(file) && broken[0].includes('复制清单'), JSON.stringify(broken));
  // 未知前缀：给 pi_business 的 CODE_FILES 追加 docs/ 文件。
  const text = s.additions.pi_business;
  const withDocs = {...s, additions: {...s.additions, pi_business: text.replace('tmall-masitu-pi-business.candidate.workflow.json")))', 'tmall-masitu-pi-business.candidate.workflow.json", "docs/x.md")))')}};
  assert.notEqual(withDocs.additions.pi_business, text);
  only(checkLocalService(withDocs), 'PiBusiness', 'docs/x.md', '入包方式');
  // backend/ 不该因不在复制清单而报错（当前主干 pi_business 列了 backend/ 文件且无违规）。
  assert.ok(codeFilesOf(s, 'pi_business').some((x) => x.startsWith('backend/')));
  assert.deepEqual(checkLocalService(s), []);
});

test('反向 3b：$biApplicationName 链每个 finite[] 代际都有分支', () => {
  const branch = "elseif($biRequest.AdditionKind -ceq 'PiNative'){'teruisi_pi_native_schema_append'}";
  only(checkBiAdopt({...s, biAdopt: removeNth(s.biAdopt, branch)}), 'PiNative', 'biApplicationName');
});
