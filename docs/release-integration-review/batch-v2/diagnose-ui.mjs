// Diagnostic-only copy: original B policy and assertions remain unchanged.
import path from 'node:path';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const source='E:/codex-artifacts/release-integration-review-20261010/AB-v2-fbec23e85f7fb149';
const root='E:/codex-artifacts/release-integration-review-20261010/AB-v2-ui-diagnostic-'+randomBytes(5).toString('hex');
await mkdir(root);
for(const name of ['candidate-handoff.json','resource-inventory.json'])await copyFile(path.join(source,name),path.join(root,name));
let script=await readFile(path.join(source,'production-ui.mjs'),'utf8');
script=script.replace(/^const root=.*;$/m,'const root='+JSON.stringify(root)+';');
const marker=" const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});";
if(!script.includes(marker))throw Error('Original UI diagnostic interface changed');
script=script.replace(marker,marker+`\n const diagnostic=[];\n function info(request){const url=new URL(request.url());return {method:request.method(),type:request.resourceType(),protocol:url.protocol,hostname:['127.0.0.1','localhost','[::1]'].includes(url.hostname)?url.hostname:'external-redacted',port:url.port,pathname:url.pathname.startsWith('/api/')||url.pathname.includes('favicon')||url.pathname==='/'?url.pathname:'resource-redacted',queryPresent:Boolean(url.search),urlSha256:null};}\n context.on('request',r=>diagnostic.push({event:'request',...info(r)}));\n context.on('requestfailed',r=>diagnostic.push({event:'failed',...info(r),errorCode:r.failure()?.errorText??'unknown'}));`);
script=script.replace('} finally {await browser.close();}',"} finally {await writeFile(root+'/request-diagnostic.json',JSON.stringify(diagnostic,null,2)+'\\n',{flag:'wx'});await browser.close();}");
// diagnostic is scoped inside try in the original; move only its declaration.
script=script.replace(' const diagnostic=[];','');script=script.replace('const blocked=[],requests=[],cases=[];','const blocked=[],requests=[],cases=[],diagnostic=[];');
await writeFile(path.join(root,'production-ui.mjs'),script,{flag:'wx'});
console.log(JSON.stringify({status:'diagnostic-prepared-not-executed',root,script:path.join(root,'production-ui.mjs')}));
