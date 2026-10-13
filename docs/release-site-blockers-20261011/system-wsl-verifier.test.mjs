import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat,mkdtemp,writeFile,link} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {SYSTEM_WSL_PATH,validateSystemWslTuple,readStrictPinnedFile} from './system-wsl-verifier.mjs';
const signature=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/SYSTEM_WSL_IDENTITY_V1.json'));
const before=await lstat(SYSTEM_WSL_PATH,{bigint:true}),bytes=await readFile(SYSTEM_WSL_PATH),after=await lstat(SYSTEM_WSL_PATH,{bigint:true});
function fixture(){return {file:SYSTEM_WSL_PATH,bytes,before,after,signature:structuredClone(signature)};}
test('only exact current Windows WSL binary shape matches reviewed identity',()=>{assert.equal(validateSystemWslTuple(fixture()).sha256,signature.sha256);});
test('same bytes at another path cannot use system exception',()=>{const f=fixture();f.file='D:\\other\\wsl.exe';assert.throws(()=>validateSystemWslTuple(f));});
test('ordinary hardlinked source still rejected',async()=>{const root=await mkdtemp('E:/codex-artifacts/release-site-blockers-20261011/system-tool-test-'),file=path.join(root,'source.mjs');const data=Buffer.from('safe test source');await writeFile(file,data,{flag:'wx'});await link(file,path.join(root,'extra-link.mjs'));await assert.rejects(readStrictPinnedFile(file,createHash('sha256').update(data).digest('hex')));});
test('system bytes drift rejected even caller record hash recomputed',()=>{const f=fixture();f.bytes=Buffer.from(bytes);f.bytes[0]^=1;f.signature.sha256=createHash('sha256').update(f.bytes).digest('hex');assert.throws(()=>validateSystemWslTuple(f));});
test('new system hardlink count rejected',()=>{const f=fixture();f.after=Object.assign(Object.create(after),{nlink:3n});assert.throws(()=>validateSystemWslTuple(f));});
test('system identity drift rejected',()=>{const f=fixture();f.after=Object.assign(Object.create(after),{ino:after.ino+1n});assert.throws(()=>validateSystemWslTuple(f));});
test('signature valid alone insufficient without exact signer',()=>{const f=fixture();f.signature.signerThumbprint='0'.repeat(40);assert.throws(()=>validateSystemWslTuple(f));});
test('different owner rejected',()=>{const f=fixture();f.signature.owner='BUILTIN\\Administrators';assert.throws(()=>validateSystemWslTuple(f));});
