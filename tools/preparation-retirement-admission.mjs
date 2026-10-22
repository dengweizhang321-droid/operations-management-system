/** Persistent preparation closure. Read-only; runs before source creation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha,canonical,readQueueObject} from './main-prebuild-queue.mjs';
import {safeDirectory,stableBytes} from './preparation-resolution.mjs';
export const retirementIntentVersion='teruisi-preparation-retirement-intent-v1';
export const retirementBanVersion='teruisi-preparation-retirement-target-ban-v1';
export const retirementSealVersion='teruisi-preparation-retirement-seal-v1';
export const retiredResolutionVersion='teruisi-retired-preparation-resolution-v1';
export const retiredDecision='retired-source-and-artifacts-sealed';
export const retirementConfigVersion='teruisi-retirement-config-compatibility-v1';
/** Exact additive config transition. The incident still binds its original bytes. */
export async function retirementOriginalConfiguration(config,raw,expectedSha256){
 if(sha(raw)===expectedSha256)return {raw,sha256:expectedSha256};
 const compatibility=config.preparationRetirementCompatibility;assert.deepEqual(Object.keys(compatibility??{}).sort(),['sourceConfigSha256','version']);assert.equal(compatibility.version,retirementConfigVersion);assert.equal(compatibility.sourceConfigSha256,expectedSha256);const original=await stableBytes(path.join(config.stateDirectory,'retirement-configs',expectedSha256+'.json'));assert.equal(sha(original),expectedSha256,'Original incident configuration changed');const without={...config};delete without.preparationRetirementCompatibility;assert.deepEqual(without,JSON.parse(original),'Retirement config transition changed incident runtime inputs');return {raw:original,sha256:expectedSha256};
}
export function retirementDirectory(config,dispatchId){assert.ok(typeof config.stateDirectory==='string'&&path.isAbsolute(config.stateDirectory),'Absolute retirement state root required');const root=path.join(config.stateDirectory,'preparation-retirements');return dispatchId?path.join(root,dispatchId):root;}
export async function readRetirementIntents(config){
 const root=retirementDirectory(config);try{await safeDirectory(root);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const names=(await fs.readdir(root)).sort();assert.ok(names.length<=128,'Retirement registry bound');const records=[];
 for(const name of names){assert.match(name,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,'Unknown retirement registry member');const directory=path.join(root,name);await safeDirectory(directory);const intentFile=path.join(directory,'INTENT.json'),intentRead=await readQueueObject(intentFile),intent=intentRead.value;assert.equal(intent.version,retirementIntentVersion);assert.equal(intent.binding.dispatchId,name);assert.match(intent.binding.selectedTarget,/^[a-f0-9]{40}$/);const banRead=await readQueueObject(path.join(directory,'TARGET-BAN.json')),ban=banRead.value;assert.equal(ban.version,retirementBanVersion);assert.equal(ban.intentSha256,intentRead.sha256);assert.equal(ban.selectedTarget,intent.binding.selectedTarget);assert.equal(ban.forbidTargetReplay,true);records.push({directory,intentFile,intent,sha256:intentRead.sha256,banSha256:banRead.sha256});}
 assert.deepEqual((await fs.readdir(root)).sort(),names,'Retirement registry changed');return records;
}
export async function assertRetirementAdmission(config,target){
 const records=await readRetirementIntents(config);
 if(target!==undefined){assert.match(target,/^[a-f0-9]{40}$/);for(const record of records)assert.notEqual(target,record.intent.binding.selectedTarget,'Retired preparation target cannot be frozen, restored, checked or replayed');}
 for(const record of records){let seal;try{seal=(await readQueueObject(path.join(record.directory,'SEALED.json'))).value;}catch(error){if(error.code==='ENOENT')throw Error('Preparation retirement is incomplete; new dispatch/source creation blocked');throw error;}assert.equal(seal.version,retirementSealVersion);const {validateRetirementSeal}=await import('./preparation-retirement.mjs');await validateRetirementSeal({config,record,seal});assert.equal(sha(await stableBytes(record.intentFile)),record.sha256,'Retirement intent changed at admission');}
 return true;
}
export function retirementBinding(dispatch,terminal){assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchId,dispatch.dispatchId);assert.equal(terminal.requestId,dispatch.requestId);assert.equal(terminal.winnerRequestId,dispatch.requestId);assert.equal(terminal.selectedTarget,dispatch.selectedTarget);assert.equal(terminal.dispatchSha256,sha(Buffer.from(canonical(dispatch))));return {dispatchId:dispatch.dispatchId,requestId:dispatch.requestId,selectedTarget:dispatch.selectedTarget,dispatchSha256:terminal.dispatchSha256,originalResultSha256:sha(Buffer.from(canonical(terminal)))};}
