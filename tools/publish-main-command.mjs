import path from 'node:path';

export function manualStepCommand({systemHost,powerShellDirectory,script,action,extra=[],addJson=true}){
 // The finite schema operator already supports the verified bundled PS7 host.
 // PS5's encoded transport does not recognize its SchemaOnly switch.
 const host=path.basename(script).toLowerCase()==='bi-app-adopt.ps1'?path.join(powerShellDirectory,'pwsh.exe'):systemHost;
 return {host,args:['-NoProfile','-NonInteractive','-File',script,'-Action',action,...extra,...(addJson?['-Json']:[])]};
}
