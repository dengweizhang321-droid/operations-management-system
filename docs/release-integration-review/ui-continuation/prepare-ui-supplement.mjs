// Offline preparation only. Never changes the sealed AB9 program or authority.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalRoot = 'E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const originalSha256 = '41434009a0f8f6cfe71f29ede31b3a8bc5a363c2b5ffa3ea2f9e9aa4b3698708';
const [outputRoot, expectedOriginalSha] = process.argv.slice(2);
assert.ok(outputRoot && path.isAbsolute(outputRoot));
assert.equal(path.dirname(path.resolve(outputRoot)), path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
assert.match(path.basename(outputRoot), /^AB-ui-supplement-20261010-[a-z0-9-]+$/);
let cursor = path.parse(path.resolve(outputRoot)).root;
for (const part of path.dirname(path.resolve(outputRoot)).slice(cursor.length).split(path.sep).filter(Boolean)) {
  cursor = path.join(cursor, part); const info = await lstat(cursor); assert.ok(info.isDirectory() && !info.isSymbolicLink());
}
assert.match(expectedOriginalSha ?? '', /^[a-f0-9]{64}$/);
assert.equal(expectedOriginalSha, originalSha256);
const original = await readFile(path.join(originalRoot, 'production-ui.mjs'));
assert.equal(digest(original), expectedOriginalSha);
let source = original.toString('utf8');
const once = (before, after) => { assert.equal(source.split(before).length, 2, `Expected one unchanged source fragment: ${before}`); source = source.replace(before, after); };
once("const root=\"E:\\\\codex-artifacts\\\\release-integration-review-20261010\\\\AB-v2-555729fd8f1dedc2\";", `const root=${JSON.stringify(path.resolve(originalRoot))};\nconst outputRoot=${JSON.stringify(path.resolve(outputRoot))};\nconst {installRequestCompletionBarrier,waitForProductDetailReady}=await import(pathToFileURL(outputRoot+'/request-completion.mjs'));`);
once(" const page=await context.newPage();page.setDefaultTimeout(60000);", " const completion=installRequestCompletionBarrier(context,{origin});\n const page=await context.newPage();page.setDefaultTimeout(60000);");
const historicalIdle = "await page.waitForLoadState('networkidle',{timeout:60000});";
assert.equal(source.split(historicalIdle).length - 1, 4);
source = source.replaceAll(historicalIdle, 'await completion.waitForIdle();');
once("await page.getByRole('button',{name:'详情',exact:true}).first().click();", "await page.locator('.product-list-region[aria-busy=false]').waitFor();const detailRead=await completion.runAndWaitForRead(()=>page.getByRole('button',{name:'详情',exact:true}).first().click(),{pathname:'/api/sales/summary',requiredQueryKeys:['productCodes','startDate','endDate','range']});await waitForProductDetailReady(page,{deadlineMonoMs:detailRead.deadlineMonoMs});await completion.waitForIdle();");
source = source.replaceAll("writeFile(root+'/production-ui-", "writeFile(outputRoot+'/production-ui-");
once("} finally {if(audit&&!audited){audited=await audit.finish();await writeFile(outputRoot+'/production-ui-audit.json',JSON.stringify(audited,null,2)+'\\n',{flag:'wx'});}await browser.close();}", "} finally {try {if(audit&&!audited){audited=await audit.finish();await writeFile(outputRoot+'/production-ui-audit.json',JSON.stringify(audited,null,2)+'\\n',{flag:'wx'});}}finally {await browser.close();}}");
await mkdir(outputRoot, { recursive: false });
const helper = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'request-completion.mjs'));
await writeFile(path.join(outputRoot, 'request-completion.mjs'), helper, { flag: 'wx' });
await writeFile(path.join(outputRoot, 'production-ui.mjs'), source, { flag: 'wx' });
await writeFile(path.join(outputRoot, 'preparation.json'), JSON.stringify({
  version: 'teruisi-ab-readonly-ui-supplement-v1', preparedAt: new Date().toISOString(), originalRoot,
  originalBatchSha256: '9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15',
  originalUiSha256: expectedOriginalSha, uiSha256: digest(Buffer.from(source)), helperSha256: digest(helper),
  productionExecuted: false, productionWritesAllowed: false, originalAuthorityChanged: false,
  changes: ['current request terminal barrier', 'one exact product detail GET and current successful DOM', 'private create-only output namespace', 'browser cleanup even if audit persistence fails'],
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputRoot, uiSha256: digest(Buffer.from(source)), helperSha256: digest(helper) }));
