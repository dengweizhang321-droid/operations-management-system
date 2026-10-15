import {initialAccounts,initialMappings,flows,sources,newAccount,flowRisk,summarize,groupTransfers,transferKey} from './model.mjs';

const accounts=structuredClone(initialAccounts), mappings=structuredClone(initialMappings), ledger=structuredClone(flows);
const state={account:'a',tab:'overview',q:'',risk:'all',wait:24,simulation:false};
const tabs=[['overview','监控总览'],['flows','库存流水'],['transfers','调拨单核对'],['mapping','商品对照'],['sources','自动化导入'],['settings','账号与规则']];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=(text,tone='neutral')=>`<span class="badge ${tone}">${esc(text)}</span>`;
const tone=s=>s.includes('超时')?'danger':s.includes('待')||s==='未建单'?'warning':s.includes('已建单')?'success':'neutral';
const account=()=>accounts.find(a=>a.id===state.account);
const currentFlows=()=>ledger.filter(f=>f.account===state.account);
const mappingFor=f=>mappings.find(m=>m.owner===f.owner&&m.goods===f.goods);
const riskFor=f=>flowRisk(f,mappingFor(f),state.wait);
const meta=()=>summarize(currentFlows(),mappings,state.wait);
const button=(action,label,cls='secondary')=>`<button class="${cls}" data-action="${action}">${label}</button>`;
function stat(label,value,note,kind=''){return `<article class="stat ${kind}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;}
function render(){
 const a=account(),m=meta();
 $('#app').innerHTML=`<aside class="sidebar"><div class="brand"><span class="brand-icon">特</span><div>特睿思<small>运营管理系统</small></div></div><small class="nav-label">经营分析</small><span class="nav-item">◫　BI 看板</span><span class="nav-item">▤　网店分析</span><span class="nav-item">◷　销售分析</span><small class="nav-label">商品与供应链</small><button class="nav-item selected" data-action="home">▦　库存管理</button><div class="nav-child active">京东入仓监控</div><span class="nav-item">◇　商品经营</span><button class="nav-item" data-tab="sources">⇩　数据导入</button><small class="nav-label">系统与智能</small><button class="nav-item" data-tab="sources">⌘　自动化中心</button><button class="nav-item" data-tab="settings">⚙　系统设置</button><div class="sidebar-footer">京东物流接入 · 设计预览<small>本地演示 / 无生产连接</small></div></aside>
 <div class="workspace"><header class="global-header"><div>商品与供应链 <span>/</span> 库存管理 <span>/</span> <b>京东入仓监控</b></div><span class="avatar">演</span></header>
 <main><div class="demo-notice"><b>DEMO · 合成数据</b><span>操作仅在本次页面内生效；刷新重置。采集、导入和通知均为预览。</span><button data-action="reset">重置演示</button></div>
 <div class="page-heading"><div><span class="eyebrow">INVENTORY / JD LOGISTICS</span><h1>京东入仓监控</h1><p>让京东每一笔库存变动，都有对应的 ERP 单据。</p></div><div class="heading-actions">${button('process','查看接入流程')}${button('simulate','预览采集流程','primary')}</div></div>
 <div class="module-tabs"><button data-action="legacy">ERP 京东仓监控 <span>现有</span></button><button class="active" data-action="home">京东 POP <span>新增</span></button></div>
 <section class="scope-bar"><label>京东账号 / 店铺<select id="account">${accounts.map(x=>`<option value="${x.id}" ${x.id===a.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><div class="scope-info"><span>物流身份</span><strong>${esc(a.owner||'待绑定事业部 / 货主')}</strong><small>${a.owner?'物流事实按货主去重；店铺只作商品归属筛选':'绑定并验证身份后，才允许首次采集'}</small></div><div class="scope-status">${badge(a.collect?'采集已开启（演示）':'自动采集关闭',a.collect?'success':'neutral')}${badge(a.monitor?'监控已开启（演示）':'监控关闭')}${badge(a.push?'推送已开启（演示）':'推送关闭')}</div>${button('new-account','＋ 新建账号')}</section>
 <nav class="subtabs" aria-label="京东POP功能">${tabs.map(([id,title])=>`<button role="tab" aria-selected="${state.tab===id}" class="${state.tab===id?'active':''}" data-tab="${id}">${title}${id==='transfers'&&m.overdue?`<i>${m.overdue}</i>`:''}</button>`).join('')}</nav>
 <div id="content">${content()}</div><footer class="page-foot">本轮范围：京东 POP 库存流水、商品对照、ERP 建单核对。自营 / C 仓区域库存不纳入本轮。</footer></main></div>`;
}
function content(){
 if(state.tab==='overview')return overview();
 if(state.tab==='flows'||state.tab==='transfers')return flowPage();
 if(state.tab==='mapping')return mappingPage();
 if(state.tab==='sources')return sourcePage();
 return settingsPage();
}
function overview(){
 const m=meta(),a=account();
 return `<div class="overview-top"><section class="panel hero-panel"><div class="hero-title"><span class="pulse"></span><span>今天先处理什么</span>${badge('示例账期 · 10-14 至 10-15')}</div><h2>${m.overdue?`${m.overdue} 条调拨商品记录超时未建单`:'暂无已标记的超时未建单'}</h2><p>${m.unmapped?`${m.unmapped} 条调拨商品记录缺少完整商品对照，无法判断 ERP 是否建单。`:'示例商品对照完整。'}${m.pending?`另有 ${m.pending} 条调拨商品记录等待人工核对。`:''}</p><div>${button('pending','处理待办','primary')}${button('to-mapping','维护商品对照')}</div><div class="hero-note">${a.monitor?'监控规则仅在演示中开启':'当前监控关闭，以下为示例风险试算'} · ERP 调拨台账尚未接入，人工标记不等于系统查单证明。</div></section><section class="panel readiness"><h3>接入准备</h3><div><span>01</span><p><b>物流页面已观察</b><small>真实下载与文件表头仍待验证</small></p>${badge('已调研','success')}</div><div><span>02</span><p><b>商品对照与调拨状态</b><small>保留原表的人工维护入口</small></p>${badge('可演示','info')}</div><div><span>03</span><p><b>自动化与提醒</b><small>新店默认关闭，按店显式启用</small></p>${badge('待接线')}</div></section></div>
 <div class="stats">${stat('库存流水',m.count,'当前店铺归属 · 示例记录')}${stat('超时未建单',m.overdue,`超过 ${state.wait} 小时 · 人工标记未建单`,'danger')}${stat('商品对照待补',m.unmapped,'编码或名称缺失，保留未知','warning')}${stat('人工已建单',m.confirmed,'待后续 ERP 台账交叉验证','green')}</div>
 <div class="overview-bottom"><section class="panel"><div class="section-title"><div><h3>流水核对待办</h3><p>先补商品映射，再核对对应单据</p></div><button class="text-button" data-tab="flows">全部流水 →</button></div>${compactTasks()}</section><section class="panel chain"><h3>一条流水的核对链路</h3><ol><li><b>京东库存流水</b><small>事业部 / 货主、仓库、商品、单号、发生时间</small></li><li><b>店铺商品归属</b><small>物流商品 → 销售平台店铺商品编码 → 店铺</small></li><li><b>人工商品对照 C / D 列</b><small>ERP 货品编码、ERP 货品名称</small></li><li><b>调拨单 C 列</b><small>ERP 调拨状态、核对备注与修改记录</small></li></ol><div class="note">库存倒挂目前只提示风险；没有 ERP 余额与完整单据覆盖时，不输出“账实一致”。</div></section></div>`;
}
function compactTasks(){
 const rows=groupTransfers(currentFlows()).filter(f=>riskFor(f)!=='人工标记已建单');
 if(!rows.length)return `<div class="empty">暂无待办。新账号尚未采集时，不代表核对通过。</div>`;
 return rows.map(f=>`<button class="task" data-flow="${f.id}"><span class="task-icon ${tone(riskFor(f))}">${riskFor(f)==='待补映射'?'映':'单'}</span><span><b>${esc(f.order)}</b><small>${esc(mappingFor(f)?.name||f.sku)} · ${esc(f.warehouse)} · ${f.qty>0?'+':''}${f.qty} 件</small></span>${badge(riskFor(f),tone(riskFor(f)))}<span>›</span></button>`).join('');
}
function flowPage(){
 const transfer=state.tab==='transfers';
 if(transfer)return transferPage();
 let rows=currentFlows().filter(f=>!transfer||f.type.includes('调拨'));
 rows=rows.filter(f=>(state.risk==='all'||riskFor(f)===state.risk)&&`${f.order} ${f.sku} ${mappingFor(f)?.name||''}`.toLowerCase().includes(state.q.toLowerCase()));
 return `<section class="panel"><div class="section-title"><div><h2>${transfer?'调拨单与 ERP 状态核对':'仓库库存流水'}</h2><p>${transfer?'按原始单号追踪，状态沿用原表 C 列的人工维护方式':'保留原始变动方向和数量，商品编码使用文本，原始事实不被人工修改'}</p></div>${badge('ERP 台账未接入','warning')}</div><div class="filter-row"><input id="search" value="${esc(state.q)}" placeholder="搜索单号 / 商品编码 / 商品名" aria-label="搜索流水"><select id="risk" aria-label="核对状态">${['all','超时未建单','待补映射','待核对','未建单','人工标记已建单'].map(r=>`<option value="${r}" ${state.risk===r?'selected':''}>${r==='all'?'全部核对状态':r}</option>`).join('')}</select><span>${rows.length} 条示例流水</span>${button('export','导出当前页 CSV')}</div><div class="table-scroll"><table><thead><tr><th>发生时间 / 原单号</th><th>商品 / ERP 编码</th><th>仓库</th><th>变动类型</th><th class="num">变动量</th><th>ERP 状态</th><th>核对结果</th><th>操作</th></tr></thead><tbody>${rows.map(f=>`<tr><td><b>${esc(f.order)}</b><small>${f.time} · 示例</small></td><td><b>${esc(mappingFor(f)?.name||f.sku)}</b><small>${esc(f.sku)} → ${esc(mappingFor(f)?.erp||'待补对照')}</small></td><td>${esc(f.warehouse)}</td><td>${esc(f.type)}</td><td class="num ${f.qty<0?'outbound':'inbound'}">${f.qty>0?'+':''}${f.qty}</td><td>${esc(f.erp)}<small>人工维护</small></td><td>${badge(riskFor(f),tone(riskFor(f)))}</td><td><button class="text-button" data-flow="${f.id}">核对详情</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">暂无匹配流水。请调整筛选或完成首次采集。</div></td></tr>'}</tbody></table></div><div class="table-footer">第 1 页 / 共 1 页 · 演示小样本<div>人工状态仅更新核对记录，不会在 ERP 自动建立单据。</div></div></section><div class="note below">“未找到 ERP 单据”和“未接入 ERP 单据”分别显示。缺少商品对照或台账覆盖时保留待核对，不直接判定漏单。</div>`;
}
function transferPage(){
 const rows=groupTransfers(currentFlows()).filter(f=>(state.risk==='all'||riskFor(f)===state.risk)&&`${f.order} ${f.goods} ${mappingFor(f)?.name||''}`.toLowerCase().includes(state.q.toLowerCase()));
 return `<section class="panel"><div class="section-title"><div><h2>调拨单与 ERP 状态核对</h2><p>每行 = 物流货主 ＋ 京东单据号 ＋ 事业部商品编号；同一调拨的多条流水合并展示</p></div>${badge('ERP 台账未接入','warning')}</div><div class="filter-row"><input id="search" value="${esc(state.q)}" placeholder="搜索调拨单 / 事业部商品 / 商品名" aria-label="搜索流水"><select id="risk" aria-label="核对状态">${['all','超时未建单','待补映射','待核对','人工标记已建单'].map(r=>`<option value="${r}" ${state.risk===r?'selected':''}>${r==='all'?'全部核对状态':r}</option>`).join('')}</select><span>${rows.length} 条调拨商品记录</span></div><div class="table-scroll"><table><thead><tr><th>京东调拨单号 / 商品</th><th>调出仓 → 调入仓</th><th class="num">京东调出</th><th class="num">京东实收</th><th>京东状态</th><th>ERP 人工状态 · C列</th><th>核对结果</th><th>操作</th></tr></thead><tbody>${rows.map(f=>`<tr><td><b>${esc(f.order)}</b><small>${esc(f.goods)} · ${esc(mappingFor(f)?.name)}</small></td><td>${esc(f.from||'来源待补')}<small>→ ${esc(f.to||'目的待补')}</small></td><td class="num">${f.out}</td><td class="num">${f.received}</td><td>${badge(f.jdStatus,f.jdStatus==='收货量异常'?'danger':'neutral')}</td><td>${esc(f.erp)}<small>人工确认记录</small></td><td>${badge(riskFor(f),tone(riskFor(f)))}</td><td><button class="text-button" data-flow="${f.id}">核对详情</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">暂无匹配调拨。没有采集数据不代表核对通过。</div></td></tr>'}</tbody></table></div><div class="table-footer">人工状态按稳定调拨商品键保存；排序和历史补采不改变归属。<div>原表“已调拨”迁入后仅作为人工确认，待 ERP 证据验证。</div></div></section><div class="note below">调出和实收来自不同事件及库存分量。部分入库、在途与收货量异常分别显示，不能用正负净额是否为零判断 ERP 已建单。</div>`;
}
function mappingPage(){
 const rows=mappings.filter(m=>m.account===state.account);
 return `<section class="panel"><div class="section-title"><div><h2>商品对照与店铺归属</h2><p>保留原工作簿 C / D 两个人工字段；京东商品归属由“店铺商品”数据源辅助确认</p></div>${badge('人工字段受保护','info')}</div><div class="note">同一销售平台商品编码可以出现在不同店铺。匹配必须同时绑定货主与店铺；歧义不自动选择第一条。</div><div class="table-scroll"><table><thead><tr><th>京东物流商品（示例）</th><th>所属店铺 / 平台商品编码</th><th>ERP 货品编码 · C列</th><th>ERP 货品名称 · D列</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map(m=>`<tr><td><b>${esc(m.name)}</b><small>${esc(m.goods)}</small></td><td>${esc(account().name)}<small>${esc(m.sku)}</small></td><td>${esc(m.erp)||'—'}</td><td>${esc(m.erpName)||'—'}</td><td>${badge(m.erp&&m.erpName?'对照完整':'待补对照',m.erp&&m.erpName?'success':'warning')}</td><td><button class="text-button" data-map="${m.id}">编辑对照</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">账号尚无商品归属记录。先完成店铺商品数据源接入。</div></td></tr>'}</tbody></table></div><div class="table-footer">自动导入仅更新来源字段；人工 ERP 对照不会被空值覆盖。</div></section><section class="panel below"><h3>编码保持各自身份</h3><div class="code-chain"><span>事业部商品编码 EMG</span><i>→</i><span>店铺商品编码 ESG / ISV</span><i>→</i><span>销售平台店铺商品编码</span><i>→</i><span>ERP 货品编码</span></div><p class="muted">示意关系不保证一对一；组合套装、同码多店及一对多映射需要单独核对。</p></section>`;
}
function sourcePage(){
 return `<section class="panel"><div class="section-title"><div><h2>京东 POP 自动化导入</h2><p>流程预览与批次验证入口；本轮实际接口和下载器尚未接线</p></div>${button('simulate','预览采集流程','primary')}</div><div class="source-grid">${sources.filter(s=>['flow','products'].includes(s.id)).map(s=>`<article class="source-card"><div class="source-number">${s.number}</div><div><h3>${s.title}</h3><p>${s.use}</p>${badge('页面已观察 · 文件契约待验证','info')}<dl><dt>来源粒度</dt><dd>${s.grain}</dd><dt>本店状态</dt><dd>尚未启用 / 无真实批次</dd></dl><a href="${s.url}" target="_blank" rel="noreferrer">打开京东来源页 ↗</a></div></article>`).join('')}</div><div class="pipeline">${['账号与货主核验','建立导出任务基线','导出并绑定任务','文件结构与覆盖校验','原子导入与精确回查'].map((s,i)=>`<div><span>${i+1}</span>${s}</div>`).join('')}</div><div class="note">下载完成不等于导入成功。任务提交结果不明时暂停；不得重复点击导出或按“最新文件”猜测。</div></section><section class="panel below"><div class="section-title"><div><h3>批次记录</h3><p>计划、下载、校验、导入、回查分开记录</p></div>${badge(state.simulation?'演示预检已结束':'无真实执行')}</div>${state.simulation?`<div class="simulation-result"><b>流程预览：已停在“文件契约待验证”</b><p>已演示账号检查和任务基线步骤；没有创建真实京东导出任务，没有下载或写入业务数据。</p><p>下一步：验证导出文件表头、物流货主身份和稳定流水键，再接入 Django 导入批次。</p></div>`:'<div class="empty">尚无真实导入批次。可预览流程，查看各阶段的判定条件。</div>'}</section>`;
}
function settingsPage(){
 const a=account();
 return `<div class="settings-grid"><section class="panel"><h2>账号启用设置</h2><p class="muted">适用于全部京东账号；每个新账号独立选择何时开始。</p><label class="field">当前店铺<input value="${esc(a.name)}" readonly></label><label class="field">物流事业部 / 货主绑定<input id="owner" value="${esc(a.owner||'')}" placeholder="待完成来源身份验证"></label><div class="switch-row"><div><b>自动采集</b><small>库存流水、店铺商品；共享货主统一领取任务</small></div><input id="collect" type="checkbox" ${a.collect?'checked':''} aria-label="自动采集"></div><div class="switch-row"><div><b>ERP 建单监控</b><small>只评估已开启的账号</small></div><input id="monitor" type="checkbox" ${a.monitor?'checked':''} aria-label="ERP建单监控"></div><div class="switch-row"><div><b>提醒推送</b><small>接收人、渠道、规则确认后再启用</small></div><input id="push" type="checkbox" ${a.push?'checked':''} aria-label="提醒推送"></div>${button('save-settings','保存演示设置','primary')}<p class="muted">这些开关只修改演示状态，不会启动 n8n 或发送通知。</p></section><section class="panel"><h2>建单核对规则</h2><label class="field">建单超时阈值（小时）<input id="wait" type="number" min="1" max="720" value="${state.wait}"></label><p class="muted">根据流水发生时刻计算；仅对人工明确“未建单”的记录判断超时。待核对不自动当作未建单。</p><hr><h3>提醒预览</h3><div class="message-preview"><b>京东 POP 建单待办</b><p>${esc(a.name)}：${meta().overdue} 笔超时未建单，${meta().unmapped} 笔待补商品对照。</p><small>示例模板 / 未发送 / 目标接收人待配置</small></div><p class="muted">同一货主、单据与规则版本防重复提醒；恢复后关闭事件。发送结果未知时停止重发。</p>${button('preview-message','预览提醒内容')}</section></div>`;
}
function modal(html){$('#detail').innerHTML=`${html}<button class="dialog-close" data-action="close" aria-label="关闭弹窗">×</button>`;$('#detail').showModal();}
function flowDetail(id){
 const raw=ledger.find(f=>f.id===id),f=groupTransfers(currentFlows()).find(t=>t.key===transferKey(raw))||raw,m=mappingFor(f);
 if(!raw.type.includes('调拨')){modal(`<h2 id="dialog-title">${esc(raw.order)}</h2><p>${esc(raw.type)} · ${esc(raw.warehouse)} · ${raw.qty} 件</p><div class="note">本轮 ERP 核对聚焦调拨。此业务仅保留原始流水，不提供调拨状态维护。负向变动不是期末负库存。</div>`);return;}
 modal(`<span class="eyebrow">库存流水 / 核对详情</span><h2 id="dialog-title">${esc(f.order)}</h2><p>${esc(f.type)} · ${esc(f.warehouse)} · ${f.qty} 件</p><div class="detail-grid"><div><small>物流商品</small><b>${esc(m?.name||f.sku)}</b></div><div><small>ERP 对照</small><b>${esc(m?.erp||'待补编码')} / ${esc(m?.erpName||'待补名称')}</b></div><div><small>核对结果</small>${badge(riskFor(f),tone(riskFor(f)))}</div><div><small>单据来源</small><b>人工维护 · ERP 台账未接入</b></div></div><label class="field">ERP 状态（调拨单 C 列）<select id="edit-status">${['待核对','未建单','已建单'].map(s=>`<option ${s===f.erp?'selected':''}>${s}</option>`).join('')}</select></label><label class="field">核对备注<textarea id="edit-note" maxlength="200" placeholder="填写单号或核对说明，最多200字">${esc(f.note||'')}</textarea></label><div class="note">保留来源单号、流水数量与发生时间；此操作只更新人工核对结果。</div><div class="dialog-actions"><button class="secondary" data-action="close">取消</button><button class="primary" data-save-flow="${f.id}">保存核对（演示）</button></div>`);
}
function editMapping(id){const m=mappings.find(x=>x.id===id);modal(`<h2 id="dialog-title">编辑商品对照</h2><p>${esc(m.name)} · ${esc(m.sku)}</p><label class="field">C 列 · ERP 货品编码<input id="erp-code" value="${esc(m.erp)}" maxlength="80" placeholder="填写 ERP 货品编码"></label><label class="field">D 列 · ERP 货品名称<input id="erp-name" value="${esc(m.erpName)}" maxlength="120" placeholder="填写 ERP 货品名称"></label><p class="muted">编码和名称均完整后才解除“待补对照”。自动采集不覆盖这两个字段。</p><div class="dialog-actions"><button class="secondary" data-action="close">取消</button><button class="primary" data-save-map="${m.id}">保存对照（演示）</button></div>`);}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function navigate(tab){state.tab=tab;state.risk='all';state.q='';render();}
document.addEventListener('click',e=>{
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.tab){navigate(el.dataset.tab);return;}
 if(el.dataset.flow){flowDetail(el.dataset.flow);return;}
 if(el.dataset.map){editMapping(el.dataset.map);return;}
 if(el.dataset.saveFlow){const f=ledger.find(f=>f.id===el.dataset.saveFlow),status=$('#edit-status').value,note=$('#edit-note').value;for(const item of ledger.filter(r=>transferKey(r)===transferKey(f))){item.erp=status;item.note=note;}$('#detail').close();render();toast('人工核对已按调拨商品键保存，ERP 单据未变更。');return;}
 if(el.dataset.saveMap){const m=mappings.find(m=>m.id===el.dataset.saveMap);m.erp=$('#erp-code').value.trim();m.erpName=$('#erp-name').value.trim();$('#detail').close();render();toast('商品对照已更新，待办已重新计算（演示）。');return;}
 const action=el.dataset.action;
 if(action==='close'){$('#detail').close();return;}
 if(action==='home')navigate('overview');
 if(action==='reset')location.reload();
 if(action==='pending'){state.tab='transfers';state.risk='all';render();}
 if(action==='to-mapping')navigate('mapping');
 if(action==='legacy')modal('<h2 id="dialog-title">现有 ERP 京东仓监控</h2><p>正式系统该入口已具备库存、在途和近 7/30/90 日出库，本 Demo 保留其导航位置。</p><p>本次新增的京东 POP 来源与人工核对独立接入，不替换原有计算。</p>');
 if(action==='process')modal('<h2 id="dialog-title">京东 POP 接入流程</h2><ol class="process-list"><li>验证京东账号与物流事业部 / 货主</li><li>采集店铺商品，建立平台编码归属</li><li>采集库存流水，按完整业务键去重</li><li>维护商品对照 C / D，保留调拨单 C 状态</li><li>导入批次回查后，按已启用规则评估待办</li></ol><p class="muted">真实导出文件、完整日期覆盖及 ERP 单据接口仍需验证。</p>');
 if(action==='simulate'){state.simulation=true;navigate('sources');toast(account().collect?'演示预检结束：文件契约待验证，未进行真实下载。':'账号自动采集关闭：仅展示流程预检，未启动采集。');}
 if(action==='new-account')modal('<h2 id="dialog-title">新建京东账号（演示）</h2><label class="field">店铺名称<input id="new-name" maxlength="60" placeholder="例如：京东示例新店 D"></label><div class="note">创建后：自动采集关闭、ERP 监控关闭、提醒推送关闭；物流身份待绑定。</div><div class="dialog-actions"><button class="secondary" data-action="close">取消</button><button class="primary" data-action="create-account">创建演示账号</button></div>');
 if(action==='create-account'){const name=$('#new-name').value.trim();if(!name){toast('请填写店铺名称');return;}const a=newAccount(`new${accounts.length}`,name);accounts.push(a);state.account=a.id;state.wait=24;state.tab='settings';$('#detail').close();render();toast('新账号已创建，全部开关默认关闭（演示）。');}
 if(action==='save-settings'){const hours=Number($('#wait').value),owner=$('#owner').value.trim();if(!Number.isInteger(hours)||hours<1||hours>720){toast('建单超时请输入 1–720 的整数小时');return;}if(($('#collect').checked||$('#monitor').checked)&&!owner){toast('请先填写物流事业部 / 货主绑定（演示）。');return;}if($('#push').checked&&!$('#monitor').checked){toast('启用提醒前请先启用建单监控');return;}Object.assign(account(),{owner:owner||null,collect:$('#collect').checked,monitor:$('#monitor').checked,push:$('#push').checked});state.wait=hours;account().waitHours=hours;render();toast('设置仅保存到本次演示，尚未完成真实身份校验。');}
 if(action==='preview-message')modal(`<h2 id="dialog-title">提醒内容预览</h2><p>${esc(account().name)}：${meta().overdue} 笔超时未建单，${meta().unmapped} 条调拨商品记录缺少完整商品对照。</p><div class="note">推送${account().push?'仅在演示中开启':'关闭'}，目标接收人待配置；本次未发送。</div>`);
 if(action==='export')exportCsv();
});
document.addEventListener('change',e=>{if(e.target.id==='account'){state.account=e.target.value;state.wait=account().waitHours??24;state.q='';state.risk='all';render();}if(e.target.id==='risk'){state.risk=e.target.value;render();}});
document.addEventListener('input',e=>{if(e.target.id==='search'){const pos=e.target.selectionStart;state.q=e.target.value;$('#content').innerHTML=content();$('#search').focus();$('#search').setSelectionRange(pos,pos);}});
function exportCsv(){
 const rows=currentFlows().filter(f=>(state.tab!=='transfers'||f.type.includes('调拨'))&&(state.risk==='all'||riskFor(f)===state.risk)&&`${f.order} ${f.sku} ${mappingFor(f)?.name||''}`.toLowerCase().includes(state.q.toLowerCase()));
 const cell=v=>`"${String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
 const text=[['示例流水单号','商品编码','仓库','变动量','人工ERP状态','核对结果'],...rows.map(f=>[f.order,f.sku,f.warehouse,f.qty,f.erp,riskFor(f)])].map(r=>r.map(cell).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='京东POP_合成示例流水.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前筛选的合成示例流水。');
}
render();
