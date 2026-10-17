// Trusted transport adapter. It has no HTTP client, provider key, database
// access, automatic retry, host routes, or discovered extension dependencies.
import { createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { randomUUID } from 'node:crypto';

function text(content) { return Array.isArray(content) ? content.filter(x=>x.type==='text').map(x=>x.text).join('\n') : String(content??''); }
function normalize(messages) {
  return messages.map(m=>{
    if(m.role==='toolResult') return {role:'tool',tool_call_id:m.toolCallId,content:text(m.content)};
    const item={role:m.role,content:text(m.content)};
    if(m.role==='assistant') {
      const calls=(m.content??[]).filter(x=>x.type==='toolCall');
      if(calls.length) item.tool_calls=calls.map(x=>({id:x.id,type:'function',function:{
        name:x.name==='system_tool'?x.arguments.name:x.name,
        arguments:JSON.stringify(x.name==='system_tool'?x.arguments.args:x.arguments)}}));
      for(const block of m.content??[]) if(block.type==='thinking'&&block.thinkingSignature) {
        try {
          const signed=JSON.parse(block.thinkingSignature);
          if(signed.version===1&&signed.frame&&signed.protocol&&signed.modelConfigId&&signed.modelVersion) item.providerFrame=signed;
        }catch{}
      }
    }
    return item;
  });
}
export default function(pi) {
  let binding, ctx;
  pi.on('session_start',(_event,context)=>{ctx=context;});
  pi.registerCommand('runner-bind',{
    description:'Internal capability binding; unavailable to the language model',
    handler:async(args,context)=>{
      const value=JSON.parse(Buffer.from(args,'base64').toString('utf8'));
      if(!value || typeof value.capability!=='string' || value.capability.length>4096) throw Error('invalid_binding');
      binding=value;ctx=context;
      if(value.model) {
        const settings=value.model;
        if(!Number.isSafeInteger(settings.contextWindow)||settings.contextWindow<1||!Number.isSafeInteger(settings.maxTokens)||settings.maxTokens<1||typeof settings.reasoning!=='boolean') throw Error('invalid_model_metadata');
        register(settings);
        const model=context.modelRegistry.find('teruisi','operation-model');
        if(!model || !await pi.setModel(model)) throw Error('model_bind_failed');
      }
    },
  });
  pi.registerCommand('runner-ping',{description:'Inspect fixed runtime',handler:async()=>{}});
  async function gateway(payload,signal) {
    if(!binding||!ctx) throw Error('operation_capability_required');
    if(signal?.aborted) throw Error('aborted');
    const request={...payload,requestId:randomUUID(),capability:binding.capability};
    const answer=await ctx.ui.input('pi-gateway-v1',JSON.stringify(request),{signal});
    if(signal?.aborted||answer===undefined) throw Error('aborted');
    const parsed=JSON.parse(answer);
    if(parsed.error) throw Error(parsed.error);
    return parsed;
  }
  pi.registerTool({
    name:'system_tool',label:'系统只读工具',description:'Invoke an authorized central system tool. Discover actual dataset and tool names through the gateway; never use SQL, URLs or database connections.',
    parameters:Type.Object({name:Type.String({minLength:1,maxLength:128}),args:Type.Record(Type.String(),Type.Unknown())},{additionalProperties:false}),
    async execute(_id,params,signal){
      const result=await gateway({kind:'tool',name:params.name,args:params.args},signal);
      let file=result.details?.data?.file??result.details?.file;
      if(!file) for(const content of result.content??[]) if(content.type==='text') {
        try {const parsed=JSON.parse(content.text);file=parsed.data?.file??parsed.file;}catch{}
      }
      if(file?.id) {
        const local=await gateway({kind:'file',fileId:file.id},signal);
        result.details={...result.details,localFilePath:local.path,sha256:local.sha256};
        result.content=[...(result.content??[]),{type:'text',text:JSON.stringify({localFilePath:local.path,sha256:local.sha256})}];
      }
      return result;
    },
  });
  function register(metadata) {pi.registerProvider('teruisi',{
    api:'teruisi-gateway',apiKey:'operation-capability',baseUrl:'https://unreachable.invalid',
    models:[{id:'operation-model',name:'Authorized operation model',reasoning:true,input:['text'],
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0},...metadata}],
    streamSimple(model,context,options={}) {
      const stream=createAssistantMessageEventStream();
      const output={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],
        stopReason:'pending',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      (async()=>{
        try {
          const normalized=normalize(context.messages).filter(x=>x.role!=='system');
          const system=getCurrentSystemPrompt(context.messages)??context.systemPrompt??'';
          let payload={kind:'model',model:model.id,messages:[{role:'system',content:system},...normalized],tools:getCurrentTools(context.messages),
            options:{maxTokens:options.maxTokens,temperature:options.temperature,reasoning:options.reasoning}};
          const replacement=await options.onPayload?.(payload,model);if(replacement) payload=replacement;
          const response=await gateway(payload,options.signal);
          await options.onResponse?.({status:200,headers:new Headers()},model);
          await options.onProviderStreamEvent?.(response,model);
          const message=response.message;
          if(!message||message.role!=='assistant'||!Array.isArray(message.content)||!['stop','length','toolUse','error','aborted'].includes(message.stopReason)) throw Error('invalid_gateway_message');
          stream.push({type:'start',partial:output});
          output.content=message.content;output.stopReason=message.stopReason;
          if(message.usage) output.usage=message.usage;
          if(message.errorMessage) output.errorMessage=message.errorMessage;
          for(let i=0;i<output.content.length;i++) {
            const block=output.content[i];
            if(block.type==='text') {
              stream.push({type:'text_start',contentIndex:i,partial:output});
              stream.push({type:'text_delta',contentIndex:i,delta:block.text,partial:output});
              stream.push({type:'text_end',contentIndex:i,content:block.text,partial:output});
            } else if(block.type==='toolCall') {
              stream.push({type:'toolcall_start',contentIndex:i,partial:output});
              stream.push({type:'toolcall_delta',contentIndex:i,delta:JSON.stringify(block.arguments),partial:output});
              stream.push({type:'toolcall_end',contentIndex:i,toolCall:block,partial:output});
            } else if(block.type==='thinking') {
              stream.push({type:'thinking_start',contentIndex:i,partial:output});
              stream.push({type:'thinking_delta',contentIndex:i,delta:block.thinking,partial:output});
              stream.push({type:'thinking_end',contentIndex:i,content:block.thinking,partial:output});
            } else throw Error('invalid_gateway_content');
          }
          if(['error','aborted'].includes(output.stopReason)) stream.push({type:'error',reason:output.stopReason,error:output});
          else stream.push({type:'done',reason:output.stopReason,message:output});
        } catch(error) {
          output.stopReason=options.signal?.aborted?'aborted':'error';output.errorMessage=String(error.message??'gateway_failed');
          stream.push({type:'error',reason:output.stopReason,error:output});
        } finally {stream.end();}
      })();
      return stream;
    },
  });}
  // Startup metadata is inert until the first authenticated runner-bind.
  register({contextWindow:1,maxTokens:1,reasoning:true});
}
