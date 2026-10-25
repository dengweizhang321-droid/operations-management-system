// Non-author probes. Only temporary synthetic inputs and read-only Node/npm
// bytes are used. No production operator, service or business endpoint.
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { classifyImpact, hash, readSourceTree, sourceTreeDigest, sourceInventory, safeRead, safeFileDigest } from '../../tools/release-impact.mjs';
import { createPreparationEvidenceSession } from '../../tools/release-preparation-evidence.mjs';
import { hashTree, windowsPathSha256, preparationEnvironmentSha256 } from '../../tools/worker-local-release.mjs';

const effects = Object.fromEntries(['data','permissions','writes','imports','automation','lifecycle','backup','dependencyBehavior'].map(key => [key, false]));
function classify(before, after) {
  const proof = classifyImpact({ before, after });
  return classifyImpact({ before, after, witness: { kind:'display', independent:true, status:'passed', reviewer:'non-author independent fixture', effects, deltaSha256:proof.deltaSha256, closureSha256:proof.closureSha256 } });
}
const localCases = [
  ['passive-text', '{open && <span>Details</span>}', 'display'],
  ['conditional-resource', '<img src={open ? "/api/trigger" : "/ok.png"} />', 'strict'],
  ['submit-control', '<button type="submit" disabled={open}>Run</button>', 'strict'],
  ['conditional-assignment', '{open && <span>{window.location.href = "/api/run"}</span>}', 'strict'],
  ['tagged-template', '<span>{danger`payload`}</span>', 'strict'],
  ['constructor', '<span>{new Image().src="/api/run"}</span>', 'strict'],
  ['other-event', '<div onMouseEnter={()=>window.location.href="/api/run"}>{open && <span>Details</span>}</div>', 'strict'],
  ['customized-builtin', '{open && <button type="button" is="write-on-connect">Run</button>}', 'strict'],
];
for (const [name, content, expected] of localCases) {
  const source = '"use client";import {useState} from "react";export default function V(){const [open,setOpen]=useState(false);return <div><button type="button" onClick={()=>setOpen(false)}>Toggle</button>'+content+'</div>;}';
  const actual = classify({'app/view.tsx':source}, {'app/view.tsx':source.replace('setOpen(false)','setOpen(true)')}).level;
  assert.equal(actual, expected, name);
  console.log(JSON.stringify({ probe:name, expected, actual, passed:true }));
}
for (const prefix of ['globalThis.counter++,', 'window.location.href="/api/run",', 'globalThis.saved=']) {
  const source = '"use client";import {useState} from "react";export default function V(){const [open,setOpen]=useState(false);return ('+prefix+'<div><button type="button" onClick={()=>setOpen(false)}>Toggle</button>{open && <span>Details</span>}</div>);}';
  const actual = classify({'app/view.tsx':source}, {'app/view.tsx':source.replace('setOpen(false)','setOpen(true)')}).level;
  assert.equal(actual, 'strict');
  console.log(JSON.stringify({ probe:'return-side-effect', expected:'strict', actual, passed:true }));
}

const root = await mkdtemp(path.join(tmpdir(), 'teruisi-independent-race-'));
const sourceRoot = path.join(root,'source');
const runtime = path.join(root,'runtime.vars');
const rc = path.join(root,'fixture.npmrc');
await mkdir(sourceRoot);
await writeFile(path.join(sourceRoot,'view.tsx'),'baseline');
await writeFile(runtime,'fixture only');
await writeFile(rc,'registry=https://fixture.invalid');
const npmRoot = path.join(path.dirname(process.execPath),'node_modules','npm');
const identify = async () => {
  const source = await readSourceTree(sourceRoot);
  return {
    sourceTree:{sha256:sourceTreeDigest(source)}, sourceInventorySha256:hash(sourceInventory(source)),
    nodeExecutableSha256:await safeFileDigest(process.execPath), toolchain:{npmPackageTree:await hashTree(npmRoot)},
    runtimeConfigurationSha256:hash(await safeRead(runtime)), environmentSha256:preparationEnvironmentSha256(process.env),
    externalNpmConfiguration:Object.fromEntries(['userconfig','globalconfig'].map(key=>[key,{pathSha256:windowsPathSha256(rc),contentSha256:hash('registry=https://fixture.invalid')}])),
  };
};
let session;
try {
  session=createPreparationEvidenceSession({batchSha256:'1'.repeat(64),sourceRoot,devVarsSource:runtime,identify,execute:async()=>({stdout:rc})});
  await session.collect({approvedBatchSha256:'1'.repeat(64)});
  let injected=false;
  await assert.rejects(session.recheck({measure:async(stage,_category,action)=>{
    if(stage==='toolchain-content'&&!injected) {
      injected=true;
      await writeFile(path.join(sourceRoot,'view.tsx'),'modified after final source observation');
    }
    return action();
  }}), /changed/);
  assert.equal(injected,true);
  console.log(JSON.stringify({probe:'actual-byte-change-during-recheck',passed:true,productionOperatorCalls:0}));
} finally {
  session?.dispose();
  if (!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)) throw new Error('Cleanup escaped synthetic fixture');
  await rm(root,{recursive:true,force:true});
}
