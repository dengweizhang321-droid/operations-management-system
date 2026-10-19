import {parseArgs} from 'node:util';
import {observeRecovery} from './e969-maintenance-recovery.mjs';
const {values}=parseArgs({options:{request:{type:'string'},sha:{type:'string'},out:{type:'string'}}});
if(!values.request||!values.sha||!values.out)throw Error('Exact request/SHA/output required');
await observeRecovery({requestFile:values.request,requestSha256:values.sha,out:values.out});
