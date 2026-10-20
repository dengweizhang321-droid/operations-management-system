// Fixed extension capabilities. No workspace imports or dynamic extension loaders.
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { loadSkills } from '/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js';
import { parseFrontmatter } from '/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/utils/frontmatter.js';

const object = properties => Type.Object(properties, {additionalProperties:false});
const string = (maxLength=4000) => Type.String({minLength:1,maxLength});
const output = value => ({content:[{type:'text',text:JSON.stringify(value)}],details:value});

export function installNative(pi, getBinding, gateway) {
  const selection=JSON.parse(process.env.PI_REVIEWED_SKILLS??'null');
  if(!selection||!/^\d+\.\d+\.\d+$/.test(selection.version))throw Error('reviewed_skills_required');
  const root=`/opt/pi/skill-bundles/${selection.version}`;
  const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,'utf8'));
  const packageSha256=createHash('sha256').update(readFileSync(`${root}/manifest.json`)).digest('hex');
  const resources=new Map(manifest.skills.flatMap(s=>s.resources.map(r=>[`${root}/${s.id}/${r.path}`,{...r,skillId:s.id}])));
  // Pi is the authority for discovery, fallback names, YAML, collisions and
  // disable-model-invocation. Never scan cwd/HOME or reimplement its parser.
  const native=loadSkills({cwd:'/workspace/work',agentDir:'/workspace/home/.pi/agent',includeDefaults:false,
    skillPaths:manifest.skills.filter(s=>selection.ids.includes(s.id)).map(s=>`${root}/${s.id}`)});
  const entire=loadSkills({cwd:'/workspace/work',agentDir:'/workspace/home/.pi/agent',includeDefaults:false,
    skillPaths:manifest.skills.map(s=>`${root}/${s.id}`)});
  const metadataFor=s=>{
    const metadata=parseFrontmatter(readFileSync(s.filePath,'utf8')).frontmatter;
    const allowed=metadata['allowed-tools'];
    const allowedTools=typeof allowed==='string'?allowed.split(/[\s,]+/).filter(Boolean):Array.isArray(allowed)&&allowed.every(x=>typeof x==='string')?allowed:undefined;
    return {...s,allowedTools,skillId:resources.get(s.filePath)?.skillId};
  };
  const loaded=native.skills.map(metadataFor);
  const discovered=entire.skills.map(metadataFor);
  let context, activeSkills=new Set(), explicit=new Set();
  const emit=(key,value)=>context?.ui.setStatus(key,JSON.stringify(value));
  const audit=(state,skill,extra={})=>emit('pi-skill-audit-v1',{state,skillId:skill.skillId,name:skill.name,packageVersion:selection.version,packageSha256,...extra});
  const inventory=()=>emit('pi-skills-v1',{snapshot:{version:selection.version,sha256:packageSha256,selectedIds:selection.ids},
    discovered:discovered.map(({name,description,filePath,disableModelInvocation,allowedTools,skillId})=>({name,description,filePath,disableModelInvocation,allowedTools,skillId,selected:selection.ids.includes(skillId)})),
    selected:loaded.map(({name,skillId})=>({name,skillId})),diagnostics:native.diagnostics,discoveryDiagnostics:entire.diagnostics});
  pi.on('session_start',(_event,ctx)=>{context=ctx;inventory();});
  pi.registerCommand('runner-catalog',{description:'Inspect immutable reviewed skill catalogue',handler:async(_args,ctx)=>{context=ctx;inventory();}});
  pi.on('input',(event,ctx)=>{
    context=ctx;
    if(!event.streamingBehavior){activeSkills=new Set();explicit=new Set();}
    const match=/^\/skill:([^\s]+)(?:\s|$)/.exec(event.text);
    if(match){const skill=loaded.find(s=>s.name===match[1]);if(skill){const args=event.text.slice(match[0].length);explicit.add(skill.skillId);activeSkills.add(skill.skillId);audit('invoked',skill,{explicit:true,argumentsSha256:createHash('sha256').update(args).digest('hex'),argumentsBytes:Buffer.byteLength(args)});audit('read',skill,{resourcePath:'SKILL.md',source:'native-command-expansion'});}}
  });
  function resourceFor(raw) {
    if(typeof raw!=='string')return;
    const candidate=path.resolve('/workspace/work',raw);
    if(!candidate.startsWith(root+'/'))return;
    const resource=resources.get(candidate);
    if(!resource||!selection.ids.includes(resource.skillId)||realpathSync(candidate)!==candidate||lstatSync(candidate).nlink!==1)throw Error('unreviewed_skill_resource');
    const bytes=readFileSync(candidate);
    if(createHash('sha256').update(bytes).digest('hex')!==resource.sha256)throw Error('skill_resource_changed');
    return {resource,skill:loaded.find(s=>s.skillId===resource.skillId)};
  }
  const localTools=new Set(['read','bash','edit','write','analysis_helper']);
  const admitted=new Set();
  pi.on('tool_call',async(event,ctx)=>{
    context=ctx;
    try {
      for(const id of activeSkills){const skill=loaded.find(s=>s.skillId===id);if(skill?.allowedTools&&!skill.allowedTools.includes(event.toolName))throw Error('skill_allowed_tools_forbidden');}
      if(!localTools.has(event.toolName))return;
      const binding=getBinding();if(!binding?.admission)throw Error('admission_required');
      const mode=binding.admission.mode;
      if(mode==='switching'||mode==='plan'&&!['read','analysis_helper'].includes(event.toolName))throw Error('plan_execution_forbidden');
      if(event.toolName==='read') {
        const raw=event.input.path??event.input.file_path;
        const selected=resourceFor(raw);
        if(selected?.skill?.disableModelInvocation&&!explicit.has(selected.skill.skillId))throw Error('skill_explicit_invocation_required');
        if(mode==='plan'&&!selected) {
          const candidate=path.resolve('/workspace/work',String(raw));
          if(!candidate.startsWith('/workspace/inputs/')||!realpathSync(candidate).startsWith('/workspace/inputs/'))throw Error('plan_read_path_forbidden');
        }
      }
      await gateway({kind:'admission',name:'local_admit',args:{toolName:event.toolName,toolCallId:event.toolCallId}},ctx.signal);
      admitted.add(event.toolCallId);
    } catch(error) {return {block:true,reason:String(error.message??'local_admission_failed')};}
  });
  pi.on('tool_result',async(event,ctx)=>{
    context=ctx;
    if(!admitted.delete(event.toolCallId))return;
    if(event.toolName==='read'&&!event.isError){const selected=resourceFor(event.input.path??event.input.file_path);if(selected?.skill){activeSkills.add(selected.skill.skillId);audit('read',selected.skill,{resourcePath:selected.resource.path,toolCallId:event.toolCallId});}}
    if(event.toolName==='analysis_helper'&&!event.isError)for(const id of activeSkills){const skill=loaded.find(s=>s.skillId===id);if(skill)audit('executed',skill,{toolName:'analysis_helper',helper:event.input.helper,toolCallId:event.toolCallId});}
    await gateway({kind:'admission',name:'local_complete',args:{toolName:event.toolName,toolCallId:event.toolCallId,status:event.isError?'failed':'completed'}},ctx.signal);
  });
  // A native !/!! command is a separate path from the bash model tool.
  pi.on('user_bash',async(_event,ctx)=>{
    if(getBinding()?.admission?.mode!=='execute')return {result:{output:'Plan mode forbids shell execution',exitCode:1,cancelled:false,truncated:false}};
    context=ctx;
  });
  pi.registerTool({name:'questionnaire',label:'问题与选项',description:'Ask one or more questions with described options and optional free text. Answers provide information and never authorize business actions.',
    parameters:object({title:Type.Optional(string(512)),questions:Type.Array(object({id:string(64),header:Type.Optional(string(64)),question:string(),
      options:Type.Array(object({label:string(512),description:Type.Optional(string(2000)),recommended:Type.Optional(Type.Boolean())}),{maxItems:10}),allowCustom:Type.Optional(Type.Boolean())}),{minItems:1,maxItems:10})}),
    async execute(id,params,signal,_update,ctx){
      const value=await ctx.ui.input('pi-questionnaire-v1',JSON.stringify({version:1,toolCallId:id,...params}),{signal});
      if(value===undefined||signal?.aborted)return output({status:'cancelled'});
      const parsed=JSON.parse(value);if(parsed.version!==1||!parsed.answers)throw Error('invalid_questionnaire_answer');
      return output(parsed);
    }});
  pi.registerTool({name:'analysis_helper',label:'固定只读分析',description:'Run reviewed pure statistics or replenishment calculations on supplied authorized data. No arbitrary code or filesystem writes.',
    parameters:object({helper:Type.Union([Type.Literal('statistics'),Type.Literal('replenishment')]),rows:Type.Array(Type.Unknown(),{maxItems:10000})}),
    async execute(_id,params,signal){
      const raw=JSON.stringify(params);if(Buffer.byteLength(raw)>1048576)throw Error('analysis_input_limit');
      const result=await new Promise((resolve,reject)=>{
        const child=spawn('/usr/local/bin/python3',['-I','-B','/opt/pi/plan-analysis.py'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'}});
        let data='',bytes=0,failed=false;const stop=()=>{failed=true;child.kill('SIGKILL');};
        const timer=setTimeout(stop,30000);signal?.addEventListener('abort',stop,{once:true});
        child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)stop();else data+=chunk.toString('utf8');});child.stderr.resume();
        child.on('error',reject);child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(code!==0||failed)return reject(Error(signal?.aborted?'aborted':'analysis_helper_failed'));try{resolve(JSON.parse(data));}catch{reject(Error('analysis_helper_invalid_result'));}});child.stdin.on('error',()=>{});child.stdin.end(raw);
      });return output(result);
    }});
  return {inventory};
}
