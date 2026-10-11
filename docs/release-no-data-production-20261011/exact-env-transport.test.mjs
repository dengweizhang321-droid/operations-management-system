import test from'node:test';import assert from'node:assert/strict';import{readFile,lstat}from'node:fs/promises';import{spawnSync}from'node:child_process';import{protectEnvironment,consumeEnvironment,environmentHash,exactEnvironment}from'./exact-env-transport.mjs';
const synthetic={SystemRoot:'C:\\Windows',SystemDrive:'C:',TEMP:'C:\\Windows\\Temp',TMP:'C:\\Windows\\Temp',HOMEDRIVE:'C:',HOMEPATH:'\\synthetic',LOGONSERVER:'\\\\synthetic',PATH:'C:\\Windows\\System32',USERDOMAIN:'synthetic',USERNAME:'synthetic',USERPROFILE:'C:\\synthetic',WINDIR:'C:\\Windows',SYNTHETIC_TOKEN:'test-only-not-a-real-secret',UNICODE_TEST:'合成值',TERUISI_PROCESS_DEADLINE_UNIX_MS:'1'};
test('only original deadline exclusion and NODE rejection',()=>{const cleaned=exactEnvironment(synthetic);assert.ok(!Object.hasOwn(cleaned,'TERUISI_PROCESS_DEADLINE_UNIX_MS'));assert.equal(environmentHash(synthetic),environmentHash(cleaned));assert.throws(()=>exactEnvironment({...synthetic,NODE_OPTIONS:''}));});
test('same-user real DPAPI roundtrip, ciphertext-only temp, exact child env and owned deletion',async()=>{
 const expected=environmentHash(synthetic),manifest=await protectEnvironment(synthetic,expected);
 const cipher=await readFile(manifest.path);assert.ok(!cipher.includes(Buffer.from(synthetic.SYNTHETIC_TOKEN)));assert.equal((await lstat(manifest.path)).nlink,1);
 await assert.rejects(consumeEnvironment({...manifest,cipherSha256:'0'.repeat(64)},expected));assert.ok((await lstat(manifest.path)).isFile());
 await assert.rejects(consumeEnvironment({...manifest,nonce:'0'.repeat(32)},expected));assert.ok((await lstat(manifest.path)).isFile());
 const env=await consumeEnvironment(manifest,expected);assert.deepEqual(env,exactEnvironment(synthetic));await assert.rejects(lstat(manifest.path),e=>e.code==='ENOENT');
 const source="const c=v=>Array.isArray(v)?'['+v.map(c).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+c(v[k])).join(',')+'}':JSON.stringify(v);console.log(require('crypto').createHash('sha256').update(c(process.env)).digest('hex'));";
 const child=spawnSync(process.execPath,['-e',source],{env,encoding:'utf8',windowsHide:true});assert.equal(child.status,0);assert.equal(child.stdout.trim(),expected,'Synthetic complete environment must reach child without extra fields');
});
