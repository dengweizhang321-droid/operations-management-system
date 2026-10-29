/** Elevated, independent, read-only R1b witness. Writes only its fixed observation. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {readQueueObject} from './main-prebuild-queue.mjs';
import {retirementObservationContext} from './preparation-retirement-native.mjs';
import {observeRetirementRequest} from './preparation-retirement-witness.mjs';
export async function runRetirementObserverCli(argv=process.argv.slice(2)){const {values}=parseArgs({args:argv,options:{help:{type:'boolean'},request:{type:'string'},sha:{type:'string'}}});if(values.help){console.log('Usage: node preparation-retirement-observer.mjs --request <fixed REQUEST-phase.json> --sha <request SHA>\nRun independently with a high token from the same adopted bundle. No source/archive/queue/lifecycle mutations.');return;}assert.ok(path.isAbsolute(values.request??''));assert.match(values.sha??'',/^[a-f0-9]{64}$/);const request=await readQueueObject(values.request);assert.equal(request.sha256,values.sha);const context=await retirementObservationContext(request.value.configFile),result=await observeRetirementRequest(context,path.resolve(values.request),values.sha);console.log(JSON.stringify(result));return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runRetirementObserverCli().catch(error=>{console.error(JSON.stringify({code:'RETIREMENT_OBSERVATION_BLOCKED',error:String(error.message).slice(0,800),publicationPerformed:false}));process.exitCode=1;});
