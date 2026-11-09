/** Structured preparation-failure terminal writer for tools/publish-main.mjs.
 *
 * Kept as its own module (instead of living inline in publish-main.mjs) so it
 * can be imported and unit-tested without triggering that file's unconditional
 * top-level `main()` call.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Best effort only: writes the structured preparation-failed terminal that
 * tools/publish-latest-main.mjs's readNativePreparationFailure expects, when
 * (and only when) exactly one new FAILED-<uuid>.json receipt was written by
 * this call under preparationOut -- the shape publishPreparedMain's own catch
 * produces strictly before STARTED.json, i.e. before any publication effect.
 * Any other outcome (no new receipt, more than one, unreadable, or missing
 * the fields readNativePreparationFailure requires) writes nothing and the
 * caller's plain rejection stands, keeping the queue result 'unknown'. */
export async function writeNativePreparationFailure({preparationOut,beforeNames,resultFile,mainCommit,nativePreparationFailureVersion,readDir=fs.readdir,readFile=fs.readFile,writeFile=fs.writeFile,hash=raw=>createHash('sha256').update(raw).digest('hex')}){
 try{
  const afterNames=await readDir(preparationOut);
  const newNames=afterNames.filter(name=>!beforeNames.has(name)&&/^FAILED-[a-f0-9-]{36}\.json$/.test(name));
  if(newNames.length!==1)return false;
  const receiptPath=path.join(preparationOut,newNames[0]);
  const receiptRaw=await readFile(receiptPath);
  const receipt=JSON.parse(receiptRaw.toString('utf8'));
  if(typeof receipt.phase!=='string'||!receipt.phase.length||receipt.phase.length>200||typeof receipt.error!=='string')return false;
  const document={version:nativePreparationFailureVersion,status:'preparation-failed',mainCommit,
   publicationPerformed:false,publicationStarted:false,maintenanceStarted:false,phase:receipt.phase,
   error:receipt.error.slice(0,1600),failureReceipt:{path:receiptPath,sha256:hash(receiptRaw)}};
  await writeFile(resultFile,JSON.stringify(document)+'\n',{flag:'wx'});
  return true;
 }catch{return false;}
}
