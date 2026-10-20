import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeOperationBindings} from '../tools/install-main-prebuild.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t){
 const base=path.join(root,'tmp');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'native-diagnostic-')),releases=path.join(directory,'packets'),packet=path.join(releases,'exact-packet'),publish=path.join(packet,'publish-aaaaaaaaaaaa');await fs.mkdir(publish,{recursive:true});
 t.after(async()=>{assert.ok(path.resolve(directory).startsWith(root+path.sep));await fs.rm(directory,{recursive:true,force:true});});
 const started=path.join(publish,'PrepareApp-started.json');await fs.writeFile(started,JSON.stringify({at:'2026-10-20T00:00:00.000Z',script:path.join(directory,'tools/django-local-service.ps1'),action:'PrepareApp'}));
 return {directory,releases,packet,publish,log:path.join(packet,'publish-main-check.log')};
}
test('native evidence permits only the exact ordinary single-link diagnostic log and retains native records',async t=>{
 const f=await fixture(t),before=await nativeOperationBindings(f.releases);assert.equal(before.length,1);await fs.writeFile(f.log,'historical diagnostic only\n');assert.deepEqual(await nativeOperationBindings(f.releases),before);assert.equal(await fs.readFile(f.log,'utf8'),'historical diagnostic only\n');
});
test('native diagnostic leaf rejects a symlink or junction without following it',async t=>{
 const f=await fixture(t),target=path.join(f.directory,'outside');await fs.mkdir(target);await fs.symlink(target,f.log,'junction');await assert.rejects(nativeOperationBindings(f.releases),/redirected/);
});
test('native diagnostic leaf rejects an ordinary hard-linked file',async t=>{
 const f=await fixture(t),target=path.join(f.directory,'outside.log');await fs.writeFile(target,'private');await fs.link(target,f.log);await assert.rejects(nativeOperationBindings(f.releases),/Unsafe publish-main-check/);
});
test('native diagnostic leaf rejects directory type and other publish-prefixed files still reject',async t=>{
 const f=await fixture(t);await fs.mkdir(f.log);await assert.rejects(nativeOperationBindings(f.releases),/Unsafe publish-main-check/);await fs.rmdir(f.log);
 for(const name of ['publish-main-check.log.extra','publish-bbbbbbbbbbbb']){const file=path.join(f.packet,name);await fs.writeFile(file,'must not be ignored');await assert.rejects(nativeOperationBindings(f.releases),/not ordinary/);await fs.unlink(file);}
});
