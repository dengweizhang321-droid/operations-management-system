import path from 'node:path';
import { watch } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { safeRead, safeFileDigest, readSourceTree, sourceInventory, sourceTreeDigest, hash, canonical, requireHash } from './release-impact.mjs';
import { workerPreparationIdentity, hashTree, runProcess, workerDevVarsSource, windowsPathSha256 } from './worker-local-release.mjs';

const lifetimeMs = 10 * 60 * 1000;
const maximumUses = 24;
// Only derived identity is reused. Every use reads complete source, Node,
// bundled npm and configuration bytes afresh. Artifact/ACL/process/restore
// checks are deliberately outside this context. No persistent cache input.
export function createPreparationEvidenceSession({ batchSha256, sourceRoot, devVarsSource = workerDevVarsSource,
  clock = () => performance.now(), identify = workerPreparationIdentity, execute = runProcess, observeInputs } = {}) {
  requireHash(batchSha256, 'evidence session batch');
  const npmRoot = path.join(path.dirname(process.execPath),'node_modules','npm');
  const cli = path.join(npmRoot,'bin','npm-cli.js');
  let entry = null, busy = false, disposed = false;
  let changed=false;
  const watchers=[];
  const watched=new Set();
  async function monitor(target,{recursive=false,source=false}={}) {
    let directory=recursive?target:path.dirname(target);
    const intendedDirectory=directory;
    while(true) {
      try {await lstat(directory);break;}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(directory);if(parent===directory)throw e;directory=parent;}
    }
    if(directory!==intendedDirectory)recursive=true;
    const key=`${path.resolve(target).toLowerCase()}|${recursive}|${source}`;
    if(watched.has(key))return;
    const handle=watch(directory,{recursive,persistent:false},(_event,name)=>{
      const relative=name?.toString().replaceAll('\\','/');
      if(source&&relative&&/^(node_modules|dist|\.runtime|outputs|tmp)(\/|$)/.test(relative))return;
      if(recursive||!relative||path.resolve(directory,relative).toLowerCase()===path.resolve(target).toLowerCase())changed=true;
    });
    handle.on('error',()=>{changed=true;});watchers.push(handle);watched.add(key);
  }
  async function startMonitoring(targets) {
    // Test observers are an isolated seam; production always watches actual
    // input trees. Watch events only invalidate; they never prove byte equality.
    if(observeInputs)return;
    if(!watchers.length) {
      await monitor(sourceRoot,{recursive:true,source:true});
      await monitor(npmRoot,{recursive:true});
      for(const target of [process.execPath,devVarsSource])await monitor(target);
    }
    for(const target of Object.values(targets))await monitor(target);
  }
  function assertStable() {
    if(disposed)throw new Error('Evidence session disposed during observation');
    if(changed)throw new Error('Inputs changed while evidence session was held');
    if(entry&&(clock()-entry.startedAt<0||clock()-entry.startedAt>lifetimeMs))throw new Error('Evidence session expired during observation');
  }
  async function optionalDigest(target) {
    try { return hash(await safeRead(target)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function observe(targets, measure) {
    const source = await measure('source-content','mutable-input',()=>readSourceTree(sourceRoot));
    const sourceSha256 = sourceTreeDigest(source), sourceInventorySha256 = hash(sourceInventory(source));
    const toolchain = await measure('toolchain-content','mutable-input',async()=>({
      node:await safeFileDigest(process.execPath), npmPackageSha256:hash(await safeRead(path.join(npmRoot,'package.json'))), npm:await hashTree(npmRoot), version:process.version,
    }));
    const configuration = await measure('configuration-content','mutable-input',async()=>({
      runtime:hash(await safeRead(devVarsSource)), environment:hash(process.env),
      projectNpmrc:await optionalDigest(path.join(sourceRoot,'.npmrc')),
      external:Object.fromEntries(await Promise.all(Object.entries(targets).map(async([k,p])=>[k,{path:p,sha256:await optionalDigest(p)}]))),
    }));
    // Git inventory selection is mutable too (linked-worktree indexes may be
    // outside sourceRoot). Bracket the tool/config observation with a complete
    // fresh inventory, instead of treating a watcher as completeness evidence.
    const finalSource=await measure('source-content-final','mutable-input',()=>readSourceTree(sourceRoot));
    if(sourceTreeDigest(finalSource)!==sourceSha256||hash(sourceInventory(finalSource))!==sourceInventorySha256)throw new Error('Source inventory changed during input observation');
    await new Promise(resolve=>setImmediate(resolve));assertStable();
    return { sourceSha256, sourceInventorySha256, toolchain, configuration };
  }
  function matchIdentity(snapshot, identity) {
    if (snapshot.sourceSha256!==identity.sourceTree.sha256 || snapshot.sourceInventorySha256!==identity.sourceInventorySha256
      || snapshot.toolchain.node!==identity.nodeExecutableSha256 || canonical(snapshot.toolchain.npm)!==canonical(identity.toolchain.npmPackageTree)
      || snapshot.configuration.runtime!==identity.runtimeConfigurationSha256 || snapshot.configuration.environment!==identity.environmentSha256
      || Object.entries(snapshot.configuration.external).some(([k,v])=>v.sha256!==identity.externalNpmConfiguration[k]?.contentSha256
        || windowsPathSha256(v.path)!==identity.externalNpmConfiguration[k]?.pathSha256)) {
      throw new Error('Source/configuration/toolchain changed during full evidence verification');
    }
  }
  const directMeasure = async(_stage,_category,action)=>action();
  async function exclusive(action) {
    if (disposed || busy) throw new Error('Evidence session is disposed or concurrently occupied');
    busy = true;
    try { const result=await action(); assertStable(); return result; }
    catch (e) { entry=null; throw e; } finally { busy=false; }
  }
  return Object.freeze({
    async collect({ approvedBatchSha256, full = false, measure = directMeasure } = {}) {
      return exclusive(async()=>{
        if (approvedBatchSha256!==batchSha256) throw new Error('Evidence belongs to another batch');
        if (entry && (clock()-entry.startedAt < 0 || clock()-entry.startedAt > lifetimeMs || entry.uses >= maximumUses)) entry=null;
        if (full || !entry) {
          await startMonitoring({});assertStable();
          const identity = await measure('full-preparation-identity','mutable-input',()=>identify(sourceRoot,devVarsSource));
          const targets = {};
          for (const k of ['userconfig','globalconfig']) {
            const result = await measure('npm-config-resolution','mutable-input',()=>execute(process.execPath,[cli,'config','get',k],{cwd:sourceRoot,label:'release npm path identity'}));
            targets[k]=path.resolve(sourceRoot,result.stdout.trim());
          }
          await startMonitoring(targets);assertStable();
          const after = await (observeInputs??observe)(targets,measure);
          matchIdentity(after,identity);
          entry={identity:structuredClone(identity),snapshot:after,targets,startedAt:clock(),uses:0};
        } else {
          const current = await (observeInputs??observe)(entry.targets,measure);
          if(disposed)throw new Error('Evidence session disposed during observation');
          if (canonical(current)!==canonical(entry.snapshot)) throw new Error('Reused evidence invalidated by input content');
        }
        entry.uses++;
        return structuredClone(entry.identity);
      });
    },
    async recheck({measure=directMeasure}={}) {
      return exclusive(async()=>{
        if (!entry || clock()-entry.startedAt > lifetimeMs || clock()-entry.startedAt < 0) throw new Error('Evidence session expired');
        const current=await (observeInputs??observe)(entry.targets,measure);
        if(disposed)throw new Error('Evidence session disposed during observation');
        if (canonical(current)!==canonical(entry.snapshot)) throw new Error('Inputs changed after admission check');
      });
    },
    assertStable,
    dispose() { entry=null; disposed=true;for(const watcher of watchers)watcher.close(); },
  });
}
