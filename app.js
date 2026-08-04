const APP_VERSION='15.1.0';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isNum=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const fmt=(v,d=2)=>isNum(v)?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:d}):'--';
const compact=v=>{if(!isNum(v))return'--';const n=Number(v);if(Math.abs(n)>=1e8)return`${(n/1e8).toFixed(2)}億`;if(Math.abs(n)>=1e4)return`${(n/1e4).toFixed(2)}萬`;return n.toLocaleString('zh-TW',{maximumFractionDigits:0})};
const state={dashboardFlowType:'volume',dashboardData:{},market:'US',symbol:'AAPL',row:{market:'US',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',tradingView:'NASDAQ:AAPL'},quote:null,fund:null,news:[],profile:null,trends:null,trendMetric:'revenue',token:'',user:{id:'local',name:'本機使用者'},watchlist:[],portfolio:[],ws:null,searchId:0,loadGeneration:0,chartMode:'native',chartRange:'1M',history:[],rankingType:'gainers',newsFilter:'all',newsSort:'time',newsQuery:'',newsAutoTimer:null,newsLastUpdated:null,newsSummary:null,aiJudgement:null,snapshot:null,isRefreshingAll:false,isPortfolioRefreshing:false,isDashboardLoading:false,isNewsRefreshing:false,portfolioTimer:null,stockAbort:null,analysisAbort:null,chartAbort:null,connection:{lastEventAt:0,reconnects:0}};
try{state.user=JSON.parse(localStorage.user||'null')}catch{}
let toastTimer,searchTimer;
function toast(x){clearTimeout(toastTimer);$('#toast').textContent=x;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function setBackendStatus(mode,text){const el=$('#backendStatus');if(!el)return;el.className=`backend-status ${mode}`;el.textContent=text}
const requestPool=new Map();
async function api(url,opt={}){
 const timeoutMs=Math.max(1500,Number(opt.timeout||18000)),retries=Math.max(0,Number(opt.retries??1)),method=String(opt.method||'GET').toUpperCase();
 const target=location.protocol==='file:'?`http://127.0.0.1:3000${url}`:url;
 const dedupeKey=opt.dedupe===false||method!=='GET'?null:`${method}:${target}`;
 if(dedupeKey&&requestPool.has(dedupeKey))return requestPool.get(dedupeKey);
 const run=async()=>{let lastError;for(let attempt=0;attempt<=retries;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),externalSignal=opt.signal;
  const forwardAbort=()=>controller.abort(externalSignal?.reason);
  if(externalSignal){if(externalSignal.aborted)forwardAbort();else externalSignal.addEventListener('abort',forwardAbort,{once:true})}
  try{
   const {signal:_ignoredSignal,timeout:_timeout,retries:_retries,dedupe:_dedupe,suppressReconnect:_suppressReconnect,...fetchOpt}=opt;
   const r=await fetch(target,{...fetchOpt,method,signal:controller.signal,cache:'no-store',headers:{Accept:'application/json',...(opt.body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:`Bearer ${state.token}`}:{})}});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||`API ${r.status}`);setBackendStatus('ok','後端已連線');return d;
  }catch(e){lastError=e;if(attempt<retries)await new Promise(resolve=>setTimeout(resolve,Math.min(2500,450*2**attempt)))}finally{clearTimeout(timer);externalSignal?.removeEventListener?.('abort',forwardAbort)}
 }
 if(externalSignal?.aborted){const cancelled=new Error('操作已取消');cancelled.name='AbortError';throw cancelled}
 setBackendStatus('error','離線，背景重連中');if(!opt.suppressReconnect&&typeof scheduleBackendRetry==='function')scheduleBackendRetry();if(lastError?.name==='AbortError')throw Error('後端回應逾時');throw Error(lastError?.message||'後端暫時未連線');};
 const promise=run().finally(()=>{if(dedupeKey)requestPool.delete(dedupeKey)});if(dedupeKey)requestPool.set(dedupeKey,promise);return promise;
}
async function checkBackend(){try{await api('/api/health',{timeout:5000,retries:0,suppressReconnect:true});return true}catch{return false}}
function logout(){state.token='';state.user={id:'local',name:'本機使用者'};localStorage.removeItem('token');localStorage.removeItem('user')}
function tvSymbol(){return state.row.tradingView||`${state.market==='TW'?'TWSE':state.market==='CN'?(state.symbol.startsWith('6')?'SSE':'SZSE'):'NASDAQ'}:${state.symbol}`}
let tvInterval='D';

function resizeCanvas(canvas){
 const dpr=Math.max(1,window.devicePixelRatio||1);
 const rect=canvas.getBoundingClientRect();
 canvas.width=Math.max(300,Math.floor(rect.width*dpr));
 canvas.height=Math.max(260,Math.floor(rect.height*dpr));
 const ctx=canvas.getContext('2d');
 ctx.setTransform(dpr,0,0,dpr,0,0);
 return {ctx,w:rect.width,h:rect.height};
}
function drawNativeChart(rows){
 const canvas=$('#nativeChart'),status=$('#chartStatus');
 if(!canvas)return;
 const valid=(rows||[]).filter(x=>isNum(x.close)&&isNum(x.high)&&isNum(x.low));
 if(!valid.length){status.textContent='目前資料源沒有可用 K 線資料';return}
 status.textContent='';
 const {ctx,w,h}=resizeCanvas(canvas);
 ctx.clearRect(0,0,w,h);
 const pad={l:58,r:18,t:20,b:34};
 const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;
 const lows=valid.map(x=>+x.low),highs=valid.map(x=>+x.high);
 let min=Math.min(...lows),max=Math.max(...highs);
 if(max===min){max+=1;min-=1}
 const extra=(max-min)*.06;max+=extra;min-=extra;
 const y=v=>pad.t+(max-v)/(max-min)*plotH;
 const step=plotW/valid.length;
 const candle=Math.max(2,Math.min(10,step*.65));
 ctx.strokeStyle='rgba(130,160,180,.18)';ctx.lineWidth=1;
 ctx.font='11px Segoe UI';ctx.fillStyle='#8098a8';
 for(let i=0;i<=4;i++){
   const py=pad.t+plotH*i/4;
   ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();
   const val=max-(max-min)*i/4;
   ctx.fillText(val.toFixed(val>=100?1:2),6,py+4);
 }
 const showEvery=Math.max(1,Math.floor(valid.length/5));
 valid.forEach((x,i)=>{
   const cx=pad.l+step*i+step/2;
   const open=+x.open,close=+x.close,high=+x.high,low=+x.low;
   const up=close>=open;
   ctx.strokeStyle=up?'#ff5b6e':'#16d6a0';
   ctx.fillStyle=up?'#ff5b6e':'#16d6a0';
   ctx.beginPath();ctx.moveTo(cx,y(high));ctx.lineTo(cx,y(low));ctx.stroke();
   const top=Math.min(y(open),y(close)),bottom=Math.max(y(open),y(close));
   ctx.fillRect(cx-candle/2,top,candle,Math.max(1,bottom-top));
   if(i%showEvery===0){
     ctx.fillStyle='#8098a8';
     const label=String(x.time||'').slice(0,10);
     ctx.fillText(label,cx-26,h-10);
   }
 });
 const last=valid.at(-1);
 ctx.setLineDash([5,4]);ctx.strokeStyle='rgba(72,168,255,.8)';
 ctx.beginPath();ctx.moveTo(pad.l,y(+last.close));ctx.lineTo(w-pad.r,y(+last.close));ctx.stroke();
 ctx.setLineDash([]);
 ctx.fillStyle='#48a8ff';ctx.fillText(`收 ${(+last.close).toFixed(2)}`,w-92,y(+last.close)-5);
}
async function loadNativeChart(){
 const wrap=$('#nativeChartWrap'),status=$('#chartStatus'),market=state.market,symbol=state.symbol,range=state.chartRange,generation=state.loadGeneration;
 state.chartAbort?.abort();const controller=new AbortController();state.chartAbort=controller;
 wrap.classList.remove('hidden');$('#tvChart').classList.add('hidden');
 status.textContent='載入 K 線中…';
 try{
   const d=await api(`/api/history?market=${market}&symbol=${encodeURIComponent(symbol)}&range=${range}&t=${Date.now()}`,{timeout:18000,retries:0,signal:controller.signal});
   if(controller.signal.aborted||generation!==state.loadGeneration||market!==state.market||symbol!==state.symbol||range!==state.chartRange)return;
   state.history=d.rows||[];drawNativeChart(state.history);
   $('#chartNote').textContent=`內建 K 線 · ${d.source||'資料來源未知'}${d.warning?` · ${d.warning}`:''}`;
 }catch(e){if(!controller.signal.aborted&&generation===state.loadGeneration)status.textContent=e.message}
 finally{if(state.chartAbort===controller)state.chartAbort=null}
}
function setChartMode(mode){
 state.chartMode=mode;
 if(mode==='tradingview'){
   $('#nativeChartWrap').classList.add('hidden');$('#tvChart').classList.remove('hidden');
   $('#chartNote').textContent='圖表由 TradingView 提供；行情等級依 TradingView 與交易所授權而定。';
   renderTradingView();
 }else{
   $('#tvChart').classList.add('hidden');$('#nativeChartWrap').classList.remove('hidden');
   loadNativeChart();
 }
}
function applyAutomaticChartMode(){setChartMode('native')}

function renderTradingView(){const box=$('#tvChart');box.innerHTML='';const wrap=document.createElement('div');wrap.className='tradingview-widget-container';wrap.style.height='100%';const inner=document.createElement('div');inner.className='tradingview-widget-container__widget';inner.style.height='100%';wrap.appendChild(inner);const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;script.text=JSON.stringify({autosize:true,symbol:tvSymbol(),interval:tvInterval,timezone:'Asia/Taipei',theme:'dark',style:'1',locale:'zh_TW',allow_symbol_change:true,save_image:false,calendar:false,details:true,hotlist:false,hide_side_toolbar:false,hide_top_toolbar:false,hide_legend:false,hide_volume:false,withdateranges:true,support_host:'https://www.tradingview.com'});wrap.appendChild(script);box.appendChild(wrap)}

function updateLiveCandle(q){
 if(state.chartMode!=='native'||!Array.isArray(state.history)||!state.history.length)return;
 const price=Number(q.price);if(!Number.isFinite(price)||price<=0)return;
 const now=q.updatedAt||new Date().toISOString();
 const intraday=state.chartRange==='1D'||state.chartRange==='5D';
 const bucket=intraday?new Date(new Date(now).setSeconds(0,0)).toISOString():String(now).slice(0,10);
 let last=state.history.at(-1);
 const lastKey=intraday?String(last?.time||'').slice(0,16):String(last?.time||'').slice(0,10);
 const bucketKey=intraday?bucket.slice(0,16):bucket;
 if(!last||lastKey!==bucketKey){
  const previous=Number(last?.close);last={time:bucket,open:Number.isFinite(previous)?previous:price,high:price,low:price,close:price,volume:Number(q.volume)||0};state.history.push(last);
  if(state.history.length>600)state.history.shift();
 }else{
  last.close=price;last.high=Math.max(Number(last.high)||price,price);last.low=Math.min(Number(last.low)||price,price);last.volume=Math.max(Number(last.volume)||0,Number(q.volume)||0);last.time=now;
 }
 drawNativeChart(state.history);
 const note=$('#chartNote');if(note&&!String(note.textContent).includes('即時更新'))note.textContent=`${note.textContent} · SSE 即時更新`;
}
function renderQuote(q){state.quote=q;updateLiveCandle(q);$('#stockName').textContent=q.name||state.row.name||q.symbol;$('#stockSymbol').textContent=q.symbol;$('#exchange').textContent=q.exchange||state.row.exchange||q.market;$('#price').textContent=`${q.currency||''} ${fmt(q.price)}`;const change=Number(q.change),pct=Number(q.changePercent),hasChange=Number.isFinite(change),up=!hasChange||change>=0;$('#change').className=up?'up':'down';$('#change').textContent=hasChange?`${up?'+':''}${fmt(change)} (${up?'+':''}${fmt(pct)}%)`:'漲跌待更新';const freshness=q.freshness|| (q.isRealtime?'即時':'可能延遲');$('#source').textContent=q.isDemo?`⚠ ${q.warning||'展示資料'}`:`${q.source} · ${freshness}${q.warning?` · ${q.warning}`:''}`;$('#source').classList.toggle('warn',Boolean(q.isDemo||q.isUnofficial||q.warning||q.freshness==='舊資料'));const updated=q.updatedAt?new Date(q.updatedAt):null;$('#lastUpdated').textContent=updated&&!Number.isNaN(updated.getTime())?`更新：${updated.toLocaleString('zh-TW')} · 品質 ${q.qualityScore??'--'}`:'更新時間未知';$('#refreshQuote').classList.toggle('live',Boolean(q.isRealtime&&q.freshness!=='舊資料'));const live=$('#liveEngineStatus');if(live)live.textContent=`行情引擎：${q.source||'備援'} · ${freshness}`;}

function safeHttpUrl(value){try{const u=new URL(value);return['http:','https:'].includes(u.protocol)?u.href:''}catch{return''}}
function listCards(id,rows=[],options={}){const box=$(id);if(!box)return;const safeRows=Array.isArray(rows)?rows.filter(Boolean):[];box.innerHTML=safeRows.length?safeRows.map((x,i)=>{const label=typeof x==='object'?(x.label||x.name||x.title||x.form||JSON.stringify(x)):x;const attrs=options.clickable?` data-peer="${esc(label)}" role="button" tabindex="0"`:'';return`<div class="company-list-item${options.clickable?' interactive':''}"${attrs}><span>${i+1}</span><b>${esc(label)}</b>${options.clickable?'<em>查看</em>':''}</div>`}).join(''):'<p class="company-empty">目前沒有足夠資料。</p>'}
function profileInitial(name='',fallback='企'){const clean=String(name).trim();if(!clean)return fallback;if(/[\u3400-\u9fff]/.test(clean))return clean.slice(0,1);return clean.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||fallback}
function sourceTierClass(tier=''){return tier.includes('官方')?'official':tier.includes('市場')?'market':'public'}
function renderCompanyEvents(p=state.profile||{}){const box=$('#companyEvents');if(!box)return;const filings=(p.filings||[]).map(x=>({title:`${x.form||'公告'}${x.description?` · ${x.description}`:''}`,date:x.date||'',source:'官方申報',url:x.accession&&p.symbol?`https://www.sec.gov/Archives/edgar/data/${String(p.cik||x.cik||'').replace(/^0+/,'')}/${String(x.accession).replaceAll('-','')}/${x.document||''}`:''}));const news=(state.news||[]).slice(0,8).map(x=>({title:x.headline,date:x.datetime,source:x.source,url:x.url,official:x.official}));const rows=[...filings,...news].filter(x=>x.title).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,10);box.innerHTML=rows.length?rows.map(x=>{const url=safeHttpUrl(x.url||'');return`<${url?'a':'div'} class="company-event"${url?` href="${esc(url)}" target="_blank" rel="noopener"`:''}><span class="event-dot ${x.official?'official':''}"></span><div><b>${esc(x.title)}</b><small>${esc(x.source||'公開資料')}${x.date?` · ${new Date(x.date).toLocaleDateString('zh-TW')}`:''}</small></div></${url?'a':'div'}>`}).join(''):'<p class="company-empty">目前沒有可用的近期事件。</p>'}
function renderCompanySources(p){const box=$('#companySources'),warnings=$('#companySourceWarnings');if(!box||!warnings)return;const rows=Array.isArray(p.sources)?p.sources:[];box.innerHTML=rows.length?rows.map(x=>{const url=safeHttpUrl(x.url||'');return`<${url?'a':'div'} class="company-source-item"${url?` href="${esc(url)}" target="_blank" rel="noopener"`:''}><span class="source-tier ${sourceTierClass(x.tier||'')}">${esc(x.tier||'公開')}</span><div><b>${esc(x.name||'資料來源')}</b><small>${x.checkedAt?`檢查：${new Date(x.checkedAt).toLocaleString('zh-TW')}`:'已納入資料整合'}</small></div></${url?'a':'div'}>`}).join(''):'<p class="company-empty">目前僅使用本地股票目錄。</p>';const rejected=(p.rejectedSources||[]).slice(0,8);warnings.innerHTML=rejected.length?`<details><summary>部分來源暫時無法使用（${rejected.length}）</summary>${rejected.map(x=>`<p>${esc(x)}</p>`).join('')}</details>`:''}
function renderCompanyProfile(p){
 state.profile=p;const selectedName=state.row?.name||p.displayName||p.requestedName||p.name||state.symbol;
 $('#companyDisplayName').textContent=selectedName;$('#companySymbolText').textContent=p.symbol||state.symbol;$('#companyExchange').textContent=p.exchange||state.row?.exchange||state.market;$('#companyMarketBadge').textContent=state.market==='TW'?'台股':state.market==='CN'?'A 股':'美股';
 const sourceEl=$('#companyProfileSource');const sourceCount=Array.isArray(p.sources)?p.sources.length:0;sourceEl.textContent=`${sourceCount?`${sourceCount} 個來源`:(p.source||'資料來源未知')}${p.verified?' · 已核對':''}`;const sourceUrl=safeHttpUrl(p.sourceUrl||p.website||'');sourceEl.classList.toggle('disabled',!sourceUrl);if(sourceUrl)sourceEl.href=sourceUrl;else sourceEl.removeAttribute('href');
 $('#companyIndustry').textContent=`產業：${p.industry||p.sector||'未分類'}`;$('#companyCountry').textContent=`地區：${p.country||'未提供'}`;const completeness=Math.max(0,Math.min(100,Number(p.completeness)||0));$('#companyCompleteness').textContent=`完整度：${completeness}% · 信心 ${Math.round(Number(p.profileConfidence)||0)}%`;$('#companyCompletenessBar').style.width=`${completeness}%`;
 const intro=p.description||`${selectedName} 目前沒有可用的公司介紹。`;$('#companyDescription').textContent=p.verified!==false?intro:`${selectedName}：外部介紹未通過名稱與股票代號核對，已改用安全資料。`;
 const logo=safeHttpUrl(p.logo||''),logoEl=$('#companyLogo'),fallbackEl=$('#companyLogoFallback');logoEl.classList.toggle('hidden',!logo||p.verified===false);fallbackEl.classList.toggle('hidden',Boolean(logo&&p.verified!==false));fallbackEl.textContent=profileInitial(selectedName,p.icon||'企');if(logo&&p.verified!==false){logoEl.src=logo;logoEl.alt=selectedName}
 $('#companyFounded').textContent=p.founded||'未提供';$('#companyHeadquarters').textContent=p.headquarters||p.country||'未提供';$('#companyCeo').textContent=p.chairman||p.ceo||'未提供';$('#companyEmployees').textContent=p.employees?`約 ${Number(p.employees).toLocaleString('zh-TW')} 人`:'未提供';
 const site=safeHttpUrl(p.website||'');$('#companyWebsite').classList.toggle('hidden',!site);if(site)$('#companyWebsite').href=site;
 listCards('#companyProducts',p.products);listCards('#companyCustomers',p.customers?.length?p.customers:[`${p.industry||'所屬產業'}終端客戶與應用市場`]);listCards('#companyCompetitors',p.competitors,{clickable:true});listCards('#companySupplyChain',p.supplyChain);listCards('#companyGlobalFootprint',p.globalFootprint?.length?p.globalFootprint:[p.country||'主要營運地區待確認']);listCards('#companyPeerNotes',p.competitors?.slice(0,5));renderCompanyEvents(p);renderCompanySources(p);$('#companyDataNature').textContent=`資料性質：${p.dataNature||'公開資料整合'}；資料完整度 ${completeness}%${sourceCount?`，共整合 ${sourceCount} 個來源`:''}。`;
}
function renderCompanyAi(x={}){const summary=$('#companyOneMinute');if(summary)summary.innerHTML=(x.oneMinuteSummary||[]).map(v=>`<p>✓ ${esc(v)}</p>`).join('')||'<p>目前資料不足。</p>';const bm=$('#companyBusinessModel');if(bm)bm.textContent=x.businessModel||'目前資料不足。';const long=$('#companyLongTerm');if(long){const v=x.longTermView||{};long.innerHTML=`<span>${esc(v.label||'待評估')}</span><b>${isNum(v.score)?Math.round(+v.score):'--'} 分</b><p>${esc(v.reason||'資料不足')}</p>`}const moat=$('#companyMoat');if(moat){const labels={brand:'品牌／客戶黏著',technology:'技術能力',scale:'規模優勢',profitability:'獲利品質'};moat.innerHTML=Object.entries(labels).map(([k,label])=>{const value=Math.max(0,Math.min(100,Number(x.moat?.[k])||0));return`<div><span>${label}</span><b>${Math.round(value)}</b><i><em style="width:${value}%"></em></i></div>`}).join('')}const radar=$('#companyRiskRadar');if(radar)radar.innerHTML=(x.riskRadar||[]).map(v=>`<div><span>${esc(v.name||'風險')}</span><b class="risk-level ${v.level==='高'?'high':v.level==='低'?'low':'mid'}">${esc(v.level||'資料不足')}</b><small>${esc(v.reason||'')}</small></div>`).join('')||'<p>目前資料不足。</p>';const strengths=$('#companyStrengths'),risks=$('#companyRisks');if(strengths)strengths.innerHTML=(x.catalysts||[]).map(v=>`<p>✓ ${esc(v)}</p>`).join('')||'<p>資料不足</p>';if(risks)risks.innerHTML=(x.risks||[]).map(v=>`<p>⚠ ${esc(v)}</p>`).join('')||'<p>資料不足</p>';listCards('#companyPeerNotes',x.peerNotes||state.profile?.competitors||[])}

function scoreLabel(v){return v==null?'--':`${Math.round(v)}`}
function metricValue(value,{suffix='',prefix='',digits=2,compactValue=false}={}){if(!isNum(value))return'資料暫缺';return `${prefix}${compactValue?compact(value):fmt(value,digits)}${suffix}`}
function metricCard(label,value,options={},source=''){const shown=metricValue(value,options),missing=shown==='資料暫缺';return `<div class="metric-item ${missing?'missing':''}"><small>${esc(label)}</small><b>${esc(shown)}</b><span>${esc(source||'來源未提供')}</span></div>`}
function renderFund(f){
 state.fund=f;const score=isNum(f.total)?+f.total:(isNum(f.score)?+f.score:null),coverage=Number(f.coverage)||0;
 $('#score').textContent=score==null?'--':Math.round(score);$('#rating').textContent=f.rating||'資料不足';$('#coverage').textContent=`覆蓋率 ${coverage}%`;$('#fundDonut').style.setProperty('--score',score||0);
 $('#fundSource').textContent=`來源：${f.source||'資料暫缺'}`;$('#fundUpdatedAt').textContent=f.updatedAt?new Date(f.updatedAt).toLocaleString('zh-TW'):'更新時間未知';
 const labels=[['獲利能力','profitability'],['成長性','growth'],['財務健康','health'],['估值','valuation'],['現金流','cashflow'],['股利','dividend']];
 $('#subScores').innerHTML=labels.map(([label,key])=>`<div><span>${label}</span><b>${scoreLabel(f.subScores?.[key])}</b><i><em style="width:${f.subScores?.[key]||0}%"></em></i></div>`).join('');
 const summary=[...(f.strengths||[]),...(f.risks||[]).map(x=>`注意：${x}`)];$('#scoreText').textContent=summary.join('；')||'目前資料不足，缺值不會被當成 0 分。';
 const fs=f.fieldSources||{};
 $('#metrics').innerHTML=[
  metricCard('EPS',f.eps,{},fs.eps),metricCard('本益比',f.pe,{suffix:'x'},fs.pe),metricCard('股價淨值比',f.pb,{suffix:'x'},fs.pb),metricCard('ROE',f.roe,{suffix:'%'},fs.roe),metricCard('ROA',f.roa,{suffix:'%'},fs.roa),
  metricCard('毛利率',f.margin,{suffix:'%'},fs.margin),metricCard('營益率',f.operatingMargin,{suffix:'%'},fs.operatingMargin),metricCard('淨利率',f.netMargin,{suffix:'%'},fs.netMargin),metricCard('負債比',f.debt,{suffix:'%'},fs.debt),
  metricCard('流動比',f.currentRatio,{suffix:'x'},fs.currentRatio),metricCard('速動比',f.quickRatio,{suffix:'x'},fs.quickRatio),metricCard('營收成長',f.growth,{suffix:'%'},fs.growth),metricCard('EPS 成長',f.epsGrowth,{suffix:'%'},fs.epsGrowth),
  metricCard('自由現金流',f.freeCashFlow,{compactValue:true},fs.freeCashFlow),metricCard('營業現金流',f.operatingCashFlow,{compactValue:true},fs.operatingCashFlow),metricCard('股息殖利率',f.dividendYield,{suffix:'%'},fs.dividendYield),metricCard('市值',f.marketCap,{compactValue:true},fs.marketCap)
 ].join('');
}
function renderAiEvidence(x={}){const box=$('#aiEvidence');if(!box)return;const evidence=Array.isArray(x.evidence)?x.evidence:[],missing=Array.isArray(x.missingData)?x.missingData:[],up=Array.isArray(x.upgradeConditions)?x.upgradeConditions:[],down=Array.isArray(x.downgradeConditions)?x.downgradeConditions:[];box.innerHTML=`<div class="evidence-grid">${evidence.map(v=>`<div class="evidence-item"><small>${esc(v.label||'依據')}</small><b>${esc(v.value||'資料不足')}</b><span>${esc(v.source||'來源未知')}${v.date?` · ${new Date(v.date).toLocaleDateString('zh-TW')}`:''}</span></div>`).join('')||'<p>目前證據資料不足。</p>'}</div><div class="evidence-conditions"><div><h5>評級上調條件</h5>${up.map(v=>`<p>＋ ${esc(v)}</p>`).join('')||'<p>等待更多資料。</p>'}</div><div><h5>評級下調條件</h5>${down.map(v=>`<p>－ ${esc(v)}</p>`).join('')||'<p>等待更多資料。</p>'}</div></div>${missing.length?`<p class="missing-data">缺失資料：${missing.map(esc).join('、')}</p>`:''}<small class="evidence-meta">${esc(x.methodology||'多來源交叉分析')} · 分析時間 ${new Date(x.asOf||Date.now()).toLocaleString('zh-TW')}</small>`}
function renderAiJudgement(x){state.aiJudgement=x;const box=$('#aiJudgement');const confidence=isNum(x?.confidence)?Math.round(+x.confidence):'--',signal=x?.signal||'持有',score=isNum(x?.signalScore)?Math.round(+x.signalScore):'--';const badge=$('#aiSignalBadge');badge.textContent=signal;badge.className=`ai-signal ${signal==='買入'?'buy':signal==='賣出'?'sell':'hold'}`;$('#aiSignalScore').textContent=`${score} 分`;box.innerHTML=`<div class="ai-stance"><strong>${esc(x?.stance||'資料不足')}</strong><span>信心度 ${confidence}%</span></div><p>${esc(x?.summary||'目前無法產生判斷。')}</p><div class="ai-columns"><div><h4>優勢／催化劑</h4>${(x?.catalysts||[]).map(v=>`<p class="ai-positive">✓ ${esc(v)}</p>`).join('')||'<p>資料不足</p>'}</div><div><h4>主要風險</h4>${(x?.risks||[]).map(v=>`<p class="ai-risk">⚠ ${esc(v)}</p>`).join('')||'<p>資料不足</p>'}</div></div><div class="ai-details"><p><b>估值：</b>${esc(x?.valuation||'資料不足')}</p><p><b>成長：</b>${esc(x?.growth||'資料不足')}</p><p><b>財務：</b>${esc(x?.financialHealth||'資料不足')}</p></div><div class="ai-action-plan"><h4>研究行動清單</h4>${(x?.actionPlan||[]).map(v=>`<p>• ${esc(v)}</p>`).join('')}</div><small>${esc(x?.dataQuality||'')} · ${esc(x?.source||'規則引擎')}</small>`;renderAiEvidence(x);renderCompanyAi(x);evaluateSmartAlerts()}


async function loadAiJudgement({silent=false,generation=state.loadGeneration,signal}={}){if(generation!==state.loadGeneration||signal?.aborted)return;const b=$('#refreshAiJudgement');if(!silent&&b){b.disabled=true;b.textContent='判斷中…'}try{const result=await api('/api/ai/analyze',{method:'POST',body:JSON.stringify({fundamentals:state.fund||{},quote:state.quote||{},news:state.news||[],profile:state.profile||{},trends:state.trends||{}}),timeout:22000,retries:0,dedupe:false,signal});if(generation!==state.loadGeneration)return;const previous=rememberAiSignal(result.signal);renderAiJudgement(result);if(readAlertSettings().aiChange&&previous?.signal&&previous.signal!==result.signal)recordAlert({level:'warning',title:`AI 評級由 ${previous.signal} 改為 ${result.signal}`,detail:`${state.row.name||state.symbol} 最新分數 ${result.signalScore??'--'} 分，請檢查證據與財務趨勢。`,key:`ai:${state.market}:${state.symbol}:${result.signal}:${new Date().toISOString().slice(0,10)}`},{notify:true});if(!silent)toast('AI 判斷已更新')}catch(e){if(generation===state.loadGeneration)renderAiJudgement({stance:'本機備援判斷',summary:e.message,confidence:0,catalysts:[],risks:['外部 AI 暫時不可用，保留最近結果或規則備援'],source:'錯誤備援',evidence:[],missingData:[],upgradeConditions:[],downgradeConditions:[]})}finally{if(!silent&&b){b.disabled=false;b.textContent='↻ 重新判斷'}}}

function highlightNewsKeywords(text=''){const safe=esc(text);const words=['AI','營收','EPS','股利','法說會','董事會','財報','獲利','虧損','增持','減持','回購','訂單','中標','擴產','政策','監管','半導體','新能源'];const pattern=new RegExp(`(${words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');return safe.replace(pattern,'<mark>$1</mark>')}
function filteredNews(){let rows=[...(state.news||[])];if(state.newsFilter==='official')rows=rows.filter(x=>x.official);if(state.newsFilter==='media')rows=rows.filter(x=>!x.official);const q=state.newsQuery.trim().toLowerCase();if(q)rows=rows.filter(x=>`${x.headline||''} ${x.summary||''} ${x.source||''}`.toLowerCase().includes(q));if(state.newsSort==='source')rows.sort((a,b)=>String(a.source||'').localeCompare(String(b.source||''),'zh-TW'));else rows.sort((a,b)=>new Date(b.datetime||0)-new Date(a.datetime||0));return rows}
function updateNewsMeta(count){const stamp=state.newsLastUpdated?new Date(state.newsLastUpdated).toLocaleString('zh-TW'):'尚未更新';$('#newsMeta').textContent=`${count} 則 · 最後更新：${stamp}`}
async function refreshNewsSummary(){try{state.newsSummary=await api('/api/news/summary',{method:'POST',body:JSON.stringify({news:state.news}),timeout:6000,retries:0,dedupe:false})}catch{state.newsSummary={sentiment:'中性',summary:state.news?.length?`共取得 ${state.news.length} 則新聞。`:'目前沒有可用新聞資料。',sources:[]}}}
function renderNews(){const sum=state.newsSummary||{sentiment:'中性',summary:state.news?.length?`共取得 ${state.news.length} 則新聞。`:'目前沒有可用新聞資料。',sources:[]};$('#newsSummary').innerHTML=`<b>情緒：${esc(sum.sentiment||'中性')}</b><p>${esc(sum.summary||'')}</p>${sum.sources?.length?`<small>來源：${sum.sources.map(esc).join('、')}</small>`:''}`;const rows=filteredNews();updateNewsMeta(rows.length);$('#newsList').innerHTML=rows.slice(0,30).map(n=>{const href=/^https?:/.test(n.url||'')?esc(n.url):'#';const time=n.datetime?new Date(n.datetime).toLocaleString('zh-TW'):'';return `<a class="news" href="${href}" target="_blank" rel="noopener"><div class="news-title-line"><b>${n.official?'<span class="official-badge">官方</span> ':''}${highlightNewsKeywords(n.headline||'')}</b><span class="news-source-tag">${esc(n.source||'未知來源')}</span></div>${n.summary?`<p>${highlightNewsKeywords(n.summary)}</p>`:''}<small>${time||'時間未提供'}</small></a>`}).join('')||'<p class="news-empty">目前沒有符合條件的新聞。</p>';renderCompanyEvents(state.profile||{});renderDashboardNews();evaluateSmartAlerts()}


const TREND_META={revenue:{label:'營收',suffix:'',compact:true},grossMargin:{label:'毛利率',suffix:'%',compact:false},eps:{label:'EPS',suffix:'',compact:false},freeCashFlow:{label:'自由現金流',suffix:'',compact:true},roe:{label:'ROE',suffix:'%',compact:false},debt:{label:'負債',suffix:'',compact:true},cash:{label:'現金',suffix:'',compact:true}};
function trendFormat(v,meta=TREND_META[state.trendMetric]){if(!isNum(v))return'--';return meta.compact?compact(v):`${fmt(v,2)}${meta.suffix||''}`}
function drawFinancialTrend(){const canvas=$('#financialTrendChart'),status=$('#trendStatus'),rows=state.trends?.quarterly||[],meta=TREND_META[state.trendMetric],valid=rows.filter(x=>isNum(x[state.trendMetric]));if(!canvas||!status)return;if(!valid.length){status.textContent='目前沒有此指標的歷史資料';const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);return}status.textContent='';const {ctx,w,h}=resizeCanvas(canvas),pad={l:58,r:20,t:24,b:42},plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b,vals=valid.map(x=>+x[state.trendMetric]);let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=1;max+=1}const extra=(max-min)*.12;min-=extra;max+=extra;const y=v=>pad.t+(max-v)/(max-min)*plotH,x=i=>pad.l+(valid.length===1?plotW/2:i*plotW/(valid.length-1));ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(130,160,180,.18)';ctx.fillStyle='#8098a8';ctx.font='11px Segoe UI';for(let i=0;i<=4;i++){const py=pad.t+plotH*i/4;ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.fillText(trendFormat(max-(max-min)*i/4,meta),5,py+4)}ctx.strokeStyle='#16d6a0';ctx.lineWidth=2;ctx.beginPath();valid.forEach((r,i)=>{const px=x(i),py=y(+r[state.trendMetric]);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();valid.forEach((r,i)=>{const px=x(i),py=y(+r[state.trendMetric]);ctx.fillStyle='#16d6a0';ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#8098a8';ctx.fillText(String(r.period||'').slice(-7),px-22,h-13)});const latest=valid.at(-1);ctx.fillStyle='#dcebf1';ctx.fillText(`${meta.label} ${trendFormat(latest[state.trendMetric],meta)}`,pad.l,pad.t-7)}
function renderFinancialTrends(data){state.trends=data;const rows=data?.quarterly||[],latest=rows.at(-1)||{},previous=rows.at(-2)||{},meta=TREND_META[state.trendMetric];$('#trendSource').textContent=`來源：${data.source||'資料暫缺'} · 覆蓋率 ${data.coverage??0}%`;$('#trendSource').classList.toggle('trend-derived',Boolean(data.derived));const values=[['最新季度',latest.period||'--'],[meta.label,trendFormat(latest[state.trendMetric],meta)],['前季變動',isNum(latest[state.trendMetric])&&isNum(previous[state.trendMetric])?`${+latest[state.trendMetric]>=+previous[state.trendMetric]?'+':''}${trendFormat(+latest[state.trendMetric]-+previous[state.trendMetric],meta)}`:'--'],['資料完整度',`${data.coverage??0}%`]];$('#trendKpis').innerHTML=values.map(([a,b])=>`<div><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('');$('#trendInsights').innerHTML=(data.insights||[]).map(v=>`<p>• ${esc(v)}</p>`).join('')||'<p>目前資料不足，等待更多季度資料。</p>';$('#trendFootnote').textContent=`${data.derived?'⚠ 此市場部分數據為已標示的趨勢估計；':'缺值不會以 0 取代；'} ${data.errors?.length?`備援紀錄：${data.errors.slice(0,2).join('；')}`:'資料已完成來源核對。'}`;drawFinancialTrend();evaluateSmartAlerts()}
async function loadFinancialTrends({force=false,generation=state.loadGeneration,signal}={}){if(generation!==state.loadGeneration||signal?.aborted)return;const b=$('#refreshFinancialTrends');if(b&&force){b.disabled=true;b.textContent='更新中…'}$('#trendStatus').textContent='載入財務趨勢中…';try{const d=await api(`/api/financial-trends?market=${state.market}&symbol=${encodeURIComponent(state.symbol)}${force?'&refresh=1':''}&t=${Date.now()}`,{timeout:24000,retries:0,signal});if(generation===state.loadGeneration)renderFinancialTrends(d)}catch(e){if(generation===state.loadGeneration){$('#trendStatus').textContent=e.message;$('#trendSource').textContent='財務趨勢暫時無法更新'}}finally{if(b&&force){b.disabled=false;b.textContent='↻ 更新趨勢'}}}

function snapshotCacheKey(m=state.market,s=state.symbol){return`alphalens_snapshot_v15_${m}_${s}`}
function saveSnapshot(snapshot){try{localStorage.setItem(snapshotCacheKey(snapshot.market,snapshot.symbol),JSON.stringify({...snapshot,cachedAt:Date.now()}))}catch{}}
function readSnapshot(m=state.market,s=state.symbol){try{return JSON.parse(localStorage.getItem(snapshotCacheKey(m,s))||'null')}catch{return null}}
function setSnapshotState(text,mode=''){
 const el=$('#snapshotState');if(!el)return;el.textContent=text;el.className=`snapshot-state ${mode}`.trim();
}
function renderDataQuality(){/* v12.8 UI removed intentionally */}
function applySnapshot(snapshot,{offline=false}={}){
 state.snapshot=snapshot;
 if(snapshot.quote){renderQuote({...state.row,...snapshot.quote});const h=state.portfolio?.find(x=>x.market===state.market&&x.symbol===state.symbol);if(h&&isNum(snapshot.quote.price)){h.lastPrice=+snapshot.quote.price;h.updatedAt=Date.now();localStorage.setItem(PORTFOLIO_KEY,JSON.stringify(state.portfolio));renderPortfolio()}}
 renderFund(snapshot.fundamentals||{total:null,rating:'資料不足',coverage:0,subScores:{},source:'資料暫缺'});
 state.profile=snapshot.profile||{};renderCompanyProfile(state.profile);
 state.news=Array.isArray(snapshot.news)?snapshot.news:[];state.newsLastUpdated=Date.now();state.newsSummary=null;renderNews();refreshNewsSummary().then(renderNews);
 renderDataQuality(snapshot.quality||{},snapshot.latencyMs,{offline});
 $('#globalUpdatedAt').textContent=`更新：${new Date(snapshot.quality?.updatedAt||snapshot.cachedAt||Date.now()).toLocaleString('zh-TW')}`;
 setSnapshotState(offline?'顯示離線快取':snapshot.quality?.partial?'部分資料已載入':'資料已同步',offline?'offline':snapshot.quality?.partial?'warning':'ok');
 if(typeof updateWatchBtn==='function')updateWatchBtn();
}
async function loadSystemStatus(){return null}


async function loadStock({force=false}={}){
 const m=state.market,s=state.symbol,generation=++state.loadGeneration;
 state.stockAbort?.abort();state.analysisAbort?.abort();
 const controller=new AbortController(),analysisController=new AbortController();state.stockAbort=controller;state.analysisAbort=analysisController;
 setSnapshotState('顯示快取並同步最新資料…','loading');
 const cached=readSnapshot(m,s);if(cached){applySnapshot(cached,{offline:true});setSnapshotState('已顯示最近快取，背景同步中…','loading')}
 applyAutomaticChartMode();connectWs();
 const current=()=>generation===state.loadGeneration&&m===state.market&&s===state.symbol&&!controller.signal.aborted;
 api(`/api/quote?market=${m}&symbol=${encodeURIComponent(s)}${force?'&refresh=1':''}&t=${Date.now()}`,{timeout:11000,retries:0,signal:controller.signal}).then(q=>{if(current())renderQuote({...state.row,...q})}).catch(()=>{});
 try{
  const snapshot=await api(`/api/snapshot?market=${m}&symbol=${encodeURIComponent(s)}${force?'&refresh=1':''}&t=${Date.now()}`,{timeout:24000,retries:0,signal:controller.signal});
  if(!current())return;saveSnapshot(snapshot);applySnapshot(snapshot);
  setTimeout(()=>loadFinancialTrends({force,generation,signal:analysisController.signal}),0);
  setTimeout(()=>loadAiJudgement({silent:true,generation,signal:analysisController.signal}),120);
 }catch(e){
  if(!current()||e?.name==='AbortError')return;
  if(cached){setSnapshotState('完整資料同步逾時，持續使用最近快取','warning');setTimeout(()=>loadFinancialTrends({generation,signal:analysisController.signal}),0);toast('完整資料同步較慢，行情與快取仍可使用')}
  else{setSnapshotState('核心資料載入失敗，後端將自動重試','error');renderFund({total:null,rating:'資料不足',coverage:0,subScores:{},source:'資料暫缺'});toast(e.message)}
 }finally{if(state.stockAbort===controller)state.stockAbort=null}
}
function normalizeSelection(row={}){
 const market=['TW','CN','US'].includes(row.market)?row.market:state.market;
 const symbol=String(row.symbol||'').trim().toUpperCase();
 if(!symbol)throw Error('股票代號無效');
 const exchange=String(row.exchange||'').trim()||(market==='TW'?'TWSE':market==='CN'?(symbol.startsWith('6')?'SSE':symbol.startsWith('4')||symbol.startsWith('8')?'BSE':'SZSE'):'NASDAQ');
 const name=String(row.name||symbol).trim();
 const tradingView=String(row.tradingView||'').trim()||`${exchange}:${symbol}`;
 return {...row,market,symbol,name,exchange,tradingView};
}
async function select(row){
 let next;
 try{next=normalizeSelection(row)}catch(e){toast(e.message);return}
 const marketChanged=next.market!==state.market;
 state.market=next.market;state.symbol=next.symbol;state.row=next;
 state.quote=null;state.fund=null;state.profile=null;state.news=[];state.history=[];state.snapshot=null;state.trends=null;state.aiJudgement=null;
 closeLiveStream();
 $$('.markets button').forEach(button=>button.classList.toggle('active',button.dataset.market===state.market));
 $('#results').classList.add('hidden');
 $('#searchInput').value='';
 $('#stockName').textContent=next.name;$('#stockSymbol').textContent=next.symbol;$('#exchange').textContent=next.exchange;
 setSnapshotState('切換股票中…','loading');
 try{
  await loadStock();
  if(marketChanged)await Promise.allSettled([loadRanking(false),loadDashboard(false)]);
 }catch(e){toast(e.message)}
}

async function search(q){const id=++state.searchId,rows=await api(`/api/search?q=${encodeURIComponent(q)}&market=${state.market}`);if(id!==state.searchId)return;$('#results').innerHTML=rows.map(x=>`<button data-row='${esc(JSON.stringify(x))}'><b>${esc(x.name)}</b><span>${esc(x.symbol)} · ${esc(x.exchange)} · ${esc(x.source||'')}</span></button>`).join('')||'<p>找不到股票；可嘗試切換市場或輸入完整代號。</p>';$('#results').classList.remove('hidden');$$('#results button').forEach(b=>b.onclick=()=>select(JSON.parse(b.dataset.row)))}
$('#searchInput').oninput=e=>{clearTimeout(searchTimer);const q=e.target.value.trim();if(!q){$('#results').classList.add('hidden');return}searchTimer=setTimeout(()=>search(q).catch(x=>toast(x.message)),180)};
async function submitSearch(){const input=$('#searchInput'),button=$('#searchBtn'),q=input.value.trim();if(!q){input.focus();toast('請輸入股票代號或公司名稱');return}button.disabled=true;button.textContent='搜尋中';try{const rows=await api(`/api/search?q=${encodeURIComponent(q)}&market=${state.market}`);if(rows[0])select(rows[0]);else{await search(q);toast('找不到完全符合的股票，請確認市場或代號')}}catch(e){toast(e.message)}finally{button.disabled=false;button.textContent='搜尋'}}
$('#searchBtn').onclick=submitSearch;
$('#searchInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitSearch()}};

const MARKET_LABELS={TW:'台股',CN:'A 股',US:'美股'};
const RANKING_TITLES={gainers:'漲幅排行榜前 15 名',losers:'跌幅排行榜前 15 名',volume:'成交量排行榜前 15 名',value:'成交值排行榜前 15 名',hot:'熱門排行榜前 15 名'};
function rankingCacheKey(){return`alphalens_ranking_${state.market}_${state.rankingType}`}
function saveRankingCache(data){try{localStorage.setItem(rankingCacheKey(),JSON.stringify({...data,cachedAt:Date.now()}))}catch{}}
function readRankingCache(){try{return JSON.parse(localStorage.getItem(rankingCacheKey())||'null')}catch{return null}}
function renderRanking(data,{offline=false}={}){
 $('#rankingMarketName').textContent=MARKET_LABELS[state.market]||state.market;
 $('#rankingTitle').textContent=RANKING_TITLES[state.rankingType]||RANKING_TITLES.gainers;
 const rows=data?.rows||[];
 $('#rankingList').innerHTML=rows.map((x,i)=>{
  const pct=Number(x.changePercent),chg=Number(x.change),up=Number.isFinite(pct)&&pct>0,down=Number.isFinite(pct)&&pct<0,cls=up?'up':down?'down':'flat';
  const amount=Number.isFinite(chg)?`${chg>0?'+':''}${fmt(chg)}`:'--';
  const percent=Number.isFinite(pct)?`${pct>0?'+':''}${fmt(pct)}%`:'--';
  const volumeText=`量 ${compact(x.volume)}`;
  const valueText=`值 ${compact(x.turnover)}`;
  const metric=state.rankingType==='value'?valueText:state.rankingType==='volume'?volumeText:`${volumeText} · ${valueText}`;
  return `<button class="ranking-row" data-m="${esc(x.market)}" data-s="${esc(x.symbol)}" data-name="${esc(x.name)}" data-exchange="${esc(x.exchange)}">
   <span class="rank-index">${i+1}</span>
   <span class="rank-company"><b>${esc(x.name)}</b><small>${esc(x.symbol)} · ${esc(x.exchange)} · ${esc(x.industry||'未分類')}</small></span>
   <span class="rank-price ${cls}">${x.currency?esc(x.currency)+' ':''}${fmt(x.price)}</span>
   <span class="rank-amount ${cls}">${amount}</span>
   <span class="rank-change ${cls}">${percent}</span>
   <span class="rank-volume">${metric}<small>${new Date(x.updatedAt||Date.now()).toLocaleTimeString('zh-TW')}</small></span>
  </button>`;
 }).join('')||'<p class="ranking-loading">目前沒有排行資料</p>';
 $$('.ranking-row').forEach(b=>b.onclick=()=>select({market:b.dataset.m,symbol:b.dataset.s,name:b.dataset.name,exchange:b.dataset.exchange}));
 const stamp=new Date(data?.updatedAt||data?.cachedAt||Date.now()).toLocaleString('zh-TW');
 $('#rankingSource').textContent=`${offline?'離線快取 · ':''}來源：${data?.source||'未知'} · 更新：${stamp}`;
}
async function loadRanking(force=false){
 const b=$('#refreshRanking');if(b){b.disabled=true;b.textContent='更新中…'}
 try{
  const data=await api(`/api/ranking?market=${state.market}&type=${state.rankingType}${force?'&refresh=1':''}&t=${Date.now()}`,{timeout:45000,retries:2});
  saveRankingCache(data);renderRanking(data)
 }catch(e){
  const cached=readRankingCache();
  if(cached){renderRanking(cached,{offline:true});toast('後端暫時無法連線，已顯示最近成功排行榜')}
  else{$('#rankingList').innerHTML='<p class="ranking-loading">排行榜暫時無法更新，後端恢復後會自動重試。</p>';$('#rankingSource').textContent=e.message}
 }finally{if(b){b.disabled=false;b.textContent='↻ 更新排行'}}
}
$$('#rankingTabs button').forEach(b=>b.onclick=()=>{
 state.rankingType=b.dataset.type;
 $$('#rankingTabs button').forEach(x=>x.classList.toggle('active',x===b));
 const cached=readRankingCache();if(cached)renderRanking(cached,{offline:true});
 loadRanking(false)
});
const MARKET_DEFAULTS={TW:{market:'TW',symbol:'2330',name:'台積電',exchange:'TWSE',industry:'半導體',tradingView:'TWSE:2330'},CN:{market:'CN',symbol:'600519',name:'貴州茅台',exchange:'SSE',industry:'白酒',tradingView:'SSE:600519'},US:{market:'US',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',industry:'消費電子',tradingView:'NASDAQ:AAPL'}};
$$('.markets button').forEach(b=>b.onclick=()=>select(MARKET_DEFAULTS[b.dataset.market]));

$$('#ranges button').forEach(b=>b.onclick=()=>{
 const label=b.textContent.trim(),map={'1D':'5','5D':'30','1M':'60','6M':'D','1Y':'D','5Y':'W'};
 state.chartRange=label;tvInterval=map[label]||'D';
 $$('#ranges button').forEach(x=>x.classList.toggle('active',x===b));
 if(state.market==='US')renderTradingView();else loadNativeChart();
 toast(`圖表區間：${label}`)
});
let resizeFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(state.chartMode==='native'&&state.history.length)drawNativeChart(state.history);if(state.trends)drawFinancialTrend()})});
document.addEventListener('click',e=>{if(!e.target.closest('.search'))$('#results').classList.add('hidden')});

let wsReconnectTimer=null,wsWatchdogTimer=null,wsGeneration=0;
function closeLiveStream(){clearTimeout(wsReconnectTimer);clearInterval(wsWatchdogTimer);wsReconnectTimer=null;wsWatchdogTimer=null;try{state.ws?.close?.()}catch{}state.ws=null}
function connectWs(){closeLiveStream();if(document.hidden)return;const generation=++wsGeneration,expected={market:state.market,symbol:state.symbol};let stream;try{stream=new EventSource(`/api/live?market=${encodeURIComponent(expected.market)}&symbol=${encodeURIComponent(expected.symbol)}`)}catch{return}state.ws=stream;state.connection.lastEventAt=Date.now();const live=$('#liveEngineStatus');if(live){live.textContent='即時串流：連線中';live.className='connection-health degraded'}const touch=()=>{state.connection.lastEventAt=Date.now()};stream.onopen=()=>{if(state.ws!==stream||generation!==wsGeneration)return;touch();state.connection.reconnects=0;if(live){live.textContent='即時串流：穩定連線';live.className='connection-health'}};stream.addEventListener('ready',touch);stream.addEventListener('ping',touch);stream.addEventListener('status',e=>{touch();if(live){live.textContent='即時串流：備援中';live.className='connection-health degraded'}});stream.addEventListener('quote',e=>{touch();try{const q=JSON.parse(e.data);if(q.market===state.market&&q.symbol===state.symbol){renderQuote({...state.row,...q});evaluateSmartAlerts()}}catch{}});stream.onerror=()=>{if(state.ws!==stream||generation!==wsGeneration)return;if(live){live.textContent='即時串流：自動重連中';live.className='connection-health degraded'};state.connection.reconnects++;/* EventSource itself reconnects using the server retry field. */};wsWatchdogTimer=setInterval(()=>{if(state.ws!==stream||generation!==wsGeneration)return;if(document.hidden)return;const stale=Date.now()-state.connection.lastEventAt>50000;if(stale){try{stream.close()}catch{}state.ws=null;if(live){live.textContent='即時串流：重新建立連線';live.className='connection-health offline'};clearInterval(wsWatchdogTimer);wsReconnectTimer=setTimeout(connectWs,Math.min(15000,2000*2**Math.min(3,state.connection.reconnects))) }},10000)}
document.addEventListener('visibilitychange',()=>{if(document.hidden){closeLiveStream()}else{connectWs();schedulePortfolioRefresh(3000)}});

$('#refreshFinancialTrends').onclick=()=>loadFinancialTrends({force:true});
$('#trendMetricTabs').addEventListener('click',e=>{const b=e.target.closest('[data-trend-metric]');if(!b)return;state.trendMetric=b.dataset.trendMetric;$$('#trendMetricTabs button').forEach(x=>x.classList.toggle('active',x===b));if(state.trends)renderFinancialTrends(state.trends)});
$('#refreshFundamentals').onclick=async()=>{const b=$('#refreshFundamentals'),m=state.market,s=state.symbol;b.disabled=true;b.textContent='更新中…';try{const f=await api(`/api/fundamentals?market=${m}&symbol=${encodeURIComponent(s)}&refresh=1&t=${Date.now()}`,{timeout:30000,retries:2});if(m===state.market&&s===state.symbol){renderFund(f);await loadAiJudgement({silent:true});toast('基本面已更新')}}catch(e){toast(e.message)}finally{b.disabled=false;b.textContent='↻ 更新基本面'}};
$('#refreshAiJudgement').onclick=()=>loadAiJudgement();
$('#translateCompanyProfile').onclick=async()=>{
 const b=$('#translateCompanyProfile'),status=$('#translateStatus'),text=$('#companyDescription').textContent.trim();
 if(!text){toast('目前沒有可翻譯的公司介紹');return}
 b.disabled=true;b.textContent='翻譯中…';status.textContent='正在連接翻譯服務';
 try{const d=await api('/api/translate',{method:'POST',body:JSON.stringify({text})});$('#companyDescription').textContent=d.translated||text;status.textContent=d.source||'翻譯完成';toast(`翻譯完成：${d.source||'翻譯服務'}`)}catch(e){status.textContent='翻譯失敗，已保留原文';toast(e.message)}finally{b.disabled=false;b.textContent='中文翻譯'}
};
$('#refreshCompanyProfile').onclick=async()=>{
 const b=$('#refreshCompanyProfile'),m=state.market,s=state.symbol;
 b.disabled=true;b.textContent='更新中…';
 try{
   const profile=await api(`/api/company?market=${m}&symbol=${encodeURIComponent(s)}&refresh=1&t=${Date.now()}`);
   if(m===state.market&&s===state.symbol){
     renderCompanyProfile(profile);
     toast(`公司介紹已更新：${profile.source||'資料來源未知'}`);
   }
 }catch(e){toast(e.message)}
 finally{b.disabled=false;b.textContent='↻ 更新資料'}
};
$('#refreshQuote').onclick=async()=>{
 const b=$('#refreshQuote'),m=state.market,s=state.symbol;
 b.disabled=true;b.textContent='更新中…';
 try{
   const q=await api(`/api/quote?market=${m}&symbol=${encodeURIComponent(s)}&refresh=1&t=${Date.now()}`);
   if(m===state.market&&s===state.symbol){renderQuote({...state.row,...q});toast(`價格已更新：${q.source||'資料來源未知'}`)}
 }catch(e){toast(e.message)}
 finally{b.disabled=false;b.textContent='↻ 立即更新'}
};
$('#refreshRanking').onclick=()=>loadRanking(true);
async function refreshNewsData({silent=false}={}){if(state.isNewsRefreshing)return;state.isNewsRefreshing=true;const b=$('#refreshNews');if(!silent&&b){b.disabled=true;b.textContent='更新中…'}try{state.news=await api(`/api/news?market=${state.market}&symbol=${encodeURIComponent(state.symbol)}&refresh=1&t=${Date.now()}`,{timeout:30000,retries:2});state.newsLastUpdated=Date.now();state.newsSummary=null;await refreshNewsSummary();renderNews();if(!silent)toast(state.news.length?'新聞已更新':'目前沒有更新新聞')}catch(e){if(!silent)toast(e.message);updateNewsMeta(filteredNews().length)}finally{state.isNewsRefreshing=false;if(!silent&&b){b.textContent='更新完成';setTimeout(()=>{b.disabled=false;b.textContent='↻ 更新'},1200)}}}
$('#refreshNews').onclick=()=>refreshNewsData();
window.addEventListener('error',e=>{console.error(e.error||e.message);toast(`前端錯誤：${e.message||'未知錯誤'}`)});
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);toast(e.reason?.message||'操作失敗')});
let backendRetryTimer=null,backendRetryAttempt=0,backendRetryRunning=false,wasOffline=false;
function scheduleBackendRetry(delay){if(backendRetryTimer)return;const wait=Number.isFinite(+delay)?+delay:Math.min(30000,3000*2**Math.min(4,backendRetryAttempt));backendRetryTimer=setTimeout(()=>{backendRetryTimer=null;retryBackend()},Math.max(1500,wait))}
async function retryBackend(){
 if(backendRetryRunning)return;backendRetryRunning=true;
 try{
  if(document.hidden){scheduleBackendRetry(15000);return}
  const ok=await checkBackend();
  if(ok){
   const recovered=wasOffline;wasOffline=false;backendRetryAttempt=0;clearTimeout(backendRetryTimer);backendRetryTimer=null;
   if(recovered){toast('後端已恢復連線');await loadStock();setTimeout(()=>loadRanking(false),200);setTimeout(()=>loadDashboard(false),400)}
   return;
  }
  wasOffline=true;backendRetryAttempt++;setBackendStatus('error',`後端重連中（第 ${backendRetryAttempt} 次）`);scheduleBackendRetry();
 }finally{backendRetryRunning=false}
}
window.addEventListener('online',()=>{backendRetryAttempt=0;clearTimeout(backendRetryTimer);backendRetryTimer=null;scheduleBackendRetry(1000)});
window.addEventListener('offline',()=>{wasOffline=true;setBackendStatus('error','網路離線，恢復後自動重連')});
$$('#companyTabs button').forEach(b=>b.onclick=()=>{$$('#companyTabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.company-tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===b.dataset.tab))});
$('#companyCompetitors').addEventListener('click',async e=>{const item=e.target.closest('[data-peer]');if(!item)return;const name=item.dataset.peer;$('#searchInput').value=name;try{const rows=await api(`/api/search?market=${state.market}&q=${encodeURIComponent(name)}`,{timeout:12000,retries:1});if(rows?.[0])await select(rows[0]);else toast(`找不到 ${name} 的股票代號`)}catch(err){toast(err.message)}});
$$('#newsFilters button').forEach(b=>b.onclick=()=>{state.newsFilter=b.dataset.filter;$$('#newsFilters button').forEach(x=>x.classList.toggle('active',x===b));renderNews()});
$('#newsSort').onchange=e=>{state.newsSort=e.target.value;renderNews()};
let newsSearchTimer;$('#newsSearch').oninput=e=>{clearTimeout(newsSearchTimer);newsSearchTimer=setTimeout(()=>{state.newsQuery=e.target.value;renderNews()},180)};
$('#newsAutoRefresh').onchange=e=>{if(state.newsAutoTimer){clearInterval(state.newsAutoTimer);state.newsAutoTimer=null}if(e.target.checked){state.newsAutoTimer=setInterval(()=>refreshNewsData({silent:true}),5*60*1000);toast('新聞自動更新已開啟，每 5 分鐘更新')}else toast('新聞自動更新已關閉')};


$('#refreshAll').onclick=async()=>{if(state.isRefreshingAll)return;state.isRefreshingAll=true;const b=$('#refreshAll');b.disabled=true;b.textContent='更新核心資料…';try{await loadStock({force:true});b.textContent='更新市場排行…';await loadRanking(true);setTimeout(()=>loadDashboard(false),0);toast('核心資料已更新；次要資料於背景同步')}finally{state.isRefreshingAll=false;b.disabled=false;b.textContent='↻ 更新全部'}};






const ALERT_KEY='alphalens_alert_settings_v151',ALERT_LOG_KEY='alphalens_alert_log_v151';
const AI_SIGNAL_KEY='alphalens_ai_signals_v151';
function readAiSignals(){try{return JSON.parse(localStorage.getItem(AI_SIGNAL_KEY)||'{}')}catch{return{}}}
function rememberAiSignal(signal){if(!signal)return null;const rows=readAiSignals(),key=`${state.market}:${state.symbol}`,previous=rows[key]||null;rows[key]={signal,time:Date.now(),name:state.row?.name||state.symbol};try{localStorage.setItem(AI_SIGNAL_KEY,JSON.stringify(rows))}catch{}return previous}
function readAlertSettings(){try{return{priceMove:true,dataStale:true,aiChange:true,events:true,...JSON.parse(localStorage.getItem(ALERT_KEY)||'{}')}}catch{return{priceMove:true,dataStale:true,aiChange:true,events:true}}}
function saveAlertSettings(){const v={priceMove:$('#alertPriceMove')?.checked!==false,dataStale:$('#alertDataStale')?.checked!==false,aiChange:$('#alertAiChange')?.checked!==false,events:$('#alertEvents')?.checked!==false};try{localStorage.setItem(ALERT_KEY,JSON.stringify(v))}catch{}return v}
function alertLog(){try{return JSON.parse(localStorage.getItem(ALERT_LOG_KEY)||'[]')}catch{return[]}}
function recordAlert(item,{notify=false}={}){const now=Date.now(),rows=alertLog(),key=item.key||`${item.title}:${item.detail}`;if(rows.some(x=>x.key===key&&now-x.time<6*60*60*1000))return;rows.unshift({...item,key,time:now});try{localStorage.setItem(ALERT_LOG_KEY,JSON.stringify(rows.slice(0,60)))}catch{}renderSmartAlerts();if(notify)showSystemNotification(item.title,item.detail,key)}
async function showSystemNotification(title,body,tag='alphalens'){if(!('Notification'in window)||Notification.permission!=='granted')return;try{const reg=await navigator.serviceWorker?.ready;if(reg?.showNotification)await reg.showNotification(title,{body,tag,renotify:false,data:{url:location.href}});else new Notification(title,{body,tag})}catch{}}
function renderSmartAlerts(){const box=$('#smartAlerts');if(!box)return;const rows=alertLog().slice(0,8);box.innerHTML=rows.length?rows.map(x=>`<div class="smart-alert ${esc(x.level||'info')}"><span class="alert-dot"></span><div><b>${esc(x.title)}</b><small>${esc(x.detail||'')} · ${new Date(x.time).toLocaleString('zh-TW')}</small></div></div>`).join(''):'<p class="dashboard-empty">目前沒有需要處理的警示。</p>'}
function evaluateSmartAlerts(){const settings=readAlertSettings(),q=state.quote,name=state.row?.name||state.symbol;if(settings.priceMove&&isNum(q?.changePercent)&&Math.abs(+q.changePercent)>=5)recordAlert({level:Math.abs(+q.changePercent)>=8?'danger':'warning',title:`${name} 單日${+q.changePercent>0?'上漲':'下跌'} ${Math.abs(+q.changePercent).toFixed(1)}%`,detail:`行情來源 ${q.source||'未知'}，請確認量價與重大消息。`,key:`move:${state.market}:${state.symbol}:${new Date().toISOString().slice(0,10)}`},{notify:true});if(settings.dataStale&&(q?.freshness==='舊資料'||q?.isDemo||(state.connection.lastEventAt>0&&Date.now()-state.connection.lastEventAt>60000)))recordAlert({level:'warning',title:`${name} 行情資料需要確認`,detail:q?.warning||'即時串流或行情來源可能中斷。',key:`stale:${state.market}:${state.symbol}:${new Date().toISOString().slice(0,10)}`});if(settings.events){const event=(state.profile?.filings||[]).find(x=>{const d=new Date(x.date);return Number.isFinite(d.getTime())&&Math.abs(Date.now()-d.getTime())<14*86400000});if(event)recordAlert({level:'info',title:`${name} 近期官方申報 ${event.form||'公告'}`,detail:`日期 ${event.date||'未知'}，建議檢查財報與風險揭露。`,key:`event:${state.market}:${state.symbol}:${event.date}:${event.form}`})}const trends=state.trends?.quarterly||[],last=trends.at(-1),prev=trends.at(-2);if(last&&prev&&isNum(last.grossMargin)&&isNum(prev.grossMargin)&&last.grossMargin<prev.grossMargin-2)recordAlert({level:'warning',title:`${name} 毛利率明顯下降`,detail:`較前季下降 ${(prev.grossMargin-last.grossMargin).toFixed(1)} 個百分點。`,key:`margin:${state.market}:${state.symbol}:${last.period}`})}
function initAlerts(){const v=readAlertSettings();for(const [id,key] of [['#alertPriceMove','priceMove'],['#alertDataStale','dataStale'],['#alertAiChange','aiChange'],['#alertEvents','events']]){const el=$(id);if(el){el.checked=v[key];el.onchange=()=>{saveAlertSettings();evaluateSmartAlerts()}}}const stateEl=$('#alertPermissionState'),button=$('#enableNotifications');const update=()=>{if(!stateEl||!button)return;const permission='Notification'in window?Notification.permission:'不支援';stateEl.textContent=`通知權限：${permission==='granted'?'已允許':permission==='denied'?'已拒絕':permission==='default'?'尚未設定':permission}`;button.textContent=permission==='granted'?'系統通知已開啟':'開啟系統通知';button.disabled=permission==='granted'};if(button)button.onclick=async()=>{if(!('Notification'in window)){toast('此瀏覽器不支援系統通知');return}const result=await Notification.requestPermission();update();if(result==='granted'){toast('智慧通知已開啟');showSystemNotification('AlphaLens 智慧提醒','重要行情、AI 評級與事件將在符合條件時提醒。','welcome')}};update();renderSmartAlerts()}

// v13.2 首頁投資決策儀表板
function dashboardScoreRow(x){
 const pct=Number(x.changePercent)||0,vol=Number(x.volume)||0,turn=Number(x.turnover)||0;
 return Math.max(0,Math.min(100,50+pct*5+Math.log10(Math.max(1,vol))*3+Math.log10(Math.max(1,turn))*1.5));
}
function dashboardAction(score){return score>=72?{label:'偏多',cls:'buy'}:score<=38?{label:'偏空',cls:'sell'}:{label:'觀察',cls:'hold'}}
function renderDashboardPortfolio(){
 const box=$('#dashboardPortfolio'); if(!box)return;
 const rows=(state.portfolio||[]).map(h=>({...h,...holdingMetrics(h)}));
 if(!rows.length){box.innerHTML='<div class="dashboard-empty"><b>尚未建立投資組合</b><p>新增持股後，這裡會顯示損益、AI 標示與警示燈。</p></div>';$('#dashPortfolioRisk').textContent='0 檔';$('#dashPortfolioDetail').textContent='尚未新增持股';return}
 const total=rows.reduce((s,x)=>s+(x.value??x.cost),0)||1;
 rows.sort((a,b)=>(b.value??b.cost)-(a.value??a.cost));
 let red=0;
 box.innerHTML=rows.slice(0,5).map(x=>{const weight=(x.value??x.cost)/total*100,ai=aiSignal(x,weight);if(ai.light==='red')red++;return `<button class="dashboard-holding" data-dashboard-holding="${esc(holdingId(x))}"><span class="risk-light ${ai.light}" aria-label="${ai.light}"></span><span><b>${esc(x.name||x.symbol)}</b><small>${esc(x.symbol)} · ${weight.toFixed(1)}%</small></span><strong class="${x.pnl>0?'up':x.pnl<0?'down':''}">${x.ret==null?'--':`${x.ret>0?'+':''}${x.ret.toFixed(1)}%`}</strong><em class="ai-action ${ai.tone}">${ai.action}</em></button>`}).join('');
 $('#dashPortfolioRisk').textContent=red?`${red} 檔紅燈`:`${rows.length} 檔正常`;
 $('#dashPortfolioDetail').textContent=`最大持股 ${rows[0].name||rows[0].symbol} ${((rows[0].value??rows[0].cost)/total*100).toFixed(1)}%`;
}
function renderDashboardNews(){
 const box=$('#dashboardNews');if(!box)return;const rows=(state.news||[]).slice(0,5);
 box.innerHTML=rows.map(n=>`<a href="${/^https?:/.test(n.url||'')?esc(n.url):'#'}" target="_blank" rel="noopener"><span>${n.official?'官方':'新聞'}</span><b>${esc(n.headline||'未命名新聞')}</b><small>${esc(n.source||'未知來源')}</small></a>`).join('')||'<p class="dashboard-empty">目前沒有可用新聞。</p>';
}
function renderDashboardMarket(data){
 const rows=data?.rows||[],scores=rows.map(dashboardScoreRow),avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:50;
 const positive=rows.filter(x=>Number(x.changePercent)>0).length,negative=rows.filter(x=>Number(x.changePercent)<0).length;
 const sentiment=avg>=65?'樂觀':avg<=42?'保守':'中性';
 $('#dashMarket').textContent=MARKET_LABELS[state.market]||state.market;$('#dashMarketState').textContent=`上漲 ${positive} · 下跌 ${negative}`;
 $('#dashSentiment').textContent=sentiment;$('#dashSentimentScore').textContent=`${Math.round(avg)} / 100`;
 const flow=dashboardAction(avg);$('#dashFlowState').textContent=flow.label;$('#dashFlowScore').textContent=avg>=65?'量價動能偏強':avg<=42?'資金動能轉弱':'資金輪動觀察';
 const badge=$('#dashboardViewBadge');badge.textContent=sentiment;badge.className=`view-badge ${sentiment==='樂觀'?'positive':sentiment==='保守'?'negative':'neutral'}`;
 const top=rows[0];$('#dashboardMarketView').innerHTML=`<h3>${sentiment==='樂觀'?'風險偏好升溫':sentiment==='保守'?'短線風險升高':'市場呈現輪動格局'}</h3><p>${positive>=negative?'強勢股票數量占優，仍需確認成交量能否持續。':'弱勢股票較多，宜控制部位並等待動能改善。'}</p>${top?`<div class="market-view-focus"><small>今日動能焦點</small><b>${esc(top.name||top.symbol)}</b><span>${Number(top.changePercent)>0?'+':''}${fmt(top.changePercent)}%</span></div>`:''}<small>此觀點由公開排行、成交量與新聞摘要規則化產生，僅供研究。</small>`;
}
function renderDashboardLists(){
 const data=state.dashboardData[state.dashboardFlowType]||{},rows=data.rows||[],box=$('#dashboardFlowList');if(!box)return;
 box.innerHTML=rows.slice(0,7).map((x,i)=>{const score=dashboardScoreRow(x),a=dashboardAction(score);return `<button class="dashboard-flow-row" data-dash-market="${esc(x.market||state.market)}" data-dash-symbol="${esc(x.symbol)}" data-dash-name="${esc(x.name||x.symbol)}" data-dash-exchange="${esc(x.exchange||'')}"><span>${i+1}</span><span><b>${esc(x.name||x.symbol)}</b><small>${esc(x.symbol)} · 量 ${compact(x.volume)}</small></span><strong class="${Number(x.changePercent)>0?'up':Number(x.changePercent)<0?'down':''}">${Number(x.changePercent)>0?'+':''}${fmt(x.changePercent)}%</strong><em class="ai-action ${a.cls}">${a.label}</em></button>`}).join('')||'<p class="dashboard-empty">暫無資料。</p>';
 $('#dashboardFlowSource').textContent=`來源：${data.source||'公開市場資料'} · 以成交量、漲跌幅及熱門度推估，不等同券商分點或法人申報。`;
 const picks=[...(state.dashboardData.hot?.rows||[]),...(state.dashboardData.gainers?.rows||[])];const unique=[];const seen=new Set();for(const x of picks){const k=`${x.market}:${x.symbol}`;if(!seen.has(k)){seen.add(k);unique.push(x)}}
 $('#dashboardAiPicks').innerHTML=unique.slice(0,5).map(x=>{const score=Math.round(dashboardScoreRow(x)),a=dashboardAction(score);return `<button data-dash-market="${esc(x.market||state.market)}" data-dash-symbol="${esc(x.symbol)}" data-dash-name="${esc(x.name||x.symbol)}" data-dash-exchange="${esc(x.exchange||'')}"><span class="pick-score">${score}</span><span><b>${esc(x.name||x.symbol)}</b><small>${esc(x.symbol)} · AI 動能分</small></span><em class="ai-action ${a.cls}">${a.label}</em></button>`}).join('')||'<p class="dashboard-empty">等待排行資料。</p>';
 renderDashboardMarket(state.dashboardData.gainers||data);renderDashboardPortfolio();renderDashboardNews();evaluateSmartAlerts();
}
async function loadDashboard(force=false){if(state.isDashboardLoading)return;state.isDashboardLoading=true;const b=$('#refreshDashboard');if(b){b.disabled=true;b.textContent='更新中…'}try{const types=['volume','gainers','hot'];for(let i=0;i<types.length;i++){const type=types[i];try{state.dashboardData[type]=await api(`/api/ranking?market=${state.market}&type=${type}${force&&i===0?'&refresh=1':''}&t=${Date.now()}`,{timeout:30000,retries:0})}catch(e){console.warn(`dashboard ${type}`,e.message)}}renderDashboardLists();$('#dashboardUpdatedAt').textContent=`更新：${new Date().toLocaleString('zh-TW')}`}catch(e){toast(`儀表板更新失敗：${e.message}`)}finally{state.isDashboardLoading=false;if(b){b.disabled=false;b.textContent='↻ 更新儀表板'}}}
function initDashboard(){
 $('#refreshDashboard').onclick=()=>loadDashboard(true);
 $('#dashboardFlowTabs').addEventListener('click',e=>{const b=e.target.closest('[data-flow]');if(!b)return;state.dashboardFlowType=b.dataset.flow;$$('#dashboardFlowTabs button').forEach(x=>x.classList.toggle('active',x===b));renderDashboardLists()});
 document.addEventListener('click',e=>{const page=e.target.closest('[data-open-page]');if(page)showAppPage(page.dataset.openPage);const h=e.target.closest('[data-dashboard-holding]');if(h)switchHolding(h.dataset.dashboardHolding);const s=e.target.closest('[data-dash-symbol]');if(s){showAppPage('analysis');select({market:s.dataset.dashMarket,symbol:s.dataset.dashSymbol,name:s.dataset.dashName,exchange:s.dataset.dashExchange})}});
}

// v12.8 原生分頁介面：HTML 已直接拆成獨立頁面，不再於載入後搬動 DOM。
function showAppPage(page='dashboard'){
 const allowed=['dashboard','analysis','portfolio','ranking','news'];
 const next=allowed.includes(page)?page:'dashboard';
 document.body.dataset.page=next;
 $$('#pageNavigation [data-page]').forEach(button=>{
  const active=button.dataset.page===next;
  button.classList.toggle('active',active);
  button.setAttribute('aria-current',active?'page':'false');
 });
 $$('.app-page').forEach(section=>{
  const active=section.dataset.page===next;
  section.classList.toggle('active',active);
  section.hidden=!active;
  section.setAttribute('aria-hidden',String(!active));
 });
 try{localStorage.setItem('alphalens_active_page',next)}catch{}
 window.scrollTo({top:0,behavior:'auto'});
}
function initPageNavigation(){
 const navigation=$('#pageNavigation');
 if(!navigation)return;
 navigation.addEventListener('click',event=>{
  const button=event.target.closest('[data-page]');
  if(!button)return;
  showAppPage(button.dataset.page);
 });
 let saved='dashboard';
 try{saved=localStorage.getItem('alphalens_active_page')||'dashboard'}catch{}
 showAppPage(saved);
}

// v13.1 我的持股：圓餅配置、警示燈、AI 操作標示與景氣訊號
const PORTFOLIO_KEY='alphalens_portfolio_v3';
let portfolioQuery='',portfolioSort='value',selectedHoldingId='';
function safeStorageGet(key,fallback='[]'){try{return localStorage.getItem(key)||fallback}catch{return fallback}}
function safeStorageSet(key,value){try{localStorage.setItem(key,value);return true}catch{return false}}
function readPortfolio(){try{let raw=JSON.parse(safeStorageGet(PORTFOLIO_KEY,'null'));if(!Array.isArray(raw)){raw=JSON.parse(safeStorageGet('alphalens_portfolio_v2','[]'))}return Array.isArray(raw)?raw.map(normalizeHolding).filter(Boolean):[]}catch{return[]}}
function normalizeHolding(h){if(!h||!h.market||!h.symbol)return null;return{market:String(h.market).toUpperCase(),symbol:String(h.symbol).trim().toUpperCase(),name:String(h.name||h.symbol).trim(),shares:Number(h.shares)||0,cost:Number(h.cost)||0,note:String(h.note||'').slice(0,120),lastPrice:isNum(h.lastPrice)?+h.lastPrice:null,dayChange:isNum(h.dayChange)?+h.dayChange:null,updatedAt:Number(h.updatedAt)||0,exchange:String(h.exchange||''),quoteSource:String(h.quoteSource||''),freshness:String(h.freshness||'')}}
function savePortfolio({render=true}={}){safeStorageSet(PORTFOLIO_KEY,JSON.stringify(state.portfolio));if(render)renderPortfolio();renderDashboardPortfolio();schedulePortfolioRefresh(15000)}
function holdingId(x){return `${x.market}:${String(x.symbol).toUpperCase()}`}
function currentPriceForHolding(h){if(h.market===state.market&&h.symbol===state.symbol&&isNum(state.quote?.price))return +state.quote.price;return isNum(h.lastPrice)?+h.lastPrice:null}
function money(v){return isNum(v)?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2}):'--'}
function marketLabel(m){return m==='TW'?'台股':m==='CN'?'A 股':'美股'}
function holdingMetrics(h){const price=currentPriceForHolding(h),cost=h.shares*h.cost,value=price==null?null:h.shares*price,pnl=value==null?null:value-cost,ret=pnl!=null&&cost>0?pnl/cost*100:null;return{price,cost,value,pnl,ret}}
function portfolioRows(){const q=portfolioQuery.trim().toLowerCase();let rows=(state.portfolio||[]).filter(h=>!q||`${h.name} ${h.symbol} ${marketLabel(h.market)}`.toLowerCase().includes(q));return rows.sort((a,b)=>{const A=holdingMetrics(a),B=holdingMetrics(b);if(portfolioSort==='name')return String(a.name).localeCompare(String(b.name),'zh-Hant');if(portfolioSort==='pnl')return (B.pnl??-Infinity)-(A.pnl??-Infinity);if(portfolioSort==='return')return (B.ret??-Infinity)-(A.ret??-Infinity);return (B.value??B.cost)-(A.value??A.cost)})}
function inferTheme(h){const s=`${h.symbol} ${h.name}`.toUpperCase();if(/2330|2454|NVDA|AMD|INTC|TSM|ASML|半導體|晶片|聯發科|台積電/.test(s))return 'semiconductor';if(/AAPL|APPLE|蘋果|GOOG|GOOGL|META|MSFT|MICROSOFT|軟體|雲端|AI/.test(s))return 'technology';if(/TSLA|BYD|比亞迪|電動車|汽車|CATL|寧德/.test(s))return 'ev';if(/銀行|金控|BANK|JPM|BAC|CITI|金融/.test(s))return 'finance';if(/油|能源|PETRO|EXXON|XOM|CHEVRON|CVX/.test(s))return 'energy';if(/航運|海運|航空|長榮|陽明|MAERSK/.test(s))return 'transport';if(/消費|零售|AMZN|COST|WMT|MCD/.test(s))return 'consumer';return 'general'}
const THEME_SIGNALS={semiconductor:{title:'半導體景氣',signals:['全球晶片庫存與終端需求變化','AI 伺服器、先進製程與封裝需求','美元、出口管制與設備投資循環']},technology:{title:'科技／AI 景氣',signals:['企業雲端與 AI 資本支出','廣告、訂閱與裝置換機需求','利率變化對高成長估值的影響']},ev:{title:'電動車景氣',signals:['全球電動車銷量與價格戰','電池原料價格及庫存水位','補貼政策、關稅與充電基礎建設']},finance:{title:'金融景氣',signals:['利率曲線與淨利差變化','逾期放款、信用成本與資產品質','房市、企業融資與監管政策']},energy:{title:'能源景氣',signals:['原油與天然氣供需及庫存','OPEC+政策與地緣政治風險','煉油利差、資本支出與匯率']},transport:{title:'運輸景氣',signals:['運價、載運率與新船供給','燃油成本與全球貿易量','港口壅塞及地緣政治航線風險']},consumer:{title:'消費景氣',signals:['零售銷售、消費者信心與就業','通膨對毛利率與需求的影響','庫存週轉、促銷強度與同店成長']},general:{title:'總體景氣',signals:['利率、通膨與流動性環境','公司營收與獲利趨勢','產業政策、匯率與供應鏈變化']}};
function aiSignal(h,weightPct=0){const m=holdingMetrics(h);let score=50,reasons=[];if(m.ret!=null){if(m.ret>=20){score+=8;reasons.push('中期報酬偏強')}else if(m.ret>=5){score+=5;reasons.push('報酬維持正向')}else if(m.ret<=-20){score-=15;reasons.push('虧損幅度偏大')}else if(m.ret<=-8){score-=8;reasons.push('價格弱於成本')}}if(Number.isFinite(h.dayChange)){if(h.dayChange>=2){score+=4;reasons.push('當日動能偏強')}else if(h.dayChange<=-2){score-=4;reasons.push('當日動能偏弱')}}const age=h.updatedAt?Date.now()-h.updatedAt:Infinity;if(age<120000){score+=4;reasons.push('行情資料新鮮')}else if(age>15*60*1000){score-=8;reasons.push('行情資料過舊')}if(weightPct>=40){score-=10;reasons.push('單一持股集中度過高')}else if(weightPct>=25){score-=5;reasons.push('持股比重偏高')}score=Math.max(0,Math.min(100,Math.round(score)));let action='持有',tone='hold';if(score>=63){action='買入';tone='buy'}else if(score<=38){action='賣出';tone='sell'}let light='green',label='正常';if(score<=38||age>30*60*1000){light='red';label=age>30*60*1000?'報價過舊':'高風險'}else if(score<55||weightPct>=30){light='yellow';label=weightPct>=30?'集中度注意':'觀察'}return{score,action,tone,light,label,reasons:reasons.slice(0,3)}}
function renderAllocation(all){const el=$('#portfolioAllocation');if(!el)return;const data=all.map(h=>({h,v:holdingMetrics(h).value??holdingMetrics(h).cost})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v),total=data.reduce((s,x)=>s+x.v,0);if(!data.length){el.innerHTML='<div class="portfolio-empty-mini">尚無可計算的持股比例。</div>';return}const shown=data.slice(0,7),rest=data.slice(7).reduce((s,x)=>s+x.v,0);if(rest>0)shown.push({h:{name:'其他'},v:rest});let cursor=0;const palette=['#25d6a2','#4da3ff','#ffba4a','#ff6b81','#a779ff','#36c5d8','#8ddf58','#6f7f89'];const segments=shown.map((x,i)=>{const pct=x.v/total*100,start=cursor;cursor+=pct;return{...x,pct,start,end:cursor,color:palette[i%palette.length]}});const gradient=segments.map(x=>`${x.color} ${x.start.toFixed(2)}% ${x.end.toFixed(2)}%`).join(',');el.innerHTML=`<div class="allocation-title"><div><b>持股比例圓餅圖</b><small>不同市場未換匯，僅供集中度參考</small></div></div><div class="allocation-pie-wrap"><div class="allocation-pie" style="background:conic-gradient(${gradient})"><div><b>${data.length}</b><span>檔持股</span></div></div><div class="allocation-legend">${segments.map(x=>`<div><i style="background:${x.color}"></i><span>${esc(x.h.name||x.h.symbol)}</span><b>${x.pct.toFixed(1)}%</b></div>`).join('')}</div></div>`}
function renderEconomicSignals(all){const el=$('#portfolioSignalBoard');if(!el)return;if(!all.length){el.innerHTML='<div class="portfolio-empty-mini">新增持股後顯示重要景氣訊號。</div>';return}const themes=new Map();all.forEach(h=>{const key=inferTheme(h);if(!themes.has(key))themes.set(key,[]);themes.get(key).push(h.name||h.symbol)});el.innerHTML=`<div class="signal-board-head"><div><b>重要景氣訊號</b><small>依目前持股產業自動整理</small></div></div><div class="economic-signal-list">${[...themes.entries()].slice(0,5).map(([key,names])=>{const t=THEME_SIGNALS[key];return `<article><div><span class="signal-pulse"></span><b>${esc(t.title)}</b></div><small>相關持股：${esc(names.slice(0,3).join('、'))}</small>${t.signals.map(s=>`<p>• ${esc(s)}</p>`).join('')}</article>`}).join('')}</div><p class="signal-disclaimer">景氣訊號是監測清單，不代表事件已發生；應搭配最新財報、新聞與總體數據確認。</p>`}
function renderPortfolio(){
 const all=state.portfolio||[],rows=portfolioRows(),selectEl=$('#portfolioSelect');if(!selectEl)return;
 selectEl.innerHTML=all.length?'<option value="">選擇持股...</option>'+all.map(h=>`<option value="${esc(holdingId(h))}">${esc(h.name||h.symbol)}（${esc(h.symbol)}）</option>`).join(''):'<option value="">尚未新增持股</option>';selectEl.value=selectedHoldingId;
 const groups={TW:{cost:0,value:0,known:0},CN:{cost:0,value:0,known:0},US:{cost:0,value:0,known:0}};all.forEach(h=>{const m=holdingMetrics(h),g=groups[h.market]||groups.US;g.cost+=m.cost;if(m.value!=null){g.value+=m.value;g.known++}});
 const marketCards=Object.entries(groups).filter(([,g])=>g.cost>0).map(([m,g])=>{const pnl=g.known?g.value-g.cost:null,ret=pnl!=null&&g.cost?pnl/g.cost*100:null;return `<div class="portfolio-stat"><small>${marketLabel(m)} · ${m==='US'?'USD':m==='CN'?'CNY':'TWD'}</small><strong>${g.known?money(g.value):money(g.cost)}</strong><em class="${pnl>0?'up':pnl<0?'down':''}">${pnl==null?'等待報價':`${pnl>0?'+':''}${money(pnl)} (${ret.toFixed(2)}%)`}</em></div>`}).join('');
 $('#portfolioSummary').innerHTML=`<div class="portfolio-stat"><small>持股檔數</small><strong>${all.length}</strong><em>${rows.length!==all.length?`篩選顯示 ${rows.length} 檔`:'本機安全保存'}</em></div>${marketCards||'<div class="portfolio-stat"><small>投資組合</small><strong>尚無持股</strong><em>點擊右上角新增</em></div>'}`;
 renderAllocation(all);renderEconomicSignals(all);
 const totalBase=all.reduce((s,h)=>s+(holdingMetrics(h).value??holdingMetrics(h).cost),0)||1;
 $('#holdingList').innerHTML=rows.map(h=>{const m=holdingMetrics(h),weight=(m.value??m.cost)/totalBase*100,ai=aiSignal(h,weight);return `<article class="holding-row holding-row-v13" data-holding="${esc(holdingId(h))}"><button class="holding-name" data-action="open" type="button"><span class="risk-light ${ai.light}" title="${esc(ai.label)}"></span><b>${esc(h.name||h.symbol)}</b><small>${esc(h.symbol)} · ${marketLabel(h.market)} · 比重 ${weight.toFixed(1)}%</small></button><div class="holding-cell"><small>現價</small><b>${m.price==null?'待更新':money(m.price)}</b><em>${esc(h.freshness||h.quoteSource||'')}</em></div><div class="holding-cell"><small>未實現損益</small><b class="${m.pnl>0?'up':m.pnl<0?'down':''}">${m.pnl==null?'--':`${m.pnl>0?'+':''}${money(m.pnl)}${m.ret!=null?` (${m.ret.toFixed(1)}%)`:''}`}</b></div><div class="holding-ai"><small>專業 AI 參考</small><span class="ai-action ${ai.tone}">${ai.action}</span><b>${ai.score} 分</b><em>${esc(ai.reasons.join('、')||'等待更多行情資料')}</em></div><div class="holding-actions"><button data-action="open" type="button">分析</button><button data-action="edit" type="button">編輯</button><button data-action="delete" type="button">刪除</button></div>${h.note?`<p class="holding-note">${esc(h.note)}</p>`:''}</article>`}).join('')||`<div class="portfolio-empty"><b>${all.length?'找不到符合條件的持股':'尚未新增持股'}</b><p>${all.length?'請調整搜尋條件。':'點擊「新增持股」，輸入代號、股數與成本即可開始追蹤。'}</p></div>`;
 $('#portfolioUpdatedAt').textContent=`本機保存 · ${all.length} 檔持股${all.some(h=>h.updatedAt)?` · 最近更新 ${new Date(Math.max(...all.map(h=>h.updatedAt||0))).toLocaleString('zh-TW')}`:''}`;
}
function clearHoldingForm(){['#holdingEditId','#holdingSymbol','#holdingName','#holdingShares','#holdingCost','#holdingNote'].forEach(id=>{const el=$(id);if(el)el.value=''});$('#holdingMarket').value='TW';$('#saveHolding').textContent='儲存持股'}
function openHoldingForm(h=null){$('#portfolioForm').classList.remove('hidden');if(!h){clearHoldingForm();return}$('#holdingEditId').value=holdingId(h);$('#holdingMarket').value=h.market;$('#holdingSymbol').value=h.symbol;$('#holdingName').value=h.name||'';$('#holdingShares').value=h.shares;$('#holdingCost').value=h.cost;$('#holdingNote').value=h.note||'';$('#saveHolding').textContent='更新持股';$('#portfolioForm').scrollIntoView({behavior:'smooth',block:'nearest'})}
function persistHolding(){const oldId=$('#holdingEditId').value,market=$('#holdingMarket').value,symbol=$('#holdingSymbol').value.trim().toUpperCase(),name=$('#holdingName').value.trim(),shares=Number($('#holdingShares').value),cost=Number($('#holdingCost').value),note=$('#holdingNote').value.trim();if(!symbol||!(shares>0)||!(cost>=0)){toast('請輸入股票代號、持有股數與平均成本');return}const item=normalizeHolding({market,symbol,name:name||symbol,shares,cost,note,lastPrice:market===state.market&&symbol===state.symbol?state.quote?.price:null,updatedAt:Date.now()});if(oldId&&oldId!==holdingId(item))state.portfolio=state.portfolio.filter(h=>holdingId(h)!==oldId);const idx=state.portfolio.findIndex(h=>holdingId(h)===holdingId(item));if(idx>=0)state.portfolio[idx]={...state.portfolio[idx],...item};else state.portfolio.push(item);savePortfolio();selectedHoldingId=holdingId(item);clearHoldingForm();$('#portfolioForm').classList.add('hidden');renderPortfolio();toast(idx>=0?'持股已更新':'持股已新增')}
async function switchHolding(id){const h=state.portfolio.find(x=>holdingId(x)===id);if(!h)return;selectedHoldingId=id;showAppPage('analysis');await select({market:h.market,symbol:h.symbol,name:h.name||h.symbol,exchange:h.exchange||''});if(isNum(state.quote?.price)){h.lastPrice=+state.quote.price;h.updatedAt=Date.now();savePortfolio({render:false})}toast(`已開啟 ${h.name||h.symbol} 個股分析`)}
async function refreshPortfolioPrices({silent=false}={}){const rows=state.portfolio||[],btn=$('#refreshPortfolioPrices');if(!rows.length){if(!silent)toast('請先新增持股');return}if(state.isPortfolioRefreshing)return;state.isPortfolioRefreshing=true;if(btn&&!silent){btn.disabled=true;btn.textContent='批次更新中…'}let ok=0,failed=0;try{const data=await api('/api/quotes',{method:'POST',body:JSON.stringify({items:rows.map(h=>({market:h.market,symbol:h.symbol})),refresh:!silent}),timeout:26000,retries:0,dedupe:false});for(const item of data.rows||[]){const h=rows.find(x=>x.market===item.market&&x.symbol===item.symbol),q=item.quote;if(h&&item.ok&&isNum(q?.price)){h.lastPrice=+q.price;h.dayChange=isNum(q.changePercent)?+q.changePercent:isNum(q.changePct)?+q.changePct:h.dayChange;h.name=((h.market==='TW'||h.market==='CN')&&!/[\u3400-\u9fff]/.test(String(q.name||'')))?h.name:((q.name&&q.name!==h.symbol)?q.name:h.name);h.updatedAt=Date.now();h.quoteSource=q.source;h.freshness=q.freshness;ok++}else failed++}savePortfolio();if(!silent)toast(`持股股價更新完成：成功 ${ok}、失敗 ${failed}`)}catch(e){if(!silent)toast(e.message)}finally{state.isPortfolioRefreshing=false;if(btn&&!silent){btn.disabled=false;btn.textContent='↻ 更新全部股價'}schedulePortfolioRefresh(60000)}}
function schedulePortfolioRefresh(delay=60000){clearTimeout(state.portfolioTimer);if(document.hidden||!state.portfolio?.length)return;state.portfolioTimer=setTimeout(()=>refreshPortfolioPrices({silent:true}),Math.max(15000,delay))}
function analyzePortfolio(){const rows=state.portfolio||[];if(!rows.length){toast('請先新增持股');return}const items=rows.map(h=>({...h,...holdingMetrics(h),weightValue:holdingMetrics(h).value??holdingMetrics(h).cost})),total=items.reduce((s,x)=>s+x.weightValue,0)||1;items.sort((a,b)=>b.weightValue-a.weightValue);const top=items[0],topPct=top.weightValue/total*100,markets={};items.forEach(x=>markets[x.market]=(markets[x.market]||0)+x.weightValue);const signals=items.map(x=>({x,ai:aiSignal(x,x.weightValue/total*100)})),buy=signals.filter(s=>s.ai.action==='買入').length,hold=signals.filter(s=>s.ai.action==='持有').length,sell=signals.filter(s=>s.ai.action==='賣出').length,red=signals.filter(s=>s.ai.light==='red').length;const risks=[];if(topPct>=45)risks.push(`最大持股 ${top.name||top.symbol} 占 ${topPct.toFixed(1)}%，集中度偏高。`);else if(topPct>=30)risks.push(`最大持股占 ${topPct.toFixed(1)}%，集中度中等。`);if(rows.length<5)risks.push('持股少於 5 檔，個股事件可能明顯影響整體績效。');if(Object.keys(markets).length===1)risks.push(`全部集中於${marketLabel(Object.keys(markets)[0])}，缺少跨市場分散。`);if(red)risks.push(`${red} 檔出現紅燈，應優先檢查報價新鮮度、虧損幅度或集中度。`);$('#portfolioAnalysis').innerHTML=`<h3>專業 AI 投資組合健檢</h3><div class="analysis-grid"><div><b>AI 操作分布</b><p><span class="ai-action buy">買入 ${buy}</span> <span class="ai-action hold">持有 ${hold}</span> <span class="ai-action sell">賣出 ${sell}</span></p></div><div><b>集中度</b><p>最大持股：${esc(top.name||top.symbol)} ${topPct.toFixed(1)}%</p></div><div><b>市場配置</b><p>${Object.entries(markets).map(([m,v])=>`${marketLabel(m)} ${(v/total*100).toFixed(0)}%`).join('、')}</p></div><div><b>需要注意</b>${(risks.length?risks:['目前沒有明顯集中或資料風險。']).map(x=>`<p>• ${esc(x)}</p>`).join('')}</div></div><p><small>AI 標示依價格、成本、當日動能、資料新鮮度與集中度計算，僅供研究參考，不構成投資建議。</small></p>`}
function exportPortfolio(){const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),holdings:state.portfolio},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`alphalens-portfolio-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('持股資料已匯出')}
async function importPortfolioFile(file){try{const data=JSON.parse(await file.text()),rows=Array.isArray(data)?data:data.holdings;if(!Array.isArray(rows))throw new Error('格式不正確');const normalized=rows.map(normalizeHolding).filter(h=>h&&h.shares>0);if(!normalized.length)throw new Error('檔案內沒有有效持股');const map=new Map(state.portfolio.map(h=>[holdingId(h),h]));normalized.forEach(h=>map.set(holdingId(h),h));state.portfolio=[...map.values()];savePortfolio();toast(`已匯入 ${normalized.length} 檔持股`)}catch(e){toast(`匯入失敗：${e.message}`)}}
async function canonicalizePortfolioNames(){
 const rows=state.portfolio||[];if(!rows.length)return;
 try{
  const data=await api('/api/names',{method:'POST',body:JSON.stringify({items:rows.map(h=>({market:h.market,symbol:h.symbol}))}),timeout:20000,retries:1});
  let changed=false;
  for(const x of data.rows||[]){if(!x.ok||!/[\u3400-\u9fff]/.test(String(x.name||'')))continue;const h=rows.find(v=>v.market===x.market&&v.symbol===x.symbol);if(h&&h.name!==x.name){h.name=x.name;h.exchange=x.exchange||h.exchange;changed=true}}
  if(changed)savePortfolio();
 }catch(e){console.warn('名稱同步失敗',e.message)}
}
function initPortfolio(){state.portfolio=readPortfolio();renderPortfolio();canonicalizePortfolioNames();$('#togglePortfolioForm').onclick=()=>openHoldingForm();$('#cancelHoldingEdit').onclick=()=>{$('#portfolioForm').classList.add('hidden');clearHoldingForm()};$('#saveHolding').onclick=persistHolding;$('#portfolioSelect').onchange=e=>{selectedHoldingId=e.target.value};$('#openSelectedHolding').onclick=()=>selectedHoldingId?switchHolding(selectedHoldingId):toast('請先選擇持股');$('#analyzePortfolio').onclick=analyzePortfolio;$('#refreshPortfolioPrices').onclick=refreshPortfolioPrices;$('#portfolioSearch').oninput=e=>{portfolioQuery=e.target.value;renderPortfolio()};$('#portfolioSort').onchange=e=>{portfolioSort=e.target.value;renderPortfolio()};$('#exportPortfolio').onclick=exportPortfolio;$('#importPortfolio').onclick=()=>$('#portfolioImportFile').click();$('#portfolioImportFile').onchange=e=>{const f=e.target.files?.[0];if(f)importPortfolioFile(f);e.target.value=''};$('#holdingList').addEventListener('click',e=>{const row=e.target.closest('[data-holding]'),button=e.target.closest('[data-action]');if(!row||!button)return;const id=row.dataset.holding,h=state.portfolio.find(x=>holdingId(x)===id);if(!h)return;if(button.dataset.action==='open')switchHolding(id);if(button.dataset.action==='edit')openHoldingForm(h);if(button.dataset.action==='delete'&&confirm(`確定刪除 ${h.name||h.symbol}？`)){state.portfolio=state.portfolio.filter(x=>holdingId(x)!==id);if(selectedHoldingId===id)selectedHoldingId='';savePortfolio();toast('持股已刪除')}})}

async function init(){initPageNavigation();initPortfolio();initDashboard();initAlerts();try{const v=await api('/api/version',{timeout:4000,retries:0});if(v.version!==APP_VERSION)toast(`前後端版本不同：前端 ${APP_VERSION}／後端 ${v.version}`)}catch{}const ok=await checkBackend();if(ok){await loadStock();setTimeout(()=>loadRanking(false),100);setTimeout(()=>loadDashboard(false),250);schedulePortfolioRefresh(8000)}else{wasOffline=true;toast('後端暫時未連線，將自動重試');$('#rankingList').innerHTML='<p class="ranking-loading">等待後端連線中…</p>';retryBackend()}}
init().catch(e=>{toast(e.message);retryBackend()});

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js?v=15.1.0').catch(()=>{}));}
