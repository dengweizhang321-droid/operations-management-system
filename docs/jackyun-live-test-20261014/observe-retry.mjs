import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const out='D:/codex-artifacts/jackyun-live-test-20261014';
const prefix=process.argv[2]??'original-human';
if(!['original-human','resumed-human','browser-recovered','wrapper-recovered'].includes(prefix))throw Error('Unknown authorized attempt');
const started=JSON.parse(await fs.readFile(out+'/'+prefix+'-dispatch-started.json','utf8'));
const require=createRequire(path.join(process.env.APPDATA,'npm/node_modules/n8n/package.json'));
const {parse}=require('flatted');
const db=new DatabaseSync(path.join(homedir(),'.n8n/database.sqlite'),{readOnly:true});
const redact=value=>String(value??'').replace(/https?:\/\/[^\s"']+/g,'[url]').replace(/(?:Bearer|token|cookie|password|signature)\s*[:=]\s*[^\s,]+/gi,'[redacted]').slice(0,1500);
try{
 db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
 const rows=db.prepare("SELECT id,workflowId,status,startedAt,stoppedAt,waitTill FROM execution_entity WHERE workflowId IN (?,?) AND deletedAt IS NULL AND julianday(startedAt)>=julianday(?) ORDER BY id LIMIT 30").all('J8kY2mQ5vR7sT4pN','TeruisiHourlyRetry2026',started.at);
 const executions=rows.map(row=>{
  const stored=db.prepare('SELECT data FROM execution_data WHERE executionId=?').get(row.id);
  const value=stored?parse(stored.data):null,error=value?.resultData?.error;
  return {...row,boundToOriginalAuthority:stored?.data.includes(started.requestId)??false,nodes:Object.keys(value?.resultData?.runData??{}),error:error?{name:error.name,message:redact(error.message),description:redact(error.description),node:error.node?.name}:null};
 });
 const now=new Date().toISOString(),result={at:now,readOnly:true,executions};
 await fs.writeFile(out+'/live-observation-'+now.replaceAll(':','-')+'.json',JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify(result));
}finally{db.close();}
