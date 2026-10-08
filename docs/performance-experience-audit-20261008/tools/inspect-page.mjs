import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const url=process.argv[2]||'http://127.0.0.1:3781/?module=sales';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const out='.runtime/audit-private';await mkdir(out,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const requests=[],errors=[];
 page.setDefaultTimeout(6000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push({url:r.url(),status:r.status()});});
 await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 await page.goto(url);await page.waitForTimeout(6000);
 console.log(JSON.stringify({url:page.url(),headings:await page.getByRole('heading').allTextContents(),buttons:await page.getByRole('button').allTextContents(),tabs:await page.getByRole('tab').allTextContents(),inputs:await page.locator('input,textarea').evaluateAll(es=>es.map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder')}))),requests,errors}));
 await page.screenshot({path:out+'/inspect.png',fullPage:false});
}finally{await browser.close();}
