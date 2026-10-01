/** Preserve C-owned ignored test evidence before any future worktree cleanup. */
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const root=process.cwd(),parent="E:/codex-artifacts/netshop-scheme2-20261001/comparison/page";
const runId=`handoff-${new Date().toISOString().replace(/[-:.]/g,"")}-${randomUUID()}`,target=resolve(parent,runId);
await mkdir(target); const preserved=[];
const hash=value=>createHash("sha256").update(value).digest("hex");
async function preserve(path){
 const source=resolve(root,path),value=await readFile(source),destination=resolve(target,"ignored",path);
 await mkdir(resolve(destination,".."),{recursive:true}); await writeFile(destination,value,{flag:"wx"});
 const copy=await readFile(destination);if(hash(copy)!==hash(value))throw Error(`Evidence copy mismatch: ${path}`);
 preserved.push({path,size:value.length,sha256:hash(value),preserved:relative(target,destination)});
}
async function walk(path){for(const entry of await readdir(resolve(root,path),{withFileTypes:true})){const next=resolve(path,entry.name);if(entry.isDirectory())await walk(next);else await preserve(relative(root,next));}}
for(const entry of await readdir(resolve(root,".runtime"),{withFileTypes:true})){if(entry.isDirectory()&&entry.name.startsWith("comparison-ui-"))await walk(resolve(".runtime",entry.name));else if(entry.isFile()&&/^comparison-tsc.*\.txt$/.test(entry.name))await preserve(resolve(".runtime",entry.name));}
const runs=[];
for(const entry of await readdir(parent,{withFileTypes:true})){if(!entry.isDirectory()||entry.name.startsWith("handoff-"))continue;const files=[];for(const name of await readdir(resolve(parent,entry.name))){const path=resolve(parent,entry.name,name);if(!(await stat(path)).isFile())continue;const value=await readFile(path);files.push({name,size:value.length,sha256:hash(value)});}runs.push({runId:entry.name,files});}
const manifest={role:"C-ui-author",root,branch:execFileSync("git",["branch","--show-current"],{cwd:root,encoding:"utf8"}).trim(),head:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),syntheticOnly:true,preservedIgnored:preserved,evidenceRuns:runs,reproducibleIgnored:[{path:"node_modules",basis:"independent npm ci --ignore-scripts --no-audit --no-fund; no production link",lockSha256:hash(await readFile(resolve(root,"package-lock.json")))},{path:"tsconfig.tsbuildinfo",basis:"reproducible compiler cache; actual 188 inherited diagnostics preserved separately"}],resources:{port:3171,expectedState:"stopped; each owned run has resource-stopped.json; no claim about other processes"}};
await writeFile(resolve(target,"manifest.json"),JSON.stringify(manifest,null,2),{flag:"wx"});console.log(JSON.stringify({target,sha256:hash(await readFile(resolve(target,"manifest.json"))),preserved:preserved.length,runs:runs.length,head:manifest.head}));
