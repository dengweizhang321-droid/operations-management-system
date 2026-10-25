import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {canonical,sha} from '../tools/main-prebuild-queue.mjs';
import {retirementNativeFiles,loadRetirementNativeTools} from '../tools/preparation-retirement-native.mjs';
import {hashRetirementSourceInventory} from '../tools/preparation-retirement-source.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('the exact old native ABI is loaded privately and the independent streaming digest matches its public byte protocol',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'s05d-retirement-test-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const pins=JSON.parse(await fs.readFile(path.join(repo,'docs/s05d-retirement-implementation-20261023/native-tool-pins.json'),'utf8')),nativeSource=pins.nativeToolsSource??pins.config?.nativeToolsSource;assert.ok(path.isAbsolute(nativeSource),'Named observed native source input required');const nativeToolsSource=path.join(root,'native-tools',sha(Buffer.from(canonical(retirementNativeFiles))));for(const [file,digest] of Object.entries(retirementNativeFiles)){const raw=await fs.readFile(path.join(nativeSource,...file.split('/')));assert.equal(sha(raw),digest);const target=path.join(nativeToolsSource,...file.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,raw);}
 const native=await loadRetirementNativeTools({stateDirectory:root,nativeToolsSource});assert.equal(native.api.hashRelativeFilesWithInventory,undefined,'Do not silently pretend the newer API exists');for(const name of ['validateWorkerSourceBinding','hashRelativeFiles','windowsPathSha256'])assert.equal(typeof native.api[name],'function');assert.equal(typeof native.rotation.resolveEffectiveReleaseChain,'function');const source=path.join(root,'source');await fs.mkdir(path.join(source,'中文'),{recursive:true});const payloads={'zero':Buffer.alloc(0),'中文/é.txt':Buffer.from('private unicode\n'),'chunk.bin':Buffer.alloc(1024*1024+3,17),'A.txt':Buffer.from([0,1,2,255])};for(const [name,raw] of Object.entries(payloads))await fs.writeFile(path.join(source,...name.split('/')),raw);const files=Object.keys(payloads).reverse(),actual=await hashRetirementSourceInventory(source,files),old=await native.api.hashRelativeFiles(source,files);assert.deepEqual(actual.tree,old);for(const [file,raw] of Object.entries(payloads))assert.equal(actual.inventory[file],sha(raw));assert.deepEqual(await native.sourceDigest(source,files),actual);
 const linked=path.join(source,'linked');await fs.link(path.join(source,'A.txt'),linked);await assert.rejects(hashRetirementSourceInventory(source,['linked']),/single-link/);await assert.rejects(hashRetirementSourceInventory(source,['../outside']));
});
