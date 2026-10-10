// Independent diagnostics for the unchanged real fs.watch implementation.
// Logs names only; no file contents or production configuration are read.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original=fs.watch;
fs.watch=function(target,options,listener) {
  const callback=(event,name)=>{
    console.log(JSON.stringify({diagnostic:'D-watch-event',target:String(target),event,name:name?.toString()??null}));
    listener(event,name);
  };
  return original.call(this,target,options,callback);
};
syncBuiltinESMExports();
