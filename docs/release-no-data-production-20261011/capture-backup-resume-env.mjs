// Root runs this only in the original normal environment; values never printed.
import{writeFile,readFile}from'node:fs/promises';import{protectEnvironment,EXPECTED_ENV,sha}from'./exact-env-transport.mjs';
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/resume2/';
const manifest=await protectEnvironment(process.env,EXPECTED_ENV);
const raw=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'ENV_CIPHER_MANIFEST.json',raw,{flag:'wx'});
console.log(JSON.stringify({status:'cipher-captured',environmentSha256:EXPECTED_ENV,manifestSha256:sha(raw),plaintextPersisted:false}));
