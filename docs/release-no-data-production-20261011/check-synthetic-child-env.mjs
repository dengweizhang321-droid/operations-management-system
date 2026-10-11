import{spawnSync}from'node:child_process';
const env={SystemRoot:'C:\\Windows',SystemDrive:'C:',TEMP:'C:\\Windows\\Temp',TMP:'C:\\Windows\\Temp',SYNTHETIC_TOKEN:'test-only-not-a-real-secret',UNICODE_TEST:'synthetic'};
const source="const k=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify({extra:Object.keys(process.env).filter(x=>!k.includes(x)),missing:k.filter(x=>!Object.hasOwn(process.env,x))}));";
const r=spawnSync(process.execPath,['-e',source],{env,input:JSON.stringify(Object.keys(env)),encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout);process.exitCode=r.status;
