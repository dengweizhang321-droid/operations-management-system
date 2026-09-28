import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {captureUserHeap,summarizeHeap} from '../tools/workerd-memory-snapshot.mjs';

function graph() {
  const strings=['(root)','Global','Object','rows','id','padding','weak-row','fixture-value'];
  // fields: type, name, id, self_size, edge_count; property/weak edges.
  return {snapshot:{node_count:5,meta:{node_fields:['type','name','id','self_size','edge_count'],
    node_types:[['synthetic','object','string'],'string','number','number','number'],
    edge_fields:['type','name_or_index','to_node'],edge_types:[['property','weak'],'string_or_number','node']}},
    nodes:[0,0,1,0,1, 1,1,3,8,2, 1,2,5,16,2, 1,2,7,16,2, 2,7,9,32,0],
    edges:[0,1,5, 0,3,10, 1,6,15, 0,4,0,0,5,20, 0,4,0,0,5,20],strings};
}

test('heap summary counts fixture rows and excludes weak edges from root paths',()=>{
  const result=summarizeHeap(graph());
  assert.equal(result.fixtureRowObjects,2);
  assert.equal(result.nodeCount,5);
  assert.equal(result.totalSelfBytes,72);
  assert.equal(result.retentionPathSamples[0].rootReached,true);
  assert.equal(result.retentionPathSamples[0].path.at(-1).edge,'rows');
  assert.equal(result.retentionPathSamples[1].reachableThroughNonWeakEdges,false);
});

test('numeric id edges may be omitted by V8 without hiding retained synthetic rows',()=>{
  const noNumericId=graph();noNumericId.nodes[14]=1;noNumericId.nodes[19]=1;
  noNumericId.edges=[0,1,5,0,3,10,1,6,15,0,5,20,0,5,20];
  assert.equal(summarizeHeap(noNumericId).fixtureRowObjects,2);
});

test('heap summary rejects truncated node and edge arrays',()=>{
  const missingNode=graph();missingNode.nodes.pop();
  assert.throws(()=>summarizeHeap(missingNode),/node count/);
  const missingEdge=graph();missingEdge.edges.pop();
  assert.throws(()=>summarizeHeap(missingEdge),/edge count/);
  const badTarget=graph();badTarget.edges[2]=99999;
  assert.throws(()=>summarizeHeap(badTarget),/edge target/);
});

test('snapshot needs streamed bytes, completed command and a complete graph; never overwrites evidence',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'workerd-memory-snapshot-'));
  try {
    let listener:(event:unknown)=>void=()=>{};let detached=0;
    const raw=JSON.stringify(graph());
    const inspector={onUserEvent(fn:(event:unknown)=>void){listener=fn;return()=>{detached++;};},
      async callUser(method:string){if(method==='HeapProfiler.takeHeapSnapshot'){
        listener({method:'HeapProfiler.addHeapSnapshotChunk',params:{chunk:raw.slice(0,20)}});
        listener({method:'HeapProfiler.addHeapSnapshotChunk',params:{chunk:raw.slice(20)}});
      }}};
    const target=path.join(directory,'complete.heapsnapshot');
    const result=await captureUserHeap(inspector,target);
    assert.equal(result.bytes,Buffer.byteLength(raw));assert.equal(result.fixtureRowObjects,2);
    assert.equal(await readFile(target,'utf8'),raw);assert.equal(detached,1);
    await assert.rejects(captureUserHeap(inspector,target),/EEXIST/);
    const noChunks={...inspector,async callUser(){}};
    await assert.rejects(captureUserHeap(noChunks,path.join(directory,'missing.heapsnapshot')),/missing/);
    const failed={...inspector,async callUser(){throw new Error('protocol unavailable');}};
    await assert.rejects(captureUserHeap(failed,path.join(directory,'failed.heapsnapshot')),/protocol unavailable/);
    assert.equal(detached,3);
  }finally{
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()),'workerd-memory-snapshot-')));
    await rm(directory,{recursive:true,force:true});
  }
});
