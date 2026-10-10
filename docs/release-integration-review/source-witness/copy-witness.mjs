// Offline COPY reader. No database connection, SQL execution or raw-row output.
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
export const version='teruisi-offline-copy-witness-v1';
const strings='request_id body_sha256 query_sha256 method path actor_email status claim_token id title work_content category owner shop_name start_date due_date priority mutation_token created_by updated_by deleted_by content task_id action summary domain source_digest'.split(' ');
const timestamps='created_at updated_at completed_at expires_at deleted_at'.split(' ');
export const schemas={
  market_write_request_receipts:'request_id body_sha256 query_sha256 method path actor_email status response_status response_payload created_at completed_at',
  workflow_write_request_receipts:'request_id body_sha256 query_sha256 method path actor_email status claim_token response_status response_payload created_at updated_at expires_at',
  workflow_tasks:'id title work_content category owner shop_name start_date due_date status priority version mutation_token created_by updated_by created_at updated_at deleted_at deleted_by',
  workflow_task_comments:'id content created_by created_at task_id',
  workflow_task_activity_logs:'id action summary metadata actor_email created_at task_id',
  workflow_data_revisions:'domain revision source_digest updated_at',
};
export function decodeCopy(value){
  if(value==='\\N')return null;
  const chunks=[];let start=0;
  for(let i=0;i<value.length;i++){
    if(value[i]!=='\\')continue;
    chunks.push(Buffer.from(value.slice(start,i),'utf8'));
    const c=value[++i];assert.ok(c!==undefined,'Truncated COPY escape');
    const simple={b:8,f:12,n:10,r:13,t:9,v:11,'\\':92};let byte;
    if(Object.hasOwn(simple,c))byte=simple[c];
    else if(/[0-7]/.test(c)){let oct=c;while(oct.length<3&&/[0-7]/.test(value[i+1]??''))oct+=value[++i];byte=parseInt(oct,8);assert.ok(byte<=255);}
    else if(c==='x'){let hex='';while(hex.length<2&&/[a-f0-9]/i.test(value[i+1]??''))hex+=value[++i];assert.ok(hex.length>0,'Invalid COPY hex');byte=parseInt(hex,16);}
    else throw new Error('Unsupported COPY escape');
    chunks.push(Buffer.from([byte]));start=i+1;
  }
  chunks.push(Buffer.from(value.slice(start),'utf8'));const result=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  assert.ok(!result.includes('\0'),'NUL is not PostgreSQL text');return result;
}
export function timestamp(value){
  if(value===null)return null;
  assert.match(value,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?(?:[+-]\d\d(?::\d\d)?)$/,'Expected ISO timestamptz');
  let result=value.replace(' ','T');if(/[+-]\d\d$/.test(result))result+=':00';
  assert.ok(Number.isFinite(Date.parse(result)),'Invalid timestamp');
  // The original profile collector explicitly SET LOCAL TIME ZONE 'UTC'.
  // Archive COPY may carry server +08 values; retain all subsecond digits.
  const ns=instantNs(result);let seconds=ns/1000000000n,fraction=ns%1000000000n;if(fraction<0){seconds--;fraction+=1000000000n;}
  const base=new Date(Number(seconds)*1000).toISOString().replace(/\.000Z$/,'');
  const digits=String(fraction).padStart(9,'0').replace(/0+$/,'');return base+(digits?'.'+digits:'')+'+00:00';
}
export function instantNs(value){
  assert.equal(typeof value,'string');const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);assert.ok(m,'Strict ISO instant required');
  const local=Date.parse(m[1]+'Z');assert.ok(Number.isFinite(local)&&new Date(local).toISOString().slice(0,19)===m[1],'Invalid calendar date/time');
  const milliseconds=Date.parse(m[1]+m[3]);assert.ok(Number.isFinite(milliseconds));return BigInt(milliseconds)*1000000n+BigInt((m[2]??'').padEnd(9,'0')||'0');
}
function jsonToken(name,value){
  if(value===null)return 'null';
  if(strings.includes(name))return JSON.stringify(value);
  if(timestamps.includes(name))return JSON.stringify(timestamp(value));
  if(['version','revision','response_status'].includes(name)){assert.match(value,/^-?(0|[1-9]\d*)$/);return value;}
  if(['response_payload','metadata'].includes(name)){JSON.parse(value);return value;}
  throw new Error('Unknown COPY column type');
}
export function pgRowJson(columns,values){
  assert.equal(columns.length,values.length);
  return '{'+columns.map((name,i)=>JSON.stringify(name)+':'+jsonToken(name,values[i])).join(',')+'}';
}
export function tableRoot(hashes){const sorted=[...hashes].sort(Buffer.compare),h=createHash('sha256');for(const v of sorted){assert.ok(Buffer.isBuffer(v)&&v.length===32);h.update(v);}return h.digest('hex');}
const allowedPath=new Set('api internal market workflow operations tasks task comments annotations images jobs claim new-products collaboration imports repair cancel finalize upload chunks batch status summary list'.split(' '));
export function redactedRow(row,key){
  const tag=value=>createHmac('sha256',key).update(String(value)).digest('hex');
  const safeKeys=new Set('data task tasks job jobs result success error status version id taskId task_id commentId deleted code message created updated completed duplicate failed imported changedFields commentId'.split(' '));
  const safeKey=name=>safeKeys.has(name)?name:':'+tag(name).slice(0,16);
  const result={};
  for(const name of ['created_at','updated_at','completed_at','expires_at','deleted_at'])if(Object.hasOwn(row,name))result[name]=row[name]===null?null:timestamp(row[name]);
  for(const name of ['id','request_id','task_id','actor_email','created_by','updated_by','mutation_token','claim_token','content','title','work_content'])if(row[name]!==undefined)result[name+'Hmac']=tag(row[name]);
  for(const name of ['method','status','action','domain'])if(row[name]!==undefined){
    const allowed={method:['GET','POST','PUT','PATCH','DELETE'],status:['待开始','工作中','已完成','processing','completed','failed','unknown'],domain:['workflow'],action:['task.created','task.updated','task.status_changed','task.deleted','comment.created','reminder.created','reminder.dismissed','link.created','link.deleted','attachment.created','attachment.deleted']};assert.ok(allowed[name].includes(row[name]));result[name]=row[name];
  }
  for(const name of ['version','revision','response_status'])if(row[name]!==undefined){const n=Number(row[name]);assert.ok(Number.isSafeInteger(n)&&n>=0);result[name]=n;}
  if(row.path!==undefined)result.pathShape=row.path.split('/').map(part=>!part||allowedPath.has(part)?part:':'+tag(part).slice(0,16)).join('/');
  for(const name of ['body_sha256','query_sha256','source_digest'])if(row[name]!==undefined){assert.match(row[name],/^[a-f0-9]{64}$/);result[name]=row[name];}
  if(row.response_payload!==undefined){const p=JSON.parse(row.response_payload);assert.ok(p&&typeof p==='object'&&!Array.isArray(p));result.responseKeys=Object.keys(p).map(safeKey).sort();result.responsePayloadHmac=tag(row.response_payload);result.nullResponseKeys=Object.keys(p).filter(k=>p[k]===null).map(safeKey).sort();result.emptyObjectResponseKeys=Object.keys(p).filter(k=>p[k]&&typeof p[k]==='object'&&!Array.isArray(p[k])&&Object.keys(p[k]).length===0).map(safeKey).sort();result.emptyArrayResponseKeys=Object.keys(p).filter(k=>Array.isArray(p[k])&&p[k].length===0).map(safeKey).sort();
    for(const name of ['version','deleted','id','taskId','task_id','commentId'])if(Object.hasOwn(p,name)){const v=p[name];if(name==='version'){assert.ok(Number.isSafeInteger(v)&&v>=0);result.response_version=v;}else if(name==='deleted'){assert.equal(typeof v,'boolean');result.response_deleted=v;}else{assert.ok(typeof v==='string'||Number.isSafeInteger(v));result['response_'+name]=tag(v);}}
    for(const name of ['data','task','comment'])if(Object.hasOwn(p,name)&&p[name]&&typeof p[name]==='object'&&!Array.isArray(p[name])){const obj=p[name];for(const field of ['id','taskId','task_id','version','status','createdAt','updatedAt'])if(Object.hasOwn(obj,field)){
      const v=obj[field];if(field==='version'){assert.ok(Number.isSafeInteger(v)&&v>=0);result['response_'+name+'_'+field]=v;}else if(field==='status'){assert.ok(['待开始','工作中','已完成'].includes(v));result['response_'+name+'_'+field]=v;}else if(field.endsWith('At')){instantNs(v);result['response_'+name+'_'+field]=v;}else result['response_'+name+'_'+field+'Hmac']=tag(v);
    }}
  }
  if(row.metadata!==undefined){const p=JSON.parse(row.metadata);assert.ok(p&&typeof p==='object'&&!Array.isArray(p));result.metadataKeys=Object.keys(p).map(safeKey).sort();result.metadataHmac=tag(row.metadata);if(p.version!==undefined){assert.ok(Number.isSafeInteger(p.version)&&p.version>=0);result.metadataVersion=p.version;}if(p.changedFields!==undefined){assert.ok(Array.isArray(p.changedFields)&&p.changedFields.every(v=>['title','workContent','category','owner','shopName','startDate','due','status','priority'].includes(v)));result.changedFields=p.changedFields;}if(p.commentId!==undefined)result.commentIdHmac=tag(p.commentId);}
  return result;
}
export class CopyWitness{
  constructor({before,after,cutoff,key,maxRows=300000,maxLineBytes=4*1024*1024}){
    assert.ok(Buffer.isBuffer(key)&&key.length===32);assert.ok(Number.isFinite(Date.parse(cutoff)));
    this.before=before;this.after=after;this.cutoffText=cutoff;this.cutoff=instantNs(cutoff);this.key=key;this.maxRows=maxRows;this.maxLineBytes=maxLineBytes;this.tables={};this.active=null;this.total=0;
  }
  line(line){
    assert.ok(Buffer.byteLength(line)<=this.maxLineBytes,'COPY line bound');
    if(!this.active){
      if(!line.startsWith('COPY '))return;
      const m=/^COPY public\.([a-z_]+) \(([^)]+)\) FROM stdin;$/.exec(line);assert.ok(m,'Unsupported COPY header');const name=m[1];assert.ok(Object.hasOwn(schemas,name),'Unexpected table');assert.ok(!Object.hasOwn(this.tables,name),'Duplicate COPY section');
      const columns=m[2].split(', ').map(v=>v.replace(/^"([a-z_]+)"$/,'$1'));assert.equal(new Set(columns).size,columns.length);assert.deepEqual([...columns].sort(),schemas[name].split(' ').sort());
      this.active={name,columns,hashes:[],prefix:[],identities:new Set(),newRows:[],modifiedRows:[],allRows:0};this.tables[name]=this.active;return;
    }
    if(line==='\\.'){this.active=null;return;}
    const t=this.active,values=line.split('\t').map(decodeCopy);assert.equal(values.length,t.columns.length,'COPY arity mismatch');
    const raw=pgRowJson(t.columns,values),digest=createHash('sha256').update(raw).digest();t.hashes.push(digest);t.allRows++;this.total++;assert.ok(this.total<=this.maxRows,'COPY row bound');
    const row=Object.fromEntries(t.columns.map((c,i)=>[c,values[i]])),created=row.created_at?instantNs(timestamp(row.created_at)):null;
    const identity=row.request_id??row.id??row.domain;assert.ok(typeof identity==='string'&&identity.length>0);const identityDigest=createHmac('sha256',this.key).update(identity).digest('hex');assert.ok(!t.identities.has(identityDigest),'Duplicate row identity');t.identities.add(identityDigest);
    if(created!==null&&created<=this.cutoff)t.prefix.push(digest);else if(created!==null)t.newRows.push(redactedRow(row,this.key));
    if(['workflow_tasks','workflow_data_revisions'].includes(t.name)&&row.updated_at&&instantNs(timestamp(row.updated_at))>this.cutoff)t.modifiedRows.push(redactedRow(row,this.key));
  }
  finish(){
    assert.equal(this.active,null,'Unterminated COPY');assert.deepEqual(Object.keys(this.tables).sort(),Object.keys(schemas).sort());
    const result={version,cutoff:this.cutoffText,rawRowsPersisted:false,productionDatabaseConnection:false,tables:{},beforePayloadRecovered:false,fullComparisonClosed:false};
    for(const [name,t]of Object.entries(this.tables)){
      this.checkingName=name;
      const digest=tableRoot(t.hashes);assert.equal(t.allRows,this.after[name].rows,'Post rows mismatch');assert.equal(digest,this.after[name].sha256,'Post profile digest mismatch');
      const prefix=tableRoot(t.prefix);result.tables[name]={rows:t.allRows,sha256:digest,postProfileMatched:true,physicalColumns:t.columns,prefixRows:t.prefix.length,prefixSha256:prefix,prefixMatchesBefore:t.prefix.length===this.before[name].rows&&prefix===this.before[name].sha256,newRows:t.newRows,modifiedRows:t.modifiedRows};
    }
    return result;
  }
}
