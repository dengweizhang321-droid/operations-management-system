// Read-only local static design server; no application gateway or database.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/demo.js',['demo.js','text/javascript; charset=utf-8']],['/demo.css',['demo.css','text/css; charset=utf-8']]]);
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return}
  const target=files.get(new URL(req.url,'http://127.0.0.1').pathname);
  if(!target){res.writeHead(404).end();return}
  try{const body=await readFile(join(root,target[0]));res.writeHead(200,{'Content-Type':target[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body)}catch{res.writeHead(500).end()}
});
server.on('error',error=>{console.error(error.message);process.exitCode=1});
server.listen(3160,'127.0.0.1',()=>console.log('Panorama design demo: http://127.0.0.1:3160/'));
