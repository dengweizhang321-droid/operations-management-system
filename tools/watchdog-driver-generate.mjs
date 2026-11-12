// Fixed-input CLI used by the watchdog to regenerate its read-only diagnostic driver after the
// pinned production sources drifted. The watchdog copies every source into a staging directory
// first; this CLI reads those frozen copies (readDirectory/<name>.ps1) but binds the generated
// driver to the fixed production paths (bound.<name>).
//
// Exit codes: 0 generated, 3 structured rejection (stdout carries a fixed-enum code that the
// watchdog may cache), anything else is a transient generator failure that must be retried.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareSupervisorStatusDriver} from './prepare-watchdog-supervisor-status-driver.mjs';

export const SOURCE_NAMES=['control','worker','transport','isolation','backendIsolation','backend','supervisor'];
// Dot-sourced dependencies the generated control copy may load beside itself. Anything else
// resolved from $PSScriptRoot would be missing from the driver directory, so it is refused.
const CONTROL_DEPENDENCIES=['native-isolation.ps1','process-deadline.ps1'];
const WRAPPER_DEPENDENCIES=['watchdog-core-overlay.ps1'];
const CAPABILITY_MARKERS=['"AggregateStatus" { Show-AggregateServiceStatus }','teruisi-django-aggregate-status-v1'];
const hash=value=>createHash('sha256').update(value).digest('hex');

// Structured proof failures: the source shape no longer matches what this generator was reviewed
// against. These are terminal for a given source digest and may be cached by the caller.
const REJECTIONS=new Map([
 ['diagnostic_source_shape_changed','source_shape_changed'],
 ['native_diagnostic_source_shape_changed','source_shape_changed'],
 ['supervisor_diagnostic_source_shape_changed','source_shape_changed'],
 ['original_predicate_changed','original_predicate_changed'],
 ['Supervisor ownership predicate changed','original_predicate_changed'],
 ['supervisor_resolver_missing','source_shape_changed'],
 ['supervisor_status_block_missing','source_shape_changed'],
 ['unexpected_relative_dependency','unexpected_relative_dependency'],
 ['backend_capability_marker_missing','capability_marker_missing'],
]);
export function classifyRejection(error){
 const message=String(error?.message??error);
 if(REJECTIONS.has(message))return REJECTIONS.get(message);
 if(/^(missing_function_|unbounded_function_)/.test(message))return 'source_shape_changed';
 return null;
}

export function relativeDependencies(text){
 // Returns the file names this script dot-sources from $PSScriptRoot, or null when some
 // dot-source line mentions $PSScriptRoot in a shape this parser does not understand.
 const strict=[...text.matchAll(/^[ \t]*\.[ \t]+\([ \t]*Join-Path[ \t]+\$PSScriptRoot[ \t]+(['"])([^'"\r\n]+)\1[ \t]*\)/gim)].map(match=>match[2]);
 const loose=[...text.matchAll(/^[ \t]*\.[ \t]+[^\r\n]*\$PSScriptRoot/gim)].length;
 return loose===strict.length?strict:null;
}

function requireAbsolute(value){
 if(typeof value!=='string'||!path.win32.isAbsolute(value)||/[\0\r\n]/.test(value))throw Error('invalid_generator_request');
 return value;
}

export async function generateWatchdogDriver(request){
 if(!request||typeof request!=='object'||typeof request.bound!=='object'||request.bound===null)throw Error('invalid_generator_request');
 const names=Object.keys(request.bound).sort();
 if(JSON.stringify(names)!==JSON.stringify([...SOURCE_NAMES].sort()))throw Error('invalid_generator_request');
 const output=requireAbsolute(request.outputDirectory),readDirectory=requireAbsolute(request.readDirectory);
 const bound={},read={};
 for(const name of SOURCE_NAMES){bound[name]=requireAbsolute(request.bound[name]);read[name]=path.join(readDirectory,name+'.ps1');}
 const options={
  outputDirectory:output,
  controlFile:bound.control,workerFile:bound.worker,transportFile:bound.transport,backendFile:bound.backend,supervisorFile:bound.supervisor,
  isolationFile:bound.isolation,backendIsolationFile:bound.backendIsolation,
  // The templates are never separate inputs: the core readiness probe comes from the pinned
  // Django library and the diagnostic helper from the pinned controller.
  coreTemplateFile:bound.backend,controlTemplateFile:bound.control,
  readFiles:{controlFile:read.control,workerFile:read.worker,transportFile:read.transport,backendFile:read.backend,supervisorFile:read.supervisor,isolationFile:read.isolation,backendIsolationFile:read.backendIsolation,coreTemplateFile:read.backend,controlTemplateFile:read.control},
 };
 const result=await prepareSupervisorStatusDriver(options);
 // Dependencies the control copy loads from beside itself: copy the exact pinned bytes.
 const control=await fs.readFile(path.join(output,'watchdog-status-control.ps1'),'utf8');
 const wrapper=await fs.readFile(path.join(output,'watchdog-status-backend.ps1'),'utf8');
 const overlay=await fs.readFile(path.join(output,'watchdog-core-overlay.ps1'),'utf8');
 const controlDependencies=relativeDependencies(control);
 if(controlDependencies===null||controlDependencies.some(name=>!CONTROL_DEPENDENCIES.includes(name)))throw Error('unexpected_relative_dependency');
 const wrapperDependencies=relativeDependencies(wrapper);
 if(wrapperDependencies===null||wrapperDependencies.some(name=>!WRAPPER_DEPENDENCIES.includes(name)))throw Error('unexpected_relative_dependency');
 const overlayDependencies=relativeDependencies(overlay);
 if(overlayDependencies===null||overlayDependencies.length)throw Error('unexpected_relative_dependency');
 // The control copy falls back to calling ten domain controllers directly when the backend
 // wrapper lacks its capability markers; refuse a driver whose wrapper does not carry them.
 for(const marker of CAPABILITY_MARKERS)if(!wrapper.includes(marker))throw Error('backend_capability_marker_missing');
 await fs.copyFile(read.isolation,path.join(output,'native-isolation.ps1'));
 await fs.copyFile(read.transport,path.join(output,'process-deadline.ps1'));
 const files=[];
 for(const entry of (await fs.readdir(output)).sort())files.push({name:entry,sha256:hash(await fs.readFile(path.join(output,entry)))});
 return {ok:true,files,proofSha256:hash(JSON.stringify(result.proof)),assetHashes:result.binding.assetHashes};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3){console.error('exact request file required');process.exit(2);}
 try{
  const request=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  process.stdout.write(JSON.stringify(await generateWatchdogDriver(request))+'\n');
 }catch(error){
  const code=classifyRejection(error);
  if(code){process.stdout.write(JSON.stringify({ok:false,rejected:true,code})+'\n');process.exit(3);}
  console.error(String(error?.message??error).slice(0,200));
  process.exit(1);
 }
}
