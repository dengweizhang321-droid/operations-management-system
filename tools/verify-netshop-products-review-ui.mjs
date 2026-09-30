/** Independent Q replay plus extra browser adversaries over the full column.
 * A committed author harness is used only as a seed. Product files are read-only.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const directory = resolve(root, ".runtime", "products-review-ui-" + randomUUID());
await mkdir(directory, { recursive: false });
let source = await readFile(resolve(root, "tools/verify-netshop-products-ui.mjs"), "utf8");
const responseMarker = " if(window.__mode==='malformed'&&response.sections?.structure)delete response.sections.structure.classification;";
assert.equal(source.split(responseMarker).length, 2, "The Q response seed anchor must remain explicit and unique");
source = source.replace(responseMarker, responseMarker + `
 if(window.__mode==='q-missing-structure'&&response.sections)delete response.sections.structure;
 if(window.__mode==='q-catalog-null-shop'&&response.shops)response.shops=[null];
 if(window.__mode==='q-catalog-bad-mapping-flag'&&response.items&&!response.sections&&response.items.length)response.items[0].salesMatched='false';
 if(window.__mode==='q-catalog-bad-ratio'&&response.items&&!response.sections&&response.items.length){response.items[0].salesMatched=true;response.items[0].grossMarginRate='broken';}
`);
const checkMarker = "  assert.deepEqual(errors, []);";
assert.equal(source.split(checkMarker).length, 2, "The Q browser seed anchor must remain explicit and unique");
source = source.replace(checkMarker, `
  await page.setViewportSize({width:1280,height:1000});
  await page.goto('http://127.0.0.1:'+port+'/');
  await page.getByText('合成商品 P01',{exact:true}).waitFor();
  await check('Q missing fixed structure never renders a missing-source substitute',async()=>{
    await page.evaluate(()=>{window.__mode='q-missing-structure';});
    await page.getByRole('button',{name:'刷新本范围',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.np-table tbody tr').count(),0);
    assert.equal(await page.locator('.np-missing').count(),0);
  });
  for(const mode of ['q-catalog-null-shop','q-catalog-bad-mapping-flag','q-catalog-bad-ratio']){
    await page.goto('http://127.0.0.1:'+port+'/');
    await page.getByText('合成商品 P01',{exact:true}).waitFor();
    await page.locator('#probe-tmall-catalog').click();
    await page.getByText('目录合成商品 1',{exact:true}).waitFor();
    await check('Q malformed old catalogue '+mode+' fails before React consumers',async()=>{
      await page.evaluate(mode=>{window.__mode=mode;},mode);
      // A changed filter starts a full read, so shops is present in the injected
      // response. Same-family refresh deliberately uses the page-only DTO.
      const currentStatus=await page.getByLabel('目录状态筛选').inputValue();
      await page.getByLabel('目录状态筛选').selectOption(currentStatus==='on_sale'?'all':'on_sale');
      await page.getByRole('alert').waitFor();
      assert.equal(await page.locator('.np-table tbody tr').count(),0);
      assert.equal(await page.locator('.np-gallery-item').count(),0);
    });
  }
${checkMarker}`);
await writeFile(resolve(directory, "review-harness.mjs"), source, { flag: "wx" });
process.env.NETSHOP_PRODUCTS_UI_EVIDENCE_ROOT = "E:/codex-artifacts/netshop-scheme2-20261001/products/review";
process.env.NETSHOP_PRODUCTS_UI_ROLE = "P-Q-independent-adversarial";
await import(pathToFileURL(resolve(directory, "review-harness.mjs")).href);
