import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyOverrideRows,replaceCatalog} from './reconcile-accounting.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('one exact override reconstructs the original tree; an unlisted change is rejected',()=>{
 const before=sha('old'),after=sha('new'),unchanged=sha('other');
 const rows=['a.json\n'+after,'b.py\n'+unchanged];
 const r={fileCount:2,currentFingerprint:sha(rows.join('\n')),baseFingerprint:sha(['a.json\n'+before,rows[1]].join('\n')),override:{path:'a.json',beforeSha256:before,afterSha256:after}};
 const e={algorithm:'relative-path-file-sha256-ordinal-v2',fileCount:2,rows,fingerprint:r.currentFingerprint};
 assert.equal(verifyOverrideRows(e,r).reconstructedBaseFingerprint,r.baseFingerprint);
 const changed=[rows[0],'b.py\n'+sha('unexplained')],fingerprint=sha(changed.join('\n'));
 assert.throws(()=>verifyOverrideRows({...e,rows:changed,fingerprint},{...r,currentFingerprint:fingerprint}),/Unexplained application changes/);
});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-accounting-private-'));
 assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const catalogFile=path.join(root,'PUBLISHED-MAIN.json'),original=JSON.stringify({status:'old-index'})+'\n';await fs.writeFile(catalogFile,original);
 return {catalogFile,directory:path.join(root,'repair'),expectedSha:sha(original),receipt:{status:'deployed_and_ready',publicationPerformed:false,accountingRepair:{kind:'post-failure-recovery-acknowledged'}},original};
}
test('only a separate acknowledgement and preserved catalog are written',async t=>{
 const x=await fixture(t),result=await replaceCatalog(x),catalog=JSON.parse(await fs.readFile(x.catalogFile,'utf8'));
 assert.equal(await fs.readFile(path.join(x.directory,'superseded-PUBLISHED-MAIN.json'),'utf8'),x.original);
 assert.equal(catalog.receiptPath,result.receiptPath);assert.equal(sha(await fs.readFile(result.receiptPath)),catalog.receiptSha256);
 assert.equal(catalog.publicationPerformed,false);assert.equal(path.basename(result.receiptPath),'ACKNOWLEDGED.json');
 assert.deepEqual((await fs.readdir(x.directory)).sort(),['ACKNOWLEDGED.json','superseded-PUBLISHED-MAIN.json']);
});
test('changed initial catalog refuses all repair writes',async t=>{
 const x=await fixture(t);await assert.rejects(replaceCatalog({...x,expectedSha:'0'.repeat(64)}),/Catalog changed before repair/);
 assert.equal(await fs.readFile(x.catalogFile,'utf8'),x.original);await assert.rejects(fs.stat(x.directory),{code:'ENOENT'});
});
test('CAS failure preserves the other writer instead of overwriting it',async t=>{
 const x=await fixture(t),other=JSON.stringify({status:'other-writer'});let committed=false;
 await assert.rejects(replaceCatalog({...x,beforeCommit:()=>fs.writeFile(x.catalogFile,other),onCommitted:()=>{committed=true;}}),/Catalog CAS changed/);
 assert.equal(committed,false);assert.equal(await fs.readFile(x.catalogFile,'utf8'),other);
 assert.equal(await fs.readFile(path.join(x.directory,'superseded-PUBLISHED-MAIN.json'),'utf8'),x.original);
});
