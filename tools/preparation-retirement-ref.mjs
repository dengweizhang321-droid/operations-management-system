/** Git's prepared transaction is the native fence for supported old publishers.
 * Read-only: no queue ticket, controller receipt, evidence or ref is written. */
import assert from 'node:assert/strict';
import {readRetirementIntents} from './preparation-retirement-admission.mjs';
export const retirementRefProtocol='teruisi-retired-manual-main-ref-fence-v1';
const manualRef=/^refs\/heads\/codex\/manual-main-([a-f0-9]{12})-[a-f0-9]{8}-[a-f0-9]{8}$/;
export function retirementPreparedTargets(input){
 assert.ok(typeof input==='string'&&Buffer.byteLength(input)<=1024*1024,'Reference transaction exceeds bound');
 const result=[];for(const line of input.trim().split(/\r?\n/)){if(!line)continue;const fields=line.split(' ');assert.equal(fields.length,3,'Malformed reference transaction');const [old,next,ref]=fields;assert.match(old,/^[a-f0-9]{40}$/);assert.match(next,/^[a-f0-9]{40}$/);const match=manualRef.exec(ref);if(!match||/^0+$/.test(next))continue;assert.equal(match[1],next.slice(0,12),'Manual-main branch target prefix changed');result.push({ref,target:next});}return result;
}
export async function assertRetirementPreparedRefs(config,input){
 const targets=retirementPreparedTargets(input);if(!targets.length)return;
 const records=await readRetirementIntents(config);
 for(const {ref,target} of targets)for(const record of records)assert.notEqual(target,record.intent.binding.selectedTarget,'Retired manual-main source ref is forbidden before checkout: '+ref);
}
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
export function makeRetirementReferenceHook({node,entry,configFile,committedEntry=entry,label='prepare only, never deploy.'}){
 const h='[0123456789abcdef]',pattern='refs/heads/codex/manual-main-'+h.repeat(12)+'-'+h.repeat(8)+'-'+h.repeat(8);
 return '#!/bin/sh\n# TERUISI main-prebuild v2: '+label+'\ncase "$1" in\nprepared)\n native=$(while IFS=" " read -r old next ref; do\n  case "$ref" in '+pattern+')\n   if [ "$next" != "'+'0'.repeat(40)+'" ]; then printf "%s %s %s\\n" "$old" "$next" "$ref"; fi ;;\n  esac\n done)\n [ -n "$native" ] || exit 0\n printf "%s\\n" "$native" | '+quote(node)+' '+quote(entry)+' event '+quote(configFile)+' "$1" ;;\ncommitted) exec '+quote(node)+' '+quote(committedEntry)+' event '+quote(configFile)+' "$1" ;;\n*) exit 0 ;;\nesac\n';
}
