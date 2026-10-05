import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.BI_DEMO_PORT||4318);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.mjs':'text/javascript; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Read-only demo');return;}
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404);res.end('Demo file not found');}
}).listen(port,'127.0.0.1',()=>console.log(`TERUISI synthetic BI demos: http://127.0.0.1:${port}/ (read-only, isolated)`));
