/** One finite operator; never submits tickets or invokes native preparation. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {writeFixedSchemaRejectionResolution} from './main-prebuild-queue.mjs';
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out)throw Error('A new private --out evidence directory is required');
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
console.log(JSON.stringify(await writeFixedSchemaRejectionResolution({sourceRoot,out:path.resolve(values.out)})));
