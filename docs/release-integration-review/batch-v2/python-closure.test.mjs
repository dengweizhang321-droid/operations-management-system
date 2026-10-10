import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pythonInventory,verifyPythonClosure,validatePythonEnvironment} from './python-closure.mjs';
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
test('Python closure accepts unchanged source and rejects changed/new source and startup hooks',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'task-d-python-'));
  try {await writeFile(path.join(root,'module.py'),'original');const baseline={version:'task-d-original-python-closure-v1',roots:[root],files:await pythonInventory([root],digest)};
    assert.equal((await verifyPythonClosure(baseline,digest,{})).status,'passed');
    await writeFile(path.join(root,'module.py'),'changed');await assert.rejects(()=>verifyPythonClosure(baseline,digest,{}));
    await writeFile(path.join(root,'module.py'),'original');await writeFile(path.join(root,'new.py'),'new');await assert.rejects(()=>verifyPythonClosure(baseline,digest,{}));
    for(const name of ['injected.pth','sitecustomize.py','usercustomize.py']) {await writeFile(path.join(root,name),'injection');await assert.rejects(()=>pythonInventory([root],digest));await rm(path.join(root,name));}
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Python closure rejects every nonempty unbound search path',()=>{for(const name of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE'])assert.throws(()=>validatePythonEnvironment({[name]:'external'}));validatePythonEnvironment({});});
