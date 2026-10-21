/** Persist bounded original bytes and direct-exit evidence before parsing. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {manualStepCommand} from './publish-main-command.mjs';

export function createMainPublicationStep({out,request,api,transport,runStep,progress,phase=()=>{},refreshLease=async()=>{}}){
 return async(label,script,action,extra=[],{json=true,addJson=true,directory=out}={})=>{
  phase(label);await refreshLease(label);progress.begin(label,{action,script,nativeStderrLog:path.join(directory,label+'.stderr.log'),...(path.basename(script)==='manual-maintenance-start.ps1'?{lockDiagnosticFile:path.join(out,'maintenance-lock-diagnostic.json')}:{})});
  const record=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await record(label+'-started.json',{at:new Date().toISOString(),script,action,extra});
  let value;
  if(runStep)value=await runStep({label,script,action,extra,json,addJson});
  else{
   const command=manualStepCommand({systemHost:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',powerShellDirectory:request.pwshDirectory,script,action,extra,addJson});
   let result,failure;
   try{result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,command.args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(command.host),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',captureOutputBuffers:true,label:'manual-main-'+label});}
   catch(error){failure=error;}
   const observed=result??failure;
   // No reconstructed excerpts or replacement-character decoding in evidence.
   if(observed.rawOutput){
    await fs.writeFile(path.join(directory,label+'.stdout.log'),observed.rawOutput.stdout,{flag:'wx'});
    await fs.writeFile(path.join(directory,label+'.stderr.log'),observed.rawOutput.stderr,{flag:'wx'});
   }
   await record(label+'-process.json',{at:new Date().toISOString(),processEvidence:observed.processEvidence??null,originalBytesRetained:Boolean(observed.rawOutput)});
   if(failure)throw failure;
   try{value=json?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.rawOutput.stdout).trim()):null;}
   catch(error){error.processEvidence=result.processEvidence;throw error;}
  }
  await record(label+'-result.json',{at:new Date().toISOString(),value});await refreshLease(label);progress.complete();return value;
 };
}
