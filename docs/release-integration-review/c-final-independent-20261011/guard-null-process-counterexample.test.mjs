import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const source=readFileSync('E:/codex-artifacts/release-no-data-adoption-20261011/adoption-scope-guard-v4.mjs','utf8');
const digest=raw=>createHash('sha256').update(raw).digest('hex');
assert.equal(digest(source),'04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd');
const begin=source.indexOf('  const isReference='),end=source.indexOf('  let scanned=',begin);
const loopBegin=source.indexOf('  assert.ok(Array.isArray(current.processes)'),loopEnd=source.indexOf('  assert.deepEqual(references,[]',loopBegin);
assert.ok(begin>0&&end>begin&&loopBegin>end&&loopEnd>loopBegin);
const fixedHost=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;

test('V4 must not clear previous-package references when a relevant interpreter command line is unreadable',async()=>{
  const references=[];
  const context={assert,path:path.win32,target:String.raw`d:\teruisi-runtime\django-sales\app.previous`,digest,Error,references,
    // This is a synthetic CIM result, not an OS enumeration or spawned host.
    current:{processes:[{ProcessId:12345,ExecutablePath:fixedHost,CommandLine:null}],tasks:[]},
    realpath:async p=>{assert.equal(p.toLowerCase(),fixedHost.toLowerCase());return p;}};
  const actual=vm.runInNewContext(source.slice(begin,end)+'\n(async()=>{'+source.slice(loopBegin,loopEnd)+';return references;})()',context);
  await assert.rejects(actual,/unknown|unreadable|incomplete/i);
});
