/** Finite consumed-history source roles; read-only, no old module execution. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {retirementEntity,hashRetirementFile,isRetirementChild,retirementGit} from './preparation-retirement-fs.mjs';
export const retirementHistoryVersion='teruisi-preparation-consumed-history-v1';
const hex=/^[a-f0-9]{64}$/,id=/^\d{8}T\d{6}Z-[a-f0-9]{16}$/;
const key=p=>path.resolve(p).toLowerCase(),canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}',sha=b=>createHash('sha256').update(b).digest('hex'),digest=v=>sha(Buffer.from(canonical(v)));
const domains=['worker-prepared-builds','worker-release-publication-staging','worker-release-rotation-plans','worker-release-rotation-consumptions','worker-release-successors'];
// Full-file SHA policies are generated only from the separately reviewed bounded
// native history projection. Unknown bytes/names never inherit a textual policy.
const historyPolicies=Object.freeze({
  "tools": {
    "start-local-worker.mjs": [
      "d13fab177d9e386131853202d1527ebe722e9e769e8872e05550a7d78c9af9f6",
      "383351ab2ad69c7889a831e2e11646e6d3e8d4e43f87b02e0d5b53d13e1ed74f"
    ],
    "worker-authority-guard.mjs": [
      "994a5fc684e33bb53033a10823cb2319bd4c457eca65a1ab363f3bbc6f6b6b20",
      "9e38c1c0debfa0cf829daab67050f4cce7034d819dbfd1274246a4bfbc6344c3",
      "dbe13fdbc71b5bdf6be64666cb75ef3f817110d7f2cd33549a94482ebebfec72",
      "1bb5adea6d6c72ad0eceab30af17f2511e086ad0b2c40cb6845c0be8dc6aab6e",
      "bbd18513fbeb3b6d7adb9956809f768458805b80959daba94669b31b87035210"
    ],
    "worker-local-release.mjs": [
      "bf0c92678e0b7d77eea2d328052e3f24e0bdd40ca1d5c20e6a643a5bbcf9550e",
      "5501053746bf61cf608ad5c9d2218b34906e254f1906280b2f6ce89474e00231",
      "ffd45d07da7450030f8308b2f5f1bc1bac2da34321a05638536e56d0ef186a19",
      "402cb55cd783f6ff24f50e692096c3681ea77b511d4603406a11b002568ef2d8",
      "d8d20fdb3a0af86eb29ac3f2bb6db88091c6ee7ca90869a1efdfadb154161d99",
      "0d945b0d4c83307171c0affeaba1df6410abb3487368e077fe7fca6bc1c57c0d",
      "901d8140089d68046e858812054212b48779ec525d233e3c45bcc5fdb4328acc",
      "3d7ba2a489f5a741ae9371c62a86d5e2025244becfc6de7133c3450ee2a3c032",
      "f4fd64f0eca398637bf614ecc939681119c479447a6fc881e76340b85bc0372c",
      "a438830b536f484c1f0f0dc1fe2cda96876bb14daa15ab085ade9eb0bd78a2d1",
      "1323776692cf6608b96e8be742a9ab22b95f01e834ab419c7d5534def0cce4cc",
      "ed711ac54f53fe825d8c7c927324456b91a58774566e645a4fc5d92dc0995ade",
      "d20be56dbe594a0db9a1375060839d75fa1655df749853615a618b5f0ff11fde",
      "0e5d1c45d215158a5b765e1ea47345a940a10b41fcd0d0b645dc89cc5fd48e32",
      "bba3e24da195576e991f162084159314652c7077f0c7f0a3647319911203c0fa",
      "3c18a8641b1364e3eee8fa7506f9bac0e2f57ec7f529a2d69a00a4410156bfce"
    ],
    "worker-local-runtime-supervisor.mjs": [
      "208d975c9fed6b111ea19942c32564e40c5a44f781b7885e9d84a2f525fa489d",
      "6234a11986b86d974b38a83b73b250f674e852dc8c19bd982987a4e5dfa99908",
      "e9976759043a0dbd9f48b0dbc6bd41b990ebe493a0dd71ee6480e0130a733218",
      "43256c8074b9cdab0cbe837e91a802f13fc958e61b95e87a8b51dfb6aaae6dc2",
      "78b81d3924797d78f916d5ba65135cbeba010ade246b973dfc68fd092d91cefb",
      "fbd5ecf25e01d553c3e4e0d9b155cbfaf2507421ad04ac6a7e8b0a83a0e66148",
      "cb34aec172c4f96d54043b12273e8dca8ac7f70fe8102212ccc7ba35aa18e3a8"
    ],
    "worker-local-service.ps1": [
      "de499f052a9c54604aeb8992e705c55242a978a68d915b796a89bfa2eaf38fb3",
      "e95cda036fa23936af627fdd609d59c2628c2d9d5897a18cb31108a1b1e7d901",
      "41c97743efd24ab3eb9ef55428c5a307963a30347fc862058747c4544d6d3e7e",
      "25b59163b8728b6c2b140c336db40a0c95642f9ee413f661b01bcdbb2808ff10",
      "13ae865b045b1e53fd75a9a1b4a5b369a935809305003d186c81d5a26d514275",
      "744a85e4f4b95dd002c02dece99fb80947ff3280328e757abfda646908ccd25f",
      "571ef0ae298d2ae3fc92b61258d4840cdad449571ebc85666b292a2851db8146",
      "7599d8bb21455e33d34c6523c0eb556d46d55cb8fc2ab1a0cb3d0bb712f715f7",
      "afaf19a5d856ec3b35fb0aab3a00be88878081e7273d3f8720788fbd9c7aa6a9",
      "b2de03114897d76023de14857fb2de74b951c14718fc72df7a9f4dafd52752e2",
      "64dfd4085d091d68c806ccbd136fb4ae3016b7e276cbc08f86445949272f9878",
      "089efa3cb88ce12b7bef38148b7c92ebb4bac0f945a390a83e6986f97e9a1ecd",
      "e360e140c0fd9dea571a7255abaaa9dc881a7cc3fb35379f2ac6efb451588ffc",
      "bb90c274d7126f9c47d7166ac49ff24dc98bed496dbb989dfcff129586806ef4",
      "a683c659505923988764780ca744a2e1876c8a3c48a250712b9427fe36571465",
      "23789686c1c3db9168b74ad3df448cb6456535db2467861cdf1e43ae8b1c0e80",
      "d81febd1d6074b1b5be0bc2025ca2c73eb386853b8efaa92c2292ec52fc139e3",
      "db01758d12c3eff08f13de4be81728ab700dda95e193bfd608008d00879842b5",
      "6b25ba59a6c3575899b5751a07b9c50235917a51ab12b47ef691b44b16ea5ec8",
      "53bbc76f45907ce5208832b61f4462f5f1e479224dcee81785c310e8f758959e",
      "bc98f84683dbf5da0769be5eb4e0533c5c5c7eb35252d26c87613f38440f6e15",
      "4c315221d5722b1b90abd8b25f16f95c3df588ab111f4ce4dd070f1b433ded80",
      "717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e"
    ],
    "worker-local-release-rotation.mjs": [
      "493105e9adbc1e8aa9d1f0ea4f1f216f4798577ae24e4eee02448c2fa34f493c",
      "16aa7ace6d149ad65fdf9644f7587f2ceda079315f4de788d1e8ca25eb69c147",
      "7b3217bc89a56d29aa6d8e7fd9053ab844bcd3483662eb47cba506092eacc2b1",
      "c5bfad6c3e19c82fcef288dbfc01d0327a7a0f50dcc759788adee3775b6efd35",
      "1c1cc7dc20fec281da6f4053298419a070a9b13ff15d1bab9c1e745aae623fc7",
      "ffbcd7a913aef28a1c0372606f363100ce681338c1757bc7c197e3387769a3df",
      "119061a811c115f1178448efd5f4651d740684dc2ce28dd087eb07314cf68e32",
      "638d5ecbc212da64d535dc60ae5f656f7184e33d17593ae49f65a48870a425bd",
      "4c12dedf527e68a372061bc2d0f78ded9083246b8d37596990d718c6500591fe",
      "ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a"
    ],
    "operations-system-control.ps1": [
      "e6ba9ecaddaf52ac8e8163aa975cd76b89df8b9f6e12d02201f93ad673e53bfe",
      "53e31c8c110ceba549ffddd089fdd1282a8ba89c722c7314e798e01e97b66858",
      "f1e12c16b76599fea8bb1169c56d61b481133047887796baf9967e0d5d3a78c4",
      "0cd53721f68bfd39fe385cc419604369a397a3be33b0acaf4b80a7c4b3f20159",
      "0f9f59baa9b958b293385c4c4c9d8c07c7d1838946d3fb5aacef210013abee7b",
      "0607604ee54deb8b7ac0317924c315df82816e67c4c1069f0f1c8205583b7be0",
      "7f2e25211da9c56526ffbcdc303905a0c217f3ec3729091114883411f8ef0696",
      "880babacfede2865277b511e5d004c16dcdd51055304cb0d99e189bd5c0991a6",
      "ab1d0c46c534e7445a055efdd15cb0e9a90336ce5ef7ce2bdd6655d071f1f91c",
      "f8065066bb8473ff7c493b9a0caf2ff851dbc72014669783760bbf1dc696c75c",
      "c639f03fc3ce593aab7b7783dd97e20c6afae6360a9dddd2452dc0057295b980",
      "f97fda451aa3ab1715c498d25eb8c307f881608fa81a1b07b737e7028561493c",
      "f4fb5cffe963f24c2fada5703ae02235546fef72d4b20f0b59810ffdcc54a3a6",
      "ee80d4be20f76354c6b4725168f58fd46026551690decc494e2ee714c6ab3391",
      "344c6470c14ea96605663a452a9ff47dfae0dad6b6bd7ff77ef430cc223ee22c",
      "9ffc6c15503e9ed7d310e0fc4dc7614daf3757481d93447afa3fc78e63ab0325",
      "4f96773cfc96d63cdff815eefebbc77c141a98b9493a8ca17bdfa44572aeda51",
      "d4bf89fb8f69eb3e48ed4d9b9da34094810f29bbe15522f59dac91bc9fa7e509",
      "6037eb6357b4c98bf4a0fa6d03ae8f533671c03f1c8b6db1335dacb556bf7638",
      "0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810"
    ],
    "collect-d1-retirement-proof.mjs": [
      "38117cb4405d64d6250e68d7ee22521029244bb6e2e283ac5e56a0cbc6b72295"
    ],
    "d1-retirement-proof.mjs": [
      "87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76"
    ],
    "release-batch-admission.mjs": [
      "aca3c4aa594f9375afe345dee48b05c79cbb370bf73a7fcee79c3c84c5b2fdbc",
      "1bb6dc999e7b0b0e3e091505288574e93b4a22287435e226e97369734a2a92c6",
      "e877cbf80bd305d98c1d475dc835ea455cba66dcc8f0b12280f914a4532c7ea5"
    ],
    "release-batch.mjs": [
      "899e16338b4e1e1b086125b37806e6c2c752bec21136a76675eff9f66cb4d7b4",
      "0b2eb39f495fa7ec92f598c24d2c2d585bf6fe9c8a4eef6278e14a71eb21c944",
      "e0d2e1d38e0416fca6bb4a61eb42ccf07baabb363493796dd54f3b8e50bf2ccc"
    ],
    "release-daily-backup.mjs": [
      "dca9baac66a121699abcdbf8873873dafef8d6c59971038886819542578194e5",
      "4b77088b234734fcfedeb658c81c489771d26f320b0a66a1a5286417a7857705"
    ],
    "release-impact.mjs": [
      "560c1713fc92dcaccd72da45cd63fa59cc56f5dba9aa5f46dec4a30fef22792c",
      "ad101d63a295ca79ee53c601cbe44c1525de47870505e2059947ba676b5c0944",
      "197f570c641922bb5ea96e053e2f37497586fa4a86c1fa6f4a1367b29c3a4164"
    ],
    "release-lifecycle-step.ps1": [
      "af8e2352d990085fcd7def628ddc3589ff4bd6b1b17837a037a6ea5f3f1a7c95",
      "f7f56eeab2eb854c6b9d29d61a56caa7f491a170f6bb6df69dd472f5d8858a65",
      "c63e8fbaa5b02a13589538ab03468d07511b27a1dec44279a893d29c8467dbce"
    ],
    "process-deadline.ps1": [
      "5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd"
    ],
    "release-readonly-retry.mjs": [
      "c520faf92035fa0aa6e2feb7429b3941ebd20fae9fa2234ff35ff1c9ef9cc5ab"
    ],
    "release-admission-timing.mjs": [
      "7b14e75d7d7b6cbf726d2199330a1e99366e202d5c36becb99287ae9b3060e66"
    ],
    "release-no-data-observation.mjs": [
      "ab29843bca7c9afa7ad328fb6ba33d2f330f0c49dbb59fe50965d7a041508d4d"
    ],
    "release-preparation-evidence.mjs": [
      "b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6"
    ]
  },
  "workers": {
    "bf0c92678e0b7d77eea2d328052e3f24e0bdd40ca1d5c20e6a643a5bbcf9550e": {
      "defaultSourceRoot": "D:\\运营管理系统-django-sales-combined",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "5501053746bf61cf608ad5c9d2218b34906e254f1906280b2f6ce89474e00231": {
      "defaultSourceRoot": "D:\\运营管理系统-django-sales-combined",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "ffd45d07da7450030f8308b2f5f1bc1bac2da34321a05638536e56d0ef186a19": {
      "defaultSourceRoot": "D:\\运营管理系统-django-sales-combined",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "402cb55cd783f6ff24f50e692096c3681ea77b511d4603406a11b002568ef2d8": {
      "defaultSourceRoot": "D:\\运营管理系统-django-sales-combined",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "d8d20fdb3a0af86eb29ac3f2bb6db88091c6ee7ca90869a1efdfadb154161d99": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "0d945b0d4c83307171c0affeaba1df6410abb3487368e077fe7fca6bc1c57c0d": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "901d8140089d68046e858812054212b48779ec525d233e3c45bcc5fdb4328acc": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "3d7ba2a489f5a741ae9371c62a86d5e2025244becfc6de7133c3450ee2a3c032": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "f4fd64f0eca398637bf614ecc939681119c479447a6fc881e76340b85bc0372c": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "a438830b536f484c1f0f0dc1fe2cda96876bb14daa15ab085ade9eb0bd78a2d1": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "1323776692cf6608b96e8be742a9ab22b95f01e834ab419c7d5534def0cce4cc": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "ed711ac54f53fe825d8c7c927324456b91a58774566e645a4fc5d92dc0995ade": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "d20be56dbe594a0db9a1375060839d75fa1655df749853615a618b5f0ff11fde": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "0e5d1c45d215158a5b765e1ea47345a940a10b41fcd0d0b645dc89cc5fd48e32": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "bba3e24da195576e991f162084159314652c7077f0c7f0a3647319911203c0fa": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": false
    },
    "3c18a8641b1364e3eee8fa7506f9bac0e2f57ec7f529a2d69a00a4410156bfce": {
      "defaultSourceRoot": "D:\\运营管理系统-sales-django-release",
      "cliSourceRoot": "explicit-required",
      "testRuntimeFlag": "does-not-skip-source-entity-check",
      "sourceEntityBeforeRuntimeMarker": true,
      "boundSource": true
    }
  },
  "rotations": [
    "493105e9adbc1e8aa9d1f0ea4f1f216f4798577ae24e4eee02448c2fa34f493c",
    "16aa7ace6d149ad65fdf9644f7587f2ceda079315f4de788d1e8ca25eb69c147",
    "7b3217bc89a56d29aa6d8e7fd9053ab844bcd3483662eb47cba506092eacc2b1",
    "c5bfad6c3e19c82fcef288dbfc01d0327a7a0f50dcc759788adee3775b6efd35",
    "1c1cc7dc20fec281da6f4053298419a070a9b13ff15d1bab9c1e745aae623fc7",
    "ffbcd7a913aef28a1c0372606f363100ce681338c1757bc7c197e3387769a3df",
    "119061a811c115f1178448efd5f4651d740684dc2ce28dd087eb07314cf68e32",
    "638d5ecbc212da64d535dc60ae5f656f7184e33d17593ae49f65a48870a425bd",
    "4c12dedf527e68a372061bc2d0f78ded9083246b8d37596990d718c6500591fe",
    "ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a"
  ],
  "launchers": [
    "5569b450edc6bfe406abde60751a79d0befe2736ed869c58bb09ea902775122d",
    "ac4a2830fb318fda1a81b860b19be90075a416528fe22bad7404c866f7380724",
    "3184e1461c07463cd8c12bb7d7813a4d5bcc15448fd64c2a0caba809d17b28e2"
  ]
});
export const retirementHistoryPolicySha256=digest(historyPolicies);
async function bounded(file,max=2*1024*1024){const entity=await retirementEntity(file);assert.equal(entity?.type,'file');assert.equal(entity.nlink,'1','History metadata requires a single link');assert.ok(Number(entity.size)<=max,'History byte bound');const before=await hashRetirementFile(file);assert.equal(before.nlink,'1','History metadata acquired a hardlink');const raw=await fs.readFile(file);assert.equal(raw.length,before.size);assert.equal(sha(raw),before.sha256);return {raw,sha256:before.sha256,signature:before};}
async function members(root){assert.equal((await retirementEntity(root))?.type,'directory');const list=(await fs.readdir(root)).sort();assert.ok(list.length<=128,'History membership bound');return list;}
function historySourceBinding(value){if(!value)return null;if(Object.hasOwn(value,'raw')){assert.equal(typeof value.raw,'string');assert.equal(sha(Buffer.from(value.raw)),value.sha256);value=JSON.parse(value.raw);}assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.ok(typeof value.sourceRoot==='string'&&path.isAbsolute(value.sourceRoot));assert.match(value.sourceRootPathSha256??'',hex);assert.match(value.identity?.sourceTree?.sha256??'',hex);return value;}
export function retirementHistoryChainAnchor(chain,original){
 assert.equal(chain.status,'resolved');assert.equal(chain.version,'teruisi-local-worker-effective-release-v1');assert.equal(chain.incompleteRecordCount,0);assert.ok(Array.isArray(chain.records)&&chain.records.length<=512);assert.equal(chain.successorCount,chain.records.length);assert.ok(chain.bootstrap?.binding);const bindings=[chain.bootstrap.binding];let previous=chain.bootstrap.binding;
 for(let i=0;i<chain.records.length;i++){const row=chain.records[i];assert.match(row.rawSha256,hex);assert.deepEqual(row.value.predecessor,previous);assert.equal(row.value.sequence,i+1);previous=row.value.successor;bindings.push(previous);}assert.deepEqual(previous,chain.head);const index=bindings.findIndex(b=>canonical(b)===canonical(original.predecessor));assert.ok(index>=0,'Original predecessor is not in this consumed chain');
 const at=index=>digest({bootstrapCurrentPointerSha256:chain.bootstrap.pointerSha256,bootstrapAuthoritySha256:chain.bootstrap.authoritySha256,records:chain.records.slice(0,index).map(r=>r.rawSha256),headBindingSha256:bindings[index].bindingSha256});for(const h of [chain.bootstrap.pointerSha256,chain.bootstrap.authoritySha256,chain.chainStateSha256,original.predecessorChainStateSha256])assert.match(h??'',hex);assert.equal(at(index),original.predecessorChainStateSha256,'Original predecessor chain prefix changed');assert.equal(at(bindings.length-1),chain.chainStateSha256,'Current consumed chain digest changed');return {bindings,anchorIndex:index,predecessor:original.predecessor,predecessorChainStateSha256:original.predecessorChainStateSha256,currentHead:chain.head,currentChainStateSha256:chain.chainStateSha256};
}
async function qualify({context,chain,manifestFile,manifestSha256,original},policies){
 const anchor=retirementHistoryChainAnchor(chain,original),runtime=path.resolve(context.native.api.workerRuntimeRoot),release=path.dirname(path.resolve(manifestFile)),releaseId=path.basename(release);assert.match(releaseId,id);assert.equal(key(release),key(path.join(runtime,'releases',releaseId)));assert.equal(key(manifestFile),key(path.join(release,'deployment-manifest.json')));assert.equal(key(chain.runtimeRoot),key(runtime));const position=anchor.bindings.findIndex(b=>b.releaseId===releaseId);assert.ok(position>=0&&position<=anchor.anchorIndex&&position<anchor.bindings.length-1,'Only an already consumed pre-dispatch history member can use this role');const binding=anchor.bindings[position];assert.equal(binding.manifestSha256,manifestSha256);const m=await bounded(manifestFile);assert.equal(m.sha256,manifestSha256);const manifest=JSON.parse(m.raw);assert.equal(manifest.version,'teruisi-local-worker-release-v1');assert.equal(manifest.releaseId,releaseId);assert.equal(manifest.source.snapshotRoot,'source-snapshot');assert.match(manifest.source.rootPathSha256??'',hex);assert.ok(Number.isSafeInteger(manifest.source.tree.fileCount)&&manifest.source.tree.fileCount>0&&manifest.source.tree.fileCount<=100000,'Invalid historical source file count');assert.match(manifest.source.tree.sha256??'',hex);assert.equal(manifest.source.tree.algorithm,'sha256-ordinal-path-length-content-v1');assert.notEqual(manifest.source.tree.sha256,original.identity.sourceTree.sha256,'Original tuple cannot be excluded as pruned history');assert.notEqual(manifest.source.rootPathSha256,original.sourceRootPathSha256,'Original source root cannot be excluded as pruned history');const sourceBinding=historySourceBinding(manifest.source.sourceBinding);if(sourceBinding){assert.notEqual(key(sourceBinding.sourceRoot),key(original.sourceRoot));assert.notEqual(sourceBinding.sourceRootPathSha256,original.sourceRootPathSha256);assert.notEqual(sourceBinding.identity?.sourceTree?.sha256,original.identity.sourceTree.sha256);}
 const top=await members(release),allowed=new Set(['audit','tools','.dev.vars','deployment-manifest.json','package.json','package-lock.json','.runtime','.wrangler','tmp','\u8fd0\u884c\u9879\u76ee.bat']);assert.ok(top.every(n=>allowed.has(n)),'Unknown protected history layout');for(const n of ['audit','tools','.dev.vars','deployment-manifest.json','package.json','package-lock.json'])assert.ok(top.includes(n),'Required history metadata absent');for(const n of top){const entity=await retirementEntity(path.join(release,n));assert.equal(entity?.type,['audit','tools','.runtime','.wrangler','tmp'].includes(n)?'directory':'file','History top member role changed');}for(const n of ['source-snapshot','dist','helper','node_modules','.git'])assert.equal(await retirementEntity(path.join(release,n)),null,'History source/payload role is not absent');for(let cursor=release;;){assert.equal(await retirementEntity(path.join(cursor,'.git')),null,'History belongs to an executable Git source');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 const toolNames=await members(path.join(release,'tools')),keyFiles=manifest.artifacts?.keyFiles;assert.ok(Array.isArray(keyFiles)&&keyFiles.length<128);const declared=new Map();for(const row of keyFiles){assert.equal(declared.has(row.relativePath),false);declared.set(row.relativePath,row.sha256);}const declaredTools=keyFiles.filter(x=>x.relativePath.startsWith('tools/')).map(x=>x.relativePath.slice(6)).sort();assert.deepEqual(toolNames,declaredTools,'Retained top tool member set differs from manifest');let total=0;const tools=[];
 for(const name of toolNames){assert.match(name,/^[a-z0-9-]+\.(?:mjs|ps1)$/);const file=path.join(release,'tools',name),entity=await retirementEntity(file);assert.equal(entity?.type,'file');assert.equal(entity.nlink,'1','History tool requires a single link');assert.ok(Number(entity.size)<=2*1024*1024,'History tool byte bound');total+=Number(entity.size);assert.ok(total<=2*1024*1024,'History tool total byte bound');const row=await hashRetirementFile(file);assert.equal(row.nlink,'1','History tool acquired a hardlink');assert.equal(row.size,Number(entity.size));assert.equal(row.sha256,declared.get('tools/'+name),'History tool bytes differ from consumed manifest');assert.ok(policies.tools[name]?.includes(row.sha256),'Unknown retained tool code: '+name);tools.push({name,...row});}
 const worker=tools.find(x=>x.name==='worker-local-release.mjs');assert.ok(worker);const workerPolicy=policies.workers[worker.sha256];assert.ok(workerPolicy,'Unknown Worker source-selection code');const rotation=tools.find(x=>x.name==='worker-local-release-rotation.mjs');if(rotation)assert.ok(policies.rotations.includes(rotation.sha256),'Unknown rotation consumer code');let launcher=null;const launcherName='\u8fd0\u884c\u9879\u76ee.bat';if(top.includes(launcherName)){const launcherFile=path.join(release,launcherName),entity=await retirementEntity(launcherFile);assert.equal(entity.nlink,'1','History launcher requires a single link');assert.ok(Number(entity.size)<=16384,'History launcher byte bound');const row=await hashRetirementFile(launcherFile);assert.equal(row.nlink,'1','History launcher acquired a hardlink');assert.equal(row.size,Number(entity.size));assert.ok(policies.launchers.includes(row.sha256),'Unknown retained launcher');launcher={name:launcherName,...row,role:'existing-runtime-start-only'};}
 assert.deepEqual(await members(release),top);assert.deepEqual(await members(path.join(release,'tools')),toolNames);const finalManifest=await bounded(manifestFile);assert.equal(finalManifest.sha256,manifestSha256);assert.deepEqual(finalManifest.signature,m.signature,'History manifest metadata changed');
 return {version:retirementHistoryVersion,kind:'consumed-pruned-history-external-source-only',path:release,releaseId,manifestSha256,manifestSignature:m.signature,binding,predecessor:anchor.predecessor,predecessorChainStateSha256:anchor.predecessorChainStateSha256,sourceSnapshotAbsent:true,noGitSource:true,top,tools,launcher,workerPolicy,requiredFixedSourceRoots:[...new Set([original.sourceRoot,workerPolicy.defaultSourceRoot,context.native.api.workerSourceRoot,context.native.api.workerLegacySourceRoot].filter(Boolean).map(p=>path.resolve(p)))].sort(),artifactDomains:[...domains],artifactReleaseRoot:path.join(runtime,'releases'),artifactStagingRoot:path.join(runtime,'.staging'),scope:'registered-source-and-native-artifact-closure-required',originalOutcome:'unknown',retryOriginal:false,publicationPerformed:false};
}
export async function qualifyRetirementHistoricalSource(options){assert.equal(options.context.privateTestTopology,false);return qualify(options,historyPolicies);}
/** No CLI accepts a policy/root override; this seam is all-private tests only. */
export async function qualifyRetirementHistoricalSourceForTest(options,{root,policies}){assert.equal(options.context.privateTestTopology,true);root=path.resolve(root);assert.ok(isRetirementChild(os.tmpdir(),root)&&path.basename(root).startsWith('s05d-history-test-'));for(const p of [options.manifestFile,options.context.native.api.workerRuntimeRoot,options.original.sourceRoot])assert.ok(isRetirementChild(root,p));return qualify(options,policies);}
export async function assertRetirementHistorySourceClosure({context,proofs,sourceInventory,originalGitTree,registrations=[],sourceActions=[],closedSources=[],distinctions=[],mode='after-close'}){
 assert.ok(Array.isArray(proofs)&&proofs.length<=512);assert.ok(['planning','closing','after-close'].includes(mode));if(!proofs.length)return {version:retirementHistoryVersion,roots:[]};const activeRegistrations=[],rows=[];
 for(const registration of registrations){const moved=closedSources.find(a=>a.kind==='git-worktree'&&a.role==='git-source'&&a.registration&&key(a.registration.path)===key(a.source)&&key(a.destination)===key(registration.path));if(!moved){activeRegistrations.push(registration);continue;}assert.ok(context.config?.stateDirectory&&isRetirementChild(path.join(context.config.stateDirectory,'ra'),moved.destination),'Retired Git destination is outside the fixed archive');assert.equal(await retirementEntity(moved.source),null,'Retired Git source reappeared');const archive=await retirementEntity(moved.destination);for(const k of ['type','dev','ino'])assert.equal(archive?.[k],moved.expected[k],'Retired Git archive identity differs');assert.equal(registration.HEAD,moved.registration.HEAD,'Retired Git archive HEAD differs');assert.equal(registration.branch??null,moved.registration.branch??null,'Retired Git archive branch differs');rows.push({path:key(registration.path),role:'retired-archive-git-registration',source:key(moved.source),objectId:moved.objectId,head:registration.HEAD});}
 const required=new Set([...proofs.flatMap(p=>p.requiredFixedSourceRoots),...activeRegistrations.map(r=>r.path)].map(key));
 for(const root of [...required].sort()){
  const entity=await retirementEntity(root),closed=closedSources.find(a=>key(a.source)===root),planned=sourceActions.find(a=>key(a.source)===root);if(!entity){rows.push({path:root,role:closed?'closed-original-address':'absent-source-address'});continue;}assert.equal(closed,undefined,'Closed history source address reappeared');if(planned){assert.ok(mode!=='after-close','History source remains open after closure');for(const k of ['dev','ino','type'])assert.equal(entity[k],planned.expected[k]);rows.push({path:root,role:'same-identity-planned-source-closure',objectId:planned.objectId});continue;}
  const witness=distinctions.find(d=>key(d.path)===root&&['source-content','complete-clean-git-source-membership'].includes(d.kind));assert.ok(witness,'Retained history external source has no qualified difference or close action: '+root);
  if(witness.kind==='source-content'){assert.ok(Object.hasOwn(sourceInventory,witness.relativePath));assert.equal(witness.expected,sourceInventory[witness.relativePath]);assert.notEqual(witness.sha256,witness.expected);const file=path.resolve(root,...witness.relativePath.split('/'));assert.ok(isRetirementChild(root,file));const actual=await hashRetirementFile(file);assert.equal(actual.sha256,witness.sha256,'History source witness changed');rows.push({path:root,role:'actual-source-content-difference',relativePath:witness.relativePath,sha256:witness.sha256,expected:witness.expected});}
  else{assert.ok(registrations.some(r=>key(r.path)===root));assert.match(originalGitTree??'',/^[a-f0-9]{40}$/);assert.match(witness.commit,/^[a-f0-9]{40}$/);assert.match(witness.gitTree,/^[a-f0-9]{40}$/);assert.notEqual(witness.gitTree,originalGitTree);assert.equal(await retirementGit(root,['status','--porcelain','--untracked-files=all'],context.git),'','History Git source changed');assert.equal(await retirementGit(root,['rev-parse','HEAD'],context.git),witness.commit);assert.equal(await retirementGit(root,['rev-parse','HEAD^{tree}'],context.git),witness.gitTree);assert.ok(witness.extraLeaf||witness.missingExpected,'Git membership difference lacks a member witness');if(witness.extraLeaf){const leaf=path.resolve(root,...witness.extraLeaf.relativePath.split('/'));assert.ok(isRetirementChild(root,leaf));assert.equal(Object.hasOwn(sourceInventory,witness.extraLeaf.relativePath),false);assert.equal((await hashRetirementFile(leaf)).sha256,witness.extraLeaf.sha256);}if(witness.missingExpected){assert.ok(Object.hasOwn(sourceInventory,witness.missingExpected));const missing=path.resolve(root,...witness.missingExpected.split('/'));assert.ok(isRetirementChild(root,missing));assert.equal(await retirementEntity(missing),null);}rows.push({path:root,role:'actual-complete-clean-git-membership-difference',commit:witness.commit,gitTree:witness.gitTree,sourceMembersSha256:witness.sourceMembersSha256,originalGitTree});}
 }
 return {version:retirementHistoryVersion,roots:rows,artifactDomains:[...domains],scope:'caller-must-seal-complete-native-original-id-closure'};
}
