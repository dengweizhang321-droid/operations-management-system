import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const norm=value=>value.replaceAll('\\','/');

export function parseNameStatus(raw){
  const tokens=raw.split('\0').filter(Boolean),changes=[];
  for(let i=0;i<tokens.length;){
    const status=tokens[i++];
    if(!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(status))throw new Error(`无法识别 Git 变更状态: ${status}`);
    if(status.startsWith('R')||status.startsWith('C'))changes.push({status,before:norm(tokens[i++]),path:norm(tokens[i++])});
    else changes.push({status,path:norm(tokens[i++])});
  }
  return changes;
}

export function classifyRelease(changes){
  const state={worker:false,django:false,migrate:false,persistence:false,full:false,domains:new Set(),reasons:[],unknown:[]};
  const classify=p=>{
    const value=norm(p);
    if(/^(docs\/|README\.md$|AGENTS\.md$)/.test(value))return;
    if(/^tests\//.test(value)){state.reasons.push(`测试:${value}`);return;}
    const backend=/^backend\/([^/]+)\//.exec(value);
    if(backend){state.django=true;state.domains.add(backend[1]);state.persistence=true;if(/\/migrations\/.*\.py$/.test(value))state.migrate=true;state.reasons.push(`后端:${value}`);return;}
    if(/^(backend\/manage\.py|backend\/requirements.*|backend\/teruisi_backend\/)/.test(value)){state.django=true;state.persistence=true;state.full=true;state.reasons.push(`后端运行配置:${value}`);return;}
    if(/^(app\/api\/|worker\/)/.test(value)){state.worker=true;if(/(?:write|create|update|delete|import|queue|task|model|config)/i.test(value))state.persistence=true;state.reasons.push(`Worker/API:${value}`);return;}
    if(/^(app\/|components\/|public\/|styles\/)/.test(value)){state.worker=true;state.reasons.push(`前端:${value}`);return;}
    if(/^lib\//.test(value)){state.worker=true;state.persistence=true;state.reasons.push(`共享运行库:${value}`);return;}
    if(/^(package(?:-lock)?\.json|tsconfig.*\.json|next-env\.d\.ts|wrangler.*|(?:vite|vinext|eslint).*config.*)$/.test(value)){state.worker=true;state.full=true;state.reasons.push(`前端依赖/构建配置:${value}`);return;}
    if(/^(config\/|tools\/|.*\.(?:ps1|bat|cmd)$)/.test(value)){state.worker=true;state.django=true;state.persistence=true;state.full=true;state.reasons.push(`运行或发布工具:${value}`);return;}
    if(/^\.github\//.test(value)){state.reasons.push(`CI:${value}`);return;}
    state.worker=true;state.django=true;state.persistence=true;state.full=true;state.unknown.push(value);state.reasons.push(`未知路径升级完整流程:${value}`);
  };
  for(const change of changes){if(change.before)classify(change.before);classify(change.path);}
  const components=[state.worker&&'worker',state.django&&'django'].filter(Boolean);
  const code=components.length>0;
  const scope=!code?'non-production':state.migrate?'database-migration':state.full?'full':state.worker&&state.django?'combined':state.django?'backend':state.persistence?'worker-persistence':'frontend-worker';
  const validation=['git-diff-check',...(state.worker?['worker-affected-tests']:[]),...(state.django?['django-affected-tests']:[]),...(state.full?['affected-integration-tests']:[]),...(state.migrate?['django-system-check','migration-dry-run','isolated-postgresql-migration-rehearsal']:[])];
  const packaging=[...(state.worker?['prepare-worker-immutable-release']:[]),...(state.django?['prepare-django-app']:[])];
  // New schema deliveries follow the confirmed schema-only policy. Business
  // imports/backfills and database recovery need their own authorization;
  // existing sealed batch contracts are not changed by this planning tool.
  const deployment=!code?[]:[...(state.persistence&&!state.migrate?['verify-current-database-backup']:[]),...(state.migrate?['apply-approved-migrations']:[]),...(state.worker?['activate-worker-release']:[]),...(state.django?['deploy-django-app']:[]),'verify-startup','verify-affected-function'];
  const workflow=[
    {step:4,id:'validate-change',actions:validation},
    {step:5,id:'merge-and-package',actions:['merge-main','push-main',...packaging]},
    {step:6,id:'publish',actions:deployment},
  ];
  return {scope,components,migrate:state.migrate,databaseProtection:state.migrate?'schema-only-no-new-full-backup-or-restore':state.persistence?'verified-current':'not-required',businessDataProcessing:'separate-authorization-required',validation,packaging,deployment,workflow,domains:[...state.domains].sort(),unknown:state.unknown,reasons:state.reasons};
}

export function makeReleasePlan({base,head='HEAD',cwd=root}){
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
  if(!base||base.startsWith('-')||head.startsWith('-'))throw new Error('必须提供明确的 --base Git 提交');
  const baseSha=git(['rev-parse','--verify',`${base}^{commit}`]).trim(),headSha=git(['rev-parse','--verify',`${head}^{commit}`]).trim();
  const changes=parseNameStatus(git(['diff','--name-status','--find-renames=50%','-z',baseSha,headSha]));
  const core={version:'teruisi-scoped-release-plan-v3',baseSha,headSha,changes,...classifyRelease(changes)};
  return {...core,planSha256:hash(core)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const {values}=parseArgs({options:{base:{type:'string'},head:{type:'string',default:'HEAD'}}});
  try{console.log(JSON.stringify(makeReleasePlan({base:values.base,head:values.head}),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
