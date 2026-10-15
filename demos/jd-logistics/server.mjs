import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['index.html','app.mjs','model.mjs','style.css']);
const port=Number(process.env.JD_LOGISTICS_DEMO_PORT || 4326);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try {
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const file=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
    if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
    const body=await fs.readFile(path.join(root,file));
    res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'none'; form-action 'none'"});
    res.end(req.method==='HEAD'?undefined:body);
  }catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`JD logistics synthetic demo: http://127.0.0.1:${port}/`));
