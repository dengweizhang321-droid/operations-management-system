import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
const raw=readFileSync('E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry.mjs');
const text=raw.toString('utf8'),match=/workerRuntimeRoot=('[^']*')/.exec(text);
if(!match)throw Error('Fixed root declaration missing');
const root=vm.runInNewContext(match[1]);
console.log(JSON.stringify({entrySha256:createHash('sha256').update(raw).digest('hex'),literalContainsEscapedTabToken:match[1].includes('\\t'),evaluatedValueContainsTab:root.includes('\t'),controlCharacterCount:[...root].filter(c=>c.charCodeAt(0)<32).length,isAbsolute:path.win32.isAbsolute(root),equalsOriginalFixedRoot:path.win32.normalize(root).toLowerCase()===path.win32.normalize('D:/teruisi-runtime/teruisi-worker-sales').toLowerCase()}));
