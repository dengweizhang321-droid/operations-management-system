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

// 关系 6（Pi 运行账本权限清单）的显式例外表：kind -> 原因与证据位置。
// 当前为空：没有已知的合法例外。只有读懂 aiRolesChanged 与 ProvisionRoles 后确认
// 某代 ai_assistant 迁移确实不需要重算授权，才允许在这里登记，并写清证据。
export const PROVISION_LIST_EXCEPTIONS = {};

// 关系 4a（candidate 在 Prepare-Application 复制清单）的显式历史例外：kind -> 原因与证据位置。
// 例外失效（清单里已有该文件）或对应规格已不存在时本测试会报错，要求删除例外。
export const COPY_LIST_CANDIDATE_EXCEPTIONS = {
  JdProductMonitoring:
    '实测事实（a264880f）：tools/jd_product_monitoring_addition.py 全文不引用 jd_product_monitoring_candidate，' +
    '其 CODE_FILES 也不列它；而 tools/tmall_warehouse_addition.py 第 35 行起每代都把自己的 candidate 列入 CODE_FILES。' +
    '该 candidate 由 5663930f 与 finite[] 条目同次引入，当时复制清单没有扩展。' +
    '按 main-schema-release.mjs invokeBinder，binder 从冻结来源目录调用、不经已安装的 app，' +
    '所以按「历史遗留」登记为例外；这是基于以上证据的推断，并非代码里的明文规则，请验收时确认。',
};

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
  const additions = {};
  for (const spec of specs) {
    const file = 'tools/' + stemOf(spec) + '_addition.py';
    if (exists.has(file)) additions[stemOf(spec)] = readRepo(file);
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
  atLeast('bi-app-adopt.ps1 名单', lists.length, MIN.biLists);
  atLeast('bi-app-adopt.ps1 kind->addition 映射', pairs.length, MIN.biPairs);
  return {lists, pairs};
}

function extractLocal(s) {
  const chainRegion = region(s.local, 'function Assert-NoUnapprovedProtectedAiMigration', 'django-local-service.ps1');
  const chain = new Set([...chainRegion.matchAll(/Join-Path [$]candidateRoot 'tools[/]([A-Za-z0-9_]+_addition)[.]py'/g)].map((m) => m[1]));
  const markers = new Set([...chainRegion.matchAll(/'([a-z0-9-]+-addition-active[.]json)'/g)].map((m) => m[1]));
  const copyRegion = region(s.local, 'function Prepare-Application', 'django-local-service.ps1');
  const copy = new Set([...copyRegion.matchAll(new RegExp(Q + 'tools[/]([^' + Q + ']+)' + Q, 'g'))].map((m) => m[1]));
  atLeast('django-local-service.ps1 闸链', chain.size, MIN.localChain);
  atLeast('django-local-service.ps1 active 标记', markers.size, MIN.localMarkers);
  atLeast('django-local-service.ps1 复制清单', copy.size, MIN.localCopy);
  return {chain, markers, copy};
}

function extractGate(s) {
  const verify = region(s.gate, 'def verify_release(', 'integration_release_gate.py');
  const db = region(s.gate, 'def verify_database_complete(', 'integration_release_gate.py');
  const names = (text, fn) => new Set([...text.matchAll(new RegExp('from ([A-Za-z0-9_]+_addition) import ' + fn, 'g'))].map((m) => m[1]));
  const markers = (text) => new Set([...text.matchAll(new RegExp(Q + '([a-z0-9-]+-addition-active[.]json)' + Q, 'g'))].map((m) => m[1]));
  const result = {
    verify: names(verify, 'verify_active'),
    verifyMarkers: markers(verify),
    db: names(db, 'complete_database'),
    dbMarkers: markers(db),
  };
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
  atLeast('postgres_no_key_backup.py generation 定义', generations.size, MIN.backupGenerations);
  atLeast('postgres_no_key_backup.py catalog 导入', catalogs.size, MIN.backupCatalogs);
  return {generations, catalogs};
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
  const {lists, pairs} = extractBi(s);
  for (const kind of kindsOf(s)) {
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
export function checkLocalService(s, candidateExceptions = COPY_LIST_CANDIDATE_EXCEPTIONS) {
  const v = [];
  const {chain, markers, copy} = extractLocal(s);
  for (const kind of Object.keys(candidateExceptions)) {
    const stem = kindsOf(s).includes(kind) ? stemOfKind(s, kind) : null;
    if (!stem) v.push(kind + ': COPY_LIST_CANDIDATE_EXCEPTIONS 里的例外已不对应任何规格，请删除');
    else if (copy.has(stem + '_candidate.py')) v.push(kind + ': tools/' + stem + '_candidate.py 已在复制清单，例外已失效，请从 COPY_LIST_CANDIDATE_EXCEPTIONS 删除');
  }
  for (const kind of kindsOf(s)) {
    const stem = stemOfKind(s, kind);
    if (!chain.has(stem + '_addition')) {
      v.push(kind + ': tools/' + stem + '_addition.py 不在 django-local-service.ps1 的 Assert-NoUnapprovedProtectedAiMigration 闸链。补：照相邻代际加一段同构代码');
    }
    const active = activeOf(s, stem);
    if (!active) v.push(kind + ': tools/' + stem + '_addition.py 里没读到 ACTIVE 标记文件名');
    else if (!markers.has(active)) v.push(kind + ': 标记文件 ' + active + ' 不在 django-local-service.ps1 闸链。补：闸链用它判定该代是否生效');
    for (const suffix of ['_addition.py', '_candidate.py']) {
      if (suffix === '_candidate.py' && candidateExceptions[kind]) continue;
      if (!copy.has(stem + suffix)) v.push(kind + ': tools/' + stem + suffix + ' 不在 django-local-service.ps1 Prepare-Application 复制清单。补：加进清单，否则发布包缺文件');
    }
    if (s.exists.has('tools/' + stem + '_catalog.py') && !copy.has(stem + '_catalog.py')) {
      v.push(kind + ': tools/' + stem + '_catalog.py 不在 django-local-service.ps1 Prepare-Application 复制清单。补：加进清单');
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
  const {generations, catalogs} = extractBackup(s);
  for (const to of [...new Set(s.specs.map((x) => x.to))].sort((a, b) => a - b)) {
    if (!generations.has(to)) {
      v.push('generation' + to + '（' + s.specs.filter((x) => x.to === to).map((x) => x.kind).join('/') + '）: 缺在 tools/postgres_no_key_backup.py 的 verify_receipt_generation。补：加 generation' + to + ' 定义并纳入各 *_installed 判定');
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
    if (!list.includes(kind) && !exceptions[kind]) {
      v.push(kind + ': 迁移在 backend/ai_assistant/migrations/，但不在 tools/publish-prepared-main.mjs 的「配置Pi运行账本权限」名单。补：加进名单（否则授权不会重算，writer 可能 503）；若确不需要，在测试的 PROVISION_LIST_EXCEPTIONS 登记原因与证据');
    }
  }
  for (const kind of Object.keys(exceptions)) {
    if (!kindsOf(s).includes(kind)) v.push(kind + ': PROVISION_LIST_EXCEPTIONS 里的例外已不对应任何规格，请删除');
  }
  return v;
}

const RELATIONS = {checkRecipes, checkFiles, checkChain, checkBiAdopt, checkLocalService, checkGate, checkDigest, checkBackup, checkProvisionList};

// ---------------------------------------------------------------- 测试

const s = snapshot();
const spec = (kind) => s.specs.find((x) => x.kind === kind);

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
  const edit = (patch) => ({...s, specs: s.specs.map((x) => (x.kind === 'AiUnifiedTasks' ? {...x, ...patch} : x))});
  only(checkChain(edit({steps: []})), 'AiUnifiedTasks', 'steps');
  only(checkChain(edit({from: 999, to: 1000})), 'AiUnifiedTasks', '999');
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
  const quoted = (name) => Q + 'tools/' + name + Q;
  for (const name of ['pi_agent_addition.py', 'pi_agent_candidate.py', 'pi_agent_catalog.py']) {
    only(checkLocalService({...s, local: replaceNth(s.local, quoted(name), quoted('x_' + name))}), 'PiAgent', name);
  }
  // 历史例外表：没有例外时 JdProductMonitoring 的 candidate 会报出；例外失效或指向不存在的 kind 也要报。
  only(checkLocalService(s, {}), 'JdProductMonitoring', 'jd_product_monitoring_candidate.py');
  only(checkLocalService(s, {...COPY_LIST_CANDIDATE_EXCEPTIONS, PiAgent: 'x'}), 'PiAgent', '例外已失效');
  only(checkLocalService(s, {...COPY_LIST_CANDIDATE_EXCEPTIONS, Ghost: 'x'}), 'Ghost');
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
  assert.deepEqual(PROVISION_LIST_EXCEPTIONS, {}, '主干当前不应有例外；新增例外须在评审中写明原因与证据位置');
});
