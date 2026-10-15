/* Offline DOM verification. This does not render pixels or control a browser. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {JSDOM,VirtualConsole}=require(process.argv[2]||'jsdom');
const files=fs.readdirSync(__dirname).filter(x=>/^0[1-6]-.*\.html$/.test(x));
let checks=0,screenCount=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const results=[];
for(const file of files){
 const html=fs.readFileSync(path.join(__dirname,file),'utf8');
 check(!/<script[^>]+src=|<link[^>]+href=|<img[^>]+src=/i.test(html),'Self-contained resources');
 const errors=[],virtualConsole=new VirtualConsole();
 virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:pathToFileURL(path.join(__dirname,file)).href,runScripts:'outside-only',virtualConsole});
 const w=dom.window,doc=w.document;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=()=>{throw Error('Network forbidden in offline prototype');};
 w.eval(doc.querySelector('script').textContent);
 const click=selector=>{let el=doc.querySelector(selector);assert.ok(el,`Missing control ${selector} in ${file}`);el.click();return el;};
 const text=()=>doc.querySelector('#content').textContent;
 check(doc.querySelectorAll('.nav-strip [role=tab]').length===9,'Nine business sections');
 const moduleButtons=[...doc.querySelectorAll('[data-action=module]')].map(x=>x.dataset.value);
 for(const module of moduleButtons){
  click(`[data-action=module][data-value=${module}]`);
  check(doc.querySelector('.nav-strip [aria-selected=true]').dataset.value===module,'Active section matches');
  const count=doc.querySelectorAll('.subtabs [data-action=tab]').length;
  for(let tab=0;tab<count;tab++){
   click(`.subtabs [data-index="${tab}"]`);
   check(text().trim().length>30,`Nonempty screen ${module}/${tab}`);
   check(!/NaN|undefined|Invalid Date/.test(text()),`Valid values ${module}/${tab}`);
   const ids=[...doc.querySelectorAll('[id]')].map(x=>x.id);
   check(new Set(ids).size===ids.length,`Unique IDs ${module}/${tab}`);
   check(doc.querySelectorAll('.subtabs [aria-selected=true]').length===1,'One active tab');
   screenCount++;
  }
 }
 click('[data-action=module][data-value=product]');
 let select=doc.querySelector('#shop-select');select.value='all';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 check(doc.querySelector('.table-bottom').textContent.includes('24'),'All-shop products have 24 synthetic rows');
 if(file.startsWith('03')){check(doc.querySelectorAll('[data-action=object]').length===24,'Every object is reachable');click('[data-action=object][data-index="23"]');check(doc.querySelector('.object-detail h2').textContent.includes('油烟'),'Last object details update');}
 click('[data-action=expand]');check(!!doc.querySelector('.expanded-row'),'Row details expand');
 click('[data-action=expand]');check(!doc.querySelector('.expanded-row'),'Row details collapse');
 let query=doc.querySelector('#table-query');query.value='不存在';query.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
 check(!text().includes('没有符合条件的记录'),'IME confirmation does not submit');
 query.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(text().includes('没有符合条件的记录'),'Search empty state');
 click('[data-action=clear-query]');check(!text().includes('没有符合条件的记录'),'Clear query restores records');
 click('[data-action=columns]');
 let boxes=[...doc.querySelectorAll('#columns-form [name=col]')];boxes.forEach(x=>x.checked=false);
 doc.querySelector('#columns-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));check(doc.querySelector('#col-error').textContent.includes('至少'),'Cannot hide every metric');
 boxes[0].checked=true;doc.querySelector('#columns-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 check(doc.querySelectorAll('#data-detail .data-table thead th').length===3,'Column selection applies');
 click('[data-action=module][data-value=adjust]');
 check(text().includes('8.88'),'Mature ROI 8.88');check(text().includes('无法判断'),'Unknown break-even remains unknown');
 check(doc.querySelector('#shop-select').disabled,'Unsupported promotion accounts cannot be falsely selected');
 click('[data-action=metric][data-index="2"]');check(doc.querySelector('#dialog-body').textContent.includes('缺保本'),'Metric definition dialog');click('[data-action=close]');
 click('[data-action=days][data-value="7"]');check(doc.querySelector('.toolbar').textContent.includes('10-09'),'Seven-day range changes');
 click('[data-action=custom]');
 let dateForm=doc.querySelector('#date-form');dateForm.elements.start.value='2026-10-14';dateForm.elements.end.value='2026-10-10';dateForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));check(doc.querySelector('#date-error').textContent.includes('无效'),'Invalid dates rejected');
 dateForm.elements.start.value='2026-10-01';dateForm.elements.end.value='2026-10-10';dateForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));check(doc.querySelector('.toolbar').textContent.includes('10-01'),'Custom dates apply');
 click('[data-action=module][data-value=config]');
 let form=doc.querySelector('#config-form');form.elements.field0.value='演示草稿';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));check(doc.querySelector('#save-status').textContent.includes('已保存'),'Local configuration draft saves');
 click('.subtabs [data-index="1"]');click('.subtabs [data-index="0"]');check(doc.querySelector('[name=field0]').value==='演示草稿','Draft retained within current file session');
 for(const mode of ['无数据','加载失败','权限不足']){let modeSelect=doc.querySelector('#state-mode');modeSelect.value=mode;modeSelect.dispatchEvent(new w.Event('change',{bubbles:true}));check(doc.querySelector('.empty'),'Explicit state '+mode);click('[data-action=retry]');check(doc.querySelector('#config-form'),'Retry restores screen');}
 check(errors.length===0,'No script errors: '+errors.join(';'));
 results.push({file,sectionCount:9,screenCount:31,scriptErrors:errors});
 dom.window.close();
}
const report={type:'offline-dom-verification',date:'2026-10-16',htmlFiles:files.length,screensExercised:screenCount,assertions:checks,network:'disabled',documentUrl:'Windows file:///D:/... parsed in JSDOM only',visualValidation:'not performed; native browser file URL blocked by policy',results};
console.log(JSON.stringify(report,null,2));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
