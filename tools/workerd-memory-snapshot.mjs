import {openSync,closeSync,writeSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

/** Synthetic isolated targets only. A completed command plus parseable graph is required. */
export async function captureUserHeap(inspector,destination) {
  const fd=openSync(destination,'wx');
  let bytes=0,overflow=false,writeError;
  const off=inspector.onUserEvent(event=>{
    if(event.method!=='HeapProfiler.addHeapSnapshotChunk')return;
    if(writeError||overflow)return;
    try {
      const chunk=Buffer.from(event.params.chunk);
      bytes+=chunk.length;
      if(bytes>128*1024*1024){overflow=true;return;}
      writeSync(fd,chunk);
    }catch(error){writeError=error;}
  });
  try {
    await inspector.callUser('HeapProfiler.enable');
    await inspector.callUser('HeapProfiler.takeHeapSnapshot',{reportProgress:false},30000);
  }finally {off();closeSync(fd);}
  if(writeError)throw writeError;
  if(overflow||!bytes)throw new Error('Heap snapshot missing or exceeds diagnostic limit');
  const raw=readFileSync(destination);
  const graph=JSON.parse(raw);
  if(!graph.snapshot?.meta?.node_fields||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw new Error('Incomplete heap snapshot');
  return {bytes,sha256:createHash('sha256').update(raw).digest('hex'),...summarizeHeap(graph)};
}

export function summarizeHeap(graph) {
  const meta=graph.snapshot.meta,nf=meta.node_fields,ef=meta.edge_fields;
  const stride=nf.length,estride=ef.length;
  const fields=Object.fromEntries(nf.map((f,i)=>[f,i]));
  const edgeFields=Object.fromEntries(ef.map((f,i)=>[f,i]));
  const nodes=graph.nodes,edges=graph.edges,strings=graph.strings;
  const count=nodes.length/stride;
  if(!Number.isSafeInteger(count)||count!==graph.snapshot.node_count)throw new Error('Heap node count mismatch');
  const edgeStarts=new Uint32Array(count+1);
  const classes=new Map(),rowNodes=[],namedNodes=[],networkEventNodes=[];
  const nameOf=i=>String(strings[nodes[i*stride+fields.name]]??'');
  const typeOf=i=>meta.node_types[fields.type][nodes[i*stride+fields.type]];
  let edgeOffset=0,totalSelfBytes=0;
  for(let i=0;i<count;i++) {
    edgeStarts[i]=edgeOffset;
    const name=nameOf(i),type=typeOf(i),size=nodes[i*stride+fields.self_size];
    const key=`${type}:${name.length<=80?name:'<long-name>'}`;
    const item=classes.get(key)??{type,name:name.length<=80?name:'<long-name>',count:0,selfBytes:0};
    item.count++;item.selfBytes+=size;classes.set(key,item);totalSelfBytes+=size;
    let padding=false,networkEvent=false;
    const edgeCount=nodes[i*stride+fields.edge_count];
    for(let e=0;e<edgeCount;e++) {
      const pos=edgeOffset+e*estride;
      if(meta.edge_types[edgeFields.type][edges[pos+edgeFields.type]]==='property') {
        const field=strings[edges[pos+edgeFields.name_or_index]];
        if(field==='method') {
          const target=edges[pos+edgeFields.to_node]/stride;
          networkEvent ||= Number.isInteger(target)&&target>=0&&target<count&&nameOf(target)==='Network.dataReceived';
        }
        // V8 can omit edges for small integer (Smi) properties such as id.
        // The synthetic fixtures uniquely identify rows by a string padding property.
        if(field==='padding') {
          const target=edges[pos+edgeFields.to_node]/stride;
          padding ||= Number.isInteger(target)&&target>=0&&target<count&&['string','concatenated string','sliced string'].includes(typeOf(target));
        }
      }
    }
    if(type==='object'&&padding)rowNodes.push(i);
    if(type==='object'&&networkEvent)networkEventNodes.push(i);
    if(type==='object'&&['InspectorProxyWorker','Response','Request','Headers','AbortController','AbortSignal','Promise','Map','Set','ArrayBuffer','ReadableStream','ReadableStreamDefaultReader'].includes(name))namedNodes.push(i);
    edgeOffset+=edgeCount*estride;
  }
  edgeStarts[count]=edgeOffset;
  if(edgeOffset!==edges.length)throw new Error('Heap edge count mismatch');
  // Shortest paths through non-weak edges; not a dominator/retained-size calculation.
  const parent=new Int32Array(count).fill(-1),via=new Int32Array(count).fill(-1),queue=new Uint32Array(count);
  let head=0,tail=1;queue[0]=0;parent[0]=0;
  while(head<tail) {
    const from=queue[head++];
    for(let e=edgeStarts[from];e<edgeStarts[from+1];e+=estride) {
      const kind=meta.edge_types[edgeFields.type][edges[e+edgeFields.type]];
      const to=edges[e+edgeFields.to_node]/stride;
      if(!kind||!Number.isInteger(to)||to<0||to>=count)throw new Error('Heap edge target is invalid');
      if(kind==='weak')continue;
      if(parent[to]!==-1)continue;
      parent[to]=from;via[to]=e;queue[tail++]=to;
    }
  }
  function pathTo(target) {
    if(parent[target]===-1)return {target:nameOf(target),reachableThroughNonWeakEdges:false};
    const path=[];let current=target;
    for(let depth=0;current!==0&&depth<24;depth++) {
      const e=via[current],kind=meta.edge_types[edgeFields.type][edges[e+edgeFields.type]];
      const raw=edges[e+edgeFields.name_or_index];
      const edge=['element','hidden'].includes(kind)?String(raw):String(strings[raw]);
      path.unshift({from:nameOf(parent[current]).slice(0,80),edge:edge.slice(0,80),type:kind,to:nameOf(current).slice(0,80)});
      current=parent[current];
    }
    return {target:nameOf(target),reachableThroughNonWeakEdges:true,rootReached:current===0,path};
  }
  const selectedNodes=[];const perName=new Map();
  for(const node of namedNodes){const name=nameOf(node),seen=perName.get(name)??0;if(seen<2){selectedNodes.push(node);perName.set(name,seen+1);}}
  return {analysisVersion:'padding-string-v2',nodeCount:count,edgeCount:edges.length/estride,totalSelfBytes,fixtureRowObjects:rowNodes.length,networkEventObjects:networkEventNodes.length,networkEventPathSamples:networkEventNodes.slice(0,2).map(pathTo),
    topClassesBySelfBytes:[...classes.values()].sort((a,b)=>b.selfBytes-a.selfBytes).slice(0,20),
    selectedClasses:[...classes.values()].filter(c=>c.type==='object'&&['InspectorProxyWorker','Object','Array','Response','Request','Headers','AbortController','AbortSignal','Promise','Map','Set','ArrayBuffer','ReadableStream','ReadableStreamDefaultReader'].includes(c.name)),
    retentionPathSamples:[...rowNodes.slice(0,2),...selectedNodes].map(pathTo)};
}
