// Only connect to debugger targets obtained from this experiment's own Miniflare.
export async function connectMemoryInspector(miniflare) {
  const endpoint=await miniflare.getInspectorURL();
  const listing=new URL(endpoint); listing.protocol='http:'; listing.pathname='/json';
  const targets=await (await fetch(listing,{signal:AbortSignal.timeout(5000)})).json();
  const connections=[];
  try { for(const id of ['core:user:','core:entry']) {
    const target=targets.find(t=>t.id===id);
    if(!target) throw new Error('Missing isolated inspector target');
    const url=new URL(target.webSocketDebuggerUrl);
    if(url.hostname!==endpoint.hostname || url.port!==endpoint.port) throw new Error('Inspector escaped isolated instance');
    const socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{socket.close();reject(new Error('Inspector connection timeout'));},5000);
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Inspector connection failed'));},{once:true});
    });
    let nextId=0;
    const pending=new Map();
    socket.addEventListener('message',event=>{
      const response=JSON.parse(event.data);
      const request=pending.get(response.id);
      if(request) {
        pending.delete(response.id); clearTimeout(request.timer);
        if(response.error) request.reject(new Error(response.error.message));
        else request.resolve(response.result);
      }
    });
    const call=method=>new Promise((resolve,reject)=>{
      const messageId=++nextId;
      const timer=setTimeout(()=>{pending.delete(messageId);reject(new Error('Inspector request timeout'));},5000);
      pending.set(messageId,{resolve,reject,timer});socket.send(JSON.stringify({id:messageId,method}));
    });
    connections.push({id,socket,call});
  } } catch(error) { for(const c of connections)c.socket.close();throw error; }
  return {
    async usage(){return Object.fromEntries(await Promise.all(connections.map(async c=>[c.id,await c.call('Runtime.getHeapUsage')])));},
    // Diagnostic only: some workerd versions collect before acknowledging CDP.
    // A timeout is recorded as unknown acknowledgement, never GC success.
    async requestUserCollection(){
      try {await connections[0].call('HeapProfiler.collectGarbage');return 'acknowledged';}
      catch {return 'unacknowledged_within_5_seconds';}
    },
    close(){for(const c of connections)c.socket.close();},
  };
}
