import {readFile,writeFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const expected='bc9eb01f2cab31767e7569d5f971626956f10cc0',prefix='docs/release-no-data-production-20261011/',sha=b=>createHash('sha256').update(b).digest('hex');
function git(args){const r=spawnSync('git',args,{windowsHide:true,maxBuffer:16777216});assert.equal(r.status,0);return r.stdout;}
const remote=git(['ls-remote','origin','refs/heads/main','refs/heads/codex/release-no-data-production-20261011']).toString().trim().split('\n');assert.equal(remote.length,2);for(const line of remote)assert.equal(line.split(/\s+/)[0],expected);
const files=git(['ls-tree','-r','--name-only','-z',expected,'--',prefix]).toString().split('\0').filter(Boolean);
for(const f of files)assert.equal(sha(git(['show',expected+':'+f])),sha(await readFile(f)),f+' differs from delivered bytes');
const result={at:new Date().toISOString(),commit:expected,remoteMainAndBranchVerified:true,taskSourceBlobs:files.length,allDeliveredBytesMatch:true,productionComplete:false,productionBlocker:'original Start full-readiness unresolved; old watchdog binding drift and missing service receipts'};
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/GIT_MORNING_DELIVERY_VERIFIED.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
