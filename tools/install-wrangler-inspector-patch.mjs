import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Backport workers-sdk#14243 without upgrading the validated dependency chain.
// Additionally bound the pre-attachment backlog; controller error/console forwarding stays intact.
export const originalInspectorSha256='17077283a771d0575bb5def67e91c0c74dec9e505d29bd63f8a71c1294c81f8f';
export const patchedInspectorSha256='ee6e78c50d02eef01d20312ed8e9a72dc75489e6f25ebba1f9869a7db7a0828c';
export const inspectorBacklogMessages=256;
export const inspectorBacklogChars=1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const changes=[
 ['  runtimeMessageBuffer = [];','  runtimeMessageBuffer = [];\n  runtimeMessageBufferSizes = [];\n  runtimeMessageBufferChars = 0;'],
 ['    this.runtimeMessageBuffer.push(msg);\n    this.tryDrainRuntimeMessageBuffer();',`    // Preserve recent diagnostics, never an unbounded headless event history.
    const messageChars = event.data.length;
    if (this.websockets.devtools === void 0 && messageChars > 1048576) return;
    this.runtimeMessageBuffer.push(msg);
    this.runtimeMessageBufferSizes.push(messageChars);
    this.runtimeMessageBufferChars += messageChars;
    while (this.websockets.devtools === void 0 && (this.runtimeMessageBuffer.length > 256 || this.runtimeMessageBufferChars > 1048576)) {
      this.runtimeMessageBuffer.shift();
      this.runtimeMessageBufferChars -= this.runtimeMessageBufferSizes.shift();
    }
    this.tryDrainRuntimeMessageBuffer();`],
 ['    for (const msg of this.runtimeMessageBuffer.splice(0)) {','    const messages = this.runtimeMessageBuffer.splice(0);\n    this.runtimeMessageBufferSizes.length = 0;\n    this.runtimeMessageBufferChars = 0;\n    for (const msg of messages) {'],
 ['    this.sendRuntimeMessage(\n      { method: "Network.enable", id: this.nextCounter() },\n      runtime\n    );','    if (this.websockets.devtools !== void 0) {\n      this.sendRuntimeMessage(\n        { method: "Network.enable", id: this.nextCounter() },\n        runtime\n      );\n    }'],
 ['              method: "Debugger.disable"\n            });','              method: "Debugger.disable"\n            });\n            this.sendRuntimeMessage({\n              id: this.nextCounter(),\n              method: "Network.disable"\n            });'],
];
export function patchWranglerInspector(source){
 const digest=sha(source);if(digest===patchedInspectorSha256)return source;
 if(digest!==originalInspectorSha256)throw new Error('Wrangler inspector patch refuses unknown dependency digest');
 let patched=source;
 for(const [before,after] of changes){if(patched.split(before).length!==2)throw new Error('Wrangler inspector patch anchor is not unique');patched=patched.replace(before,after);}
 if(sha(patched)!==patchedInspectorSha256)throw new Error('Wrangler inspector patch output digest mismatch');
 return patched;
}
// Pure reconstruction for differential tests; no runtime rollback/write entrypoint.
export function originalInspectorForTesting(source){
 if(sha(source)===originalInspectorSha256)return source;
 if(sha(source)!==patchedInspectorSha256)throw new Error('Unknown inspector fixture digest');
 let restored=source;
 for(const [before,after] of [...changes].reverse()){
   if(restored.split(after).length!==2)throw new Error('Inspector fixture anchor is not unique');
   restored=restored.replace(after,before);
 }
 if(sha(restored)!==originalInspectorSha256)throw new Error('Inspector fixture restoration mismatch');
 return restored;
}
export async function installWranglerInspectorPatch(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const require=createRequire(path.join(root,'package.json'));
 const packagePath=require.resolve('wrangler/package.json');
 if(JSON.parse(await readFile(packagePath,'utf8')).version!=='4.92.0')throw new Error('Wrangler inspector patch requires locked 4.92.0');
 const entry=path.join(path.dirname(packagePath),'wrangler-dist/InspectorProxyWorker.js');
 const source=await readFile(entry,'utf8'),patched=patchWranglerInspector(source);
 if(patched!==source)await writeFile(entry,patched);
 return {status:patched===source?'already_patched':'patched',sha256:sha(patched)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await installWranglerInspectorPatch()));
