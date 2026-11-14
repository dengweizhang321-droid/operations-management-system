/** Read-only collector for an artifact-loss successor manifest (v2). Not a control bundle member.
 *  Selects every packet that is whole-packet missing, not yet in the adopted chain, has a terminal that
 *  needs a native read, and whose dispatch group is entirely prepared/failed. Never writes under the state directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {canonical,sha,durableCreate,readPreparationQueueStructure,validatePreparedTerminalNative,validatePreparationTerminal} from './main-prebuild-queue.mjs';
import {readArtifactLossControlBinding,artifactPacketMissing,assertArtifactLossBindings,makeArtifactLossSuccessorManifest,artifactLossSuccessorFileName} from './prepared-artifact-loss.mjs';

const key=file=>path.resolve(file).toLowerCase();
const needsNativeRead=terminal=>terminal?.status==='prepared'||(terminal?.status==='failed'&&terminal.preparationTerminal?.kind==='native-preparation-failed');
const includable=terminal=>terminal?.status==='prepared'||(terminal?.status==='failed'&&terminal.preparationTerminal!==undefined);
const inside=(root,target)=>{const relative=path.relative(path.resolve(root),path.resolve(target));return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));};

/** Pure analysis over the real queue. Writes nothing. */
export async function collectArtifactLossSuccessor(stateDirectory){
 const queue=path.join(path.resolve(stateDirectory),'prebuild-queue-v2'),binding=await readArtifactLossControlBinding(queue);assert.ok(binding,'No adopted artifact loss manifest; nothing to extend');
 const inventory=await readPreparationQueueStructure(queue);for(const element of binding.chain)assertArtifactLossBindings(element.manifest,queue,inventory);
 const tip=binding.chain.at(-1).sha256,covered=new Set(binding.chain.flatMap(element=>element.manifest.packets.map(packet=>key(packet.packet))));
 const groups=new Map();for(const read of inventory.dispatches){const k=key(read.value.selection.packet);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(read);}
 const selected=[],blockers=[],presentBlockers=[];
 for(const [k,reads] of [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0)){
  if(covered.has(k))continue;
  const packet=reads[0].value.selection.packet,tickets=reads.flatMap(read=>read.value.tickets.map(ref=>({read,ref,terminal:inventory.terminals.get(ref.requestId)})));
  if(!tickets.some(item=>needsNativeRead(item.terminal)))continue;
  let missing;try{missing=await artifactPacketMissing(packet);}catch(error){blockers.push({packet,reason:'packet state unreadable: '+error.message});continue;}
  if(!missing){
   // Present packets keep their native checks; report any that would still block the inventory.
   for(const item of tickets){try{
    if(item.terminal?.status==='prepared')await validatePreparedTerminalNative(item.terminal,item.read.value);
    else if(item.terminal?.status==='failed'&&item.terminal.preparationTerminal)await validatePreparationTerminal(item.terminal.preparationTerminal,item.read.value);
   }catch(error){presentBlockers.push({packet,dispatchId:item.read.value.dispatchId,requestId:item.ref.requestId,reason:error.message});}}
   continue;
  }
  const bad=tickets.filter(item=>!includable(item.terminal));
  if(bad.length){blockers.push({packet,reason:'dispatch group has tickets that are neither prepared nor failed-with-terminal',tickets:bad.map(item=>({dispatchId:item.read.value.dispatchId,requestId:item.ref.requestId,status:item.terminal?.status??'pending'}))});continue;}
  try{makeArtifactLossSuccessorManifest(queue,inventory,[packet],tip);}catch(error){blockers.push({packet,reason:'binding refused: '+error.message});continue;}
  selected.push(packet);
 }
 assert.deepEqual(blockers,[],'Missing packets still block normal consumption but cannot be retired: '+JSON.stringify(blockers));
 assert.ok(selected.length>0,'No packet needs a successor manifest');
 const manifest=makeArtifactLossSuccessorManifest(queue,inventory,selected,tip),raw=Buffer.from(canonical(manifest));
 const rows=manifest.packets.flatMap(packet=>packet.dispatches.flatMap(dispatch=>dispatch.tickets.map(ticket=>({dispatchId:dispatch.dispatchId,requestId:ticket.requestId,status:ticket.status,packet:packet.packet}))));
 const table=['| dispatchId | requestId | status | packet |','| --- | --- | --- | --- |',...rows.map(row=>'| '+[row.dispatchId,row.requestId,row.status,row.packet].join(' | ')+' |')].join('\n')+'\n';
 return {manifest,raw,sha256:sha(raw),table,rows,presentBlockers,predecessorManifestSha256:tip,packets:manifest.packets.length,dispatches:manifest.packets.reduce((total,packet)=>total+packet.dispatches.length,0)};
}
async function nearestExistingRealpath(target){let current=path.resolve(target);for(;;){try{return await fs.realpath(current);}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);assert.notEqual(parent,current,'No existing ancestor');current=parent;}}}
export async function writeCollection(stateDirectory,out,result){
 assert.ok(path.isAbsolute(stateDirectory)&&path.isAbsolute(out),'Absolute --state and --out required');
 assert.ok(!inside(stateDirectory,out)&&!inside(await fs.realpath(stateDirectory),await nearestExistingRealpath(out)),'--out must be outside the state directory');
 await fs.mkdir(out,{recursive:false});
 await durableCreate(path.join(out,artifactLossSuccessorFileName(result.sha256)),result.manifest);
 await fs.writeFile(path.join(out,'SUCCESSOR-TABLE.md'),result.table,{flag:'wx'});
}
async function main(){
 const {values}=parseArgs({options:{state:{type:'string'},out:{type:'string'}}});assert.ok(values.state&&values.out,'--state and --out are required');
 const state=path.resolve(values.state),out=path.resolve(values.out);
 // Validate the destination before reading anything so a bad --out never costs a scan.
 assert.ok(!inside(state,out)&&!inside(await fs.realpath(state),await nearestExistingRealpath(out)),'--out must be outside the state directory');
 const result=await collectArtifactLossSuccessor(state);await writeCollection(state,out,result);
 console.log(JSON.stringify({status:'collected',manifestFile:path.join(out,artifactLossSuccessorFileName(result.sha256)),manifestSha256:result.sha256,predecessorManifestSha256:result.predecessorManifestSha256,packets:result.packets,dispatches:result.dispatches,tickets:result.rows.length,remainingPresentNativeBlockers:result.presentBlockers.length,presentBlockers:result.presentBlockers,stateDirectoryWritten:false},null,1));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
