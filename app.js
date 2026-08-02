const APP_VERSION='11.1.0';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=(v,d=2)=>Number.isFinite(+v)?(+v).toLocaleString('zh-TW',{maximumFractionDigits:d}):'--';
const compact=v=>{const n=Number(v);if(!Number.isFinite(n))return'--';if(Math.abs(n)>=1e8)return`${(n/1e8).toFixed(2)}億`;if(Math.abs(n)>=1e4)return`${(n/1e4).toFixed(2)}萬`;return n.toLocaleString('zh-TW',{maximumFractionDigits:0})};
const state={market:'US',symbol:'AAPL',row:{market:'US',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',tradingView:'NASDAQ:AAPL'},quote:null,fund:null,news:[],profile:null,token:'',user:{id:'local',name:'本機使用者'},watchlist:[],ws:null,searchId:0,chartMode:'native',chartRange:'1M',history:[],rankingType:'gainers',newsFilter:'all',newsSort:'time',newsQuery:'',newsAutoTimer:null,newsLastUpdated:null,aiJudgement:null};
try{state.user=JSON.parse(localStorage.user||'null')}catch{}
let toastTimer,searchTimer;
function toast(x){clearTimeout(toastTimer);$('#toast').textContent=x;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function setBackendStatus(mode,text){const el=$('#backendStatus');if(!el)return;el.className=`backend-status ${mode}`;el.textContent=text}
async function api(url,opt={}){
 const timeoutMs=Number(opt.timeout||18000),retries=Number(opt.retries??1);
 const targets=location.protocol==='file:'?[`http://127.0.0.1:3000${url}`]:[url,`http://127.0.0.1:3000${url}`];
 let lastError;
 for(let attempt=0;attempt<=retries;attempt++){
  for(const target of [...new Set(targets)]){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
    const r=await fetch(target,{...opt,signal:controller.signal,headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:`Bearer ${state.token}`}:{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||`API ${r.status}`);
    setBackendStatus('ok','後端已連線');clearTimeout(timer);return d;
   }catch(e){lastError=e;clearTimeout(timer)}
  }
  if(attempt<retries)await new Promise(r=>setTimeout(r,600*(attempt+1)));
 }
 setBackendStatus('error','離線，正在重試');
 if(lastError?.name==='AbortError')throw Error('後端回應逾時');
 throw Error('後端暫時未連線，系統會自動重試');
}
async function checkBackend(){try{await api('/api/health',{timeout:5000});return true}catch{return false}}
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
 const valid=(rows||[]).filter(x=>Number.isFinite(+x.close)&&Number.isFinite(+x.high)&&Number.isFinite(+x.low));
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
 const wrap=$('#nativeChartWrap'),status=$('#chartStatus');
 wrap.classList.remove('hidden');$('#tvChart').classList.add('hidden');
 status.textContent='載入 K 線中…';
 try{
   const d=await api(`/api/history?market=${state.market}&symbol=${encodeURIComponent(state.symbol)}&range=${state.chartRange}&t=${Date.now()}`);
   state.history=d.rows||[];
   drawNativeChart(state.history);
   $('#chartNote').textContent=`內建 K 線 · ${d.source||'資料來源未知'}${d.warning?` · ${d.warning}`:''}`;
 }catch(e){status.textContent=e.message}
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
function applyAutomaticChartMode(){
 setChartMode(state.market==='US'?'tradingview':'native');
}

function renderTradingView(){const box=$('#tvChart');box.innerHTML='';const wrap=document.createElement('div');wrap.className='tradingview-widget-container';wrap.style.height='100%';const inner=document.createElement('div');inner.className='tradingview-widget-container__widget';inner.style.height='100%';wrap.appendChild(inner);const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;script.text=JSON.stringify({autosize:true,symbol:tvSymbol(),interval:tvInterval,timezone:'Asia/Taipei',theme:'dark',style:'1',locale:'zh_TW',allow_symbol_change:true,save_image:false,calendar:false,details:true,hotlist:false,hide_side_toolbar:false,hide_top_toolbar:false,hide_legend:false,hide_volume:false,withdateranges:true,support_host:'https://www.tradingview.com'});wrap.appendChild(script);box.appendChild(wrap)}
function renderQuote(q){state.quote=q;$('#stockName').textContent=q.name||state.row.name||q.symbol;$('#stockSymbol').textContent=q.symbol;$('#exchange').textContent=q.exchange||state.row.exchange||q.market;$('#price').textContent=`${q.currency||''} ${fmt(q.price)}`;const up=+q.change>=0;$('#change').className=up?'up':'down';$('#change').textContent=`${up?'+':''}${fmt(q.change)} (${up?'+':''}${fmt(q.changePercent)}%)`;$('#source').textContent=q.isDemo?`⚠ ${q.warning||'展示資料'}`:`${q.source} · ${q.isRealtime?'即時/近即時':'可能延遲'}${q.warning?` · ${q.warning}`:''}`;$('#source').classList.toggle('warn',Boolean(q.isDemo||q.isUnofficial||q.warning));const updated=q.updatedAt?new Date(q.updatedAt):null;$('#lastUpdated').textContent=updated&&!Number.isNaN(updated.getTime())?`更新：${updated.toLocaleString('zh-TW')}`:'更新時間未知';$('#refreshQuote').classList.toggle('live',Boolean(q.isRealtime))}

function safeHttpUrl(value){try{const u=new URL(value);return['http:','https:'].includes(u.protocol)?u.href:''}catch{return''}}
function listCards(id,rows=[]){const box=$(id),safeRows=Array.isArray(rows)?rows.filter(Boolean):[];box.innerHTML=safeRows.length?safeRows.map((x,i)=>`<div class="company-list-item"><span>${i+1}</span><b>${esc(x)}</b></div>`).join(''):'<p class="company-empty">目前沒有足夠資料。</p>'}
function profileInitial(name='',fallback='企'){const clean=String(name).trim();if(!clean)return fallback;if(/[\u3400-\u9fff]/.test(clean))return clean.slice(0,1);return clean.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||fallback}
function renderCompanyProfile(p){
 state.profile=p;const selectedName=state.row?.name||p.displayName||p.requestedName||p.name||state.symbol;
 $('#companyDisplayName').textContent=selectedName;$('#companySymbolText').textContent=p.symbol||state.symbol;$('#companyExchange').textContent=p.exchange||state.row?.exchange||state.market;$('#companyMarketBadge').textContent=state.market==='TW'?'台股':state.market==='CN'?'A 股':'美股';
 const sourceEl=$('#companyProfileSource');sourceEl.textContent=`${p.source||'資料來源未知'}${p.verified?' · 已核對':''}`;const sourceUrl=safeHttpUrl(p.sourceUrl||p.website||'');sourceEl.classList.toggle('disabled',!sourceUrl);if(sourceUrl)sourceEl.href=sourceUrl;else sourceEl.removeAttribute('href');
 $('#companyIndustry').textContent=`產業：${p.industry||p.sector||'未分類'}`;$('#companyCountry').textContent=`地區：${p.country||'未提供'}`;const completeness=Math.max(0,Math.min(100,Number(p.completeness)||0));$('#companyCompleteness').textContent=`完整度：${completeness}%`;$('#companyCompletenessBar').style.width=`${completeness}%`;
 const intro=p.description||`${selectedName} 目前沒有可用的公司介紹。`;$('#companyDescription').textContent=p.verified!==false?intro:`${selectedName}：外部介紹未通過名稱與股票代號核對，已改用安全資料。`;
 const logo=safeHttpUrl(p.logo||''),logoEl=$('#companyLogo'),fallbackEl=$('#companyLogoFallback');logoEl.classList.toggle('hidden',!logo||p.verified===false);fallbackEl.classList.toggle('hidden',Boolean(logo&&p.verified!==false));fallbackEl.textContent=profileInitial(selectedName,p.icon||'企');if(logo&&p.verified!==false){logoEl.src=logo;logoEl.alt=selectedName}
 $('#companyFounded').textContent=p.founded||'未提供';$('#companyHeadquarters').textContent=p.headquarters||p.country||'未提供';$('#companyCeo').textContent=p.chairman||p.ceo||'未提供';$('#companyEmployees').textContent=p.employees?`約 ${Number(p.employees).toLocaleString('zh-TW')} 人`:'未提供';
 const site=safeHttpUrl(p.website||'');$('#companyWebsite').classList.toggle('hidden',!site);if(site)$('#companyWebsite').href=site;
 listCards('#companyProducts',p.products);listCards('#companyCompetitors',p.competitors);listCards('#companySupplyChain',p.supplyChain);$('#companyDataNature').textContent=`資料性質：${p.dataNature||'公開資料整合'}；內容僅供快速理解公司業務。`;
}

function scoreLabel(v){return v==null?'--':`${Math.round(v)}`}
function metricValue(value,{suffix='',prefix='',digits=2,compactValue=false}={}){if(value==null||!Number.isFinite(+value))return'資料暫缺';return `${prefix}${compactValue?compact(value):fmt(value,digits)}${suffix}`}
function metricCard(label,value,options={},source=''){const shown=metricValue(value,options),missing=shown==='資料暫缺';return `<div class="metric-item ${missing?'missing':''}"><small>${esc(label)}</small><b>${esc(shown)}</b><span>${esc(source||'來源未提供')}</span></div>`}
function renderFund(f){
 state.fund=f;const score=Number.isFinite(+f.total)?+f.total:(Number.isFinite(+f.score)?+f.score:null),coverage=Number(f.coverage)||0;
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
function renderAiJudgement(x){state.aiJudgement=x;const box=$('#aiJudgement');const confidence=Number.isFinite(+x?.confidence)?Math.round(+x.confidence):'--';box.innerHTML=`<div class="ai-stance"><strong>${esc(x?.stance||'資料不足')}</strong><span>信心度 ${confidence}%</span></div><p>${esc(x?.summary||'目前無法產生判斷。')}</p><div class="ai-columns"><div><h4>優勢／催化劑</h4>${(x?.catalysts||[]).map(v=>`<p class="ai-positive">✓ ${esc(v)}</p>`).join('')||'<p>資料不足</p>'}</div><div><h4>主要風險</h4>${(x?.risks||[]).map(v=>`<p class="ai-risk">⚠ ${esc(v)}</p>`).join('')||'<p>資料不足</p>'}</div></div><div class="ai-details"><p><b>估值：</b>${esc(x?.valuation||'資料不足')}</p><p><b>成長：</b>${esc(x?.growth||'資料不足')}</p><p><b>財務：</b>${esc(x?.financialHealth||'資料不足')}</p></div><small>${esc(x?.dataQuality||'')} · ${esc(x?.source||'規則引擎')}</small>`}
async function loadAiJudgement({silent=false}={}){const b=$('#refreshAiJudgement');if(!silent){b.disabled=true;b.textContent='判斷中…'}try{const result=await api('/api/ai/analyze',{method:'POST',body:JSON.stringify({fundamentals:state.fund||{},quote:state.quote||{},news:state.news||[],profile:state.profile||{}}),timeout:35000,retries:1});renderAiJudgement(result);if(!silent)toast('AI 判斷已更新')}catch(e){renderAiJudgement({stance:'暫時無法判斷',summary:e.message,confidence:0,catalysts:[],risks:['後端或分析服務暫時不可用'],source:'錯誤備援'})}finally{if(!silent){b.disabled=false;b.textContent='↻ 重新判斷'}}}

function highlightNewsKeywords(text=''){const safe=esc(text);const words=['AI','營收','EPS','股利','法說會','董事會','財報','獲利','虧損','增持','減持','回購','訂單','中標','擴產','政策','監管','半導體','新能源'];const pattern=new RegExp(`(${words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');return safe.replace(pattern,'<mark>$1</mark>')}
function filteredNews(){let rows=[...(state.news||[])];if(state.newsFilter==='official')rows=rows.filter(x=>x.official);if(state.newsFilter==='media')rows=rows.filter(x=>!x.official);const q=state.newsQuery.trim().toLowerCase();if(q)rows=rows.filter(x=>`${x.headline||''} ${x.summary||''} ${x.source||''}`.toLowerCase().includes(q));if(state.newsSort==='source')rows.sort((a,b)=>String(a.source||'').localeCompare(String(b.source||''),'zh-TW'));else rows.sort((a,b)=>new Date(b.datetime||0)-new Date(a.datetime||0));return rows}
function updateNewsMeta(count){const stamp=state.newsLastUpdated?new Date(state.newsLastUpdated).toLocaleString('zh-TW'):'尚未更新';$('#newsMeta').textContent=`${count} 則 · 最後更新：${stamp}`}
async function renderNews(){let sum={sentiment:'中性',summary:state.news?.length?`共取得 ${state.news.length} 則新聞。`:'目前沒有可用新聞資料。',sources:[]};try{sum=await api('/api/news/summary',{method:'POST',body:JSON.stringify({news:state.news}),timeout:8000,retries:1})}catch{}$('#newsSummary').innerHTML=`<b>情緒：${esc(sum.sentiment||'中性')}</b><p>${esc(sum.summary||'')}</p>${sum.sources?.length?`<small>來源：${sum.sources.map(esc).join('、')}</small>`:''}`;const rows=filteredNews();updateNewsMeta(rows.length);$('#newsList').innerHTML=rows.slice(0,30).map(n=>{const href=/^https?:/.test(n.url||'')?esc(n.url):'#';const time=n.datetime?new Date(n.datetime).toLocaleString('zh-TW'):'';return `<a class="news" href="${href}" target="_blank" rel="noopener"><div class="news-title-line"><b>${n.official?'<span class="official-badge">官方</span> ':''}${highlightNewsKeywords(n.headline||'')}</b><span class="news-source-tag">${esc(n.source||'未知來源')}</span></div>${n.summary?`<p>${highlightNewsKeywords(n.summary)}</p>`:''}<small>${time||'時間未提供'}</small></a>`}).join('')||'<p class="news-empty">目前沒有符合條件的新聞。</p>'}
async function loadStock(){
 const m=state.market,s=state.symbol;$('#source').textContent='載入中';
 const requests=[
  api(`/api/quote?market=${m}&symbol=${encodeURIComponent(s)}`),
  api(`/api/fundamentals?market=${m}&symbol=${encodeURIComponent(s)}`),
  api(`/api/news?market=${m}&symbol=${encodeURIComponent(s)}`),
  api(`/api/company?market=${m}&symbol=${encodeURIComponent(s)}`)
 ];
 const [qr,fr,nr,pr]=await Promise.allSettled(requests);
 if(m!==state.market||s!==state.symbol)return;
 if(qr.status==='fulfilled')renderQuote({...state.row,...qr.value});else{$('#source').textContent='行情載入失敗';toast(qr.reason?.message||'行情載入失敗')}
 if(fr.status==='fulfilled')renderFund(fr.value);else renderFund({total:null,rating:'資料不足',coverage:0,subScores:{},strengths:[],risks:['基本面 API 暫時無法使用'],source:'資料暫缺',updatedAt:new Date().toISOString()});
 state.news=nr.status==='fulfilled'?nr.value:[];await renderNews();
 if(pr.status==='fulfilled')renderCompanyProfile(pr.value);else renderCompanyProfile({name:state.row.name,industry:state.row.industry,exchange:state.row.exchange,country:'',description:'公司介紹暫時無法取得。',source:'暫時不可用'});
 await loadAiJudgement({silent:true});applyAutomaticChartMode();connectWs()
}
function select(row){state.row=row;state.market=row.market;state.symbol=row.symbol;$$('.markets button').forEach(b=>b.classList.toggle('active',b.dataset.market===row.market));$('#searchInput').value='';$('#results').classList.add('hidden');loadStock()}
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
$$('.markets button').forEach(b=>b.onclick=()=>{const row=MARKET_DEFAULTS[b.dataset.market];$$('.markets button').forEach(x=>x.classList.toggle('active',x===b));$('#searchInput').value='';$('#results').classList.add('hidden');select(row);loadRanking(false)});

$$('#ranges button').forEach(b=>b.onclick=()=>{
 const label=b.textContent.trim(),map={'1D':'5','5D':'30','1M':'60','6M':'D','1Y':'D','5Y':'W'};
 state.chartRange=label;tvInterval=map[label]||'D';
 $$('#ranges button').forEach(x=>x.classList.toggle('active',x===b));
 if(state.market==='US')renderTradingView();else loadNativeChart();
 toast(`圖表區間：${label}`)
});
window.addEventListener('resize',()=>{if(state.chartMode==='native'&&state.history.length)drawNativeChart(state.history)});
document.addEventListener('click',e=>{if(!e.target.closest('.search'))$('#results').classList.add('hidden')});

function connectWs(){
 state.ws?.close();
 const expected={market:state.market,symbol:state.symbol};
 let ws;try{ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`)}catch{return}
 state.ws=ws;
 ws.onopen=()=>{if(state.ws===ws)ws.send(JSON.stringify({type:'subscribe',...expected}))};
 ws.onmessage=e=>{try{const msg=JSON.parse(e.data);if(msg.type==='quote'&&msg.data.market===state.market&&msg.data.symbol===state.symbol)renderQuote({...state.row,...msg.data})}catch{}};
 ws.onerror=()=>{};
 ws.onclose=()=>{if(state.ws===ws&&expected.market===state.market&&expected.symbol===state.symbol)setTimeout(connectWs,5000)}
}
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
async function refreshNewsData({silent=false}={}){const b=$('#refreshNews');if(!silent&&b){b.disabled=true;b.textContent='更新中…'}try{state.news=await api(`/api/news?market=${state.market}&symbol=${encodeURIComponent(state.symbol)}&refresh=1&t=${Date.now()}`,{timeout:30000,retries:2});state.newsLastUpdated=Date.now();await renderNews();if(!silent)toast(state.news.length?'新聞已更新':'目前沒有更新新聞')}catch(e){if(!silent)toast(e.message);updateNewsMeta(filteredNews().length)}finally{if(!silent&&b){b.textContent='更新完成';setTimeout(()=>{b.disabled=false;b.textContent='↻ 更新'},1200)}}}
$('#refreshNews').onclick=()=>refreshNewsData();
window.addEventListener('error',e=>{console.error(e.error||e.message);toast(`前端錯誤：${e.message||'未知錯誤'}`)});
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);toast(e.reason?.message||'操作失敗')});
let backendRetryTimer=null,wasOffline=false;
async function retryBackend(){
 const ok=await checkBackend();
 if(ok){
  if(wasOffline){toast('後端已恢復連線');await Promise.allSettled([loadStock(),loadRanking(false)])}
  wasOffline=false;clearTimeout(backendRetryTimer);backendRetryTimer=null;return;
 }
 wasOffline=true;clearTimeout(backendRetryTimer);backendRetryTimer=setTimeout(retryBackend,5000);
}
$$('#companyTabs button').forEach(b=>b.onclick=()=>{$$('#companyTabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.company-tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===b.dataset.tab))});
$$('#newsFilters button').forEach(b=>b.onclick=()=>{state.newsFilter=b.dataset.filter;$$('#newsFilters button').forEach(x=>x.classList.toggle('active',x===b));renderNews()});
$('#newsSort').onchange=e=>{state.newsSort=e.target.value;renderNews()};
let newsSearchTimer;$('#newsSearch').oninput=e=>{clearTimeout(newsSearchTimer);newsSearchTimer=setTimeout(()=>{state.newsQuery=e.target.value;renderNews()},180)};
$('#newsAutoRefresh').onchange=e=>{if(state.newsAutoTimer){clearInterval(state.newsAutoTimer);state.newsAutoTimer=null}if(e.target.checked){state.newsAutoTimer=setInterval(()=>refreshNewsData({silent:true}),5*60*1000);toast('新聞自動更新已開啟，每 5 分鐘更新')}else toast('新聞自動更新已關閉')};

async function init(){
 try{const v=await api('/api/version',{timeout:4000,retries:0});if(v.version!==APP_VERSION)toast(`前後端版本不同：前端 ${APP_VERSION}／後端 ${v.version}`)}catch{}
 const ok=await checkBackend();
 if(ok){await Promise.allSettled([loadStock(),loadRanking(false)])}
 else{
  wasOffline=true;toast('後端暫時未連線，將每 5 秒自動重試');
  $('#rankingList').innerHTML='<p class="ranking-loading">等待後端連線中…</p>';
  retryBackend();
 }
}
init().catch(e=>{toast(e.message);retryBackend()});
