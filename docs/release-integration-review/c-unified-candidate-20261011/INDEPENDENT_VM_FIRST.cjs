
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict"),cp=require("node:child_process"),{createHash}=require("node:crypto");
const target="D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T034516Z-f308beaede528df7/tools/release-batch-admission.mjs",raw=fs.readFileSync(target,"utf8"),H=x=>createHash("sha256").update(x).digest("hex");
const reference=cp.execFileSync("git",["show","fcfe50aa:tools/release-batch-admission.mjs"],{stdio:["ignore","pipe","pipe"]});
let seed=fs.readFileSync("tests/release-admission-observation-age.test.mjs","utf8");seed=seed.slice(seed.indexOf("const start="),seed.indexOf("\ntest("));
seed=seed.replace("let clock=1000000,identityReads=0,djangoReads=0,journalReads=0,chainReads=0;","let clock=1000000,identityReads=0,djangoReads=0,journalReads=0,chainReads=0,externalDigest=null,externalHead=null,externalPathDrift=false;");
seed=seed.replace("const advance=(name,ms)=>{calls.push(name);clock+=ms;};","const advance=(name,ms)=>{calls.push(name);clock+=ms;if(name===\"identity-final\"||name===\"session-final\"){if(options.independentDjango)externalDigest=\"e\".repeat(64);if(options.independentJournal)externalHead=\"foreign\";if(options.independentChain)externalPathDrift=true;}};");
seed=seed.replace("path,Buffer,Number,Math,Error,canonical","path,Buffer,Number,Math,Error,Date:{now:()=>clock},canonical");
seed=seed.replace("safeFileDigest:async()=>{djangoReads++;return options.djangoDrift&&djangoReads>1?'e'.repeat(64):h;}","safeFileDigest:async()=>{djangoReads++;return externalDigest??h;}");
seed=seed.replace("previous:options.journalDrift&&journalReads>1?'foreign':null","previous:externalHead");
seed=seed.replace("headManifestPath:'/private/worker/releases/old/deployment-manifest.json'","headManifestPath:externalPathDrift?'/private/worker/releases/changed/deployment-manifest.json':'/private/worker/releases/old/deployment-manifest.json'");
seed=seed.replace("verifyNoDataDeploymentReceipts:async()=>{},requiresCompleteAdmission","workerSourceRootForBatch:()=>'/private/source',verifyNoDataDeploymentReceipts:async()=>{},requiresCompleteAdmission");
seed=seed.replace("getResponseTime:()=>observedResponseAt,","getResponseTime:()=>observedResponseAt,getDjangoReads:()=>djangoReads,getJournalReads:()=>journalReads,getChainReads:()=>chainReads,");
const fixture=vm.runInNewContext(seed+";fixture",{raw,vm,path,assert,Buffer,createHash});
(async()=>{
const results=[];
const s=fixture(),v=await s.run();assert.equal(s.getClock()-s.getResponseTime(),302000);assert.equal(v.observedAtMs,s.getClock());results.push({case:"Slow recovery and full reread after successful Status",collectorAccepted:true,trueResponseAgeMs:302000,claimedReturnAgeMs:0});
for(const [key,message,counter]of [["independentDjango","Django changes during final slow content reread","getDjangoReads"],["independentJournal","Journal changes during final slow content reread","getJournalReads"],["independentChain","Effective manifest path changes during final slow content reread","getChainReads"]]){const f=fixture({[key]:true});await f.run();assert.equal(f[counter](),1);results.push({case:message,collectorAccepted:true,identityReads:1});}
const n=fixture({notReady:true});await assert.rejects(n.run(),e=>e.code==="STATUS_NOT_READY"&&e.processEvidence===undefined&&e.readinessEvidence===undefined);results.push({case:"Status exit0 then readiness assertion fails",readinessRejected:true,returnedNativeProcessNotAttached:true});
assert.equal(H(Buffer.from(raw)),H(fs.readFileSync(target)));
console.log(JSON.stringify({candidateSha256:H(Buffer.from(raw)),referenceSha256:H(reference),referenceCommit:cp.execFileSync("git",["rev-parse","fcfe50aa"],{encoding:"utf8"}).trim(),sourceStable:true,checks:5,expectedReviewerAssertionsPass:5,blockingGapsReproduced:4,diagnosticGapReproduced:true,productionCalls:0,nativeChildren:0,results},null,2));
})().catch(e=>{console.error(e.name+":"+e.message);process.exitCode=1});
