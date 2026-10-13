import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const intended=await readFile('E:/codex-artifacts/release-site-blockers-20261011/SITE_AGY3_PROMPT.txt','utf8');
const received=process.argv[2]??'';
const hash=s=>createHash('sha256').update(s).digest('hex');
const result={expectedSha256:hash(intended),receivedSha256:hash(received),same:received===intended,
  expectedQuotes:(intended.match(/"/g)??[]).length,receivedQuotes:(received.match(/"/g)??[]).length,
  scope:'Controlled native argv receiver; does not establish what a different receiver accepted.'};
console.log(JSON.stringify(result));
process.exitCode=result.same?0:1;
