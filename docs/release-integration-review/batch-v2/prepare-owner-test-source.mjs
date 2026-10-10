// Copy PUBLIC installed backend source and current tests into an isolated root.
// Never copies .env/credentials/databases and never launches production services.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { sha } from './validators.mjs';
const own=path.dirname(fileURLToPath(import.meta.url)), repository=path.resolve(own,'../../..');
const source='D:/teruisi-runtime/django-sales/app/backend', target=path.join(repository,'.runtime/owner-acceptance/backend');
const digest=sha(await readFile('D:/teruisi-runtime/django-sales/app/deployment.json'));
assert.equal(digest,'237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9');
const inventory=[];
async function copy(dir, output, prefix, kind) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    assert.ok(!entry.isSymbolicLink());
    if(['__pycache__','.git','.runtime','.venv','node_modules'].includes(entry.name)||entry.name.endsWith('.pyc')
      ||entry.name.startsWith('.env')&&!/\.(example|sample)$/.test(entry.name))continue;
    const name=prefix+entry.name;
    if(entry.isDirectory())await copy(path.join(dir,entry.name),path.join(output,entry.name),name+'/',kind);
    else {
      assert.ok(!/\.(?:sqlite3?|db|dump|dpapi)$/i.test(name)&&!/(?:^|\/)secrets\//i.test(name));
      const raw=await readFile(path.join(dir,entry.name));await mkdir(output,{recursive:true});
      await writeFile(path.join(output,entry.name),raw,{flag:'wx'});
      assert.equal(sha(await readFile(path.join(output,entry.name))),sha(raw));
      inventory.push({path:name,kind,bytes:raw.length,sha256:sha(raw)});
    }
  }
}
await copy(source,target,'backend/','exact-installed-owner');
for(const name of ['access_control','customer_service'])await copy(path.join(repository,'backend',name,'tests'),path.join(target,name,'tests'),`backend/${name}/tests/`,'current-isolated-test-only');
await writeFile(path.join(own,'../evidence/owner-test-source.json'),JSON.stringify({version:'task-d-exact-owner-isolation-v1',ownerManifestSha256:digest,
  productionSource:source,isolatedSource:target,productionConnectionsAllowed:false,sourceFiles:inventory.filter(x=>x.kind==='exact-installed-owner').length,
  testFiles:inventory.filter(x=>x.kind==='current-isolated-test-only').length,inventory},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'prepared',sourceFiles:inventory.filter(x=>x.kind==='exact-installed-owner').length,testFiles:inventory.filter(x=>x.kind==='current-isolated-test-only').length}));
