import test from 'node:test';
import assert from 'node:assert/strict';
import {timestamp,instantNs,pgRowJson,redactedRow} from './copy-witness.mjs';
test('server plus08 normalizes to original UTC row bytes without losing microseconds',()=>{
  assert.equal(timestamp('2026-10-10 13:44:20.123456+08'),'2026-10-10T05:44:20.123456+00:00');
  assert.equal(pgRowJson(['created_at'],['2026-10-10 13:44:20.123456+08']),'{"created_at":"2026-10-10T05:44:20.123456+00:00"}');
});
test('UTC conversion handles fractional-hour offsets and crossing midnight',()=>{
  assert.equal(timestamp('2026-10-10 22:00:00.000001-05:45'),'2026-10-11T03:45:00.000001+00:00');
  assert.equal(timestamp('2026-01-01 00:00:00+01'),'2025-12-31T23:00:00+00:00');
});
test('PG UTC formatting trims trailing zero fractions without rounding the significant microsecond',()=>{
  assert.equal(timestamp('2026-10-10 05:44:20.123000+00'),'2026-10-10T05:44:20.123+00:00');
  assert.equal(timestamp('2026-10-10 05:44:20.000000+00'),'2026-10-10T05:44:20+00:00');
  assert.equal(timestamp('2026-10-10 05:44:20.000001+00'),'2026-10-10T05:44:20.000001+00:00');
});
test('a seven-digit .NET tick and timezone-equivalent instants retain exact ordering',()=>{
  assert.equal(instantNs('2026-10-10T05:44:20.123401Z')-instantNs('2026-10-10T05:44:20.1234008Z'),200n);
  assert.equal(instantNs('2026-10-10T13:44:20.1234008+08:00'),instantNs('2026-10-10T05:44:20.1234008Z'));
});
test('pre-epoch UTC conversion uses floor seconds instead of rounding negative fractions',()=>{
  assert.equal(timestamp('1969-12-31 23:59:59.999999+00'),'1969-12-31T23:59:59.999999+00:00');
  assert.equal(instantNs('1969-12-31T23:59:59.999999Z'),-1000n);
});
test('strict calendar, response time and response scalar types reject unsupported representations',()=>{
  for(const date of ['2026-02-30T00:00:00Z','2026-10-10T24:00:00Z','2026-10-10T05:00:00Z (synthetic-private)'])assert.throws(()=>instantNs(date));
  const key=Buffer.alloc(32,5);
  for(const p of [{version:1.5},{version:-1},{deleted:1357911},{id:true},{id:9007199254740992}])assert.throws(()=>redactedRow({response_payload:JSON.stringify(p)},key));
});
