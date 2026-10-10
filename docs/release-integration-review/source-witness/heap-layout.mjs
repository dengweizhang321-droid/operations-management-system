// PostgreSQL REL_17_11, little-endian 8KiB heap pages. Read-only byte decoder.
// Sources: postgres.org/docs/17/storage-page-layout.html and REL_17_11
// src/include/{access/htup_details.h,storage/itemid.h,varatt.h,catalog/pg_class.h}
// src/backend/utils/cache/relmapper.c. No SQL or live visibility claim.
import assert from 'node:assert/strict';
export const PAGE=8192;
export function crc32c(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0x82f63b78:0);}return (crc^0xffffffff)>>>0;}
export function relationMap(bytes,oid){assert.equal(bytes.length,524);assert.equal(bytes.readUInt32LE(0),0x592717);const n=bytes.readInt32LE(4);assert.ok(n>=0&&n<=64);assert.equal(crc32c(bytes.subarray(0,520)),bytes.readUInt32LE(520));const entries=[];for(let i=0;i<n;i++)entries.push({oid:bytes.readUInt32LE(8+i*8),file:bytes.readUInt32LE(12+i*8)});assert.equal(new Set(entries.map(e=>e.oid)).size,n);const found=entries.find(e=>e.oid===oid);assert.ok(found&&found.file>0);return found.file;}
export function tupleAt(page,offset,length){
  assert.ok(page.length===PAGE&&offset>=24&&offset%8===0&&length>=24&&offset+length<=PAGE);const b=page.subarray(offset,offset+length);
  const natts=b.readUInt16LE(18)&0x7ff,mask=b.readUInt16LE(20),hoff=b[22];
  assert.ok(natts>0&&natts<=1600&&hoff>=24&&hoff%8===0&&hoff<=b.length);assert.ok(!(mask&8),'Old OID tuple format unsupported');
  if(mask&1)assert.ok(23+Math.ceil(natts/8)<=hoff);
  return {bytes:b,natts,mask,hoff,xmin:b.readUInt32LE(0),xmax:b.readUInt32LE(4),ctidBlock:b.readUInt16LE(12)*65536+b.readUInt16LE(14),ctidOffset:b.readUInt16LE(16)};
}
export function heapTuples(buffer){
  assert.ok(buffer.length>0&&buffer.length%PAGE===0);const result=[];
  for(let block=0;block<buffer.length/PAGE;block++){
    const page=buffer.subarray(block*PAGE,(block+1)*PAGE);if(page.every(b=>b===0))continue;
    const lower=page.readUInt16LE(12),upper=page.readUInt16LE(14),special=page.readUInt16LE(16);
    assert.equal(page.readUInt16LE(18),PAGE|4);assert.ok(lower>=24&&lower<=upper&&upper<=special&&special===PAGE&&(lower-24)%4===0);
    const spans=[];for(let line=0;line<(lower-24)/4;line++){
      const item=page.readUInt32LE(24+4*line),offset=item&0x7fff,flags=(item>>>15)&3,length=item>>>17;
      if(flags!==1)continue;assert.ok(offset>=upper);assert.ok(spans.every(s=>offset+length<=s.offset||offset>=s.end),'Overlapping normal heap items');spans.push({offset,end:offset+length});const tuple=tupleAt(page,offset,length);result.push({...tuple,block,line:line+1,offset,length});
    }
  }
  return result;
}
const utf8=new TextDecoder('utf-8',{fatal:true});
export function catalogIdentity(t){assert.ok(t.hoff+68<=t.bytes.length);if(t.mask&1){assert.ok(t.bytes[23]&1);assert.ok(t.bytes[23]&2);}const raw=t.bytes.subarray(t.hoff+4,t.hoff+68),end=raw.indexOf(0);assert.ok(end>=0);return {oid:t.bytes.readUInt32LE(t.hoff),name:utf8.decode(raw.subarray(0,end))};}
export function catalogRelation(t){const id=catalogIdentity(t),b=t.bytes,o=t.hoff;assert.ok(o+118<=b.length);return {...id,namespace:b.readUInt32LE(o+68),owner:b.readUInt32LE(o+80),file:b.readUInt32LE(o+88),tablespace:b.readUInt32LE(o+92),kind:String.fromCharCode(b[o+115]),natts:b.readInt16LE(o+116)};}
function align(n,by){return Math.ceil(n/by)*by;}
function variable(b,pos){
  if(b[pos]===0)pos=align(pos,4);assert.ok(pos<b.length);const first=b[pos];
  if(first&1){if(first===1){assert.ok(pos+18<=b.length&&b[pos+1]===18,'Only ONDISK external TOAST tag supported');return {value:{unsupported:'external-toast'},next:pos+18};}const size=first>>>1;assert.ok(size>=1&&pos+size<=b.length);return{value:utf8.decode(b.subarray(pos+1,pos+size)),next:pos+size};}
  assert.ok(pos+4<=b.length);const header=b.readUInt32LE(pos),size=header>>>2;assert.ok(size>=4&&pos+size<=b.length);
  if((header&3)===2){assert.ok(size>=8,'Compressed varlena needs header');return{value:{unsupported:'compressed-varlena'},next:pos+size};}
  assert.equal(header&3,0);return{value:utf8.decode(b.subarray(pos+4,pos+size)),next:pos+size};
}
export function decodeScopedRow(t,columns){
  assert.equal(t.natts,columns.length);const b=t.bytes,row={};let pos=t.hoff;
  for(let i=0;i<columns.length;i++){
    const name=columns[i],notNull=!(t.mask&1)||!!(b[23+(i>>>3)]&(1<<(i&7)));
    if(!notNull){row[name]=null;continue;}
    if(['version','revision','created_at','updated_at','deleted_at'].includes(name)){
      pos=align(pos,8);assert.ok(pos+8<=b.length);const value=b.readBigInt64LE(pos);pos+=8;
      if(name==='version'||name==='revision')row[name]=String(value);
      else{
        const micros=value+946684800000000n;let sec=micros/1000000n,frac=micros%1000000n;if(frac<0){sec--;frac+=1000000n;}
        const date=new Date(Number(sec)*1000);assert.ok(Number.isFinite(date.getTime()));const base=date.toISOString().replace(/T/,' ').replace(/\.000Z$/,'');
        const digits=String(frac).padStart(6,'0').replace(/0+$/,'');row[name]=base+(digits?'.'+digits:'')+'+00';
      }
    }else{const v=variable(b,pos);row[name]=v.value;pos=v.next;}
  }
  assert.ok(pos<=b.length);return row;
}
