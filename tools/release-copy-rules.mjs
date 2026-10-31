import path from 'node:path';
export const copyRuleSourcePaths=Object.freeze(['tools/django-local-service.ps1','tools/worker-local-release.mjs','tools/build-worker-helper.mjs','tools/collect-d1-retirement-proof.mjs']);
const normalized=s=>s.replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
function literalArray(source,name,cache={}){
  if(cache[name])return cache[name];
  const match=new RegExp(`(?:export )?const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`).exec(source);
  if(!match)throw Error(`unsupported array: ${name}`);
  const result=[];
  for(const expression of match[1].split(',').map(s=>s.trim()).filter(Boolean)){
    if(/^"[^"\n]+"$/.test(expression))result.push(JSON.parse(expression));
    else if(/^\.\.\.\w+$/.test(expression))result.push(...literalArray(source,expression.slice(3),cache));
    else if(/^\w+$/.test(expression)){
      const value=new RegExp(`(?:export )?const ${expression} = ("[^"\\n]+?");`).exec(source);
      if(!value)throw Error(`unsupported constant: ${expression}`);result.push(JSON.parse(value[1]));
    }else throw Error(`dynamic array expression: ${expression}`);
  }
  return cache[name]=result;
}
function callArguments(source,open){
  let depth=1,quote=null;
  for(let i=open;i<source.length;i++){
    const ch=source[i];
    if(quote){if(ch==='\\'){i++;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='(')depth++;
    if(ch===')'&&!--depth)return source.slice(open,i).trim();
  }
  throw Error('unterminated module call');
}
export function extractCopyRules(sources,readSource=p=>sources[p]){
 try{
  for(const p of copyRuleSourcePaths)if(typeof sources[p]!=='string')throw Error(`missing producer: ${p}`);
  const django=normalized(sources[copyRuleSourcePaths[0]]);
  const prepare=django.split('function Prepare-Application {')[1]?.split('\nfunction ')[0];
  const block=prepare?.split('foreach ($relative in @(')[1]?.split(')) {')[0];
  if(!block||block.replace(/"[^"\n]+"|[\s,]/g,''))throw Error('dynamic Django copy list');
  const djangoFiles=[...block.matchAll(/"([^"\n]+)"/g)].map(m=>m[1].replaceAll('\\','/'));
  djangoFiles.push('tools/django-local-service.ps1','config/dingtalk-replenishment.json','config/inventory-warehouse-mapping.json');
  // Recognize every current PrepareApp direct copy source. Additional sources
  // or copy commands require a review instead of silently becoming offline.
  const copySources=[...prepare.matchAll(/Copy-Item\s+-LiteralPath\s+(\$\w+)/g)].map(m=>m[1]);
  const expected=['$DingTalkReplenishmentConfigSource','$InventoryWarehouseMappingConfigSource','$PSCommandPath','$source','$installedIntegrationPolicy','$installedDeltaPolicy'];
  if(JSON.stringify(copySources)!==JSON.stringify(expected)||/\b(?:Copy-Item|Copy-ApplicationTree|Copy-WranglerRuntimeClosure)\b/gi[Symbol.match](prepare)?.length!==8)
    throw Error('unrecognized Django copy operation');
  if((prepare.match(/\bCopy-[A-Za-z][\w-]*/g)??[]).length!==8||
    !prepare.includes('$source = Join-Path $ExecutionRoot $relative')||
    !prepare.includes('Copy-ApplicationTree $BackendRoot (Join-Path $staging "backend")')||
    !prepare.includes('Copy-WranglerRuntimeClosure (Join-Path $staging "runtime-tools")')||
    !django.includes('$DingTalkReplenishmentConfigSource = Join-Path $ExecutionRoot "config\\dingtalk-replenishment.json"')||
    !django.includes('$InventoryWarehouseMappingConfigSource = Join-Path $ExecutionRoot "config\\inventory-warehouse-mapping.json"'))throw Error('unsupported Django copy helper or source binding');
  const worker=normalized(sources[copyRuleSourcePaths[1]]);
  const runtimeCopy=worker.split('export async function copyWorkerReleaseRuntimeArtifacts(sourceRoot, releaseRoot) {')[1]?.split('\nexport ')[0];
  if(!runtimeCopy?.includes('const source = path.join(sourceRoot, ...relativePath.split("/"));')||
    !runtimeCopy.includes('const target = path.join(releaseRoot, ...relativePath.split("/"));'))throw Error('unknown Worker runtime source binding');
  // Both runtime artifact copying sites must remain literal path-based loops.
  if((worker.match(/\bcopyFile\s*\(/g)??[]).length!==2||(worker.match(/await copyFile\(source, target\);/g)??[]).length!==2||
    (worker.match(/await cp\(/g)??[]).length!==3||
    !worker.includes('for (const relativePath of workerReleaseBundledSourcePaths) {'))throw Error('unrecognized Worker copy operation');
  for(const expression of ['await cp(path.join(buildRoot, "dist"), path.join(releaseStage, "dist"), { recursive: true, errorOnExist: true, force: false });','await cp(path.join(buildRoot, "node_modules"), path.join(releaseStage, "node_modules"), { recursive: true, errorOnExist: true, force: false });','await cp(helperBuild.helperRoot, path.join(releaseStage, "helper"), { recursive: true, errorOnExist: true, force: false });'])
    if(!worker.includes(expression))throw Error('dynamic Worker copy source or destination');
  const runtime=[...new Set([...literalArray(worker,'workerReleaseBundledSourcePaths'),...literalArray(worker,'workerReleaseKeyFilePaths')])];
  const builder=normalized(sources[copyRuleSourcePaths[2]]);
  const entry=/const entryRelativePath = ("[^"\n]+");/.exec(builder);
  if(!entry||!builder.includes('entryPoints: [entryPath]')||!builder.includes('packages: "external"'))throw Error('unknown helper build entry or package semantics');
  const resourceBlock=/const immutablePowerShellResources = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(builder)?.[1];
  if(!resourceBlock)throw Error('unknown helper resources');
  const resourcePattern=/\{\s*sourceRelativePath:\s*"([^"\n]+)",\s*outputRelativePath:\s*"([^"\n]+)"\s*\}/g;
  const resourceFiles=[...resourceBlock.matchAll(resourcePattern)].map(m=>m[1]);
  if(!resourceFiles.length||resourceBlock.replace(resourcePattern,'').replace(/[\s,]/g,''))throw Error('dynamic helper resource array');
  for(const p of resourceFiles)if(typeof readSource(p)!=='string')throw Error(`missing helper resource: ${p}`);
  const helperFiles=new Set(resourceFiles),pending=[JSON.parse(entry[1])];
  while(pending.length){
    const p=pending.pop();if(helperFiles.has(p))continue;helperFiles.add(p);
    const source=readSource(p);if(typeof source!=='string')throw Error(`missing helper dependency: ${p}`);
    // Imports are conservatively scanned even inside comments. Extra matches
    // over-include or fail closed; no source is evaluated or compiled.
    for(const call of source.matchAll(/\b(?:import|require)\s*\(/g)){
      if(!/^\s*(?:"[^"\r\n]*"|'[^'\r\n]*')\s*\)/.test(source.slice(call.index+call[0].length)))throw Error(`dynamic helper import: ${p}`);
    }
    const specifiers=[...source.matchAll(/\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["']([^"']+)["']/g)].map(m=>m[1]);
    for(const spec of specifiers){
      if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;
      const target=path.posix.normalize(spec.startsWith('@/')?spec.slice(2):path.posix.join(path.posix.dirname(p),spec));
      if(target.startsWith('../'))throw Error(`helper dependency escapes source: ${p}`);
      const candidates=[target,...['.ts','.tsx','.mjs','.js','.json','/index.ts','/index.tsx','/index.mjs','/index.js'].map(ext=>target+ext)];
      const resolved=candidates.find(c=>typeof readSource(c)==='string');
      if(!resolved)throw Error(`unresolved helper import: ${p}:${spec}`);pending.push(resolved);
    }
  }
  // Snapshot semantic consumers: retirement verifier and fresh proof collector.
  const snapshot=[...worker.matchAll(/["']((?:tools|lib|app|drizzle)\/[^"'\n]+\.(?:ts|mjs|sql))["']/g)].map(m=>m[1]);
  const migrations=literalArray(normalized(sources[copyRuleSourcePaths[3]]),'retirementMigrations').map(p=>`drizzle/${p}`);
  const controlFiles=new Set(),controlQueue=['tools/publish-latest-main.mjs','tools/publish-prepared-main.mjs','tools/publish-main.mjs'];
  while(controlQueue.length){
    const p=controlQueue.pop();if(controlFiles.has(p))continue;controlFiles.add(p);
    const source=readSource(p);if(typeof source!=='string')throw Error(`missing publication control dependency: ${p}`);
    for(const call of source.matchAll(/\b(?:import|require)\s*\(/g)){
      const expression=callArguments(source,call.index+call[0].length);
      if(/^(?:"[^"\r\n]*"|'[^'\r\n]*')$/.test(expression))continue;
      // Existing loaders select a frozen root but a literal module member.
      // Arbitrary environment, computed module names or new loader shapes fail.
      const frozen=/^pathToFileURL\(path\.join\((?:root|source|expected|config\.nativeToolsSource|binding\.bundleRoot|g\.root|run\.operation\.source\.frozenRoot),\s*['"](tools\/[A-Za-z0-9_./-]+\.mjs)['"]\)\)$/.exec(expression);
      if(frozen){controlQueue.push(frozen[1]);continue;}
      if(expression==='pathToFileURL(run.console.module)'){controlQueue.push('tools/preparation-retirement-console.mjs');continue;}
      throw Error(`dynamic publication control import: ${p}`);
    }
    for(const m of source.matchAll(/\b(?:from\s*|import\s*\(\s*)["'](\.\.?\/[^"']+)["']/g)){
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(p),m[1]));
      if(target.startsWith('tools/'))controlQueue.push(target);
    }
  }
  return {known:true,djangoFiles,workerFiles:[...new Set([...runtime,...helperFiles,...snapshot,...migrations,'tools/build-worker-helper.mjs'])].sort(),controlFiles:[...controlFiles].sort(),runtimeFiles:runtime,helperFiles:[...helperFiles].sort(),snapshotConsumers:[...new Set([...snapshot,...migrations])].sort(),archiveOnlySnapshotExcluded:true};
 }catch(error){return {known:false,reason:error.message};}
}

// Pure: no filesystem, git, import/eval of a producer, or process execution.
export function copiedComponents(relativePath,rules){
  const p=relativePath.replaceAll('\\','/');
  if(!p||p.startsWith('/')||p.includes(':')||p.split('/').some(s=>s==='..'||s===''||s==='.')||!rules?.known)
    return {known:false,components:['worker','django'],reason:rules?.reason??'invalid path or unknown rules'};
  // Windows paths compare without case. Noncanonical case must never evade a list.
  const lower=p.toLowerCase();
  const worker=(rules.workerFiles??[]).some(x=>x.toLowerCase()===lower);
  const django=rules.djangoFiles.some(x=>x.toLowerCase()===lower);
  return {known:true,components:[worker&&'worker',django&&'django'].filter(Boolean),reason:worker?'Worker runtime/helper/semantic-snapshot input closure':'explicit application copy inventory'};
}
