/** Independent, finite read-only witness. Writes only its requested evidence. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {canonical,sha,readQueueObject,durableCreate,fixedSchemaRejection as fixed,assertSchemaRejectionPacket,classifySchemaControllers,schemaCensusScript,schemaCensusProjection,assertSchemaArtifactDirectory} from './main-prebuild-queue.mjs';
import {taskPowerShell,readPreparationTask,preparationTaskState} from './main-prebuild-task.mjs';
const execute=promisify(execFile);
const {values}=parseArgs({options:{request:{type:'string'},sha:{type:'string'},out:{type:'string'}}});
assert.ok(values.request&&values.sha&&values.out);
await assertSchemaArtifactDirectory(path.dirname(path.resolve(values.request)));
const {value:request,sha256}=await readQueueObject(path.resolve(values.request));assert.equal(sha256,values.sha);
assert.equal(request.version,'teruisi-schema-rejection-request-ece-v1');assert.equal(request.dispatchId,fixed.dispatchId);assert.ok(['before-archive','after-archive'].includes(request.phase));assert.match(request.nonce,/^[a-f0-9]{32}$/);
assert.ok(Date.now()-Date.parse(request.at)>=0&&Date.now()-Date.parse(request.at)<60000,'Witness request expired');
const directory=path.dirname(path.resolve(values.request));assert.ok(directory.toLowerCase().startsWith('d:\\codex-artifacts\\'));assert.equal(path.basename(values.request),'REQUEST-'+request.phase+'.json');assert.equal(path.resolve(values.out),path.join(directory,'OBSERVATION-'+request.phase+'.json'));
const self=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(self),'..');assert.equal(path.resolve(request.operatorSource),root);const selfSha=sha(await fs.readFile(self));assert.equal(selfSha,request.observerCodeSha256);assert.equal(selfSha,fixed.observerSha256);
const verifyOperator=async()=>{
 const git=async args=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 assert.deepEqual({commit:await git(['rev-parse','HEAD']),tree:await git(['rev-parse','HEAD^{tree}']),status:await git(['status','--porcelain'])},request.sourceIdentity);assert.equal(request.sourceIdentity.status,'');
 for(const [name,expected] of Object.entries(request.operatorFiles)){assert.match(name,/^[a-z0-9-]+\.mjs$/);const file=path.join(root,'tools',name),stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);assert.equal(sha(await fs.readFile(file)),expected,'Operator dependency changed');}
};
await verifyOperator();
const git=async args=>(await execute('git',['-C',path.join(fixed.packet,'source'),...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
const sourceCommit=await git(['rev-parse','HEAD']),sourceTree=await git(['rev-parse','HEAD^{tree}']);assert.equal(sourceCommit,fixed.target);assert.equal(await git(['status','--porcelain']),'');
const packet=await assertSchemaRejectionPacket();
assert.deepEqual(await readPreparationTask(request.task),request.task.definition);assert.equal(sha(Buffer.from(canonical(request.task.definition))),request.taskDefinitionSha256);const state=await preparationTaskState(request.task);assert.equal(state.state,3);assert.equal(state.instances,0);
const census=await taskPowerShell(schemaCensusScript);
assert.ok(Array.isArray(census.rows)&&census.rows.length>0);const observer=census.rows.find(row=>row.processId===process.pid);assert.ok(observer);const observerIdentity=Object.fromEntries(['processId','creationDate','commandLine','executablePath'].map(key=>[key,observer[key]]));
const relatedControllers=classifySchemaControllers(census.rows,{writer:request.writer,observer:observerIdentity});assert.deepEqual(relatedControllers,[]);
assert.deepEqual(await assertSchemaRejectionPacket(),packet);assert.equal(await git(['rev-parse','HEAD']),sourceCommit);assert.equal(await git(['rev-parse','HEAD^{tree}']),sourceTree);assert.equal(await git(['status','--porcelain']),'');
await verifyOperator();
const value={version:'teruisi-schema-rejection-observation-ece-v1',dispatchId:fixed.dispatchId,requestSha256:sha(Buffer.from(canonical(request))),nonce:request.nonce,phase:request.phase,at:new Date().toISOString(),writer:request.writer,observer:observerIdentity,observerCodeSha256:selfSha,elevated:census.elevated,completeCensus:true,censusCount:census.rows.length,census:schemaCensusProjection(census.rows),relatedControllers,relatedOpaque:0,taskState:state.state,taskInstances:state.instances,taskDefinitionSha256:request.taskDefinitionSha256,sourceCommit,sourceTree,sourceClean:true,packet,operatorSourceIdentity:request.sourceIdentity,operatorFiles:request.operatorFiles};
await assertSchemaArtifactDirectory(directory);await durableCreate(path.resolve(values.out),value);await assertSchemaArtifactDirectory(directory);console.log(JSON.stringify({status:'read-only-observation-written',file:path.resolve(values.out),sha256:sha(Buffer.from(canonical(value))),elevated:census.elevated,publicationPerformed:false}));
// Keep the exact observer and its caller transport alive until the ordinary
// writer has independently matched the fresh cross-token process projection.
const deadline=Date.now()+60000,ack=path.join(directory,'ACK-'+request.phase+'.json');
for(;;){try{const {value}=await readQueueObject(ack);assert.equal(value.requestSha256,sha256);assert.equal(value.writerPid,request.writer.processId);break;}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>=deadline)throw Error('Ordinary writer did not acknowledge its fresh census');await new Promise(done=>setTimeout(done,100));}}
