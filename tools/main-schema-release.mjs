/** Finite, reviewed structure additions for the manual main publisher. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const monitoringSchema={version:'teruisi-main-schema-release-v1',additionKind:'JdProductMonitoring',fromGeneration:147,toGeneration:148,steps:['inventory.0016_jd_product_monitoring']};
export const monitoringMigration='backend/inventory/migrations/0016_jd_product_monitoring.py';
export const monitoringRecipe='config/main-schema-releases/inventory-0016.json';
const hex=/^[a-f0-9]{64}$/;
export const tmallSchema={version:'teruisi-main-schema-release-v1',additionKind:'TmallWarehouse',fromGeneration:147,toGeneration:149,steps:['inventory.0016_jd_product_monitoring','inventory.0017_tmall_warehouse']};
export const tmall148Schema={...tmallSchema,fromGeneration:148,steps:['inventory.0017_tmall_warehouse']};
export const tmallMigration='backend/inventory/migrations/0017_tmall_warehouse.py';
const finite=[
 {schema:monitoringSchema,migrations:[monitoringMigration],recipe:monitoringRecipe,binder:'jd_product_monitoring_candidate.py',evidence:'inventory-0016-evidence.json'},
 {schema:tmallSchema,migrations:[monitoringMigration,tmallMigration],recipe:'config/main-schema-releases/inventory-0017.json',binder:'tmall_warehouse_candidate.py',evidence:'inventory-0017-evidence.json'},
 {schema:tmall148Schema,migrations:[tmallMigration],recipe:'config/main-schema-releases/inventory-0017-from148.json',binder:'tmall_warehouse_candidate.py',evidence:'inventory-0017-evidence.json'}
];
function requestSpec(schema){return finite.find(spec=>Object.entries(spec.schema).every(([name,value])=>JSON.stringify(schema?.[name])===JSON.stringify(value)));}
function planSpec(plan){
 const changes=(plan.changes??[]).filter(change=>/\/migrations\/[^/]+\.py$/.test(change.path)||/\/migrations\/[^/]+\.py$/.test(change.before??''));
 const sorted=changes.toSorted((a,b)=>a.path.localeCompare(b.path));
 const spec=finite.find(spec=>JSON.stringify(sorted)===JSON.stringify(spec.migrations.map(path=>({status:'A',path})).toSorted((a,b)=>a.path.localeCompare(b.path))));
 assert.ok(spec,'最新main含新增或改写迁移，尚无对应结构发布包；本次未部署');return spec;
}

export function schemaForRequest(request){
 const schema=request.schemaRelease;
 if(!request.migrate&&!request.releasePlan?.migrate&&!schema&&!request.schemaEvidencePath)return null;
 assert.equal(request.migrate,true,'结构发布必须显式声明迁移');assert.equal(request.releasePlan?.migrate,true,'结构发布范围不一致');
 assert.ok(schema&&typeof schema==='object'&&!Array.isArray(schema),'缺少已审核的结构发布包，请先准备对应迁移材料');
 const spec=requestSpec(schema);assert.ok(spec,'结构发布仅支持已审核的0016或0017有限父链');
 assert.deepEqual(Object.keys(schema).sort(),[...Object.keys(spec.schema),'recipeSha256','evidencePath','evidenceSha256','validationSha256','codeSha256'].sort(),'结构发布绑定字段不匹配');
 for(const name of ['recipeSha256','evidenceSha256','validationSha256','codeSha256'])assert.match(schema[name]??'',hex,'结构发布摘要无效');
 assert.ok(typeof schema.evidencePath==='string'&&path.isAbsolute(schema.evidencePath),'结构证据必须是绝对路径');
 assert.equal(request.schemaEvidencePath,undefined,'不能套用旧147证据参数');
 assert.ok(request.components?.includes('django'),'结构迁移必须包含后台发布');
 return schema;
}
async function regular(file){
 const resolved=path.resolve(file);let cursor=resolved;
 for(;;){const info=await fs.lstat(cursor);assert.equal(info.isSymbolicLink(),false,'结构发布材料不得使用链接');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 const info=await fs.lstat(resolved);assert.ok(info.isFile()&&info.nlink===1&&info.size<16*1024*1024,'结构发布材料不是有界独立文件');
 return fs.readFile(resolved);
}
function relative(root,name){assert.ok(typeof name==='string'&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='.'),'结构材料路径越界');const resolved=path.resolve(root,name);assert.ok(resolved.startsWith(path.resolve(root)+path.sep));return resolved;}
export async function readSchemaRecipe(source,plan){
 const spec=planSpec(plan);
 let raw;try{raw=await regular(path.join(source,spec.recipe));}catch(error){if(error.code==='ENOENT')throw Error('迁移缺少已审核发布材料，需要由任务交付迁移包；本次未部署');throw error;}
 const recipe=JSON.parse(raw.toString('utf8'));
 assert.deepEqual(Object.keys(recipe).sort(),['version','additionKind','fromGeneration','toGeneration','steps','stepFiles','validation','validationSha256','codeSha256'].sort(),'结构发布recipe字段不匹配');
 assert.equal(recipe.version,'teruisi-main-schema-recipe-v1');
 for(const name of ['additionKind','fromGeneration','toGeneration','steps'])assert.deepEqual(recipe[name],spec.schema[name],'结构发布recipe不是已审核有限父链');
 assert.deepEqual(Object.keys(recipe.stepFiles).sort(),spec.migrations.toSorted());
 for(const name of spec.migrations){
  const migration=await regular(path.join(source,name));
  const normalized=Buffer.from(migration.toString('utf8').replaceAll('\r\n','\n'));
  assert.ok(!normalized.includes(13),'迁移文件包含独立回车');assert.equal(sha(normalized),recipe.stepFiles[name],'迁移字节与发布材料不一致');
 }
 assert.match(recipe.codeSha256??'',hex);assert.match(recipe.validationSha256??'',hex);
 assert.equal(sha(await regular(relative(source,recipe.validation))),recipe.validationSha256,'隔离迁移验证记录已变化');
 return {recipe,recipeSha256:sha(raw),spec};
}
export function schemaPreparationEnvironment(parent=process.env){
 const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','SYSTEMDRIVE']);
 return {...Object.fromEntries(Object.entries(parent).filter(([name])=>allowed.has(name.toUpperCase()))),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
}
async function invokeBinder(source,spec,args,{runtime='D:/teruisi-runtime/django-sales',run=execute}={}){
 const python=path.join(runtime,'venv/Scripts/python.exe');
 try{const result=await run(python,[path.join(source,'tools',spec.binder),'--source',source,'--runtime',runtime,'--recipe',path.join(source,spec.recipe),...args],{cwd:source,env:schemaPreparationEnvironment(),windowsHide:true,timeout:600000,maxBuffer:2*1024*1024});return JSON.parse(result.stdout.trim());}
 catch(error){throw Error('结构发布材料校验失败：'+String(error.stderr??error.message).slice(0,1800));}
}
export async function prepareMainSchemaRelease({source,packet,plan},{run,runtime}={}){
 const {recipe,recipeSha256,spec}=await readSchemaRecipe(source,plan);
 const requestFile=path.join(packet,'main-release-request.json');
 let previous;
 try{previous=JSON.parse((await regular(requestFile)).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous){
  assert.equal(previous.mainCommit,plan.headSha);assert.equal(previous.deployedCommit,plan.baseSha);assert.deepEqual(previous.releasePlan,plan);
  await verifyMainSchemaRelease(previous,source,{run,runtime});
  return previous.schemaRelease;
 }
 const directory=path.join(packet,'schema');await fs.mkdir(directory,{recursive:true});
 const evidencePath=path.join(directory,spec.evidence);
 const result=await invokeBinder(source,spec,['--output',evidencePath],{run,runtime});assert.equal(result.status,'bound');
 const evidenceSha256=sha(await regular(evidencePath));assert.equal(result.evidenceSha256,evidenceSha256);
 return {...spec.schema,recipeSha256,evidencePath,evidenceSha256,validationSha256:recipe.validationSha256,codeSha256:recipe.codeSha256};
}
export async function verifyMainSchemaRelease(request,source,options={}){
 const schema=schemaForRequest(request);if(!schema)return null;
 const {recipe,recipeSha256,spec}=await readSchemaRecipe(source,request.releasePlan);
 assert.deepEqual(requestSpec(schema).schema,spec.schema,'请求与迁移范围使用了不同父链');
 assert.equal(schema.recipeSha256,recipeSha256);assert.equal(schema.validationSha256,recipe.validationSha256);assert.equal(schema.codeSha256,recipe.codeSha256);
 assert.equal(path.resolve(schema.evidencePath),path.resolve(source,'..','schema',spec.evidence),'结构证据不属于本次冻结来源');
 assert.equal(sha(await regular(schema.evidencePath)),schema.evidenceSha256,'本次结构发布证据已变化');
 const result=await invokeBinder(source,spec,['--check',schema.evidencePath,'--evidence-sha',schema.evidenceSha256],options);assert.equal(result.status,'bound');
 return schema;
}
