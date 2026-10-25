/** Fixed full-byte policies for the observed supported source entry families. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hashRetirementFile,retirementEntity,retirementGit,isRetirementChild} from './preparation-retirement-fs.mjs';
import {sha} from './main-prebuild-queue.mjs';
import {retirementRefProtocol} from './preparation-retirement-ref.mjs';
export const retirementEntryPolicies=Object.freeze({
 "latest": [
  "a5b567fb46981c9a8dc2d8ee2a23f41891ee8adb8c78ea13f7c07d27fbd8e345",
  "9f25f560239fc163f35a726dd0825e79fb060160a5b638114e68e67c6c3b7616",
  "8c25de726d2b12f8ba68be9fec95c5516ed4f030da3befe179108b7561920d23",
  "bf9b5eb4a541573584c14b3b75a12b95dabd91b7bc0934cd3ceb6e02edd40d92",
  "4623c8e675a46509b4ffc79160db74b2d7f357edcf905557a97c1d58957b2dce",
  "b7d98d2ec2aaa7e0da15f92dce91d8655da3a355d15a09ce9db5bff42f115822",
  "4649a741a05234825546aaa2e942505862c98f8e870632316ac69548ee262ff6",
  "34f4c088351e218f70b25a4a310031e59affd2f9ca4d0ba7f9e58a5b453252ef",
  "510f4004506eef7d10bab527b442f179e9842f425b1d679f0147fc1edfac9b75",
  "d40b209710fb7ad15b71e8a648feabd14d3c316437a4ded938b917c5a483fa06",
  "f2b99dad549cbfb4c298893219951d92b46d84c2268f4b2605c23c4d174e2342",
  "613d9d24a80a2e163b29363beed956f277620deb3af66e7cec4c111f2c7bb032",
  "717d80a1f60324e06481f123614309185bdb75ea63c4a0250eae3b6e9e82f078",
  "15432689000cd0556775d7c58af3eff1ceac737e856cdbba2f98fdafe8df2d96"
 ],
 "main": [
  "228e151242e4c5351fb4ec294df44f9e4adadcf6c5a007931517e4c17ef82063",
  "3071a97f103c1da5d362d3a9b541c479b2420546821246efa023520f5767bb2f",
  "b630a6670a52e11427d60873198b299b077338bbeb3bc58a794ced9e505044c7",
  "02c361d3ae7bdbbb220348ec6b0cd752f64ba0969440c2cb7fd3f649978dd70f",
  "7cd4cbe2c3933f43c6f950ce0ab20cd71346b3bcb070cd779c39c78cc4357c0c",
  "9cfef8d3e22951e7343dbdb2afdb19eeb2bbf8a01c7c7cf2f3636de2b5c24035",
  "2a79dc481b8a2fc26eee6ccc271854e739c0c3a5614ed19cb0d4dd7557a607f2",
  "1e21fde7285165f690965401c9b5bea80a79d74578294f32100c8d64a73b7a40"
 ],
 "installer": [
  "33d88bd5cd3d81711c40b250c9dfec43ac1605fd315d44f08596ce9235baba35",
  "38ebe60c3bed5ecc7a3d5abf2d8b00f7eabaeb39d7328b39551eda7602292e27",
  "a98ffa3bb23a983d067e8f0b9eee497ebaa423f267d34eae3cb855e0de7864bf",
  "e33beb2249f8b9a79b1803df57f2de5226768ae852043dc9f56c2bcd39b6ca48",
  "df6edb149ae5f5e1bdeb346cf35131496793ea2fb78b353897e70270b1a58bd7",
  "ebd9bd5780ad754a584c5210d994d3f309cfc7f98475b79140aeac54399f0b97",
  "4ac1e59106cabc185184601730aea0b4dae468849b306b2a96a65d59cb6d094a",
  "6c9e6ba449919913d8948caa36230f299a827cbc684b440bf5a703b6e0f3d4a5",
  "95d1ffd6b0990000cf5afe03b1a3c0a7e2568f98ea8cbb37a03f4c4da7a624a4",
  "2364c118d042ec429c9096f2cc10073679124a4044722e29518f5b68c4d3d073",
  "0d72237101c37488815a3640c573806f86e3154087aad4b9fdc749ea68446564",
  "e60715f442d9ae652f90d079c604278466db484b323b22a7f3e08246778c901f",
  "0302468cbbcf66c9f0e919b410fa93f1a6bbbcf9a341b7c336fa68e96b06c6ac",
  "e02003d367ba4ef7940cefa4625a06c51e8336da0adb007c8e4e5ebd8a345b29"
 ],
 "guards": {
  // The exact older reader uses separate HEAD/tree queries, not an atomic snapshot.
  // Its paired 228e publisher binds its own source before check/preparation.
  "b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6": {
   "kind": "fixed-frozen-source-reader-sequential-identities"
  },
  "c0b4f216ff749f3a6e71b73614dfbfd1556485f13cd168fab15d06de3635b882": {
   "kind": "fixed-frozen-source-reader"
  }
 },
 "resumes": {
  "515c7a2ccdce60b277aeb42252ba2f61495002ebf828d5aa201aaeff387f61dc": {
   "kind": "fixed-other-resume",
   "commit": "7dcd013f7985e35b8f80cda6698311e2be9c3472"
  }
 },
 "previousCurrentInstaller": ["a0865630915a5b60ec08db93939bdb3f50149fb48ecd37a40493ed7b4abca54c"],
 "currentInstaller": "5c95061e338df562f4c06f478833d90df66ec0cf3000477e3dd64312f738c417",
 "previousCurrentLatest": ["1fa234d5f3bdc5ba5fa028d91756d53a7ed79569e5a054270c73e280f22c67ac","16de220734c22ddfa050ae5cef11ab41e9a05d51ba8a8f3e28ec2e2214d05475"],
 "currentLatest": "f730c55a097a2d292eab1ab0223bada4fc19a83f84b80e3ffbf16a21e113e4fc"
});
export async function qualifyRetirementSourceEntries(context,{roots,target,closedSources=[]}){
 assert.match(target,/^[a-f0-9]{40}$/);const closed=new Set(closedSources.flatMap(x=>[x.source,x.destination]).map(x=>path.resolve(x).toLowerCase())),unique=[...new Set(roots.map(x=>path.resolve(x)))].sort();assert.ok(unique.length<=1024);const proofs=[];let bytes=0;
 for(const root of unique){if([...closed].some(x=>x===root.toLowerCase()||isRetirementChild(x,root)))continue;const entity=await retirementEntity(root);if(!entity){proofs.push({root,absent:true});continue;}assert.equal(entity.type,'directory');const tools=path.join(root,'tools'),present=await retirementEntity(tools);if(!present){proofs.push({root,toolsAbsent:true});continue;}assert.equal(present.type,'directory');const members=(await fs.readdir(tools)).sort();assert.ok(members.length<=2048);const files=[],read=async relative=>{const file=path.join(tools,relative),entity=await retirementEntity(file);if(!entity)return null;assert.equal(entity.type,'file');assert.ok(Number(entity.size)<=512*1024);bytes+=Number(entity.size);assert.ok(bytes<=16*1024*1024,'Source entry qualification byte budget');const value=await hashRetirementFile(file);assert.equal(value.nlink,'1');files.push({relative,...value});return value;};
  const latest=await read('publish-latest-main.mjs');if(latest)assert.ok((retirementEntryPolicies.latest.includes(latest.sha256)||(latest.sha256===retirementEntryPolicies.currentLatest||retirementEntryPolicies.previousCurrentLatest.includes(latest.sha256))),'Unqualified latest-main source entry: '+tools);
  const installer=await read('install-main-prebuild.mjs');if(installer)assert.ok((retirementEntryPolicies.installer.includes(installer.sha256)||(installer.sha256===retirementEntryPolicies.currentInstaller||retirementEntryPolicies.previousCurrentInstaller.includes(installer.sha256))),'Unqualified control installer source entry: '+tools);
  const main=await read('publish-main.mjs');let ownSource=null;if(main){assert.ok(retirementEntryPolicies.main.includes(main.sha256),'Unqualified frozen publisher source entry: '+tools);const guard=await read('frozen-main-source.mjs');if(main.sha256==='228e151242e4c5351fb4ec294df44f9e4adadcf6c5a007931517e4c17ef82063'){assert.ok(guard&&Object.hasOwn(retirementEntryPolicies.guards,guard.sha256),'Frozen source identity reader changed');}const resume=await read('publish-main-known-resume.mjs');if(resume){const policy=retirementEntryPolicies.resumes[resume.sha256];assert.ok(policy,'Unqualified fixed resume source');assert.notEqual(policy.commit,target,'Fixed old resume can select the retired target');}
   let head;try{head=await retirementGit(root,['rev-parse','--verify','HEAD'],context.git);}catch(error){assert.equal(error.code,128,'Frozen source Git identity is unknown');head=null;}if(head!==null){assert.match(head,/^[a-f0-9]{40}$/);assert.notEqual(head,target,'Original target remains at a supported frozen publisher source: '+root);ownSource={kind:'own-root-head-before-preparation',head};}else ownSource={kind:'native-no-git-source'};
  }
  assert.deepEqual((await fs.readdir(tools)).sort(),members,'Source entry membership changed');proofs.push({root,members,files,ownSource,latestPolicy:latest?((latest.sha256===retirementEntryPolicies.currentLatest||retirementEntryPolicies.previousCurrentLatest.includes(latest.sha256))?'current-retirement-admission-and-native-ref-before-checkout':'native-manual-main-ref-before-checkout'):null,installerPolicy:installer?((installer.sha256===retirementEntryPolicies.currentInstaller||retirementEntryPolicies.previousCurrentInstaller.includes(installer.sha256))?'retirement-protocol-preserving-control-adoption':'nonempty-effective-hooks-path-before-first-write'):null});
 }
 return {version:'teruisi-retirement-source-entries-v1',refProtocol:retirementRefProtocol,policiesSha256:sha(Buffer.from(JSON.stringify(retirementEntryPolicies))),bytes,proofs};
}
