import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
export function validatePythonEnvironment(env) {
  for(const name of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE'])assert.ok(!env[name],'Unbound Python search path refused');
}
export async function pythonInventory(roots,digestFile) {
  const files=[];
  async function walk(root,dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      assert.ok(!entry.isSymbolicLink());if(entry.name==='__pycache__')continue;
      if(path.basename(root)==='Lib'&&entry.isDirectory()&&entry.name==='site-packages')continue; // venv explicitly excludes base system packages
      const filename=path.join(dir,entry.name);
      if(entry.isDirectory())await walk(root,filename);else {
        assert.ok(!entry.name.endsWith('.pth')&&!/^sitecustomize\.|^usercustomize\./.test(entry.name),'Unreviewed Python startup hook refused');
        files.push({root,path:filename,sha256:await digestFile(filename)});
      }
    }
  }
  for(const root of roots)await walk(path.resolve(root),path.resolve(root));
  return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function verifyPythonClosure(baseline,digestFile,env=process.env) {
  validatePythonEnvironment(env);assert.equal(baseline.version,'task-d-original-python-closure-v1');
  assert.deepEqual(await pythonInventory(baseline.roots,digestFile),baseline.files,'Original Python inventory changed');
  return {status:'passed',files:baseline.files.length,cacheBoundary:'Python validated bytecode cache and OS system libraries remain original trusted runtime boundary'};
}
