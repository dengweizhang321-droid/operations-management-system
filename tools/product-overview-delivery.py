"""Preserve non-sensitive synthetic evidence and build a viewable timeline."""
import hashlib
import html
import json
from pathlib import Path
import shutil
import statistics

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(r'E:\codex-artifacts\product-overview-speed-20261005')
OUT.mkdir(parents=True,exist_ok=True)
LAB=ROOT/'.runtime/product-overview-lab/evidence'
for file in LAB.iterdir():
    if file.suffix in {'.png','.jpg','.json'}:shutil.copy2(file,OUT/file.name)
for name in ['product-all-unit.log','product-rechecks.log','product-cross-module-rechecks.log','product-related-tests-final.log','product-lint.log','product-lint-final-scope.log','product-build-final.log','product-tsc-scoped.log','product-tsc-baseline-complete.log']:
    shutil.copy2(ROOT/'.runtime'/name,OUT/name)
for file in (ROOT/'.runtime/independent_review').iterdir():
    if file.is_file() and file.suffix in {'.json','.log','.png','.py','.mjs'}:shutil.copy2(file,OUT/('independent-'+file.name))
pg=ROOT/'.runtime/product-overview-pg-894c19ae267f8de4/benchmark.json'
shutil.copy2(pg,OUT/'postgres-benchmark.json')
for folder in ['product-overview-pg-1b93098b97bd3eb2','product-overview-pg-3b604295bb76933a']:
    for name in ['tests.log','result.json']:
        shutil.copy2(ROOT/'.runtime'/folder/name,OUT/(folder+'-'+name))
lab=json.loads((LAB/'result.json').read_text(encoding='utf-8'))
p=json.loads(pg.read_text(encoding='utf-8'))
labels={'cold':'首次冷计算','revisit':'同范围再次进入','page':'翻页（旧版也是page投影）','sort':'排序（旧版也是page投影）','filter':'同基础范围改筛选','date':'新日期冷计算','refresh':'同范围刷新'}
rows=[]
for scenario,label in labels.items():
    old=[r for r in p['records'] if r['scenario'].startswith('baseline/'+scenario+'/')]
    first=[r for r in p['records'] if r['scenario'].startswith('candidate/'+scenario+'/') and not r['scenario'].endswith('/rest')]
    rest=[r for r in p['records'] if r['scenario'].startswith('candidate/'+scenario+'/') and r['scenario'].endswith('/rest')]
    totals=[r['totalMs']+(rest[i]['totalMs'] if rest else 0) for i,r in enumerate(first)]
    rows.append({'scenario':scenario,'label':label,'baselineMedian':statistics.median(r['totalMs'] for r in old),'candidateFirstMedian':statistics.median(r['totalMs'] for r in first),'candidateAllMedian':statistics.median(totals),'baselineRange':[min(r['totalMs'] for r in old),max(r['totalMs'] for r in old)],'candidateFirstRange':[min(r['totalMs'] for r in first),max(r['totalMs'] for r in first)],'candidateAllRange':[min(totals),max(totals)],'queriesBefore':old[0]['queries'],'queriesAfter':first[0]['queries']+(rest[0]['queries'] if rest else 0),'cache':first[0]['calculationCache']})
ui=[]
for scenario in ['first-open','revisit','page','sort','filter','date','refresh']:
    for implementation in ['baseline','candidate']:
        values=[r for r in lab['all'] if r['scenario']==scenario and r['implementation']==implementation]
        ui.append({'scenario':scenario,'implementation':implementation,'n':len(values),'feedbackMedian':statistics.median(r['feedbackMs'] for r in values),'firstPaintMedian':statistics.median(r['updatedFirstContentMs'] for r in values),'allPaintMedian':statistics.median(r['allNecessaryContentMs'] for r in values)})
summary={'postgres':rows,'ui':ui,'conditions':{'postgres':'private PostgreSQL 17.11; 8500 synthetic products / 255000 sales, 2026-09 fixed; OS/database page cache warm; calculation cache miss vs hit explicit; three paired repeats; query code identical to reviewed main except pilot','ui':'120 products / 3600 sales / 120 stocks / 120 rates; private SQLite, React/Vite development; actual click/input origin, DOM commit and subsequent paint recorded; first-open n1, revisit n2, other n3; no injected delay; shell lazy loading measured separately','claims':'not production measurement, not P95; old retained content is not counted as newly fetched content'}}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
table=''.join('<tr>'+''.join(f'<td>{html.escape(str(v))}</td>' for v in [r['label'],f"{r['baselineMedian']:.0f}",f"{r['candidateFirstMedian']:.0f}",f"{r['candidateAllMedian']:.0f}",r['cache'],f"{r['queriesBefore']} → {r['queriesAfter']}"] )+'</tr>' for r in rows)
case=next(r for r in lab['all'] if r['implementation']=='candidate' and r['scenario']=='first-open')
frames=[{**f,'ms':round(f['timestamp']-case['timeOrigin']-case['start'])} for f in lab['frames'] if f['implementation']=='candidate']
frames=[f for f in frames if f['ms']>=0]
doc=f'''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>商品经营总览速度试点</title><style>body{{font:16px/1.7 system-ui;background:#f3f6f5;color:#17342d;margin:0}}main{{max-width:1200px;margin:auto;padding:32px}}h1{{font-size:30px}}section{{background:white;border-radius:16px;padding:24px;margin:20px 0}}table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;border-bottom:1px solid #e1e8e5;padding:10px}}img{{width:100%;display:block;border:1px solid #dbe5e0}}button,a{{color:#166b52}}button{{padding:8px 14px}}.notice{{border-left:4px solid #d89a33;padding:12px 20px}}input{{width:100%}}code{{font-size:13px}}small{{color:#55726a}}</style><main><h1>商品经营总览 · 速度优化试点</h1><p>源码和隔离验证完成；生产尚未采用。只优化商品经营，未改网店“商品表现”。</p><p><a href="http://127.0.0.1:3136/?module=product">完整系统隔离预览（6商品/180销售）</a> · <a href="http://127.0.0.1:3138/.runtime/product-overview-lab/index.html?implementation=candidate">候选120商品实验</a> · <a href="http://127.0.0.1:3138/.runtime/product-overview-lab/index.html?implementation=baseline">原版对照</a></p><section><h2>实际结果和取舍</h2><p>分页、排序、回访和同范围刷新显著减少重复计算。冷打开首批仍约1.27秒，没有稳定提速；完整补齐约1.36秒，比原版略晚。新日期冷范围仍约2.49秒，目标未达。</p><p class="notice">以下是固定合成环境的3次配对中位数，单位毫秒；不是正式数据、稳定P95或生产承诺。SQL条数与查询成本分开报告。</p><table><tr><th>场景</th><th>原版完整</th><th>候选首批</th><th>候选完整</th><th>计算缓存</th><th>SQL条数</th></tr>{table}</table><small>PostgreSQL 17.11，8500商品 / 255000销售，固定2026-09-01—30；数据库页已热，计算缓存另行清空或命中。21组重构前后精确业务等价。</small></section><section><h2>真实分阶段画面</h2><p>同一次120商品/3600销售、含库存和费率的SQLite实验；真实点击起点，无人为网络延迟。反馈 {case['feedbackMs']:.0f}ms，明细DOM提交 {case['firstCommitMs']:.0f}ms / 后续绘制 {case['updatedFirstContentMs']:.0f}ms，全部DOM提交 {case['allCommitMs']:.0f}ms / 后续绘制 {case['allNecessaryContentMs']:.0f}ms。</p><p><button id="play">播放原始画面</button> <span id="stamp"></span></p><input id="frame" type="range" min="0" max="{len(frames)-1}" value="0"><img id="image" alt="原始浏览器帧"><p>拖动查看原始CDP截图；画面间隔取自原始时间戳。没有合成分阶段截图或为制造效果添加延迟。</p></section><section><h2>加载和一致性</h2><p>框架与搜索先显示；initial-page提交校验后的明细和版本；overview复用同一完整授权集合计算，再补毛利分布和依赖筛选。页码/排序只读page，保留统计；同范围刷新保留上次成功内容，局部失败可重试。范围变化同步隐藏旧结果，generation+abort阻止迟到覆盖，scope+snapshot双绑定。超出缓存容量时内联full，避免第二次完整扫描。</p><p>缓存为每个reader进程最多4范围、总16MiB不可变JSON、TTL120秒；身份/角色/scope/数据库/authority/日期/平台/店铺/数据版本隔离，每次前后复验销售+ERP/products/库存版本，事务绕过。不缓存HTTP响应，不放宽任何原超时。</p></section><section><h2>验证</h2><p>作者和独立私有PG各28项；独立真实SQL22范围×3投影、浏览器10组、缓存5组及超大结果负例通过。全量unit初次3225通过/8失败/22跳过，7个缺隔离Python环境、1个更新后的源码断言；补齐环境后失败全集57项定向通过，原日志保留。相关17项通过；完整生产构建通过；lint0错误/14旧警告。</p><p>全项目TypeScript没有全绿；同口径完整抽取基线和候选均188项旧诊断，无新增诊断，本次业务文件没有诊断。生产未发布、未停服/重启/迁移/回填/补跑。</p><p><a href="summary.json">性能汇总JSON</a> · <a href="postgres-benchmark.json">逐次PG原始记录</a> · <a href="result.json">浏览器原始记录及Server-Timing</a></p></section><script>const frames={json.dumps(frames)};const slider=document.querySelector('#frame'),img=document.querySelector('#image'),stamp=document.querySelector('#stamp');function show(i){{slider.value=i;img.src=frames[i].file;stamp.textContent='点击后 '+frames[i].ms+' ms · '+(i+1)+' / '+frames.length}}slider.oninput=()=>show(+slider.value);document.querySelector('#play').onclick=()=>{{let i=0;show(0);function next(){{if(i+1>=frames.length)return;const delay=frames[i+1].ms-frames[i].ms;setTimeout(()=>{{i++;show(i);next()}},delay)}}next()}};show(0)</script></main></html>'''
(OUT/'report.html').write_text(doc,encoding='utf-8')
shutil.copy2(OUT/'report.html',ROOT/'.runtime/product-overview-lab/evidence/report.html')
for name in ['summary.json','postgres-benchmark.json']:
    shutil.copy2(OUT/name,ROOT/'.runtime/product-overview-lab/evidence'/name)
manifest={p.name:{'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in OUT.iterdir() if p.is_file() and p.name!='manifest.json'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(OUT)
