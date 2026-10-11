// Small read-only receipt supplement; never imports operational modules.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const root='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749',expectedManifest='6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',pins=new Map(),paths=new Map();
const fingerprint=s=>[s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function assertPath(target){const absolute=path.resolve(target);let cursor=path.parse(absolute).root;for(const p of ['',...absolute.slice(cursor.length).split(path.sep).filter(Boolean)]){if(p)cursor=path.join(cursor,p);const s=fs.lstatSync(cursor,{bigint:true});if(s.isSymbolicLink()||path.resolve(fs.realpathSync(cursor)).toLowerCase()!==cursor.toLowerCase())throw Error('Reparse');const identity=[s.dev,s.ino,s.mode].join(':');if(paths.has(cursor)&&paths.get(cursor)!==identity)throw Error('Path drift');paths.set(cursor,identity);}}
function read(file){assertPath(file);const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)throw Error('Unsafe receipt');const raw=fs.readFileSync(file);if(fingerprint(before)!==fingerprint(fs.lstatSync(file,{bigint:true})))throw Error('Read drift');pins.set(file,fingerprint(before));return raw;}
const startedAt=new Date().toISOString(),manifestRaw=read(path.join(root,'deployment-manifest.json'));
if(hash(manifestRaw)!==expectedManifest)throw Error('Wrong manifest');
const manifest=JSON.parse(manifestRaw),receipts=[];
for(const key of ['contractReceipt','d1RetirementReceipt','guardReceipt','helperReceipt']){const pin=manifest.artifacts[key];if(!pin||!pin.relativePath.startsWith('audit/')||path.isAbsolute(pin.relativePath)||pin.relativePath.split('/').includes('..'))throw Error('Unsafe receipt path');const raw=read(path.join(root,pin.relativePath)),value=JSON.parse(raw);if(hash(raw)!==pin.sha256||value.version!==pin.version)throw Error('Original receipt mismatch: '+key);receipts.push({name:key,...pin});}
if(manifest.artifacts.guardReceipt.sha256!=='92eff2b54a9227f954a7f223a698f1c3c0e9d45168a7dc758188523311812e01')throw Error('Different guard receipt');
for(const [file,pin]of pins)if(fingerprint(fs.lstatSync(file,{bigint:true}))!==pin)throw Error('Receipt closure drift');
for(const target of paths.keys())assertPath(target);
const record={version:'teruisi-c-targeted-independent-original-receipts-v1',startedAt,finishedAt:new Date().toISOString(),status:'passed',manifestSha256:expectedManifest,receipts,readFiles:pins.size,rootAndAncestorIdentityVerified:true,fileMetadataStable:true,productionActions:0,receiptSemanticsOrLiveAdmissionNotCertified:true};
fs.writeFileSync(new URL('./FINAL_RECEIPT_AUDIT.json',import.meta.url),JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:record.status,receipts:receipts.length}));
