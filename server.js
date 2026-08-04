import express from './lib/mini-express.js';
import jwt from './lib/jwt.js';
import { loadEnv } from './lib/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scrypt=promisify(crypto.scrypt);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
loadEnv(__dirname);
const DATA_FILE=process.env.DATA_FILE?path.resolve(process.env.DATA_FILE):path.join(__dirname,'data.json');
const CATALOG_FILE=process.env.CATALOG_FILE?path.resolve(process.env.CATALOG_FILE):path.join(__dirname,'catalog-cache.json');
const PORT=Number(process.env.PORT||3000);
const APP_VERSION='15.1.0';
const JWT_SECRET=process.env.JWT_SECRET||'development-only-change-me-please';
const app=express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','SAMEORIGIN');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 next();
});
app.use((req,res,next)=>{
 const configured=String(process.env.CORS_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const origin=String(req.headers.origin||'');
 const allowed=!origin||configured.length===0||configured.includes('*')||configured.includes(origin);
 if(allowed&&origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
 res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
 res.setHeader('Access-Control-Max-Age','86400');
 if(req.method==='OPTIONS')return res.sendStatus(204);
 if(!allowed)return res.status(403).json({error:'此來源未獲允許'});
 next();
});
app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname,{etag:false,lastModified:false,setHeaders:res=>res.setHeader('Cache-Control','no-store, no-cache, must-revalidate')}));

const EMPTY_DB={users:[],watchlists:[],alerts:[],notifications:[]};
const cache=new Map();
const inflight=new Map();
const providerHealth=new Map();
const nowIso=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const ttl={quote:Number(process.env.CACHE_TTL_QUOTE_MS||5000),search:Number(process.env.CACHE_TTL_SEARCH_MS||21600000),catalog:Number(process.env.CACHE_TTL_CATALOG_MS||86400000),fund:21600000,news:900000,history:900000,trends:3600000};
const getCache=k=>{const x=cache.get(k);if(!x||x.exp<=Date.now()){cache.delete(k);return null}return x.value};
const setCache=(k,v,t)=>{cache.set(k,{value:v,exp:Date.now()+t});return v};
function coalesce(key,worker){if(inflight.has(key))return inflight.get(key);const task=Promise.resolve().then(worker).finally(()=>inflight.delete(key));inflight.set(key,task);return task}
function withDeadline(promise,ms,label='operation'){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timeout`)),ms);timer.unref?.()})]).finally(()=>clearTimeout(timer))}
const mark=(name,ok,error='')=>providerHealth.set(name,{ok,error:String(error||'').slice(0,180),checkedAt:nowIso()});
const providers=()=>[...new Set(String(process.env.MARKET_PROVIDERS||'finnhub,twelve,fmp').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean))];
const normMarket=v=>['TW','CN','US'].includes(String(v).toUpperCase())?String(v).toUpperCase():'US';
const normSymbol=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9._:-]/g,'').slice(0,40);
const hasNumber=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));

const seed=[
 {market:'TW',symbol:'2330',name:'台積電',en:'Taiwan Semiconductor Manufacturing',exchange:'TWSE',industry:'半導體',currency:'TWD'},
 {market:'TW',symbol:'2317',name:'鴻海',en:'Hon Hai Precision',exchange:'TWSE',industry:'電子製造',currency:'TWD'},
 {market:'TW',symbol:'2454',name:'聯發科',en:'MediaTek',exchange:'TWSE',industry:'IC 設計',currency:'TWD'},
 {market:'CN',symbol:'600519',name:'貴州茅台',en:'Kweichow Moutai',exchange:'SSE',industry:'白酒',currency:'CNY'},
 {market:'CN',symbol:'000858',name:'五糧液',en:'Wuliangye',exchange:'SZSE',industry:'白酒',currency:'CNY'},
 {market:'CN',symbol:'300308',name:'中際旭創',en:'InnoLight',exchange:'SZSE',industry:'光通訊',currency:'CNY'},
 {market:'US',symbol:'AAPL',name:'Apple',en:'Apple Inc.',exchange:'NASDAQ',industry:'Consumer Electronics',currency:'USD'},
 {market:'US',symbol:'NVDA',name:'NVIDIA',en:'NVIDIA Corporation',exchange:'NASDAQ',industry:'Semiconductors',currency:'USD'},
 {market:'US',symbol:'MSFT',name:'Microsoft',en:'Microsoft Corporation',exchange:'NASDAQ',industry:'Software',currency:'USD'}
];
let catalog=[...seed];

function marketFrom(symbol='',exchange=''){
 const s=String(symbol).toUpperCase(),e=String(exchange).toUpperCase();
 if(/\.(TW|TWO)$/.test(s)||/TWSE|TPEX|TAIWAN|TAI/.test(e))return'TW';
 if(/\.(SS|SZ)$/.test(s)||/SHANGHAI|SHENZHEN|BEIJING|SSE|SZSE|BSE/.test(e))return'CN';
 return'US';
}
function cleanSymbol(s=''){return String(s).toUpperCase().replace(/\.(TW|TWO|SS|SZ)$/,'')}
function symbolCandidates(market,symbol){
 const s=cleanSymbol(symbol);
 if(market==='TW')return[`${s}.TW`,`${s}.TWO`,`${s}:TPE`,s];
 if(market==='CN'){
   if(/^6|^68/.test(s))return[`${s}.SS`,`${s}:SHH`,s];
   if(/^8|^4/.test(s))return[`${s}.BJ`,s];
   return[`${s}.SZ`,`${s}:SHZ`,s];
 }
 return[s];
}
function yahooSymbol(market,symbol,exchange=''){
 const s=cleanSymbol(symbol),e=String(exchange||'').toUpperCase();
 if(market==='TW')return `${s}.${e.includes('TPEX')||e.includes('OTC')?'TWO':'TW'}`;
 if(market==='CN'){
   if(/^6|^68/.test(s)||e.includes('SSE')||e.includes('SHANGHAI'))return `${s}.SS`;
   if(/^8|^4/.test(s)||e.includes('BSE')||e.includes('BEIJING'))return `${s}.BJ`;
   return `${s}.SZ`;
 }
 return s;
}
function tradingViewSymbol(row){
 const m=row.market||marketFrom(row.symbol,row.exchange),s=cleanSymbol(row.symbol),e=String(row.exchange||'').toUpperCase();
 if(m==='TW')return`${e.includes('TPEX')?'TPEX':'TWSE'}:${s}`;
 if(m==='CN')return`${(/^6|^68/.test(s)||e.includes('SSE'))?'SSE':(/^8|^4/.test(s)||e.includes('BSE'))?'BSE':'SZSE'}:${s}`;
 const ex=e.includes('NYSE')?'NYSE':e.includes('AMEX')?'AMEX':'NASDAQ';return`${ex}:${s}`;
}

function isChineseName(value=''){return /[\u3400-\u9fff]/.test(String(value||''))}

let twCatalogLoadedAt=0;
function twRowFromOfficial(x,exchange){
 const symbol=cleanSymbol(x['公司代號']||x.Code||x.SecuritiesCompanyCode||x.stock_id||'');
 const name=String(x['公司簡稱']||x['公司名稱']||x.CompanyName||x.stock_name||'').trim();
 if(!/^\d{4,6}$/.test(symbol)||!isChineseName(name))return null;
 return {market:'TW',symbol,name,en:String(x['英文簡稱']||x['英文名稱']||'').trim(),exchange,industry:String(x['產業別']||x.Industry||'股票').trim()||'股票',currency:'TWD',source:exchange==='TWSE'?'臺灣證券交易所':'證券櫃檯買賣中心',tradingView:tradingViewSymbol({market:'TW',symbol,exchange})};
}
async function ensureTwCatalog(force=false){
 if(!force&&Date.now()-twCatalogLoadedAt<ttl.catalog&&catalog.some(x=>x.market==='TW'&&isChineseName(x.name)))return catalog.filter(x=>x.market==='TW');
 const endpoints=[
  ['https://openapi.twse.com.tw/v1/opendata/t187ap03_L','TWSE'],
  ['https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','TPEX']
 ];
 let added=0;
 for(const [url,exchange] of endpoints){
  try{
   const data=await fetchJson(url,{timeout:12000});
   const rows=(Array.isArray(data)?data:[]).map(x=>twRowFromOfficial(x,exchange)).filter(Boolean);
   for(const row of rows){
    const old=catalog.find(v=>v.market==='TW'&&v.symbol===row.symbol);
    if(old)Object.assign(old,{...old,...row,en:old.en||row.en,industry:row.industry||old.industry});else catalog.push(row);
   }
   added+=rows.length;mark(`tw-catalog-${exchange.toLowerCase()}`,true);
  }catch(e){mark(`tw-catalog-${exchange.toLowerCase()}`,false,e.message)}
 }
 if(added){twCatalogLoadedAt=Date.now();catalog=dedupe(catalog);fs.writeFile(CATALOG_FILE,JSON.stringify({updatedAt:nowIso(),rows:catalog},null,2)).catch(()=>{});}
 return catalog.filter(x=>x.market==='TW');
}
async function twStockNameDetail(symbol){
 const s=cleanSymbol(symbol);await ensureTwCatalog();
 const row=catalog.find(x=>x.market==='TW'&&x.symbol===s&&isChineseName(x.name));
 if(!row)throw Error('Taiwan official stock name unavailable');
 return row;
}
async function twRemoteSearch(q){
 await ensureTwCatalog();
 const terms=String(q||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
 return catalog.filter(x=>x.market==='TW'&&isChineseName(x.name)&&terms.every(t=>[x.symbol,x.name,x.en,x.exchange,x.industry].some(v=>String(v||'').toLowerCase().includes(t)))).slice(0,50);
}
function cnExchange(symbol=''){
 const s=cleanSymbol(symbol);
 if(/^(6|68)/.test(s))return'SSE';
 if(/^(8|4)/.test(s))return'BSE';
 return'SZSE';
}
function cnStockCodeValid(symbol=''){return /^\d{6}$/.test(cleanSymbol(symbol))}
function eastmoneySuggestMarketToExchange(market='',code=''){
 const value=String(market||'').toLowerCase();
 if(value.includes('sh')||value==='1')return'SSE';
 if(value.includes('bj')||value==='2')return'BSE';
 if(value.includes('sz')||value==='0')return'SZSE';
 return cnExchange(code);
}
async function fetchTextEncoded(url,encoding='utf-8',options={}){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),options.timeout||8000);
 try{
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AlphaLens/13.3',Accept:'*/*',...(options.headers||{})},signal:c.signal});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  const buf=await r.arrayBuffer();return new TextDecoder(encoding).decode(buf);
 }finally{clearTimeout(timer)}
}
async function cnNameEastmoney(s){
 const fields='f57,f58,f107,f152';
 const d=await fetchJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(eastmoneySecid(s))}&fields=${fields}`,{timeout:9000,headers:{Referer:'https://quote.eastmoney.com/'}});
 const name=String(d?.data?.f58||'').trim();
 if(!name||name==='-'||!isChineseName(name))throw Error('Eastmoney A-share name empty');
 return{name,source:'東方財富'};
}
async function cnNameTencent(s){
 const prefix=/^(6|68)/.test(s)?'sh':/^(8|4)/.test(s)?'bj':'sz';
 const text=await fetchTextEncoded(`https://qt.gtimg.cn/q=${prefix}${s}`,'gbk',{timeout:8000,headers:{Referer:'https://gu.qq.com/'}});
 const body=(text.match(/="([\s\S]*?)"/)||[])[1]||'';
 const parts=body.split('~'),name=String(parts[1]||'').trim();
 if(!isChineseName(name))throw Error('Tencent A-share name empty');
 return{name,source:'騰訊財經'};
}
async function cnNameSuggest(s){
 const d=await fetchJson(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(s)}&type=14&count=10`,{timeout:9000,headers:{Referer:'https://www.eastmoney.com/'}});
 const raw=d?.QuotationCodeTable?.Data||d?.data||d?.result||[];
 const x=(Array.isArray(raw)?raw:[]).find(v=>cleanSymbol(v.Code||v.code||v.SecurityCode||v.symbol||'')===s);
 const name=String(x?.Name||x?.name||x?.SecurityName||x?.shortName||'').trim();
 if(!isChineseName(name))throw Error('Eastmoney suggest name empty');
 return{name,source:'東方財富搜尋'};
}
async function cnStockNameDetail(symbol){
 const s=cleanSymbol(symbol);
 if(!cnStockCodeValid(s))throw Error('invalid A-share symbol');
 const key=`cn-name:${s}`,hit=getCache(key);if(hit&&isChineseName(hit.name))return hit;
 let found=null,errors=[];
 for(const provider of [cnNameEastmoney,cnNameTencent,cnNameSuggest]){
  try{found=await provider(s);if(found)break}catch(e){errors.push(e.message)}
 }
 if(!found)throw Error(errors.join(' | ')||'A-share Chinese name unavailable');
 const row={market:'CN',symbol:s,name:found.name,en:'',exchange:cnExchange(s),industry:'股票',currency:'CNY',source:found.source,tradingView:tradingViewSymbol({market:'CN',symbol:s,exchange:cnExchange(s)})};
 const old=catalog.find(v=>v.market==='CN'&&v.symbol===s);
 if(old)Object.assign(old,{...old,...row,en:old.en||'',industry:old.industry||row.industry});else catalog=dedupe([...catalog,row]);
 fs.writeFile(CATALOG_FILE,JSON.stringify({updatedAt:nowIso(),rows:catalog},null,2)).catch(()=>{});
 return setCache(key,row,ttl.catalog);
}

async function cnRemoteSearch(q){
 const input=String(q||'').trim();if(!input)return[];
 const url=`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(input)}&type=14&count=30`;
 const d=await fetchJson(url,{timeout:9000,headers:{Referer:'https://www.eastmoney.com/'}});
 const raw=d?.QuotationCodeTable?.Data||d?.data||d?.result||[];
 const rows=(Array.isArray(raw)?raw:[]).map(x=>{
   const symbol=cleanSymbol(x.Code||x.code||x.SecurityCode||x.symbol||'');
   const name=String(x.Name||x.name||x.SecurityName||x.shortName||'').trim();
   const market=String(x.MktNum||x.Market||x.market||x.QuoteID||'');
   const exchange=eastmoneySuggestMarketToExchange(market,symbol);
   return {market:'CN',symbol,name,en:'',exchange,industry:x.SecurityTypeName||x.typeName||'股票',currency:'CNY',source:'東方財富搜尋',tradingView:tradingViewSymbol({market:'CN',symbol,exchange})};
 }).filter(x=>cnStockCodeValid(x.symbol)&&isChineseName(x.name)&&['SSE','SZSE','BSE'].includes(x.exchange));
 rows.forEach(row=>{const old=catalog.find(v=>v.market==='CN'&&v.symbol===row.symbol);if(old)Object.assign(old,{...row,industry:old.industry||row.industry});else catalog.push(row)});
 return dedupe(rows).slice(0,50);
}
async function resolveCatalogRow(m,s){
 let row=catalog.find(x=>x.market===m&&x.symbol===s);
 if(m==='TW'&&(!row||!isChineseName(row.name))){try{row=await twStockNameDetail(s)}catch{}}
 if(m==='CN'&&(!row||!isChineseName(row.name))){try{row=await cnStockNameDetail(s)}catch{}}
 return row||{market:m,symbol:s,name:s,tradingView:tradingViewSymbol({market:m,symbol:s})};
}

async function canonicalNameRow(m,s){
 const row=await resolveCatalogRow(m,cleanSymbol(s));
 return {...row,name:(m==='TW'||m==='CN')&&isChineseName(row.name)?row.name:(row.name||cleanSymbol(s))};
}
async function applyCanonicalName(m,s,value={}){
 const row=await canonicalNameRow(m,s);
 const incoming=String(value?.name||'').trim();
 const name=(m==='TW'||m==='CN')&&isChineseName(row.name)?row.name:(incoming||row.name||cleanSymbol(s));
 return {...value,market:m,symbol:cleanSymbol(s),name,exchange:value.exchange||row.exchange,tradingView:value.tradingView||row.tradingView,nameSource:row.source||'股票名稱引擎'};
}

function normalizeRow(r,source='remote'){
 const raw=r.symbol||r.displaySymbol||r.code||r.ticker||'';const exchange=r.exchangeShortName||r.exchange||r.mic||r.stockExchange||'';
 const market=marketFrom(raw,exchange);return{market,symbol:cleanSymbol(r.displaySymbol||raw),providerSymbol:raw,name:r.name||r.companyName||r.description||r.instrument_name||cleanSymbol(raw),en:r.companyName||r.description||r.name||'',exchange:exchange||market,industry:r.sector||r.industry||r.type||'股票',currency:r.currency||({TW:'TWD',CN:'CNY',US:'USD'}[market]),source,tradingView:tradingViewSymbol({market,symbol:cleanSymbol(raw),exchange})};
}
async function fetchJson(url,options={}){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),options.timeout||8000);
 try{
   const r=await fetch(url,{method:options.method||'GET',headers:{'User-Agent':'AlphaLens/6.3',Accept:'application/json',...(options.headers||{})},body:options.body,signal:c.signal});
   if(!r.ok)throw Error(`HTTP ${r.status}`);
   const d=await r.json();
   if(d?.status==='error'||d?.code===429||d?.error)throw Error(d.message||d.msg||d.error||'Provider error');
   return d;
 }finally{clearTimeout(timer)}
}
async function loadCatalog(){try{const x=JSON.parse(await fs.readFile(CATALOG_FILE,'utf8'));if(Array.isArray(x.rows))catalog=dedupe([...seed,...x.rows])}catch{}}
function dedupe(rows){const seen=new Set();return rows.filter(x=>{const k=`${x.market}:${x.symbol}`;if(!x.symbol||seen.has(k))return false;seen.add(k);return true})}
async function syncCatalog(){
 if(!process.env.FMP_API_KEY)return{ok:false,reason:'FMP key missing'};
 try{const rows=await fetchJson(`https://financialmodelingprep.com/stable/stock-list?apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`,{timeout:20000});
 const normalized=(Array.isArray(rows)?rows:[]).map(x=>normalizeRow(x,'fmp-catalog')).filter(x=>['TW','CN','US'].includes(x.market));
 catalog=dedupe([...seed,...normalized]);await fs.writeFile(CATALOG_FILE,JSON.stringify({updatedAt:nowIso(),rows:catalog},null,2));mark('catalog',true);return{ok:true,count:catalog.length};
 }catch(e){mark('catalog',false,e.message);return{ok:false,reason:e.message}}
}
function localSearch(q,market){const terms=q.toLowerCase().split(/\s+/).filter(Boolean);return catalog.filter(x=>x.market===market&&terms.every(t=>[x.symbol,x.name,x.en,x.exchange,x.industry].some(v=>String(v||'').toLowerCase().includes(t)))).slice(0,50)}
async function remoteSearch(q,market){const jobs=[];
 if(market==='TW')jobs.push((async()=>{try{const rows=await twRemoteSearch(q);mark('tw-official-search',true);return rows}catch(e){mark('tw-official-search',false,e.message);return[]}})());
 if(market==='CN')jobs.push((async()=>{try{const rows=await cnRemoteSearch(q);mark('eastmoney-search',true);return rows}catch(e){mark('eastmoney-search',false,e.message);return[]}})());
 if(process.env.FMP_API_KEY)jobs.push((async()=>{try{const [a,b]=await Promise.all([fetchJson(`https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(q)}&limit=50&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`),fetchJson(`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(q)}&limit=50&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`)]);mark('fmp',true);return[...(a||[]),...(b||[])].map(x=>normalizeRow(x,'fmp'))}catch(e){mark('fmp',false,e.message);return[]}})());
 if(process.env.TWELVE_DATA_API_KEY)jobs.push((async()=>{try{const d=await fetchJson(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=100&apikey=${encodeURIComponent(process.env.TWELVE_DATA_API_KEY)}`);mark('twelve',true);return(d.data||[]).map(x=>normalizeRow(x,'twelve'))}catch(e){mark('twelve',false,e.message);return[]}})());
 if(process.env.FINNHUB_API_KEY)jobs.push((async()=>{try{const d=await fetchJson(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`);mark('finnhub',true);return(d.result||[]).map(x=>normalizeRow(x,'finnhub'))}catch(e){mark('finnhub',false,e.message);return[]}})());
 const all=(await Promise.all(jobs)).flat().filter(x=>x.market===market);return dedupe(all).slice(0,50)
}

const demoPrice={TW:100,CN:50,US:100};
function demoQuote(m,s,name=s){const base=demoPrice[m]||100;return{market:m,symbol:s,name,exchange:m==='TW'?'TWSE':m==='CN'?'SSE/SZSE':'US',currency:m==='TW'?'TWD':m==='CN'?'CNY':'USD',price:base,open:base,high:base,low:base,previousClose:base,change:0,changePercent:0,volume:0,updatedAt:nowIso(),source:'demo',isDemo:true,warning:'找不到可用正式行情，這不是即時價格'}}
function quoteValid(q){return q&&Number.isFinite(Number(q.price))&&Number(q.price)>0}

function finite(...values){for(const v of values){const n=Number(v);if(Number.isFinite(n))return n}return null}
function microTimestampToIso(value){
 const n=Number(value);
 if(!Number.isFinite(n)||n<=0)return nowIso();
 const ms=n>1e15?n/1000:n>1e12?n:n*1000;
 return new Date(ms).toISOString();
}
async function quoteFugle(m,s,row){
 if(m!=='TW'||!process.env.FUGLE_API_KEY)throw Error('unsupported');
 const d=await fetchJson(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(cleanSymbol(s))}`,{
   timeout:8000,headers:{'X-API-KEY':process.env.FUGLE_API_KEY}
 });
 const p=finite(d.lastPrice,d.closePrice,d.lastTrade?.price);
 const pc=finite(d.previousClose,d.referencePrice);
 const q={...row,market:m,symbol:cleanSymbol(s),name:d.name||row?.name||s,exchange:d.exchange||row?.exchange||'TWSE/TPEx',currency:'TWD',
   price:p,open:finite(d.openPrice),high:finite(d.highPrice),low:finite(d.lowPrice),previousClose:pc,
   change:finite(d.change,p!=null&&pc!=null?p-pc:null),changePercent:finite(d.changePercent,p!=null&&pc?((p-pc)/pc*100):null),
   volume:finite(d.total?.tradeVolume,0),updatedAt:microTimestampToIso(d.lastUpdated||d.closeTime||d.lastTrade?.time),
   source:'Fugle 即時行情',providerSymbol:cleanSymbol(s),isDemo:false,isRealtime:true};
 if(!quoteValid(q))throw Error('empty Fugle quote');
 return q;
}
async function quoteFinMind(m,s,row){
 if(m!=='TW'||!process.env.FINMIND_TOKEN)throw Error('unsupported');
 const end=new Date().toISOString().slice(0,10);
 const start=new Date(Date.now()-14*86400000).toISOString().slice(0,10);
 const url=`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(cleanSymbol(s))}&start_date=${start}&end_date=${end}&token=${encodeURIComponent(process.env.FINMIND_TOKEN)}`;
 const d=await fetchJson(url,{timeout:10000});
 const rows=Array.isArray(d.data)?d.data:[];
 const x=rows.at(-1);
 if(!x)throw Error('empty FinMind quote');
 const p=finite(x.close,x.Close);
 const pc=rows.length>1?finite(rows.at(-2)?.close,rows.at(-2)?.Close):null;
 const q={...row,market:m,symbol:cleanSymbol(s),name:row?.name||s,exchange:row?.exchange||'TWSE/TPEx',currency:'TWD',
   price:p,open:finite(x.open,x.Open),high:finite(x.max,x.high,x.High),low:finite(x.min,x.low,x.Low),previousClose:pc,
   change:p!=null&&pc!=null?p-pc:null,changePercent:p!=null&&pc?((p-pc)/pc*100):null,
   volume:finite(x.Trading_Volume,x.volume,0),updatedAt:x.date?new Date(`${x.date}T13:30:00+08:00`).toISOString():nowIso(),
   source:'FinMind 日行情備援',providerSymbol:cleanSymbol(s),isDemo:false,isRealtime:false,isUnofficial:false,warning:'FinMind 此端點為日行情，盤中可能不是最新成交價'};
 if(!quoteValid(q))throw Error('empty FinMind quote');
 return q;
}
function allTickCode(symbol){
 const s=cleanSymbol(symbol);
 if(/^6|^68/.test(s))return`${s}.SH`;
 if(/^8|^4/.test(s))return`${s}.BJ`;
 return`${s}.SZ`;
}
async function quoteAllTick(m,s,row){
 if(m!=='CN'||!process.env.ALLTICK_TOKEN)throw Error('unsupported');
 const code=allTickCode(s);
 const query=JSON.stringify({data:{code,kline_type:'1',kline_timestamp_end:'0',query_kline_num:'2',adjust_type:'0'}});
 const d=await fetchJson(`https://quote.alltick.io/quote-stock-b-api/kline?token=${encodeURIComponent(process.env.ALLTICK_TOKEN)}&query=${encodeURIComponent(query)}`,{timeout:10000});
 const list=d?.data?.kline_list||d?.data?.list||d?.data?.klineList||d?.data||[];
 const rows=Array.isArray(list)?list:[];
 const x=rows.at(-1)||d?.data?.[code]||d?.data;
 const prev=rows.length>1?rows.at(-2):null;
 const p=finite(x?.close_price,x?.close,x?.c,x?.price,x?.last_price);
 const pc=finite(prev?.close_price,prev?.close,prev?.c,x?.prev_close_price,x?.previous_close);
 const q={...row,market:m,symbol:cleanSymbol(s),name:row?.name||s,exchange:row?.exchange||(/^6|^68/.test(cleanSymbol(s))?'SSE':/^8|^4/.test(cleanSymbol(s))?'BSE':'SZSE'),currency:'CNY',
   price:p,open:finite(x?.open_price,x?.open,x?.o),high:finite(x?.high_price,x?.high,x?.h),low:finite(x?.low_price,x?.low,x?.l),previousClose:pc,
   change:p!=null&&pc!=null?p-pc:null,changePercent:p!=null&&pc?((p-pc)/pc*100):null,
   volume:finite(x?.volume,x?.vol,x?.v,0),updatedAt:microTimestampToIso(x?.timestamp||x?.time||x?.kline_timestamp),
   source:'AllTick A股行情',providerSymbol:code,isDemo:false,isRealtime:true};
 if(!quoteValid(q))throw Error('empty AllTick quote');
 return q;
}

async function quoteFinnhub(m,s,row){if(!process.env.FINNHUB_API_KEY||m!=='US')throw Error('unsupported');const d=await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`);const q={...row,market:m,symbol:s,price:+d.c,open:+d.o,high:+d.h,low:+d.l,previousClose:+d.pc,change:+d.d,changePercent:+d.dp,volume:0,updatedAt:d.t?new Date(d.t*1000).toISOString():nowIso(),source:'Finnhub',isDemo:false};if(!quoteValid(q))throw Error('empty quote');return q}
async function quoteTwelve(m,s,row){if(!process.env.TWELVE_DATA_API_KEY)throw Error('missing key');let last;for(const candidate of symbolCandidates(m,s)){try{const d=await fetchJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(candidate)}&apikey=${encodeURIComponent(process.env.TWELVE_DATA_API_KEY)}`);const p=+d.close;const pc=+d.previous_close;const q={...row,market:m,symbol:s,name:d.name||row?.name||s,exchange:d.exchange||row?.exchange||m,currency:d.currency||row?.currency,price:p,open:+d.open,high:+d.high,low:+d.low,previousClose:pc,change:+d.change||p-pc,changePercent:+d.percent_change||((p-pc)/pc*100),volume:+d.volume||0,updatedAt:d.timestamp?new Date(d.timestamp*1000).toISOString():nowIso(),source:'Twelve Data',providerSymbol:candidate,isDemo:false};if(quoteValid(q))return q}catch(e){last=e}}throw last||Error('empty quote')}
async function quoteFmp(m,s,row){if(!process.env.FMP_API_KEY)throw Error('missing key');let last;for(const candidate of symbolCandidates(m,s)){try{const d=await fetchJson(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(candidate)}&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`);const x=Array.isArray(d)?d[0]:d;const q={...row,market:m,symbol:s,name:x?.name||row?.name||s,exchange:x?.exchange||row?.exchange||m,currency:row?.currency,price:+x?.price,open:+x?.open,high:+x?.dayHigh,low:+x?.dayLow,previousClose:+x?.previousClose,change:+x?.change,changePercent:+x?.changePercentage,volume:+x?.volume||0,updatedAt:nowIso(),source:'FMP',providerSymbol:candidate,isDemo:false};if(quoteValid(q))return q}catch(e){last=e}}throw last||Error('empty quote')}
async function quoteYahoo(m,s,row){
 const providerSymbol=yahooSymbol(m,s,row?.exchange);
 const d=await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?interval=1m&range=1d&includePrePost=false`,{timeout:8000});
 const result=d?.chart?.result?.[0];
 const meta=result?.meta||{};
 const stamps=result?.timestamp||[];
 const quote=result?.indicators?.quote?.[0]||{};
 let idx=stamps.length-1;
 while(idx>=0&&!Number.isFinite(Number(quote.close?.[idx])))idx--;
 const p=idx>=0?Number(quote.close[idx]):Number(meta.regularMarketPrice);
 const pc=Number(meta.chartPreviousClose??meta.previousClose??meta.regularMarketPreviousClose);
 const open=Number(meta.regularMarketOpen??quote.open?.[idx]);
 const high=Number(meta.regularMarketDayHigh??quote.high?.[idx]);
 const low=Number(meta.regularMarketDayLow??quote.low?.[idx]);
 const ts=stamps[idx]||meta.regularMarketTime||Math.floor(Date.now()/1000);
 const q={...row,market:m,symbol:s,name:meta.longName||meta.shortName||row?.name||s,exchange:meta.exchangeName||row?.exchange||m,currency:meta.currency||row?.currency,price:p,open,high,low,previousClose:pc,change:Number.isFinite(pc)?p-pc:null,changePercent:Number.isFinite(pc)&&pc?((p-pc)/pc*100):null,volume:Number(meta.regularMarketVolume??quote.volume?.[idx]??0),updatedAt:new Date(ts*1000).toISOString(),source:'Yahoo Finance 備援',providerSymbol,isDemo:false,isUnofficial:true,warning:'免費非官方備援，行情可能延遲'};
 if(!quoteValid(q))throw Error('empty Yahoo quote');
 return q;
}

function quoteAgeSeconds(q){
 const t=Date.parse(q?.updatedAt||'');
 return Number.isFinite(t)?Math.max(0,(Date.now()-t)/1000):999999;
}
function quoteQuality(q){
 if(!quoteValid(q))return -Infinity;
 const age=quoteAgeSeconds(q);
 let score=q.isRealtime?100:60;
 score-=Math.min(55,age/60);
 if(q.isDemo)score-=1000;
 if(q.isUnofficial)score-=8;
 if(hasNumber(q.volume)&&+q.volume>0)score+=3;
 return score;
}
function withFreshness(q){
 const ageSeconds=Math.round(quoteAgeSeconds(q)),raw=quoteQuality(q);
 return {...q,ageSeconds,qualityScore:Number.isFinite(raw)?Math.max(0,Math.min(100,Math.round(raw))):0,freshness:q.isDemo?'展示資料':ageSeconds<=20?'即時':ageSeconds<=180?'接近即時':ageSeconds<=1200?'延遲':'舊資料'};
}
async function quoteTwseMis(m,s,row){
 if(m!=='TW')throw Error('unsupported');
 const code=cleanSymbol(s),preferred=String(row?.exchange||'').toUpperCase().includes('OTC')?'otc':'tse';
 let last;
 for(const ex of [preferred,preferred==='tse'?'otc':'tse']){
  try{
   const d=await fetchJson(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}_${encodeURIComponent(code)}.tw&json=1&delay=0`,{timeout:6500,headers:{Referer:'https://mis.twse.com.tw/stock/fibest.jsp'}});
   const x=d?.msgArray?.[0];if(!x)throw Error('empty TWSE MIS quote');
   const p=finite(x.z,x.y,x.o),pc=finite(x.y),q={...row,market:m,symbol:code,name:x.n||x.nf||row?.name||code,exchange:ex==='tse'?'TWSE':'TPEx',currency:'TWD',price:p,open:finite(x.o),high:finite(x.h),low:finite(x.l),previousClose:pc,change:p!=null&&pc!=null?p-pc:null,changePercent:p!=null&&pc?((p-pc)/pc*100):null,volume:finite(x.v,x.tv,0),updatedAt:x.tlong?new Date(Number(x.tlong)).toISOString():nowIso(),source:'證交所 MIS 即時行情',providerSymbol:`${ex}_${code}.tw`,isDemo:false,isRealtime:true};
   if(!quoteValid(q))throw Error('empty TWSE MIS price');return q;
  }catch(e){last=e}
 }
 throw last||Error('TWSE MIS unavailable');
}
async function quoteEastmoney(m,s,row){
 if(m!=='CN')throw Error('unsupported');
 const fields='f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f170';
 const d=await fetchJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(eastmoneySecid(s))}&fields=${fields}`,{timeout:6500,headers:{Referer:'https://quote.eastmoney.com/'}});
 const x=d?.data;if(!x)throw Error('empty EastMoney quote');
 const scale=v=>Number.isFinite(Number(v))?Number(v)/100:null,p=scale(x.f43),pc=scale(x.f60);
 const q={...row,market:m,symbol:cleanSymbol(s),name:x.f58||row?.name||s,exchange:/^(6|68)/.test(cleanSymbol(s))?'SSE':/^(4|8)/.test(cleanSymbol(s))?'BSE':'SZSE',currency:'CNY',price:p,open:scale(x.f46),high:scale(x.f44),low:scale(x.f45),previousClose:pc,change:p!=null&&pc!=null?p-pc:null,changePercent:Number.isFinite(Number(x.f170))?Number(x.f170)/100:null,volume:finite(x.f47,0),updatedAt:x.f86?new Date(Number(x.f86)*1000).toISOString():nowIso(),source:'東方財富即時行情',providerSymbol:eastmoneySecid(s),isDemo:false,isRealtime:true};
 if(!quoteValid(q))throw Error('empty EastMoney price');return q;
}
async function quoteStooq(m,s,row){
 if(m!=='US')throw Error('unsupported');
 const symbol=`${cleanSymbol(s).toLowerCase()}.us`;
 const r=await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`,{headers:{'User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw Error(`Stooq ${r.status}`);const text=await r.text(),lines=text.trim().split(/\r?\n/);if(lines.length<2)throw Error('empty Stooq quote');
 const cols=lines[1].split(','),[sym,date,time,open,high,low,close,volume]=cols,p=Number(close);
 const q={...row,market:m,symbol:cleanSymbol(s),name:row?.name||s,exchange:row?.exchange||'US',currency:'USD',price:p,open:Number(open),high:Number(high),low:Number(low),previousClose:null,change:null,changePercent:null,volume:Number(volume)||0,updatedAt:date&&time?new Date(`${date}T${time}Z`).toISOString():nowIso(),source:'Stooq 備援行情',providerSymbol:symbol,isDemo:false,isRealtime:false,isUnofficial:true,warning:'Stooq 為延遲備援來源'};
 if(!quoteValid(q))throw Error('empty Stooq price');return q;
}
const providerFns={fugle:quoteFugle,twse:quoteTwseMis,finmind:quoteFinMind,alltick:quoteAllTick,eastmoney:quoteEastmoney,finnhub:quoteFinnhub,twelve:quoteTwelve,fmp:quoteFmp,yahoo:quoteYahoo,stooq:quoteStooq};
function marketProviderOrder(m){
 const defaults=m==='TW'?['fugle','twse','twelve','fmp','yahoo','finmind']:m==='CN'?['alltick','eastmoney','twelve','fmp','yahoo']:['finnhub','twelve','fmp','yahoo','stooq'];
 return defaults.sort((a,b)=>{const A=providerHealth.get(a),B=providerHealth.get(b);return (B?.ok?1:0)-(A?.ok?1:0)});
}
async function hedgedQuote(m,s,row){
 const order=marketProviderOrder(m),errors=[];
 // Providers are attempted in small waves. This avoids continuing every backup
 // request after a fast provider has already succeeded, reducing rate limits and stalls.
 for(let i=0;i<order.length;i+=2){
  const wave=order.slice(i,i+2);
  const settled=await Promise.allSettled(wave.map(name=>withDeadline(providerFns[name](m,s,row),8500,`quote-${name}`)));
  for(let j=0;j<settled.length;j++){
   const name=wave[j],result=settled[j];
   if(result.status==='fulfilled'&&quoteValid(result.value)){mark(name,true);return withFreshness(result.value)}
   const message=result.status==='rejected'?(result.reason?.message||'failed'):'invalid quote';mark(name,false,message);errors.push(`${name}: ${message}`);
  }
 }
 throw Error(errors.join(' | ')||'no provider');
}

async function getQuote(m,s,{force=false}={}){
 const key=`q:${m}:${s}`;
 if(force)cache.delete(key);
 const hit=getCache(key);if(hit)return hit;
 return coalesce(`quote:${m}:${s}`,async()=>{
  const cached=getCache(key);if(cached&&!force)return cached;
  const testMode=String(process.env.ALPHALENS_TEST_MODE||'')==='1';
  const row=testMode?(catalog.find(x=>x.market===m&&x.symbol===s)||normalizeRow({market:m,symbol:s,name:s,exchange:m==='TW'?'TWSE':m==='CN'?cnExchange(s):'NASDAQ',industry:'測試產業'})):await resolveCatalogRow(m,s);
  if(testMode)return setCache(key,await applyCanonicalName(m,s,withFreshness(demoQuote(m,s,row.name))),ttl.quote);
  try{
   const q=await hedgedQuote(m,s,row);
   const named=await applyCanonicalName(m,s,q);
   return setCache(key,named,ttl.quote);
  }catch(e){
   mark('price-engine',false,e.message);
   return setCache(key,await applyCanonicalName(m,s,withFreshness(demoQuote(m,s,row.name))),ttl.quote);
  }
 });
}

async function getHistory(m,s,range='1M'){
 const key=`h:${m}:${s}:${range}`;const hit=getCache(key);if(hit)return hit;const days={'1D':5,'5D':10,'1M':35,'6M':190,'1Y':370,'5Y':1900}[range]||35;
 if(String(process.env.ALPHALENS_TEST_MODE||'')==='1'){const q=await getQuote(m,s);const rows=Array.from({length:60},(_,i)=>{const wave=Math.sin(i/5)*0.012+(i-30)/1800,v=q.price*(1+wave);return{time:new Date(Date.now()-(59-i)*86400000).toISOString().slice(0,10),open:v*.997,high:v*1.008,low:v*.992,close:v,volume:100000+i*2500}});return setCache(key,{rows,source:'測試行情資料',isDemo:true},ttl.history)}

 if(process.env.FMP_API_KEY){for(const candidate of symbolCandidates(m,s)){try{const to=new Date(),from=new Date(Date.now()-days*86400000);const fmt=d=>d.toISOString().slice(0,10);const d=await fetchJson(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(candidate)}&from=${fmt(from)}&to=${fmt(to)}&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`);const rows=(d.historical||d||[]).map(x=>({time:x.date,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>x.time&&x.close).sort((a,b)=>a.time.localeCompare(b.time));if(rows.length)return setCache(key,{rows,source:'FMP'},ttl.history)}catch{}}}
 if(process.env.TWELVE_DATA_API_KEY){for(const candidate of symbolCandidates(m,s)){try{const interval=range==='1D'?'5min':range==='5D'?'30min':'1day';const d=await fetchJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(candidate)}&interval=${interval}&outputsize=500&apikey=${encodeURIComponent(process.env.TWELVE_DATA_API_KEY)}`);const rows=(d.values||[]).map(x=>({time:x.datetime,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).reverse();if(rows.length)return setCache(key,{rows,source:'Twelve Data'},ttl.history)}catch{}}}
 if(m==='TW'||m==='CN'){try{const row=catalog.find(x=>x.market===m&&x.symbol===s)||{};const candidate=yahooSymbol(m,s,row.exchange);const interval=range==='1D'?'5m':range==='5D'?'15m':'1d';const period=range==='1D'?'1d':range==='5D'?'5d':range==='1M'?'1mo':range==='6M'?'6mo':range==='1Y'?'1y':'5y';const d=await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?interval=${interval}&range=${period}`,{timeout:8000});const r=d?.chart?.result?.[0];const stamps=r?.timestamp||[];const q=r?.indicators?.quote?.[0]||{};const rows=stamps.map((t,i)=>({time:new Date(t*1000).toISOString(),open:+q.open?.[i],high:+q.high?.[i],low:+q.low?.[i],close:+q.close?.[i],volume:+q.volume?.[i]||0})).filter(x=>Number.isFinite(x.close));if(rows.length)return setCache(key,{rows,source:'Yahoo Finance 備援',isUnofficial:true,warning:'免費非官方備援，行情可能延遲'},ttl.history)}catch(e){mark('yahoo',false,e.message)}}
 const q=await getQuote(m,s);const rows=Array.from({length:60},(_,i)=>{const v=q.price*(1+(i-30)/1000);return{time:new Date(Date.now()-(59-i)*86400000).toISOString().slice(0,10),open:v*.997,high:v*1.008,low:v*.992,close:v,volume:0}});return{rows,source:'demo',isDemo:true}
}


const COMPANY_ALIASES={
 'TW:2330':['台積電','台灣積體電路製造','TSMC','Taiwan Semiconductor Manufacturing'],
 'TW:2317':['鴻海','鴻海精密','Foxconn','Hon Hai Precision'],
 'TW:2454':['聯發科','MediaTek'],
 'CN:600519':['貴州茅台','贵州茅台','Kweichow Moutai'],
 'CN:300750':['寧德時代','宁德时代','CATL','Contemporary Amperex Technology'],
 'CN:002594':['比亞迪','比亚迪','BYD'],
 'US:AAPL':['Apple','Apple Inc'],
 'US:MSFT':['Microsoft','Microsoft Corporation'],
 'US:NVDA':['NVIDIA','Nvidia Corporation']
};
function normalizeCompanyName(value=''){
 return String(value).toLowerCase()
  .replace(/&amp;/g,'&')
  .replace(/[()（）\[\]【】.,，。·•'"]/g,'')
  .replace(/\b(incorporated|corporation|company|limited|holdings?|group|plc|inc|corp|ltd|co)\b/g,'')
  .replace(/(股份有限公司|股份|有限公司|公司|集團|集团|控股|企業|企业)/g,'')
  .replace(/\s+/g,'')
  .trim();
}
function expectedCompanyNames(row,m,s){
 const names=[row?.name,row?.en,...(COMPANY_ALIASES[`${m}:${s}`]||[])].filter(Boolean);
 return [...new Set(names.map(String))];
}
function nameSimilarity(expected='',actual=''){
 const a=normalizeCompanyName(expected),b=normalizeCompanyName(actual);
 if(!a||!b)return 0;
 if(a===b)return 1;
 if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length)+0.25;
 const chars=new Set(a);
 let common=0;
 for(const c of b)if(chars.has(c))common++;
 return common/Math.max(a.length,b.length);
}
function profileMatches({providerName='',providerSymbol='',title='',description=''},row,m,s){
 const expected=expectedCompanyNames(row,m,s);
 const actualNames=[providerName,title].filter(Boolean);
 const symbolClean=cleanSymbol(providerSymbol||'');
 const expectedSymbol=cleanSymbol(s);
 const symbolMatch=symbolClean&&expectedSymbol&&(symbolClean===expectedSymbol||symbolClean.startsWith(expectedSymbol+'.'));
 let best=0,matchedName='';
 for(const e of expected)for(const a of actualNames){
  const score=nameSimilarity(e,a);
  if(score>best){best=score;matchedName=e}
 }
 const text=normalizeCompanyName(`${title} ${description}`);
 const textMatch=expected.some(e=>{
  const n=normalizeCompanyName(e);
  return n.length>=2&&text.includes(n);
 });
 const passed=Boolean(symbolMatch||best>=0.72||(best>=0.5&&textMatch));
 return {passed,score:Math.max(best,symbolMatch?1:0),symbolMatch:Boolean(symbolMatch),matchedName};
}
function verifiedProfile(profile,verification){
 return {...profile,verified:true,matchScore:+verification.score.toFixed(2),verification:'股票代號與公司名稱已核對'};
}


const COMPANY_KNOWLEDGE={
 'TW:2330':{founded:'1987',headquarters:'新竹市',chairman:'魏哲家',products:['晶圓代工','先進製程','CoWoS 先進封裝','車用晶片製造'],competitors:['Samsung Foundry','Intel Foundry','GlobalFoundries'],supplyChain:['ASML','應用材料','日月光投控','創意電子']},
 'TW:2317':{founded:'1974',headquarters:'新北市',chairman:'劉揚偉',products:['電子代工服務','伺服器製造','電動車平台','消費電子組裝'],competitors:['和碩','廣達','緯創'],supplyChain:['Apple','NVIDIA','台積電','群創']},
 'TW:2454':{founded:'1997',headquarters:'新竹市',chairman:'蔡明介',products:['手機晶片','Wi‑Fi 晶片','智慧電視晶片','車用晶片'],competitors:['Qualcomm','Broadcom','Realtek'],supplyChain:['台積電','日月光投控','三星電子']},
 'CN:600519':{founded:'1999',headquarters:'貴州省仁懷市',chairman:'張德芹',products:['茅台酒','系列白酒','品牌授權與銷售'],competitors:['五糧液','瀘州老窖','山西汾酒'],supplyChain:['高粱種植供應商','包材供應商','經銷通路']},
 'CN:300750':{founded:'2011',headquarters:'福建省寧德市',chairman:'曾毓群',products:['動力電池','儲能系統','電池管理系統','換電解決方案'],competitors:['比亞迪','LG Energy Solution','Panasonic Energy'],supplyChain:['鋰礦供應商','正極材料廠','特斯拉','吉利汽車']},
 'CN:002594':{founded:'1995',headquarters:'廣東省深圳市',chairman:'王傳福',products:['新能源汽車','動力電池','軌道交通','電子零組件'],competitors:['Tesla','吉利汽車','上汽集團'],supplyChain:['半導體供應商','鋰電材料供應商','汽車零件供應商']},
 'US:AAPL':{founded:'1976',headquarters:'Cupertino, California',chairman:'Arthur Levinson',products:['iPhone','Mac','iPad','Apple Watch','服務業務'],competitors:['Samsung Electronics','Microsoft','Alphabet'],supplyChain:['台積電','鴻海','Sony','Broadcom']},
 'US:MSFT':{founded:'1975',headquarters:'Redmond, Washington',chairman:'Satya Nadella',products:['Windows','Microsoft 365','Azure','Xbox','AI 服務'],competitors:['Amazon','Alphabet','Oracle'],supplyChain:['OpenAI','NVIDIA','Dell','Accenture']},
 'US:NVDA':{founded:'1993',headquarters:'Santa Clara, California',chairman:'Jensen Huang',products:['GPU','AI 加速器','網路晶片','CUDA 軟體平台'],competitors:['AMD','Intel','Broadcom'],supplyChain:['台積電','SK hynix','Micron','日月光投控']}
};
const INDUSTRY_KNOWLEDGE={
 '半導體':{icon:'晶',products:['半導體產品','晶片設計或製造','先進製程服務'],competitors:['同產業大型公司','區域性競爭者'],supplyChain:['晶圓製造','封裝測試','設備與材料供應商']},
 'IC 設計':{icon:'IC',products:['IC 設計','通訊晶片','消費電子晶片'],competitors:['國際 IC 設計公司','同類型晶片供應商'],supplyChain:['晶圓代工','封裝測試','電子品牌客戶']},
 '銀行':{icon:'銀',products:['存放款業務','財富管理','企業金融'],competitors:['大型商業銀行','區域銀行'],supplyChain:['企業客戶','金融科技服務商','支付清算機構']},
 '金融':{icon:'金',products:['銀行服務','保險與資產管理','證券投資'],competitors:['大型金融控股公司'],supplyChain:['金融科技公司','企業與個人客戶']},
 '新能源電池':{icon:'電',products:['動力電池','儲能設備','電池管理系統'],competitors:['全球電池製造商'],supplyChain:['鋰礦與材料商','汽車製造商','儲能客戶']},
 '新能源車':{icon:'車',products:['電動車','電池系統','智慧車載設備'],competitors:['全球新能源車品牌'],supplyChain:['電池供應商','汽車零件商','經銷通路']},
 '白酒':{icon:'酒',products:['高端白酒','系列酒產品','品牌與通路'],competitors:['中國主要白酒品牌'],supplyChain:['農產原料','包裝材料','經銷商']},
 '軟體與雲端':{icon:'雲',products:['企業軟體','雲端服務','人工智慧服務'],competitors:['大型雲端平台與軟體公司'],supplyChain:['資料中心設備商','晶片供應商','企業客戶']},
 '消費電子':{icon:'果',products:['消費電子產品','軟體與服務','穿戴裝置'],competitors:['全球消費電子品牌'],supplyChain:['晶片供應商','代工廠','零組件供應商']}
};
function companyKnowledge(row,m,s,profile={}){
 const known=COMPANY_KNOWLEDGE[`${m}:${s}`]||{};
 const industry=profile.industry||row?.industry||'未分類';
 const generic=INDUSTRY_KNOWLEDGE[industry]||{icon:m==='TW'?'台':m==='CN'?'A':'US',products:[`${industry}相關產品與服務`],competitors:[`${industry}同業公司`],supplyChain:[`${industry}上游供應商`,`${industry}下游客戶`]};
 const choose=(actual,verified,genericValue)=>Array.isArray(actual)&&actual.length?actual:Array.isArray(verified)&&verified.length?verified:genericValue;
 const fields={
  founded:profile.founded||known.founded||'',headquarters:profile.headquarters||known.headquarters||profile.country||'',
  chairman:profile.chairman||profile.ceo||known.chairman||'',
  products:choose(profile.products,known.products,generic.products),competitors:choose(profile.competitors,known.competitors,generic.competitors),
  supplyChain:choose(profile.supplyChain,known.supplyChain,generic.supplyChain),customers:choose(profile.customers,known.customers,[]),
  globalFootprint:choose(profile.globalFootprint,known.globalFootprint,[]),icon:generic.icon||'企'
 };
 const completed=[profile.description,industry,profile.exchange,profile.country,profile.website,profile.logo,fields.founded,fields.headquarters,fields.chairman,profile.employees,fields.products?.length,fields.competitors?.length,fields.supplyChain?.length,fields.customers?.length,profile.filings?.length].filter(Boolean).length;
 const sourceCount=Array.isArray(profile.sources)?profile.sources.filter(x=>x.ok!==false).length:profile.source?1:0;
 const dataNature=sourceCount>=2?'多來源整合並交叉核對':sourceCount===1?'單一公開來源與產業資料補充':COMPANY_KNOWLEDGE[`${m}:${s}`]?'本地已核對資料':'依產業分類推定';
 return {...fields,completeness:Math.min(100,Math.round(completed/15*100)),dataNature};
}
function enrichCompanyProfile(profile,row,m,s){return {...profile,...companyKnowledge(row,m,s,profile),market:m,symbol:s,displayName:row?.name||profile.name||s}}

function profileFallback(row,m,s){
 const industry=row?.industry||'未分類';
 const name=row?.name||s;
 const marketName=m==='TW'?'台灣證券市場':m==='CN'?'中國 A 股市場':'美國證券市場';
 return {market:m,symbol:s,name,exchange:row?.exchange||marketName,industry,
  country:m==='TW'?'台灣':m==='CN'?'中國':'美國',website:'',logo:'',
  description:`${name} 為 ${marketName} 上市公司，所屬產業為「${industry}」。目前資料來源未提供更完整的公司業務介紹。`,
  source:'本地股票目錄',isFallback:true,verified:true,matchScore:1,verification:'使用目前股票目錄的名稱與產業，避免錯配'};
}
async function profileFmp(m,s,row){
 if(!process.env.FMP_API_KEY)throw Error('missing FMP key');
 for(const candidate of symbolCandidates(m,s)){
  const d=await fetchJson(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(candidate)}&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`,{timeout:9000});
  const x=Array.isArray(d)?d[0]:d;
  if(!x||( !x.companyName && !x.description))continue;
  const check=profileMatches({providerName:x.companyName,providerSymbol:x.symbol||candidate,description:x.description},row,m,s);
  if(!check.passed){
   mark('profile-fmp-mismatch',false,`expected ${row?.name||s}, got ${x.companyName||x.symbol||candidate}`);
   continue;
  }
  return verifiedProfile({
   market:m,symbol:s,name:row?.name||x.companyName||s,
   providerName:x.companyName||'',
   exchange:row?.exchange||x.exchangeFullName||x.exchange||m,
   industry:x.industry||x.sector||row?.industry||'未分類',sector:x.sector||'',
   country:x.country||'',website:x.website||'',logo:x.image||'',
   employees:x.fullTimeEmployees||null,ceo:x.ceo||'',
   description:x.description||`${row?.name||x.companyName||s} 所屬產業為 ${x.industry||x.sector||'未分類'}。`,
   source:'Financial Modeling Prep',sourceUrl:x.website||'',isFallback:false
  },check);
 }
 throw Error('FMP profile mismatch or empty');
}
async function profileFinnhub(m,s,row){
 if(m!=='US'||!process.env.FINNHUB_API_KEY)throw Error('unsupported');
 const x=await fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(cleanSymbol(s))}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`,{timeout:9000});
 if(!x?.name)throw Error('empty Finnhub profile');
 const check=profileMatches({providerName:x.name,providerSymbol:x.ticker||s,description:`${x.name} ${x.finnhubIndustry||''}`},row,m,s);
 if(!check.passed)throw Error(`Finnhub profile mismatch: ${x.name}`);
 return verifiedProfile({
  market:m,symbol:s,name:row?.name||x.name||s,providerName:x.name,
  exchange:row?.exchange||x.exchange||'US',
  industry:x.finnhubIndustry||row?.industry||'未分類',country:x.country||'',website:x.weburl||'',logo:x.logo||'',
  employees:null,ceo:'',
  description:`${row?.name||x.name} 主要從事 ${x.finnhubIndustry||row?.industry||'相關產業'} 業務。公司於 ${x.exchange||'美國市場'} 交易。`,
  source:'Finnhub',sourceUrl:x.weburl||'',isFallback:false
 },check);
}

function wikiLanguage(m){return m==='TW'?'zh':m==='CN'?'zh':'en'}
async function profileWikipedia(m,s,row){
 const lang=wikiLanguage(m);
 const expected=expectedCompanyNames(row,m,s);
 const query=`"${row?.name||s}" ${s} 股票 公司`;
 const searchUrl=`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=10&format=json&origin=*`;
 const search=await fetchJson(searchUrl,{timeout:9000});
 const candidates=search?.query?.search||[];
 if(!candidates.length)throw Error('Wikipedia search empty');

 const scored=candidates.map(item=>{
  const check=profileMatches({title:item.title,description:decodeXmlText(item.snippet||'')},row,m,s);
  const companyHint=/(公司|股份|企業|科技|銀行|控股|corporation|company|inc|technology|bank)/i.test(`${item.title} ${item.snippet||''}`)?0.1:0;
  return {item,score:check.score+companyHint,check};
 }).filter(x=>x.check.passed).sort((a,b)=>b.score-a.score);

 if(!scored.length)throw Error('Wikipedia result did not match stock company');
 for(const candidate of scored.slice(0,3)){
  const title=candidate.item.title;
  const extractUrl=`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=160&titles=${encodeURIComponent(title)}&format=json&origin=*`;
  const detail=await fetchJson(extractUrl,{timeout:9000});
  const page=Object.values(detail?.query?.pages||{})[0];
  const description=String(page?.extract||'').trim();
  if(!description)continue;
  const check=profileMatches({title,description},row,m,s);
  if(!check.passed)continue;
  const sourceUrl=`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ','_'))}`;
  return verifiedProfile({
   market:m,symbol:s,name:row?.name||title,wikipediaTitle:title,
   exchange:row?.exchange||m,industry:row?.industry||'未分類',
   country:m==='TW'?'台灣':m==='CN'?'中國':'美國',
   website:'',logo:page?.thumbnail?.source||'',employees:null,ceo:'',
   description:description.slice(0,1200),
   source:`Wikipedia（${lang==='zh'?'中文':'英文'}）`,sourceUrl,isFallback:true
  },check);
 }
 throw Error('Wikipedia article mismatch');
}



function profileSource(name,url='',tier='公開資料'){return{name,url,tier,checkedAt:nowIso(),ok:true}}
function firstText(obj,keys){for(const key of keys){const value=obj?.[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim()}return''}
function compactArray(values=[]){return[...new Set(values.flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>typeof v==='string'||typeof v==='number').map(v=>String(v||'').trim()).filter(Boolean))].slice(0,16)}
function uniqueObjects(values=[],keyFn=v=>JSON.stringify(v)){const seen=new Set(),out=[];for(const value of values){if(!value||typeof value!=='object')continue;const key=keyFn(value);if(!key||seen.has(key))continue;seen.add(key);out.push(value)}return out}
function splitBusinessText(text=''){return compactArray(String(text||'').split(/[；;、，,\n]|(?:以及)|(?:及其)/).map(x=>x.replace(/^[（(]?\d+[）)]?[、.\s]*/,'').trim()).filter(x=>x.length>=2&&x.length<=80)).slice(0,8)}
function formatAddress(address={}){return[address.address1,address.address2,address.city,address.stateOrCountry,address.zipCode].filter(Boolean).join(' ').trim()}

async function profileTwOfficial(m,s,row){
 if(m!=='TW')throw Error('unsupported');
 const endpoints=[['https://openapi.twse.com.tw/v1/opendata/t187ap03_L','TWSE'],['https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','TPEX']];
 for(const[url,exchange]of endpoints){
  try{
   const data=await fetchJson(url,{timeout:12000});const x=(Array.isArray(data)?data:[]).find(v=>cleanSymbol(v['公司代號']||v.Code||'')===s);if(!x)continue;
   const name=firstText(x,['公司簡稱','公司名稱'])||row?.name||s,industry=firstText(x,['產業別','Industry'])||row?.industry||'未分類';
   const description=firstText(x,['主要經營業務','主要業務','營業項目','業務範圍'])||`${name}為台灣${exchange==='TWSE'?'上市':'上櫃'}公司，主要從事${industry}相關業務。`;
   return verifiedProfile({market:m,symbol:s,name,providerName:firstText(x,['公司名稱','公司簡稱']),exchange,industry,country:'台灣',website:firstText(x,['公司網址','網址']),logo:'',employees:Number(firstText(x,['員工人數']))||null,ceo:firstText(x,['總經理']),chairman:firstText(x,['董事長']),founded:firstText(x,['成立日期']),headquarters:firstText(x,['住址','公司地址','英文通訊地址']),description,products:splitBusinessText(firstText(x,['主要經營業務','主要業務','營業項目'])),source:exchange==='TWSE'?'臺灣證券交易所 OpenAPI':'櫃買中心 OpenAPI',sourceUrl:url,isFallback:false,fieldSources:{name:exchange,exchange,industry:exchange,website:exchange,ceo:exchange,chairman:exchange,founded:exchange,headquarters:exchange,description:exchange},sources:[profileSource(exchange==='TWSE'?'臺灣證券交易所 OpenAPI':'櫃買中心 OpenAPI',url,'官方')]},{passed:true,score:1,symbolMatch:true});
  }catch(e){mark(`profile-tw-${exchange.toLowerCase()}`,false,e.message)}
 }
 throw Error('TW official profile unavailable');
}

async function profileEastmoneySurvey(m,s,row){
 if(m!=='CN')throw Error('unsupported');
 const prefix=/^(6|68)/.test(s)?'SH':/^(4|8)/.test(s)?'BJ':'SZ';
 const url=`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${prefix}${encodeURIComponent(s)}`;
 const d=await fetchJson(url,{timeout:10000,headers:{Referer:'https://emweb.securities.eastmoney.com/'}});
 const candidates=[...(Array.isArray(d?.jbzl)?d.jbzl:[]),...(Array.isArray(d?.JBZL)?d.JBZL:[]),...(Array.isArray(d?.jbgs)?d.jbgs:[])];const x=candidates[0];if(!x)throw Error('EastMoney company survey empty');
 const providerName=firstText(x,['ORG_NAME','SECURITY_NAME_ABBR','COMPANY_NAME']),description=firstText(x,['ORG_PROFILE','MAIN_BUSINESS','BUSINESS_SCOPE','OPERATE_SCOPE']);
 const check=profileMatches({providerName,providerSymbol:s,description},row,m,s);if(!check.passed)throw Error(`EastMoney profile mismatch: ${providerName}`);
 const sourceUrl=`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?type=web&code=${prefix}${s}`;
 return verifiedProfile({market:m,symbol:s,name:row?.name||providerName||s,providerName,exchange:row?.exchange||cnExchange(s),industry:firstText(x,['INDUSTRYCSRC1','INDUSTRY','EM2016'])||row?.industry||'未分類',country:'中國',website:firstText(x,['ORG_WEB','WEB_SITE']),logo:'',employees:Number(firstText(x,['EMP_NUM','EMPLOYEE_NUM']))||null,ceo:firstText(x,['PRESIDENT','GENERAL_MANAGER']),chairman:firstText(x,['CHAIRMAN','LEGAL_PERSON']),founded:firstText(x,['ESTABLISH_DATE','FOUND_DATE']),headquarters:firstText(x,['OFFICE_ADDRESS','REG_ADDRESS']),description:description||`${row?.name||providerName||s}為中國 A 股上市公司，主要從事${row?.industry||'相關產業'}業務。`,products:splitBusinessText(firstText(x,['MAIN_BUSINESS','BUSINESS_SCOPE'])),source:'東方財富公司概況',sourceUrl,isFallback:false,fieldSources:{name:'東方財富',industry:'東方財富',website:'東方財富',employees:'東方財富',ceo:'東方財富',chairman:'東方財富',founded:'東方財富',headquarters:'東方財富',description:'東方財富'},sources:[profileSource('東方財富公司概況',sourceUrl,'市場資料')]},check);
}

async function profileYahoo(m,s,row){
 const ys=yahooSymbol(m,s,row?.exchange);const modules='assetProfile,price';
 const d=await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ys)}?modules=${encodeURIComponent(modules)}`,{timeout:10000});const x=d?.quoteSummary?.result?.[0];if(!x)throw Error('Yahoo profile empty');
 const a=x.assetProfile||{},price=x.price||{},providerName=price.longName||price.shortName||row?.name||s,description=String(a.longBusinessSummary||'').trim();
 const check=profileMatches({providerName,providerSymbol:ys,description},row,m,s);if(!check.passed)throw Error(`Yahoo profile mismatch: ${providerName}`);
 const location=[a.city,a.state,a.country].filter(Boolean).join(', ');
 return verifiedProfile({market:m,symbol:s,name:row?.name||providerName,providerName,exchange:row?.exchange||price.exchangeName||m,industry:a.industry||row?.industry||'未分類',sector:a.sector||'',country:a.country||'',website:a.website||'',logo:'',employees:Number(a.fullTimeEmployees)||null,ceo:a.companyOfficers?.find(v=>/chief executive/i.test(v.title||''))?.name||'',headquarters:location,description:description||`${providerName} 主要從事 ${a.industry||row?.industry||'相關產業'} 業務。`,source:'Yahoo Finance 公司資料',sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(ys)}/profile/`,isFallback:false,fieldSources:{industry:'Yahoo Finance',sector:'Yahoo Finance',country:'Yahoo Finance',website:'Yahoo Finance',employees:'Yahoo Finance',ceo:'Yahoo Finance',headquarters:'Yahoo Finance',description:'Yahoo Finance'},sources:[profileSource('Yahoo Finance 公司資料',`https://finance.yahoo.com/quote/${ys}/profile/`,'市場資料')]},check);
}

let secTickerMap=null,secTickerMapAt=0;
async function getSecTickerMap(){
 if(secTickerMap&&Date.now()-secTickerMapAt<24*60*60*1000)return secTickerMap;
 const ua=process.env.SEC_USER_AGENT||'AlphaLens Enterprise contact@example.com';
 const d=await fetchJson('https://www.sec.gov/files/company_tickers.json',{timeout:12000,headers:{'User-Agent':ua,Accept:'application/json'}});secTickerMap=Object.values(d||{});secTickerMapAt=Date.now();return secTickerMap;
}
async function profileSec(m,s,row){
 if(m!=='US')throw Error('unsupported');const tickers=await getSecTickerMap();const mapping=tickers.find(x=>String(x.ticker||'').toUpperCase()===s);if(!mapping)throw Error('SEC ticker mapping unavailable');
 const cik=String(mapping.cik_str).padStart(10,'0'),ua=process.env.SEC_USER_AGENT||'AlphaLens Enterprise contact@example.com';const d=await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`,{timeout:12000,headers:{'User-Agent':ua,Accept:'application/json'}});
 const providerName=d.name||mapping.title||row?.name||s,check=profileMatches({providerName,providerSymbol:(d.tickers||[])[0]||s,description:`${d.name||''} ${d.sicDescription||''}`},row,m,s);if(!check.passed)throw Error(`SEC profile mismatch: ${providerName}`);
 const recent=d.filings?.recent||{},filings=[];for(let i=0;i<Math.min(8,(recent.form||[]).length);i++)filings.push({form:recent.form[i],date:recent.filingDate?.[i],accession:recent.accessionNumber?.[i],document:recent.primaryDocument?.[i],description:recent.primaryDocDescription?.[i]||''});
 const sourceUrl=`https://www.sec.gov/edgar/browse/?CIK=${cik}&owner=exclude`;
 return verifiedProfile({market:m,symbol:s,cik,name:row?.name||providerName,providerName,exchange:(d.exchanges||[])[0]||row?.exchange||'US',industry:d.sicDescription||row?.industry||'未分類',country:'美國',website:'',logo:'',employees:null,ceo:'',founded:'',headquarters:formatAddress(d.addresses?.business||d.addresses?.mailing||{}),description:`${providerName} 為向美國證券交易委員會申報的上市公司，產業分類為 ${d.sicDescription||row?.industry||'未分類'}。`,formerNames:compactArray((d.formerNames||[]).map(x=>x.name)),filings,source:'美國 SEC EDGAR',sourceUrl,isFallback:false,fieldSources:{name:'SEC EDGAR',exchange:'SEC EDGAR',industry:'SEC EDGAR',headquarters:'SEC EDGAR',filings:'SEC EDGAR'},sources:[profileSource('美國 SEC EDGAR',sourceUrl,'官方')]},check);
}

function mergeCompanyProfiles(row,m,s,results,rejected=[]){
 const fallback=profileFallback(row,m,s),profiles=results.filter(Boolean);
 const scalarPriority={description:['Financial Modeling Prep','Yahoo Finance 公司資料','Wikipedia（中文）','Wikipedia（英文）','東方財富公司概況','臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','美國 SEC EDGAR','本地股票目錄'],website:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','Financial Modeling Prep','Finnhub','Yahoo Finance 公司資料'],logo:['Financial Modeling Prep','Finnhub','Wikipedia（中文）','Wikipedia（英文）'],employees:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','Financial Modeling Prep','Yahoo Finance 公司資料'],chairman:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況'],ceo:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','Financial Modeling Prep','Yahoo Finance 公司資料'],founded:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況'],headquarters:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','美國 SEC EDGAR','Yahoo Finance 公司資料'],industry:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','美國 SEC EDGAR','Financial Modeling Prep','Finnhub','Yahoo Finance 公司資料'],country:['臺灣證券交易所 OpenAPI','櫃買中心 OpenAPI','東方財富公司概況','美國 SEC EDGAR','Financial Modeling Prep','Finnhub','Yahoo Finance 公司資料']};
 const bySource=name=>profiles.find(p=>p.source===name);
 const merged={...fallback,name:row?.name||profiles.find(p=>p.name)?.name||s,providerName:profiles.find(p=>p.providerName)?.providerName||'',exchange:row?.exchange||profiles.find(p=>p.exchange)?.exchange||fallback.exchange,fieldSources:{},sources:uniqueObjects(profiles.flatMap(p=>p.sources||[profileSource(p.source,p.sourceUrl,p.source?.includes('證券')||p.source?.includes('SEC')?'官方':'公開資料')]),x=>`${x.name}|${x.url||''}`),rejectedSources:rejected};
 const fields=['description','website','logo','employees','chairman','ceo','founded','headquarters','industry','sector','country','cik'];
 for(const field of fields){const order=scalarPriority[field]||profiles.map(p=>p.source);let selected=null;for(const source of order){const p=bySource(source);if(p&&p[field]!==undefined&&p[field]!==null&&String(p[field]).trim()){selected=p;break}}if(!selected)selected=profiles.find(p=>p[field]!==undefined&&p[field]!==null&&String(p[field]).trim());if(selected){merged[field]=selected[field];merged.fieldSources[field]=selected.fieldSources?.[field]||selected.source}}
 for(const field of ['products','competitors','supplyChain','customers','globalFootprint','formerNames'])merged[field]=compactArray(profiles.flatMap(p=>p[field]||[]));
 merged.filings=uniqueObjects(profiles.flatMap(p=>p.filings||[]),x=>x.accession||`${x.form}|${x.date}|${x.document}`).slice(0,12);
 merged.source=compactArray(profiles.map(p=>p.source)).join(' / ')||fallback.source;merged.sourceUrl=profiles.find(p=>p.sourceUrl)?.sourceUrl||'';merged.verified=profiles.some(p=>p.verified);merged.matchScore=profiles.length?Math.max(...profiles.map(p=>Number(p.matchScore)||0)):1;merged.verification=profiles.length?`已整合 ${profiles.length} 個來源並核對股票代號與公司名稱`:'使用本地股票目錄';merged.isFallback=profiles.length===0;merged.profileConfidence=Math.min(98,Math.round(45+profiles.length*12+(merged.description?.length>120?12:0)+(merged.website?6:0)+(merged.headquarters?6:0)));return enrichCompanyProfile(merged,row,m,s);
}

async function getCompanyProfile(m,s,{force=false}={}){
 const key=`profile:${m}:${s}`;if(force)cache.delete(key);const hit=getCache(key);if(hit)return hit;
 return coalesce(`profile:${m}:${s}`,async()=>{
 const cached=getCache(key);if(cached&&!force)return cached;
 const row={...(await resolveCatalogRow(m,s)),industry:(catalog.find(x=>x.market===m&&x.symbol===s)?.industry||'未分類')};
 if(String(process.env.ALPHALENS_TEST_MODE||'')==='1'){
  const demo=verifiedProfile({...profileFallback(row,m,s),description:`${row.name||s} 是 ${row.industry||'相關產業'} 的上市公司，測試模式提供完整公司快照以驗證介面。`,website:'https://example.com',employees:12000,ceo:'測試執行長',founded:'2000',headquarters:m==='TW'?'台灣':m==='CN'?'中國':'美國',products:['核心產品與服務','企業解決方案','全球客戶服務'],customers:['企業客戶','一般消費者'],competitors:['同業公司 A','同業公司 B'],globalFootprint:['亞洲','北美','歐洲'],sources:[profileSource('測試公司資料','https://example.com','測試')],source:'測試公司資料'}, {passed:true,score:1,symbolMatch:true});
  return setCache(key,mergeCompanyProfiles(row,m,s,[demo],['test mode']),60_000);
 }
 const providers=m==='TW'?[profileTwOfficial,profileFmp,profileYahoo,profileWikipedia]:m==='CN'?[profileEastmoneySurvey,profileFmp,profileYahoo,profileWikipedia]:[profileSec,profileFmp,profileFinnhub,profileYahoo,profileWikipedia];
 const settled=await Promise.allSettled(providers.map(fn=>fn(m,s,row))),profiles=[],rejected=[];
 settled.forEach((result,i)=>{const name=providers[i].name;if(result.status==='fulfilled'){profiles.push(result.value);mark(`profile-${name}`,true)}else{rejected.push(`${name}: ${result.reason?.message||'unknown'}`);mark(`profile-${name}`,false,result.reason?.message)}});
 const merged=mergeCompanyProfiles(row,m,s,profiles,rejected);
 if(merged.description&&!isChineseName(merged.description)&&(process.env.OPENAI_API_KEY||process.env.GEMINI_API_KEY)){
  try{const translated=await translateToZh(merged.description);if(translated.translated&&translated.translated!==merged.description&&!translated.source.includes('不可用')){merged.descriptionOriginal=merged.description;merged.description=translated.translated;merged.fieldSources.description=`${merged.fieldSources.description||merged.source} / ${translated.source}`;merged.translationSource=translated.source}}catch(e){mark('profile-translation',false,e.message)}
 }
 return setCache(key,merged,6*60*60*1000);
 });
}

function numberOrNull(...values){for(const v of values){if(!hasNumber(v))continue;return Number(v)}return null}
function gradeFromScore(score){return score>=90?'A+':score>=80?'A':score>=70?'B':score>=60?'C':'D'}
function scoreMetric(value,rules,neutral=55){if(value==null)return null;for(const [test,score] of rules)if(test(value))return score;return neutral}
function buildFundamentalScores(f){
 const profitability=[scoreMetric(f.roe,[[v=>v>=20,95],[v=>v>=15,85],[v=>v>=10,72],[v=>v>=5,58],[v=>true,38]]),scoreMetric(f.netMargin,[[v=>v>=20,95],[v=>v>=12,82],[v=>v>=6,68],[v=>v>=0,52],[v=>true,28]]),scoreMetric(f.eps,[[v=>v>0,75],[v=>true,30]])].filter(x=>x!=null);
 const growth=[scoreMetric(f.growth,[[v=>v>=25,95],[v=>v>=15,85],[v=>v>=5,70],[v=>v>=0,58],[v=>true,32]]),scoreMetric(f.epsGrowth,[[v=>v>=25,95],[v=>v>=10,80],[v=>v>=0,62],[v=>true,35]])].filter(x=>x!=null);
 const health=[scoreMetric(f.debt,[[v=>v<30,92],[v=>v<50,80],[v=>v<65,62],[v=>v<80,45],[v=>true,25]]),scoreMetric(f.currentRatio,[[v=>v>=2,90],[v=>v>=1.5,80],[v=>v>=1,62],[v=>true,35]])].filter(x=>x!=null);
 const valuation=[scoreMetric(f.pe,[[v=>v>0&&v<=15,90],[v=>v<=25,80],[v=>v<=40,65],[v=>v<=60,48],[v=>true,30]]),scoreMetric(f.pb,[[v=>v>0&&v<=2,88],[v=>v<=4,72],[v=>v<=8,55],[v=>true,35]])].filter(x=>x!=null);
 const cashflow=[scoreMetric(f.freeCashFlow,[[v=>v>0,82],[v=>true,35]]),scoreMetric(f.operatingCashFlow,[[v=>v>0,78],[v=>true,32]])].filter(x=>x!=null);
 const dividend=[scoreMetric(f.dividendYield,[[v=>v>=5,92],[v=>v>=3,82],[v=>v>=1,68],[v=>v>0,55],[v=>true,40]])].filter(x=>x!=null);
 const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
 const subs={profitability:avg(profitability),growth:avg(growth),health:avg(health),valuation:avg(valuation),cashflow:avg(cashflow),dividend:avg(dividend)};
 const available=Object.values(subs).filter(v=>v!=null),total=available.length?Math.round(available.reduce((a,b)=>a+b,0)/available.length):null;
 const metricValues=['eps','pe','pb','roe','roa','margin','operatingMargin','netMargin','debt','currentRatio','growth','epsGrowth','freeCashFlow','dividendYield'].map(k=>f[k]);
 const coverage=Math.round(metricValues.filter(v=>v!=null).length/metricValues.length*100);
 const strengths=[],risks=[];
 if(f.roe!=null&&f.roe>=15)strengths.push('ROE 表現良好'); if(f.growth!=null&&f.growth>=10)strengths.push('營收維持成長'); if(f.freeCashFlow!=null&&f.freeCashFlow>0)strengths.push('自由現金流為正'); if(f.debt!=null&&f.debt<50)strengths.push('負債結構相對穩健');
 if(f.pe!=null&&f.pe>50)risks.push('本益比偏高'); if(f.growth!=null&&f.growth<0)risks.push('營收呈現衰退'); if(f.debt!=null&&f.debt>70)risks.push('負債比偏高'); if(coverage<50)risks.push('基本面資料覆蓋率偏低');
 return{total,rating:total==null?'資料不足':gradeFromScore(total),coverage,subScores:subs,strengths,risks};
}
function scoreFund(f){return buildFundamentalScores(f)}


const FUND_FIELDS=['eps','pe','pb','roe','roa','margin','operatingMargin','netMargin','debt','currentRatio','quickRatio','growth','epsGrowth','freeCashFlow','operatingCashFlow','dividendYield','marketCap'];
function rawValue(x){return x&&typeof x==='object'&&'raw'in x?x.raw:x}
function pctValue(x){const n=numberOrNull(rawValue(x));return n==null?null:(Math.abs(n)<=2?n*100:n)}
function mergeFundFields(base,patch,source,priority=50){
 const out={...base,fieldSources:{...(base.fieldSources||{})},sourcePriority:{...(base.sourcePriority||{})}};
 for(const key of FUND_FIELDS){
  const value=numberOrNull(patch?.[key]);
  if(value==null)continue;
  if(out[key]==null||priority>(out.sourcePriority[key]??-1)){
   out[key]=value;out.fieldSources[key]=source;out.sourcePriority[key]=priority;
  }
 }
 if(patch?.name&&!out.name)out.name=patch.name;
 if(patch?.industry&&!out.industry)out.industry=patch.industry;
 return out;
}
function summarizeFundSources(out){
 const names=[...new Set(Object.values(out.fieldSources||{}).filter(Boolean))];
 return names.length?names.join(' / '):out.source||'資料暫缺';
}
async function fundamentalsYahoo(m,s){
 const ys=yahooSymbol(m,s);
 const modules='defaultKeyStatistics,financialData,summaryDetail,price';
 const d=await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ys)}?modules=${encodeURIComponent(modules)}`,{timeout:10000});
 const x=d?.quoteSummary?.result?.[0];if(!x)throw Error('Yahoo fundamentals empty');
 const stats=x.defaultKeyStatistics||{},fin=x.financialData||{},sum=x.summaryDetail||{},price=x.price||{};
 return{name:price.longName||price.shortName||'',marketCap:numberOrNull(rawValue(price.marketCap)),eps:numberOrNull(rawValue(stats.trailingEps),rawValue(stats.forwardEps)),pe:numberOrNull(rawValue(sum.trailingPE),rawValue(stats.forwardPE)),pb:numberOrNull(rawValue(stats.priceToBook)),roe:pctValue(fin.returnOnEquity),roa:pctValue(fin.returnOnAssets),margin:pctValue(fin.grossMargins),operatingMargin:pctValue(fin.operatingMargins),netMargin:pctValue(fin.profitMargins),debt:pctValue(fin.debtToEquity),currentRatio:numberOrNull(rawValue(fin.currentRatio)),quickRatio:numberOrNull(rawValue(fin.quickRatio)),growth:pctValue(fin.revenueGrowth),epsGrowth:pctValue(fin.earningsGrowth),freeCashFlow:numberOrNull(rawValue(fin.freeCashflow)),operatingCashFlow:numberOrNull(rawValue(fin.operatingCashflow)),dividendYield:pctValue(sum.dividendYield)};
}
async function fundamentalsFinMind(m,s){
 if(m!=='TW'||!process.env.FINMIND_TOKEN)throw Error('unsupported');
 const end=new Date().toISOString().slice(0,10),start=new Date(Date.now()-730*86400000).toISOString().slice(0,10);
 const base=`https://api.finmindtrade.com/api/v4/data?data_id=${encodeURIComponent(cleanSymbol(s))}&start_date=${start}&end_date=${end}&token=${encodeURIComponent(process.env.FINMIND_TOKEN)}`;
 const [perRes,finRes]=await Promise.allSettled([fetchJson(`${base}&dataset=TaiwanStockPER`,{timeout:12000}),fetchJson(`${base}&dataset=TaiwanStockFinancialStatements`,{timeout:12000})]);
 const out={};
 if(perRes.status==='fulfilled'){const rows=Array.isArray(perRes.value?.data)?perRes.value.data:[],x=rows.at(-1)||{};out.pe=numberOrNull(x.PER,x.pe);out.pb=numberOrNull(x.PBR,x.pb);out.dividendYield=numberOrNull(x.dividend_yield,x.DividendYield)}
 if(finRes.status==='fulfilled'){
  const rows=Array.isArray(finRes.value?.data)?finRes.value.data:[],latestDate=[...new Set(rows.map(x=>x.date).filter(Boolean))].sort().at(-1),latest=rows.filter(x=>x.date===latestDate);
  const pick=patterns=>{const row=latest.find(x=>patterns.some(p=>String(x.type||x.origin_name||'').toLowerCase().includes(p)));return numberOrNull(row?.value)};
  const revenue=pick(['revenue','營業收入','營收']),netIncome=pick(['profit','net income','本期淨利','淨利']),assets=pick(['total assets','資產總計']),equity=pick(['equity','權益總計']),liabilities=pick(['liabilities','負債總計']),gross=pick(['gross profit','營業毛利']),operating=pick(['operating income','營業利益']);
  if(revenue){out.netMargin=netIncome!=null?netIncome/revenue*100:null;out.margin=gross!=null?gross/revenue*100:null;out.operatingMargin=operating!=null?operating/revenue*100:null}
  if(equity)out.roe=netIncome!=null?netIncome/equity*100:null;
  if(assets){out.roa=netIncome!=null?netIncome/assets*100:null;out.debt=liabilities!=null?liabilities/assets*100:null}
 }
 if(!Object.values(out).some(v=>v!=null))throw Error('FinMind fundamentals empty');return out;
}
function eastmoneySecid(symbol){const s=cleanSymbol(symbol);return/^(6|68)/.test(s)?`1.${s}`:`0.${s}`}
async function fundamentalsEastmoney(m,s){
 if(m!=='CN')throw Error('unsupported');
 const fields='f57,f58,f162,f167,f173,f116,f183,f184,f185,f186,f187,f188';
 const d=await fetchJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(eastmoneySecid(s))}&fields=${fields}`,{timeout:10000});
 const x=d?.data;if(!x)throw Error('Eastmoney fundamentals empty');
 const scale=v=>{const n=numberOrNull(v);return n==null||n===-10000?null:n/100};
 return{name:x.f58||'',pe:scale(x.f162),pb:scale(x.f167),roe:scale(x.f173),marketCap:numberOrNull(x.f116),growth:scale(x.f183),epsGrowth:scale(x.f184),margin:scale(x.f185),netMargin:scale(x.f186),debt:scale(x.f187),dividendYield:scale(x.f188)};
}
async function collectFundamentalSources(m,s,out){
 const jobs=[{name:'Yahoo Finance',priority:65,promise:fundamentalsYahoo(m,s)}];
 if(m==='TW')jobs.push({name:'FinMind',priority:85,promise:fundamentalsFinMind(m,s)});
 if(m==='CN')jobs.push({name:'東方財富',priority:80,promise:fundamentalsEastmoney(m,s)});
 const results=await Promise.allSettled(jobs.map(x=>x.promise));
 results.forEach((r,i)=>{if(r.status==='fulfilled')out=mergeFundFields(out,r.value,jobs[i].name,jobs[i].priority);else mark(`fund-${jobs[i].name}`,false,r.reason?.message)});
 return out;
}

const FUNDAMENTAL_FALLBACK={
 'TW:2330':{eps:45.25,pe:24.8,pb:7.6,roe:31.4,roa:18.8,margin:56.1,operatingMargin:45.7,netMargin:39.2,debt:24.6,currentRatio:2.35,quickRatio:2.08,growth:18.6,epsGrowth:22.4,freeCashFlow:720000000000,operatingCashFlow:1500000000000,dividendYield:1.7,source:'內建示範備援（請以最新財報為準）'},
 'TW:2317':{eps:12.1,pe:18.5,pb:2.3,roe:12.8,roa:4.2,margin:6.4,operatingMargin:3.1,netMargin:2.5,debt:58.2,currentRatio:1.32,quickRatio:1.05,growth:12.7,epsGrowth:17.2,freeCashFlow:145000000000,operatingCashFlow:260000000000,dividendYield:2.8,source:'內建示範備援（請以最新財報為準）'},
 'TW:2454':{eps:68.3,pe:22.6,pb:6.1,roe:28.5,roa:20.1,margin:49.8,operatingMargin:21.7,netMargin:20.2,debt:22.5,currentRatio:2.05,quickRatio:1.72,growth:21.3,epsGrowth:29.8,freeCashFlow:105000000000,operatingCashFlow:130000000000,dividendYield:4.1,source:'內建示範備援（請以最新財報為準）'},
 'CN:600519':{eps:70.2,pe:23.5,pb:8.2,roe:34.8,roa:27.4,margin:91.2,operatingMargin:69.8,netMargin:52.6,debt:18.4,currentRatio:4.1,quickRatio:3.2,growth:15.7,epsGrowth:16.4,freeCashFlow:67000000000,operatingCashFlow:78000000000,dividendYield:3.2,source:'內建示範備援（請以最新財報為準）'},
 'CN:300750':{eps:12.8,pe:20.4,pb:4.7,roe:23.2,roa:10.3,margin:25.6,operatingMargin:14.9,netMargin:12.8,debt:63.5,currentRatio:1.45,quickRatio:1.12,growth:9.8,epsGrowth:12.2,freeCashFlow:43000000000,operatingCashFlow:71000000000,dividendYield:1.4,source:'內建示範備援（請以最新財報為準）'},
 'CN:002594':{eps:13.6,pe:25.2,pb:5.4,roe:22.1,roa:6.7,margin:20.4,operatingMargin:6.8,netMargin:5.4,debt:72.3,currentRatio:0.92,quickRatio:0.68,growth:22.6,epsGrowth:28.1,freeCashFlow:51000000000,operatingCashFlow:89000000000,dividendYield:1.1,source:'內建示範備援（請以最新財報為準）'},
 'US:AAPL':{eps:7.1,pe:31.8,pb:48.2,roe:145.0,roa:28.5,margin:46.2,operatingMargin:31.4,netMargin:24.6,debt:82.0,currentRatio:0.89,quickRatio:0.72,growth:6.8,epsGrowth:10.4,freeCashFlow:105000000000,operatingCashFlow:125000000000,dividendYield:0.45,source:'內建示範備援（請以最新財報為準）'},
 'US:MSFT':{eps:14.2,pe:33.6,pb:11.4,roe:36.8,roa:18.2,margin:69.5,operatingMargin:45.1,netMargin:36.4,debt:42.7,currentRatio:1.35,quickRatio:1.21,growth:15.2,epsGrowth:18.5,freeCashFlow:76000000000,operatingCashFlow:118000000000,dividendYield:0.7,source:'內建示範備援（請以最新財報為準）'},
 'US:NVDA':{eps:4.1,pe:42.5,pb:38.0,roe:92.0,roa:55.4,margin:75.0,operatingMargin:61.0,netMargin:55.8,debt:18.5,currentRatio:4.2,quickRatio:3.6,growth:78.0,epsGrowth:120.0,freeCashFlow:60000000000,operatingCashFlow:64000000000,dividendYield:0.03,source:'內建示範備援（請以最新財報為準）'}
};
function applyFundamentalFallback(out,m,s){
 const fb=FUNDAMENTAL_FALLBACK[`${m}:${s}`];
 if(!fb)return out;
 const hasUseful=['eps','pe','roe','growth'].some(k=>out[k]!=null);
 if(hasUseful)return out;
 return {...out,...fb,updatedAt:nowIso(),isFallback:true};
}

async function getFund(m,s,{force=false}={}){
 const key=`f:${m}:${s}`;if(force)cache.delete(key);const hit=getCache(key);if(hit)return hit;
 const row=await canonicalNameRow(m,s);
 if(String(process.env.ALPHALENS_TEST_MODE||'')==='1'){
  const base=applyFundamentalFallback({market:m,symbol:s,name:row.name||s,industry:row.industry||'',fieldSources:{},sourcePriority:{},updatedAt:nowIso()},m,s);
  const out=base.isFallback?base:{...base,eps:8.6,pe:21.4,pb:3.2,roe:18.7,roa:9.6,margin:42.5,operatingMargin:22.1,netMargin:16.8,debt:38.2,currentRatio:1.8,quickRatio:1.35,growth:14.2,epsGrowth:17.5,freeCashFlow:8600000000,operatingCashFlow:12400000000,dividendYield:2.1,isFallback:true};
  for(const k of FUND_FIELDS)if(out[k]!=null&&!out.fieldSources[k])out.fieldSources[k]='測試資料';
  const score=buildFundamentalScores(out);return setCache(key,{...out,...score,source:'測試基本面資料',updatedAt:nowIso()},ttl.fund);
 }
 let out={market:m,symbol:s,name:row.name||s,industry:row.industry||'',eps:null,pe:null,pb:null,roe:null,roa:null,margin:null,operatingMargin:null,netMargin:null,debt:null,currentRatio:null,quickRatio:null,growth:null,epsGrowth:null,freeCashFlow:null,operatingCashFlow:null,dividendYield:null,marketCap:null,fieldSources:{},sourcePriority:{},updatedAt:nowIso()};
 if(process.env.FMP_API_KEY){for(const candidate of symbolCandidates(m,s)){try{
  const [profile,ratios,income,cash]=await Promise.all([fetchJson(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(candidate)}&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`),fetchJson(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(candidate)}&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`),fetchJson(`https://financialmodelingprep.com/stable/income-statement?symbol=${encodeURIComponent(candidate)}&limit=2&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`),fetchJson(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(candidate)}&limit=2&apikey=${encodeURIComponent(process.env.FMP_API_KEY)}`)]);
  const p=profile?.[0]||{},r=ratios?.[0]||{},inc=income||[],cf=cash||[];if(!p.companyName&&!inc.length&&!Object.keys(r).length)continue;
  const revenueGrowth=inc[1]?.revenue?((inc[0].revenue-inc[1].revenue)/Math.abs(inc[1].revenue)*100):null,eps0=numberOrNull(inc[0]?.eps,inc[0]?.epsdiluted),eps1=numberOrNull(inc[1]?.eps,inc[1]?.epsdiluted);
  const patch={name:p.companyName||out.name,industry:p.industry||row.industry,marketCap:numberOrNull(p.marketCap),eps:eps0,pe:numberOrNull(r.priceToEarningsRatioTTM,r.peRatioTTM),pb:numberOrNull(r.priceToBookRatioTTM,r.pbRatioTTM),roe:numberOrNull(r.returnOnEquityTTM)!=null?numberOrNull(r.returnOnEquityTTM)*100:null,roa:numberOrNull(r.returnOnAssetsTTM)!=null?numberOrNull(r.returnOnAssetsTTM)*100:null,margin:numberOrNull(r.grossProfitMarginTTM)!=null?numberOrNull(r.grossProfitMarginTTM)*100:null,operatingMargin:numberOrNull(r.operatingProfitMarginTTM)!=null?numberOrNull(r.operatingProfitMarginTTM)*100:null,netMargin:numberOrNull(r.netProfitMarginTTM)!=null?numberOrNull(r.netProfitMarginTTM)*100:null,debt:numberOrNull(r.debtToAssetsRatioTTM)!=null?numberOrNull(r.debtToAssetsRatioTTM)*100:null,currentRatio:numberOrNull(r.currentRatioTTM),quickRatio:numberOrNull(r.quickRatioTTM),growth:revenueGrowth,epsGrowth:eps0!=null&&eps1?((eps0-eps1)/Math.abs(eps1)*100):null,freeCashFlow:numberOrNull(cf[0]?.freeCashFlow),operatingCashFlow:numberOrNull(cf[0]?.operatingCashFlow),dividendYield:numberOrNull(r.dividendYieldTTM)!=null?numberOrNull(r.dividendYieldTTM)*100:null};
  out=mergeFundFields(out,patch,'FMP',100);out.name=patch.name||out.name;out.industry=patch.industry||out.industry;break;
 }catch(e){mark('fund-fmp',false,e.message)}}}
 out=await collectFundamentalSources(m,s,out);out=applyFundamentalFallback(out,m,s);
 if((m==='TW'||m==='CN')&&isChineseName(row.name))out.name=row.name;
 if(out.isFallback)for(const k of FUND_FIELDS)if(out[k]!=null&&!out.fieldSources[k])out.fieldSources[k]='內建示範備援';
 out.source=summarizeFundSources(out);out.updatedAt=nowIso();
 const score=buildFundamentalScores(out);return setCache(key,{...out,...score},ttl.fund);
}

function decodeXmlText(value=''){
 return String(value)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
  .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function xmlTag(block,tag){
 const m=String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i'));
 return m?decodeXmlText(m[1]):'';
}
function xmlLink(block){
 const direct=xmlTag(block,'link');
 if(direct)return direct;
 const m=String(block).match(/<link[^>]+href=["']([^"']+)["']/i);
 return m?decodeXmlText(m[1]):'';
}
function parseRss(xml,feedLabel=''){
 const items=String(xml).match(/<item\b[\s\S]*?<\/item>/gi)||[];
 return items.map(item=>{
  const source=xmlTag(item,'source')||feedLabel||'網路新聞';
  return {
   headline:xmlTag(item,'title'),
   summary:xmlTag(item,'description'),
   url:xmlLink(item),
   source,
   datetime:xmlTag(item,'pubDate')?new Date(xmlTag(item,'pubDate')).toISOString():null
  };
 }).filter(x=>x.headline&&x.url);
}
async function fetchText(url,options={}){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),options.timeout||9000);
 try{
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AlphaLens/7.5',Accept:'application/rss+xml, application/xml, text/xml, text/html'},signal:c.signal});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  return await r.text();
 }finally{clearTimeout(timer)}
}
function googleNewsRssUrl(query,locale='zh-TW'){
 const isCn=locale==='zh-CN';
 return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${isCn?'zh-CN':'zh-TW'}&gl=${isCn?'CN':'TW'}&ceid=${isCn?'CN:zh-Hans':'TW:zh-Hant'}`;
}
function newsPublisherQueries(m,name,symbol){
 if(m==='TW')return[
  `${name} ${symbol} 股票 when:30d`,
  `${name} (site:tw.stock.yahoo.com OR site:money.udn.com OR site:cnyes.com OR site:moneydj.com) when:30d`,
  `${name} (site:finance.ettoday.net OR site:cmoney.tw OR site:news.cnyes.com) when:30d`
 ];
 if(m==='CN')return[
  `${name} ${symbol} A股 when:30d`,
  `${name} (site:finance.sina.com.cn OR site:eastmoney.com OR site:stcn.com OR site:cnstock.com) when:30d`,
  `${name} (site:cls.cn OR site:10jqka.com.cn OR site:jrj.com.cn) when:30d`
 ];
 return[];
}
function officialDisclosureItems(m,s,name){
 if(m==='TW')return[
  {headline:`${name}（${s}）公開資訊觀測站重大訊息`,summary:'查看公司最新重大訊息、公告與財務揭露。',url:`https://mops.twse.com.tw/mops/web/t05st01?co_id=${encodeURIComponent(s)}&firstin=1&step=1`,source:'公開資訊觀測站',datetime:nowIso(),official:true},
  {headline:'臺灣證券交易所最新市場與上市公司消息',summary:'查看證交所新聞、上市公司重大訊息與市場公告。',url:'https://www.twse.com.tw/zh/about/news/news/list.html',source:'臺灣證券交易所',datetime:nowIso(),official:true}
 ];
 if(m==='CN'){
  const isShanghai=/^(6|68)/.test(s),isBeijing=/^(4|8)/.test(s);
  const exchange=isBeijing?'北京證券交易所':isShanghai?'上海證券交易所':'深圳證券交易所';
  const url=isBeijing?'https://www.bse.cn/disclosure/announcement.html':isShanghai?'https://www.sse.com.cn/disclosure/listedinfo/announcement/':'https://www.szse.cn/disclosure/listed/notice/index.html';
  return[{headline:`${name}（${s}）${exchange}公告查詢`,summary:'查看交易所上市公司公告、定期報告與臨時公告。',url,source:exchange,datetime:nowIso(),official:true}];
 }
 return[];
}
function dedupeNews(rows){
 const seen=new Set();
 return rows.filter(x=>{
  const key=String(x.headline||'').toLowerCase().replace(/[\s｜|:：\-—_]+/g,'').slice(0,100);
  if(!key||seen.has(key))return false;
  seen.add(key);return true;
 }).sort((a,b)=>new Date(b.datetime||0)-new Date(a.datetime||0));
}
function compactNewsSummary(text=''){
 const clean=String(text).replace(/\s+/g,' ').trim();
 return clean.length>180?`${clean.slice(0,177)}…`:clean;
}
async function getNews(m,s,{force=false}={}){
 const key=`n:${m}:${s}`;if(force)cache.delete(key);const hit=getCache(key);if(hit)return hit;
 const row=await canonicalNameRow(m,s);
 const name=row.name&&row.name!==s?row.name:s;
 if(String(process.env.ALPHALENS_TEST_MODE||'')==='1'){
  const rows=[
   {headline:`${name} 發布最新營運重點`,summary:'公司持續投入核心產品、研發與全球市場，營運展望維持穩健。',url:'https://example.com/news/1',source:'測試新聞',datetime:nowIso(),official:true},
   {headline:`${name} 產業需求與景氣訊號更新`,summary:'需求、庫存與資本支出仍是近期重要觀察指標。',url:'https://example.com/news/2',source:'測試新聞',datetime:new Date(Date.now()-3600000).toISOString(),official:false}
  ];
  return setCache(key,rows,ttl.news);
 }
 let rows=[];

 if(process.env.FINNHUB_API_KEY&&m==='US'){
  try{
   const to=new Date(),from=new Date(Date.now()-30*86400000),fmt=d=>d.toISOString().slice(0,10);
   const d=await fetchJson(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(s)}&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`);
   rows=(d||[]).slice(0,20).map(x=>({headline:x.headline,summary:compactNewsSummary(x.summary),url:x.url,source:x.source,datetime:x.datetime?new Date(x.datetime*1000).toISOString():null}));
  }catch(e){mark('news-finnhub',false,e.message)}
 }

 if(m==='TW'||m==='CN'){
  const locale=m==='CN'?'zh-CN':'zh-TW';
  const feeds=await Promise.allSettled(newsPublisherQueries(m,name,s).map(async q=>{
   const xml=await fetchText(googleNewsRssUrl(q,locale),{timeout:10000});
   return parseRss(xml,'Google News 聚合');
  }));
  for(const result of feeds)if(result.status==='fulfilled')rows.push(...result.value);
  rows.push(...officialDisclosureItems(m,s,name));
 }

 rows=dedupeNews(rows).map(x=>({...x,summary:compactNewsSummary(x.summary)})).slice(0,24);
 return setCache(key,rows,ttl.news);
}


function valueFromUnit(fact,units=['USD','TWD','CNY','USD/shares']){
 if(!fact?.units)return[];for(const unit of units){if(Array.isArray(fact.units[unit]))return fact.units[unit]}return Object.values(fact.units).find(Array.isArray)||[];
}
function secQuarterSeries(facts,tags=[]){
 const rows=[];
 for(const tag of tags){const entries=valueFromUnit(facts?.['us-gaap']?.[tag]||facts?.['dei']?.[tag]);for(const x of entries){if(!hasNumber(x.val)||!x.end)continue;const frame=String(x.frame||'');if(!/^CY\d{4}Q[1-4]I?$/.test(frame))continue;const normalized=frame.replace(/I$/,'');rows.push({period:normalized.replace('CY','').replace('Q',' Q'),date:x.end,value:+x.val,form:x.form,sourceTag:tag,filed:x.filed})}if(rows.length)break}
 return [...new Map(rows.sort((a,b)=>String(b.date).localeCompare(a.date)).map(x=>[x.period,x])).values()].slice(0,12).sort((a,b)=>String(a.date).localeCompare(b.date));
}
function secAnnualSeries(facts,tags=[]){
 const rows=[];for(const tag of tags){const entries=valueFromUnit(facts?.['us-gaap']?.[tag]||facts?.['dei']?.[tag]);for(const x of entries){if(!hasNumber(x.val)||!x.end)continue;const frame=String(x.frame||'');if(!/^CY\d{4}$/.test(frame)||x.form!=='10-K')continue;rows.push({period:frame.slice(2),date:x.end,value:+x.val,sourceTag:tag,filed:x.filed})}if(rows.length)break}
 return [...new Map(rows.sort((a,b)=>String(b.date).localeCompare(a.date)).map(x=>[x.period,x])).values()].slice(0,8).sort((a,b)=>String(a.date).localeCompare(b.date));
}
function mergeTrendMetric(target,series,key){for(const x of series){let row=target.get(x.period);if(!row){row={period:x.period,date:x.date};target.set(x.period,row)}row[key]=x.value;row.date=row.date||x.date}}
function pctChange(current,previous){return hasNumber(current)&&hasNumber(previous)&&+previous!==0?(+current-+previous)/Math.abs(+previous)*100:null}
function trendInsights(quarterly=[]){const out=[],last=quarterly.at(-1),prev=quarterly.at(-2),yoy=quarterly.at(-5);if(last&&yoy&&hasNumber(last.revenue)&&hasNumber(yoy.revenue)){const v=pctChange(last.revenue,yoy.revenue);out.push(`營收年增 ${v>=0?'+':''}${v.toFixed(1)}%`)}if(last&&prev&&hasNumber(last.grossMargin)&&hasNumber(prev.grossMargin))out.push(`毛利率較前季 ${last.grossMargin>=prev.grossMargin?'改善':'下降'} ${Math.abs(last.grossMargin-prev.grossMargin).toFixed(1)} 個百分點`);if(last&&prev&&hasNumber(last.eps)&&hasNumber(prev.eps)){const v=pctChange(last.eps,prev.eps);out.push(`EPS 季變動 ${v>=0?'+':''}${v.toFixed(1)}%`)}if(last&&hasNumber(last.freeCashFlow))out.push(last.freeCashFlow>=0?'自由現金流為正':'自由現金流為負');return out.slice(0,5)}
function finalizeTrends({market,symbol,quarterly=[],annual=[],source='資料暫缺',sources=[],errors=[],derived=false}){
 quarterly=quarterly.filter(x=>x.period).sort((a,b)=>String(a.date||a.period).localeCompare(String(b.date||b.period))).slice(-8);
 annual=annual.filter(x=>x.period).sort((a,b)=>String(a.date||a.period).localeCompare(String(b.date||b.period))).slice(-5);
 for(const r of quarterly){if(hasNumber(r.grossProfit)&&hasNumber(r.revenue)&&+r.revenue!==0)r.grossMargin=+r.grossProfit/+r.revenue*100;if(hasNumber(r.netIncome)&&hasNumber(r.equity)&&+r.equity!==0)r.roe=+r.netIncome/+r.equity*4*100;if(hasNumber(r.operatingCashFlow)&&hasNumber(r.capex))r.freeCashFlow=+r.operatingCashFlow-Math.abs(+r.capex)}
 for(const r of annual){if(hasNumber(r.grossProfit)&&hasNumber(r.revenue)&&+r.revenue!==0)r.grossMargin=+r.grossProfit/+r.revenue*100;if(hasNumber(r.netIncome)&&hasNumber(r.equity)&&+r.equity!==0)r.roe=+r.netIncome/+r.equity*100;if(hasNumber(r.operatingCashFlow)&&hasNumber(r.capex))r.freeCashFlow=+r.operatingCashFlow-Math.abs(+r.capex)}
 const fields=['revenue','grossMargin','eps','roe','debt','cash','freeCashFlow'],present=fields.filter(k=>quarterly.some(x=>hasNumber(x[k]))||annual.some(x=>hasNumber(x[k]))).length;
 return{market,symbol,quarterly,annual,insights:trendInsights(quarterly),coverage:Math.round(present/fields.length*100),source,sources:[...new Set(sources.filter(Boolean))],errors:errors.slice(0,8),derived,updatedAt:nowIso()};
}
async function trendsSec(m,s,row){if(m!=='US')throw Error('unsupported');const map=await getSecTickerMap(),mapping=map[String(s).toUpperCase()];if(!mapping?.cik_str)throw Error('SEC CIK unavailable');const cik=String(mapping.cik_str).padStart(10,'0');const data=await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,{timeout:12000,headers:{'User-Agent':process.env.SEC_USER_AGENT||'AlphaLens Enterprise contact@example.com'}});const facts=data.facts||{},q=new Map(),a=new Map();
 mergeTrendMetric(q,secQuarterSeries(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),'revenue');mergeTrendMetric(q,secQuarterSeries(facts,['GrossProfit']),'grossProfit');mergeTrendMetric(q,secQuarterSeries(facts,['NetIncomeLoss','ProfitLoss']),'netIncome');mergeTrendMetric(q,secQuarterSeries(facts,['EarningsPerShareDiluted','EarningsPerShareBasic']),'eps');mergeTrendMetric(q,secQuarterSeries(facts,['StockholdersEquity']),'equity');mergeTrendMetric(q,secQuarterSeries(facts,['Liabilities']),'debt');mergeTrendMetric(q,secQuarterSeries(facts,['CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']),'cash');mergeTrendMetric(q,secQuarterSeries(facts,['NetCashProvidedByUsedInOperatingActivities']),'operatingCashFlow');mergeTrendMetric(q,secQuarterSeries(facts,['PaymentsToAcquirePropertyPlantAndEquipment']),'capex');
 mergeTrendMetric(a,secAnnualSeries(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),'revenue');mergeTrendMetric(a,secAnnualSeries(facts,['GrossProfit']),'grossProfit');mergeTrendMetric(a,secAnnualSeries(facts,['NetIncomeLoss','ProfitLoss']),'netIncome');mergeTrendMetric(a,secAnnualSeries(facts,['EarningsPerShareDiluted','EarningsPerShareBasic']),'eps');mergeTrendMetric(a,secAnnualSeries(facts,['StockholdersEquity']),'equity');mergeTrendMetric(a,secAnnualSeries(facts,['Liabilities']),'debt');mergeTrendMetric(a,secAnnualSeries(facts,['CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']),'cash');mergeTrendMetric(a,secAnnualSeries(facts,['NetCashProvidedByUsedInOperatingActivities']),'operatingCashFlow');mergeTrendMetric(a,secAnnualSeries(facts,['PaymentsToAcquirePropertyPlantAndEquipment']),'capex');
 const result=finalizeTrends({market:m,symbol:s,quarterly:[...q.values()],annual:[...a.values()],source:'美國 SEC Company Facts',sources:['美國 SEC Company Facts']});if(!result.quarterly.length&&!result.annual.length)throw Error('SEC trend data empty');return result}
async function trendsFmp(m,s,row){if(!process.env.FMP_API_KEY)throw Error('missing key');const candidates=symbolCandidates(m,s),errors=[];for(const candidate of candidates){try{const base='https://financialmodelingprep.com/stable',key=encodeURIComponent(process.env.FMP_API_KEY),symbol=encodeURIComponent(candidate);const [iq,bq,cq,ia,ba,ca]=await Promise.all([fetchJson(`${base}/income-statement?symbol=${symbol}&period=quarter&limit=8&apikey=${key}`,{timeout:10000}),fetchJson(`${base}/balance-sheet-statement?symbol=${symbol}&period=quarter&limit=8&apikey=${key}`,{timeout:10000}),fetchJson(`${base}/cash-flow-statement?symbol=${symbol}&period=quarter&limit=8&apikey=${key}`,{timeout:10000}),fetchJson(`${base}/income-statement?symbol=${symbol}&period=annual&limit=5&apikey=${key}`,{timeout:10000}),fetchJson(`${base}/balance-sheet-statement?symbol=${symbol}&period=annual&limit=5&apikey=${key}`,{timeout:10000}),fetchJson(`${base}/cash-flow-statement?symbol=${symbol}&period=annual&limit=5&apikey=${key}`,{timeout:10000})]);const rows=(x=>Array.isArray(x)?x:(x?.data||[]));const build=(income,balance,cash)=>rows(income).map((x,i)=>{const b=rows(balance)[i]||{},c=rows(cash)[i]||{};return{period:x.period||x.calendarYear||String(x.date||'').slice(0,10),date:x.date,revenue:numberOrNull(x.revenue),grossProfit:numberOrNull(x.grossProfit),netIncome:numberOrNull(x.netIncome),eps:numberOrNull(x.epsDiluted,x.eps),equity:numberOrNull(b.totalStockholdersEquity,b.totalEquity),debt:numberOrNull(b.totalLiabilities,b.totalDebt),cash:numberOrNull(b.cashAndCashEquivalents,b.cashAndShortTermInvestments),operatingCashFlow:numberOrNull(c.netCashProvidedByOperatingActivities,c.operatingCashFlow),capex:numberOrNull(c.investmentsInPropertyPlantAndEquipment,c.capitalExpenditure)}});const result=finalizeTrends({market:m,symbol:s,quarterly:build(iq,bq,cq),annual:build(ia,ba,ca),source:'Financial Modeling Prep',sources:['Financial Modeling Prep']});if(result.quarterly.length||result.annual.length)return result}catch(e){errors.push(e.message)}}throw Error(errors.join(' | ')||'FMP trend data empty')}
async function trendsFinMind(m,s,row){if(m!=='TW'||!process.env.FINMIND_TOKEN)throw Error('unsupported');const start=new Date(Date.now()-6*365*86400000).toISOString().slice(0,10);const d=await fetchJson(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=${encodeURIComponent(s)}&start_date=${start}&token=${encodeURIComponent(process.env.FINMIND_TOKEN)}`,{timeout:12000});const map=new Map();for(const x of d.data||[]){const period=String(x.date||'').slice(0,10);if(!period)continue;let r=map.get(period);if(!r){r={period,date:period};map.set(period,r)}const name=String(x.type||x.origin_name||'').toLowerCase(),v=numberOrNull(x.value);if(v==null)continue;if(/revenue|operatingrevenue|營業收入/.test(name))r.revenue=v;else if(/grossprofit|營業毛利/.test(name))r.grossProfit=v;else if(/earningspershare|基本每股盈餘/.test(name))r.eps=v;else if(/cashandcashequivalents|現金及約當現金/.test(name))r.cash=v;else if(/totalliabilities|負債總額/.test(name))r.debt=v;else if(/totalequity|權益總額/.test(name))r.equity=v;else if(/netcashflowsfromusedinoperatingactivities|營業活動之淨現金流入/.test(name))r.operatingCashFlow=v;else if(/propertyplantandequipment|不動產.*設備/.test(name))r.capex=v}const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));const result=finalizeTrends({market:m,symbol:s,quarterly:rows.slice(-8),annual:rows.filter((_,i)=>i%4===3).slice(-5),source:'FinMind 台灣財報',sources:['FinMind 台灣財報']});if(!result.quarterly.length)throw Error('FinMind trend data empty');return result}
async function trendsEastmoney(m,s,row){if(m!=='CN')throw Error('unsupported');const filter=encodeURIComponent(`(SECURITY_CODE=\"${cleanSymbol(s)}\")`);const d=await fetchJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=ALL&filter=${filter}&pageNumber=1&pageSize=12&sortColumns=REPORT_DATE&sortTypes=-1`,{timeout:12000,headers:{Referer:'https://data.eastmoney.com/'}});const rows=(d?.result?.data||[]).map(x=>({period:String(x.REPORT_DATE_NAME||x.REPORT_DATE||'').slice(0,10),date:String(x.REPORT_DATE||'').slice(0,10),revenue:numberOrNull(x.TOTAL_OPERATE_INCOME,x.OPERATE_INCOME),grossProfit:numberOrNull(x.GROSS_PROFIT),netIncome:numberOrNull(x.PARENT_NETPROFIT,x.NETPROFIT),eps:numberOrNull(x.BASIC_EPS,x.DEDUCT_BASIC_EPS),equity:numberOrNull(x.TOTAL_EQUITY,x.PARENT_HOLDER_EQUITY),debt:numberOrNull(x.TOTAL_LIABILITIES),cash:numberOrNull(x.MONETARYFUNDS),operatingCashFlow:numberOrNull(x.NETCASH_OPERATE),capex:numberOrNull(x.CONSTRUCT_LONG_ASSET)}));const result=finalizeTrends({market:m,symbol:s,quarterly:rows.slice().reverse().slice(-8),annual:rows.filter(x=>String(x.date).slice(5,10)==='12-31').reverse().slice(-5),source:'東方財富財務報表',sources:['東方財富財務報表']});if(!result.quarterly.length)throw Error('Eastmoney trend data empty');return result}
async function derivedTrends(m,s){const f=await getFund(m,s),year=new Date().getFullYear(),quarterly=[];for(let i=7;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i*3);const q=Math.floor(d.getMonth()/3)+1;const drift=1+(7-i)*((Number(f.growth)||0)/100/8);quarterly.push({period:`${d.getFullYear()} Q${q}`,date:d.toISOString().slice(0,10),revenue:hasNumber(f.marketCap)?Math.max(1,+f.marketCap*.02*drift):null,grossMargin:numberOrNull(f.margin),eps:hasNumber(f.eps)?+f.eps/4*drift:null,roe:numberOrNull(f.roe),debt:numberOrNull(f.debt),cash:null,freeCashFlow:hasNumber(f.freeCashFlow)?+f.freeCashFlow/4*drift:null})}return finalizeTrends({market:m,symbol:s,quarterly,annual:[],source:`${f.source||'基本面'}衍生趨勢`,sources:[f.source||'基本面'],errors:['部分市場未取得歷史財報，圖表為已標示的趨勢估計'],derived:true})}
async function getFinancialTrends(m,s,{force=false}={}){const key=`trends:${m}:${s}`;if(force)cache.delete(key);const hit=getCache(key);if(hit)return hit;return coalesce(key,async()=>{const cached=getCache(key);if(cached&&!force)return cached;const row=await resolveCatalogRow(m,s);if(String(process.env.ALPHALENS_TEST_MODE||'')==='1'){const quarterly=Array.from({length:8},(_,i)=>{const d=new Date(2024,i*3,1);return{period:`${d.getFullYear()} Q${Math.floor(d.getMonth()/3)+1}`,date:d.toISOString(),revenue:100+i*8,grossMargin:40+i*.4,eps:2+i*.2,roe:15+i*.3,debt:40-i*.4,cash:30+i,freeCashFlow:18+i*1.5}});return setCache(key,finalizeTrends({market:m,symbol:s,quarterly,annual:[],source:'測試財務趨勢',sources:['測試財務趨勢']}),ttl.trends)}const providers=m==='US'?[trendsSec,trendsFmp]:m==='TW'?[trendsFinMind,trendsFmp]:[trendsEastmoney,trendsFmp],errors=[];for(const fn of providers){try{const result=await withDeadline(fn(m,s,row),18000,fn.name);mark(`trends-${fn.name}`,true);return setCache(key,result,ttl.trends)}catch(e){errors.push(`${fn.name}: ${e.message}`);mark(`trends-${fn.name}`,false,e.message)}}const fallback=await derivedTrends(m,s);fallback.errors=[...errors,...fallback.errors];return setCache(key,fallback,15*60*1000)})}

function ruleSummary(news=[]){
 if(!news.length)return{summary:'目前沒有可用新聞資料。',sentiment:'中性',highlights:[],sources:[]};
 const text=news.map(x=>`${x.headline} ${x.summary}`).join(' ').toLowerCase();
 const pos=(text.match(/growth|beat|record|upgrade|profit|成長|創高|上調|獲利|增長|中標|擴產|回購/g)||[]).length;
 const neg=(text.match(/miss|cut|decline|lawsuit|risk|下滑|虧損|風險|減持|處罰|調查|違規/g)||[]).length;
 const sources=[...new Set(news.map(x=>x.source).filter(Boolean))];
 const topics=[];
 const topicRules=[['財報與營收',/營收|財報|獲利|淨利|eps|業績|年報|季報/i],['產品與產能',/產品|新品|產能|擴產|工廠|晶片|電池/i],['法人與資金',/法人|外資|投信|資金|融資|持股|增持|減持/i],['政策與監管',/政策|監管|公告|交易所|處罰|調查/i],['合作與訂單',/合作|訂單|中標|供應|客戶|合約/i]];
 for(const [label,rx] of topicRules)if(rx.test(text))topics.push(label);
 const mood=pos>neg?'正向':neg>pos?'保守':'中性';
 return{
  summary:`彙整最近 ${news.length} 則消息，涵蓋 ${sources.length} 個來源，整體情緒偏${mood}${topics.length?`；主要主題包括${topics.slice(0,3).join('、')}`:''}。`,
  sentiment:mood,
  highlights:news.filter(x=>!x.official).slice(0,4).map(x=>x.headline),
  sources:sources.slice(0,8)
 };
}

function ruleAiAnalysis(payload={}){
 const fund=payload.fundamentals||{},quote=payload.quote||{},news=payload.news||[],profile=payload.profile||{};
 const baseScore=hasNumber(fund.total)?+fund.total:hasNumber(fund.score)?+fund.score:50,sentiment=ruleSummary(news),name=profile.displayName||profile.name||fund.name||quote.name||quote.symbol||'本公司';
 const risks=[...(fund.risks||[])],catalysts=[...(fund.strengths||[])];
 if(fund.pe!=null&&fund.pe>50)risks.push('估值偏高，市場預期若降溫可能出現修正');
 if(fund.growth!=null&&fund.growth<0)risks.push('營收成長為負，需辨識是景氣循環或結構性衰退');
 if(fund.debt!=null&&fund.debt>70)risks.push('負債比偏高，利率與景氣變化可能放大風險');
 if(!news.length)risks.push('近期事件資料不足，新聞風險判斷可信度較低');
 if((profile.completeness||0)<55)risks.push('公司資料完整度偏低，分析需搭配官方公告確認');
 if(fund.growth!=null&&fund.growth>=15)catalysts.push('營收成長動能偏強');
 if(fund.roe!=null&&fund.roe>=15)catalysts.push('股東權益報酬率具競爭力');
 if(fund.freeCashFlow!=null&&fund.freeCashFlow>0)catalysts.push('自由現金流為正');
 if(sentiment.sentiment==='正向')catalysts.push('近期公開消息情緒偏正向');
 const valuation=fund.pe==null?'估值資料不足，暫不做精準判斷。':fund.pe<=18?`本益比約 ${fund.pe.toFixed(1)} 倍，估值相對保守。`:fund.pe<=32?`本益比約 ${fund.pe.toFixed(1)} 倍，估值位於合理至略高區間。`:`本益比約 ${fund.pe.toFixed(1)} 倍，市場已反映較高成長預期。`;
 const growth=fund.growth==null?'成長資料不足。':fund.growth>=15?`營收年增約 ${fund.growth.toFixed(1)}%，成長動能偏強。`:fund.growth>=0?`營收年增約 ${fund.growth.toFixed(1)}%，維持溫和成長。`:`營收年增約 ${fund.growth.toFixed(1)}%，目前處於衰退。`;
 const health=[fund.roe!=null?`ROE ${fund.roe.toFixed(1)}%`:null,fund.debt!=null?`負債比 ${fund.debt.toFixed(1)}%`:null,fund.margin!=null?`毛利率 ${fund.margin.toFixed(1)}%`:null,fund.freeCashFlow!=null?`自由現金流${fund.freeCashFlow>0?'為正':'為負'}`:null].filter(Boolean).join('；')||'財務指標不足。';
 let signalScore=baseScore;
 if(sentiment.sentiment==='正向')signalScore+=4;if(sentiment.sentiment==='保守')signalScore-=5;
 if(hasNumber(quote.changePercent)){if(+quote.changePercent>4)signalScore-=2;if(+quote.changePercent<-4)signalScore-=3}
 signalScore=Math.max(0,Math.min(100,Math.round(signalScore)));
 const signal=signalScore>=76?'買入':signalScore>=48?'持有':'賣出';
 const industry=profile.industry||fund.industry||'相關產業',products=(profile.products||[]).slice(0,3).join('、')||`${industry}產品與服務`;
 const oneMinuteSummary=[`${name}主要從事${products}。`,fund.margin!=null?`目前毛利率約 ${fund.margin.toFixed(1)}%，獲利模式需搭配產業週期評估。`:`主要獲利來源與產品組合需以公司最新財報確認。`,fund.growth!=null&&fund.growth>=10?`成長重點在既有業務擴張與產業需求提升。`:`未來成長仍需觀察需求、競爭與新產品進度。`];
 const quality=Math.round(((fund.coverage||0)*.45)+((profile.completeness||0)*.35)+Math.min(100,news.length*10)*.2);
 const moat={brand:Math.max(35,Math.min(95,55+(profile.competitors?.length?5:0)+(profile.products?.length>=3?8:0))),technology:Math.max(35,Math.min(95,industry.match(/半導體|科技|軟體|AI|電池|電子/i)?75:58)),scale:Math.max(35,Math.min(95,(fund.marketCap||0)>1e11?85:(fund.marketCap||0)>1e10?72:55)),profitability:Math.max(25,Math.min(95,fund.roe!=null?45+fund.roe:55))};
 const riskRadar=[{name:'估值',level:fund.pe==null?'資料不足':fund.pe>45?'高':fund.pe>28?'中':'低',reason:valuation},{name:'成長',level:fund.growth==null?'資料不足':fund.growth<0?'高':fund.growth<8?'中':'低',reason:growth},{name:'財務',level:fund.debt==null?'資料不足':fund.debt>70?'高':fund.debt>50?'中':'低',reason:health},{name:'事件',level:sentiment.sentiment==='保守'?'高':news.length<2?'資料不足':'中',reason:sentiment.summary}];
 const evidence=[
 {label:'基本面評分',value:fund.total==null?'資料不足':`${fund.total} 分`,source:fund.source||'未知',date:fund.updatedAt||nowIso()},
 {label:'營收成長',value:fund.growth==null?'資料不足':`${fund.growth.toFixed(1)}%`,source:fund.fieldSources?.growth||fund.source||'未知',date:fund.updatedAt||nowIso()},
 {label:'ROE',value:fund.roe==null?'資料不足':`${fund.roe.toFixed(1)}%`,source:fund.fieldSources?.roe||fund.source||'未知',date:fund.updatedAt||nowIso()},
 {label:'行情動能',value:quote.changePercent==null?'資料不足':`${Number(quote.changePercent).toFixed(2)}%`,source:quote.source||'未知',date:quote.updatedAt||nowIso()},
 {label:'新聞情緒',value:sentiment.sentiment||'中性',source:(sentiment.sources||[]).join(' / ')||'新聞摘要',date:news[0]?.datetime||nowIso()}
 ];
 const missingData=['eps','pe','roe','growth','freeCashFlow'].filter(k=>fund[k]==null).map(k=>({eps:'EPS',pe:'本益比',roe:'ROE',growth:'營收成長',freeCashFlow:'自由現金流'}[k]));
 const upgradeConditions=signal==='買入'?['下一季營收與毛利率維持改善','估值沒有明顯擴張']:['營收增速回升且現金流改善','估值回到合理區間','重大風險解除'];
 const downgradeConditions=['營收或 EPS 連續兩季惡化','自由現金流轉負且未改善','重大監管、治理或產品風險升高'];
 return{stance:signalScore>=80?'基本面偏強':signalScore>=65?'偏正向觀察':signalScore>=48?'中性觀察':'風險偏高',signal,signalScore,summary:`${name}綜合研究分數 ${signalScore} 分。${sentiment.summary}`,confidence:Math.max(35,Math.min(92,quality)),valuation,growth,financialHealth:health,catalysts:[...new Set(catalysts)].slice(0,6),risks:[...new Set(risks)].slice(0,7),actionPlan:signal==='買入'?['避免追高，採分批方式','確認估值與下一季財報','設定基本面失效條件']:signal==='持有'?['持續追蹤營收、毛利率與現金流','等待估值或成長改善','重大事件後重新評估']:['優先控制部位風險','等待獲利與現金流改善','避免只因價格下跌而攤平'],oneMinuteSummary,businessModel:`以${products}為主要業務，實際營收結構應以最新年報或法說會資料為準。`,moat,longTermView:{label:signalScore>=75?'具長期觀察價值':signalScore>=55?'中性觀察':signalScore>=40?'需等待改善':'長期風險偏高',score:signalScore,reason:catalysts[0]||risks[0]||'資料不足'},riskRadar,peerNotes:(profile.competitors||[]).slice(0,5),evidence,missingData,upgradeConditions,downgradeConditions,asOf:nowIso(),methodology:'基本面、行情、公司資料與新聞的多來源交叉評分',dataQuality:`資料品質 ${quality}/100；基本面來源：${fund.source||'未知'}；公司資料：${profile.source||'未知'}；新聞 ${news.length} 則；行情來源：${quote.source||'未知'}`,source:'AlphaLens 規則引擎'};
}
function extractJsonText(text=''){const cleaned=String(text).replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();const first=cleaned.indexOf('{'),last=cleaned.lastIndexOf('}');if(first<0||last<=first)throw Error('AI did not return JSON');return JSON.parse(cleaned.slice(first,last+1))}
async function callOpenAiJson(input){
 if(!process.env.OPENAI_API_KEY)throw Error('OpenAI key missing');const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);
 try{const r=await fetch(`${process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'}/responses`,{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5-mini',input,temperature:0.2}),signal:c.signal});if(!r.ok)throw Error(`OpenAI ${r.status}`);const j=await r.json(),txt=j.output_text||j.output?.flatMap(o=>o.content||[]).map(x=>x.text||'').join('')||'';return extractJsonText(txt)}finally{clearTimeout(timer)}
}
async function callGeminiJson(input){
 if(!process.env.GEMINI_API_KEY)throw Error('Gemini key missing');const model=process.env.GEMINI_MODEL||'gemini-2.5-flash',c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);
 try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:input}]}],generationConfig:{temperature:.2,responseMimeType:'application/json'}}),signal:c.signal});if(!r.ok)throw Error(`Gemini ${r.status}`);const j=await r.json(),txt=j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';return extractJsonText(txt)}finally{clearTimeout(timer)}
}
function normalizeAiAnalysis(parsed={},fallback={}){
 const signal=['買入','持有','賣出'].includes(parsed.signal)?parsed.signal:fallback.signal;
 const number=(v,d)=>hasNumber(v)?Math.max(0,Math.min(100,Math.round(+v))):d;
 const arr=(v,d=[],limit=8)=>Array.isArray(v)?v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,limit):d;
 const riskRadar=Array.isArray(parsed.riskRadar)?parsed.riskRadar.filter(x=>x&&x.name).slice(0,6).map(x=>({name:String(x.name),level:['低','中','高','資料不足'].includes(x.level)?x.level:'資料不足',reason:String(x.reason||'')})):fallback.riskRadar;
 const moat={};for(const k of ['brand','technology','scale','profitability'])moat[k]=number(parsed.moat?.[k],fallback.moat?.[k]||50);
 return{...fallback,...parsed,signal,signalScore:number(parsed.signalScore,fallback.signalScore),confidence:number(parsed.confidence,fallback.confidence),catalysts:arr(parsed.catalysts,fallback.catalysts,6),risks:arr(parsed.risks,fallback.risks,7),actionPlan:arr(parsed.actionPlan,fallback.actionPlan,5),oneMinuteSummary:arr(parsed.oneMinuteSummary,fallback.oneMinuteSummary,3),peerNotes:arr(parsed.peerNotes,fallback.peerNotes,5),riskRadar,moat,longTermView:{...fallback.longTermView,...(parsed.longTermView||{}),score:number(parsed.longTermView?.score,fallback.longTermView?.score)},evidence:fallback.evidence,missingData:[...new Set([...(fallback.missingData||[]),...arr(parsed.missingData,[],10)])],upgradeConditions:arr(parsed.upgradeConditions,fallback.upgradeConditions,6),downgradeConditions:arr(parsed.downgradeConditions,fallback.downgradeConditions,6),asOf:nowIso(),methodology:String(parsed.methodology||fallback.methodology||''),dataQuality:String(parsed.dataQuality||fallback.dataQuality||'')};
}
async function aiAnalyze(payload){
 const fallback=ruleAiAnalysis(payload);if(String(process.env.ALPHALENS_TEST_MODE||'')==='1')return fallback;
 const schema='{"stance":"","signal":"買入|持有|賣出","signalScore":0,"summary":"","confidence":0,"valuation":"","growth":"","financialHealth":"","catalysts":[""],"risks":[""],"actionPlan":[""],"oneMinuteSummary":["","",""],"businessModel":"","moat":{"brand":0,"technology":0,"scale":0,"profitability":0},"longTermView":{"label":"","score":0,"reason":""},"riskRadar":[{"name":"","level":"低|中|高|資料不足","reason":""}],"peerNotes":[""],"evidence":[{"label":"","value":"","source":"","date":""}],"missingData":[""],"upgradeConditions":[""],"downgradeConditions":[""],"methodology":"","dataQuality":""}';
 const input=`你是專業股票研究助理。僅根據提供資料，以繁體中文輸出嚴格 JSON，不得加入 Markdown，不得虛構缺少數據。投資訊號只能是買入、持有、賣出，且必須明確標示為研究參考。JSON 結構：${schema}。資料：${JSON.stringify(payload).slice(0,24000)}`;
 const order=String(process.env.AI_PROVIDER_ORDER||'openai,gemini').split(',').map(x=>x.trim().toLowerCase());
 for(const provider of order){try{const parsed=provider==='gemini'?await callGeminiJson(input):provider==='openai'?await callOpenAiJson(input):null;if(parsed){mark(`ai-${provider}`,true);return{...normalizeAiAnalysis(parsed,fallback),source:provider==='gemini'?'Google Gemini':'OpenAI'}}}catch(e){mark(`ai-${provider}`,false,e.message)}}
 return{...fallback,source:'AlphaLens 規則引擎備援'};
}

async function translateToZh(text){
 const value=String(text||'').trim();if(!value)return{translated:'',source:'無內容'};
 if(/[一-鿿]/.test(value)&&value.replace(/[^一-鿿]/g,'').length>value.length*.15)return{translated:value,source:'原文已含中文'};
 const prompt=`請將以下公司介紹忠實翻譯為繁體中文。保留公司、產品與專有名詞，不補充、不評論，只輸出翻譯內容：\n${value.slice(0,5000)}`;
 if(process.env.OPENAI_API_KEY){const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);try{const r=await fetch(`${process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'}/responses`,{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5-mini',input:prompt}),signal:c.signal});if(r.ok){const j=await r.json(),t=j.output_text||j.output?.flatMap(o=>o.content||[]).map(x=>x.text||'').join('')||'';if(t.trim())return{translated:t.trim(),source:'OpenAI 翻譯'}}}catch(e){mark('translate-openai',false,e.message)}finally{clearTimeout(timer)}}
 if(process.env.GEMINI_API_KEY){const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);try{const model=process.env.GEMINI_MODEL||'gemini-2.5-flash',r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.1}}),signal:c.signal});if(r.ok){const j=await r.json(),t=j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';if(t.trim())return{translated:t.trim(),source:'Google Gemini 翻譯'}}}catch(e){mark('translate-gemini',false,e.message)}finally{clearTimeout(timer)}}
 try{const d=await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(value.slice(0,4500))}&langpair=auto|zh-TW`,{timeout:12000});const t=d?.responseData?.translatedText;if(t&&t!==value)return{translated:t,source:'MyMemory 翻譯'}}catch(e){mark('translate-mymemory',false,e.message)}
 return{translated:value,source:'翻譯服務不可用，顯示原文'};
}

let writeChain=Promise.resolve();async function dbRead(){try{return{...EMPTY_DB,...JSON.parse(await fs.readFile(DATA_FILE,'utf8'))}}catch{return structuredClone(EMPTY_DB)}}async function dbMutate(fn){writeChain=writeChain.then(async()=>{const db=await dbRead(),result=await fn(db),tmp=`${DATA_FILE}.tmp`;await fs.writeFile(tmp,JSON.stringify(db,null,2));await fs.rename(tmp,DATA_FILE);return result});return writeChain}
async function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex'),d=await scrypt(p,salt,64);return`scrypt:${salt}:${Buffer.from(d).toString('hex')}`}async function verifyPassword(p,stored){if(!stored?.startsWith('scrypt:'))return false;const[,salt,h]=stored.split(':'),a=Buffer.from(await scrypt(p,salt,64)),b=Buffer.from(h,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
const publicUser=u=>({id:u.id,name:u.name,email:u.email});const tokenFor=u=>jwt.sign({sub:u.id,name:u.name,email:u.email},JWT_SECRET,{expiresIn:'7d',issuer:'alphalens'});function auth(req,res,next){const t=req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];if(!t)return res.status(401).json({error:'尚未登入'});try{req.user=jwt.verify(t,JWT_SECRET,{issuer:'alphalens'});next()}catch{return res.status(401).json({error:'登入已失效'})}}


const RANKING_UNIVERSE={
 TW:[
  ['2330','台積電','TWSE','半導體'],['2317','鴻海','TWSE','電子代工'],['2454','聯發科','TWSE','IC 設計'],['2308','台達電','TWSE','電源管理'],['2382','廣達','TWSE','AI 伺服器'],
  ['2881','富邦金','TWSE','金融'],['2882','國泰金','TWSE','金融'],['2891','中信金','TWSE','金融'],['2303','聯電','TWSE','半導體'],['2412','中華電','TWSE','電信'],
  ['3711','日月光投控','TWSE','半導體封測'],['3231','緯創','TWSE','電子代工'],['2357','華碩','TWSE','電腦硬體'],['2379','瑞昱','TWSE','IC 設計'],['3034','聯詠','TWSE','IC 設計']
 ],
 CN:[
  ['600519','貴州茅台','SSE','白酒'],['300750','寧德時代','SZSE','新能源電池'],['002594','比亞迪','SZSE','新能源車'],['601318','中國平安','SSE','金融保險'],['600036','招商銀行','SSE','銀行'],
  ['000858','五糧液','SZSE','白酒'],['600276','恆瑞醫藥','SSE','醫藥'],['601012','隆基綠能','SSE','太陽能'],['000333','美的集團','SZSE','家電'],['000651','格力電器','SZSE','家電'],
  ['300308','中際旭創','SZSE','光通訊'],['688981','中芯國際','SSE','半導體'],['601888','中國中免','SSE','零售旅遊'],['600900','長江電力','SSE','公用事業'],['601166','興業銀行','SSE','銀行']
 ],
 US:[
  ['AAPL','Apple','NASDAQ','消費電子'],['MSFT','Microsoft','NASDAQ','軟體與雲端'],['NVDA','NVIDIA','NASDAQ','半導體'],['AMZN','Amazon','NASDAQ','電商與雲端'],['GOOGL','Alphabet','NASDAQ','網路服務'],
  ['META','Meta','NASDAQ','社群媒體'],['TSLA','Tesla','NASDAQ','電動車'],['AVGO','Broadcom','NASDAQ','半導體'],['AMD','AMD','NASDAQ','半導體'],['NFLX','Netflix','NASDAQ','串流媒體'],
  ['JPM','JPMorgan Chase','NYSE','銀行'],['V','Visa','NYSE','支付'],['WMT','Walmart','NYSE','零售'],['PLTR','Palantir','NASDAQ','AI 軟體'],['COST','Costco','NASDAQ','零售']
 ]
};
async function mapLimit(rows,limit,worker){
 const out=new Array(rows.length);let index=0;
 async function run(){while(index<rows.length){const i=index++;try{out[i]=await worker(rows[i],i)}catch(e){out[i]={error:e.message}}}}
 await Promise.all(Array.from({length:Math.min(limit,rows.length)},run));return out;
}
function rankingSort(rows,type){
 const safe=(v,fallback=0)=>hasNumber(v)?+v:fallback;
 const copy=[...rows];
 if(type==='losers')return copy.sort((a,b)=>safe(a.changePercent,999)-safe(b.changePercent,999));
 if(type==='volume')return copy.sort((a,b)=>safe(b.volume)-safe(a.volume));
 if(type==='value')return copy.sort((a,b)=>safe(b.turnover)-safe(a.turnover));
 if(type==='hot')return copy.sort((a,b)=>safe(b.hotScore)-safe(a.hotScore));
 return copy.sort((a,b)=>safe(b.changePercent,-999)-safe(a.changePercent,-999));
}
async function getRankingBase(m,{force=false}={}){
 const key=`rankingbase:${m}`;if(force)cache.delete(key);const hit=getCache(key);if(hit)return hit;
 return coalesce(key,async()=>{const cached=getCache(key);if(cached&&!force)return cached;const universe=RANKING_UNIVERSE[m]||RANKING_UNIVERSE.US;
  const rows=await mapLimit(universe,4,async([symbol,name,exchange,industry])=>{const q=await getQuote(m,symbol,{force:false});const price=hasNumber(q.price)?+q.price:null,change=hasNumber(q.change)?+q.change:null,changePercent=hasNumber(q.changePercent)?+q.changePercent:null,volume=hasNumber(q.volume)?+q.volume:0,turnover=price!=null?price*volume:0,hotScore=Math.abs(changePercent||0)*20+Math.log10(Math.max(1,volume))*8+(q.isRealtime?10:0);const canonical=String(process.env.ALPHALENS_TEST_MODE||'')==='1'?{name,exchange}:await canonicalNameRow(m,symbol);return{market:m,symbol,name:(m==='TW'||m==='CN')&&isChineseName(canonical.name)?canonical.name:(q.name&&q.name!==symbol?q.name:name),exchange:q.exchange||canonical.exchange||exchange,industry,currency:q.currency,price,change,changePercent,volume,turnover,hotScore,source:q.source||'未知',updatedAt:q.updatedAt||nowIso(),isDemo:Boolean(q.isDemo),isRealtime:Boolean(q.isRealtime)}});
  const valid=rows.filter(x=>x&&!x.error),sources=[...new Set(valid.map(x=>x.source).filter(Boolean))];return setCache(key,{market:m,rows:valid,source:sources.join(' / ')||'資料來源未知',updatedAt:nowIso()},30000)});
}
async function getRanking(m,{force=false,type='gainers'}={}){
 const rankingType=['gainers','losers','volume','value','hot'].includes(type)?type:'gainers',base=await getRankingBase(m,{force});return{...base,type:rankingType,rows:rankingSort(base.rows,rankingType).slice(0,15)};
}


function settledValue(result,fallback=null){
 return result.status==='fulfilled'?result.value:fallback;
}
function snapshotQuality({quote,fundamentals,news,profile},errors=[]){
 const fundFields=['eps','pe','pb','roe','roa','margin','operatingMargin','netMargin','debt','currentRatio','quickRatio','growth','epsGrowth','freeCashFlow','dividendYield'];
 const present=fundFields.filter(k=>fundamentals?.[k]!=null&&Number.isFinite(+fundamentals[k])).length;
 const sourceNames=[
  quote?.source,fundamentals?.source,profile?.source,
  ...(Array.isArray(news)?news.map(x=>x.source):[])
 ].filter(Boolean);
 const uniqueSources=[...new Set(sourceNames)];
 const coverage=Math.round((present/fundFields.length)*100);
 const live=Boolean(quote&&!quote.isDemo),fallbackNotes=[];
 if(quote?.isDemo)fallbackNotes.push('行情使用展示備援');
 if(fundamentals?.isFallback)fallbackNotes.push('基本面使用內建備援');
 if(profile?.isFallback)fallbackNotes.push('公司資料使用本地備援');
 return {
  coverage,
  sourceCount:uniqueSources.length,
  sources:uniqueSources.slice(0,12),
  live,
  partial:errors.length>0||fallbackNotes.length>0,
  errors:[...errors,...fallbackNotes],
  updatedAt:nowIso()
 };
}
async function getSnapshot(m,s,{force=false}={}){
 const key=`snapshot:${m}:${s}`;
 if(force)cache.delete(key);
 const hit=getCache(key);if(hit)return hit;
 return coalesce(key,async()=>{
 const cached=getCache(key);if(cached&&!force)return cached;
 const tasks=[
  withDeadline(getQuote(m,s,{force}),10000,'snapshot quote'),
  withDeadline(getFund(m,s,{force}),16000,'snapshot fundamentals'),
  withDeadline(getNews(m,s,{force}),14000,'snapshot news'),
  withDeadline(getCompanyProfile(m,s,{force}),18000,'snapshot company')
 ];
 const labels=['quote','fundamentals','news','profile'];
 const started=Date.now();
 const results=await Promise.allSettled(tasks);
 const errors=results.map((r,i)=>r.status==='rejected'?`${labels[i]}: ${r.reason?.message||'unknown error'}`:null).filter(Boolean);
 const data={
  market:m,symbol:s,
  quote:settledValue(results[0],null),
  fundamentals:settledValue(results[1],{market:m,symbol:s,total:null,rating:'資料不足',coverage:0,subScores:{},source:'資料暫缺'}),
  news:settledValue(results[2],[]),
  profile:settledValue(results[3],profileFallback(catalog.find(x=>x.market===m&&x.symbol===s)||{},m,s)),
  latencyMs:Date.now()-started
 };
 data.quality=snapshotQuality(data,errors);
 return setCache(key,data,15000);
 });
}

app.get('/api/snapshot',async(req,res)=>res.json(await getSnapshot(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.get('/api/system/status',(_req,res)=>res.json({
 version:APP_VERSION,
 uptimeSeconds:Math.round(process.uptime()),
 catalogCount:catalog.length,
 cacheEntries:cache.size,
 providers:[...providerHealth.entries()].map(([name,value])=>({name,...value})),
 updatedAt:nowIso()
}));
app.get('/api/version',(_q,res)=>res.json({version:APP_VERSION}));
app.get('/api/health',(_q,res)=>res.json({ok:true,catalogCount:catalog.length,
 configured:{fugle:Boolean(process.env.FUGLE_API_KEY),finmind:Boolean(process.env.FINMIND_TOKEN),alltick:Boolean(process.env.ALLTICK_TOKEN),finnhub:Boolean(process.env.FINNHUB_API_KEY),twelve:Boolean(process.env.TWELVE_DATA_API_KEY),fmp:Boolean(process.env.FMP_API_KEY)},
 providerHealth:Object.fromEntries(providerHealth),cacheEntries:cache.size,time:nowIso()}));
app.post('/api/catalog/sync',async(_q,res)=>res.json(await syncCatalog()));
app.get('/api/ranking',async(req,res)=>res.json(await getRanking(normMarket(req.query.market),{force:String(req.query.refresh||'')==='1',type:String(req.query.type||'gainers')})));
app.get('/api/search',async(req,res)=>{const q=String(req.query.q||'').trim().slice(0,80),m=normMarket(req.query.market);if(!q)return res.json([]);const key=`s:${m}:${q.toLowerCase()}`,hit=getCache(key);if(hit)return res.json(hit);let exact=[];if(m==='CN'&&cnStockCodeValid(q)){try{exact=[await cnStockNameDetail(q)]}catch{}}if(m==='TW'){try{await ensureTwCatalog()}catch{}}const rows=dedupe([...exact,...localSearch(q,m),...await remoteSearch(q,m)]).slice(0,50).map(x=>({...x,name:(m==='TW'||m==='CN')&&isChineseName(x.name)?x.name:(x.name||x.symbol),tradingView:x.tradingView||tradingViewSymbol(x)}));res.json(setCache(key,rows,ttl.search))});
app.post('/api/names',async(req,res)=>{const items=Array.isArray(req.body?.items)?req.body.items.slice(0,100):[];const rows=[];for(const x of items){const market=normMarket(x.market),symbol=normSymbol(x.symbol);try{const row=await canonicalNameRow(market,symbol);rows.push({ok:true,market,symbol,name:row.name,exchange:row.exchange,source:row.source||'股票名稱引擎'})}catch(e){rows.push({ok:false,market,symbol,name:symbol,error:e.message})}}res.json({rows,updatedAt:nowIso()})});
app.get('/api/quote',async(req,res)=>res.json(await getQuote(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.post('/api/quotes',async(req,res)=>{const items=Array.isArray(req.body?.items)?req.body.items.slice(0,60):[],force=Boolean(req.body?.refresh),results=[];for(let i=0;i<items.length;i+=6){const chunk=items.slice(i,i+6);results.push(...await Promise.all(chunk.map(async x=>{const market=normMarket(x.market),symbol=normSymbol(x.symbol);try{return{ok:true,market,symbol,quote:await getQuote(market,symbol,{force})}}catch(e){return{ok:false,market,symbol,error:e.message}}}))) }res.json({rows:results,updatedAt:nowIso()})});
app.get('/api/history',async(req,res)=>res.json(await getHistory(normMarket(req.query.market),normSymbol(req.query.symbol),String(req.query.range||'1M'))));
app.get('/api/company',async(req,res)=>res.json(await getCompanyProfile(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.get('/api/fundamentals',async(req,res)=>res.json(await getFund(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.get('/api/financial-trends',async(req,res)=>res.json(await getFinancialTrends(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.get('/api/news',async(req,res)=>res.json(await getNews(normMarket(req.query.market),normSymbol(req.query.symbol),{force:String(req.query.refresh||'')==='1'})));
app.post('/api/news/summary',async(req,res)=>res.json(ruleSummary(req.body.news||[])));
app.post('/api/ai/analyze',async(req,res)=>res.json(await aiAnalyze(req.body)));
app.post('/api/translate',async(req,res)=>res.json(await translateToZh(req.body.text)));
app.post('/api/auth/register',async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,80),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');if(!name||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return res.status(400).json({error:'請填寫正確姓名、Email 與至少 8 碼密碼'});try{const u=await dbMutate(async db=>{if(db.users.some(x=>x.email===email))throw Error('Email 已註冊');const u={id:uuid(),name,email,password:await hashPassword(password),createdAt:nowIso()};db.users.push(u);return u});res.json({token:tokenFor(u),user:publicUser(u)})}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||''),db=await dbRead(),u=db.users.find(x=>x.email===email);if(!u||!await verifyPassword(password,u.password))return res.status(401).json({error:'Email 或密碼錯誤'});res.json({token:tokenFor(u),user:publicUser(u)})});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:{id:req.user.sub,name:req.user.name,email:req.user.email}}));
app.get('/api/watchlist',auth,async(req,res)=>{const db=await dbRead();res.json(db.watchlists.filter(x=>x.userId===req.user.sub))});
app.post('/api/watchlist',auth,async(req,res)=>{const m=normMarket(req.body.market),s=normSymbol(req.body.symbol),name=String(req.body.name||s).slice(0,120);const x=await dbMutate(db=>{let r=db.watchlists.find(x=>x.userId===req.user.sub&&x.market===m&&x.symbol===s);if(!r){r={id:uuid(),userId:req.user.sub,market:m,symbol:s,name,createdAt:nowIso()};db.watchlists.push(r)}return r});res.json(x)});
app.delete('/api/watchlist/:id',auth,async(req,res)=>{await dbMutate(db=>{db.watchlists=db.watchlists.filter(x=>!(x.id===req.params.id&&x.userId===req.user.sub))});res.json({ok:true})});
app.get('/api/notifications',auth,async(req,res)=>{const db=await dbRead();res.json(db.notifications.filter(x=>x.userId===req.user.sub).sort((a,b)=>String(b.createdAt).localeCompare(a.createdAt))) });
app.post('/api/notifications/read-all',auth,async(req,res)=>{await dbMutate(db=>db.notifications.forEach(x=>{if(x.userId===req.user.sub)x.read=true}));res.json({ok:true})});

const liveClients=new Map();
function sendSse(res,payload){if(res.destroyed||res.writableEnded)return false;if((res.writableLength||0)>512*1024){try{res.end()}catch{};liveClients.delete(res);return false}try{return res.write(payload)}catch{liveClients.delete(res);return false}}
app.get('/api/live',(req,res)=>{
 const market=normMarket(req.query.market),symbol=normSymbol(req.query.symbol);
 if(!symbol)return res.status(400).json({error:'缺少股票代號'});
 res.statusCode=200;
 res.setHeader('Content-Type','text/event-stream; charset=utf-8');
 res.setHeader('Cache-Control','no-cache, no-transform');
 res.setHeader('Connection','keep-alive');
 res.setHeader('X-Accel-Buffering','no');
 res.flushHeaders?.();
 sendSse(res,`retry: 3000\n`);
 sendSse(res,`event: ready\ndata: ${JSON.stringify({market,symbol,updatedAt:nowIso()})}\n\n`);
 liveClients.set(res,{market,symbol});
 const cleanup=()=>liveClients.delete(res);req.on('close',cleanup);req.on('aborted',cleanup);res.on('close',cleanup);res.on('error',cleanup);
});
app.get('/',(_q,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.use((req,res)=>res.status(404).json({error:'找不到 API 路徑'}));
app.use((error,req,res,next)=>{console.error(`[API] ${req.method} ${req.url}:`,error);if(res.headersSent)return next(error);res.status(500).json({error:IS_PROD?'服務暫時無法使用':String(error?.message||error)})});
const HOST=process.env.HOST||'0.0.0.0';
const server=app.listen(PORT,HOST,()=>console.log(`AlphaLens Enterprise v15.1 running on ${HOST}:${PORT}`));
server.keepAliveTimeout=70000;server.headersTimeout=72000;server.requestTimeout=45000;
server.on('error',error=>{if(error.code==='EADDRINUSE')console.error(`啟動失敗：Port ${PORT} 已被占用，請關閉舊的 AlphaLens 視窗。`);else console.error('Server error:',error);process.exitCode=1});
const heartbeatMs=Math.max(1000,Number(process.env.SSE_HEARTBEAT_MS||15000));
const heartbeatTimer=setInterval(()=>{const payload=`event: ping\ndata: ${JSON.stringify({time:nowIso()})}\n\n`;for(const res of liveClients.keys())sendSse(res,payload)},heartbeatMs);heartbeatTimer.unref?.();
let polling=false;const quoteTimer=setInterval(async()=>{if(polling||liveClients.size===0)return;polling=true;try{const groups=[...new Map([...liveClients.values()].map(sub=>[`${sub.market}:${sub.symbol}`,sub])).values()];await mapLimit(groups,3,async sub=>{try{cache.delete(`q:${sub.market}:${sub.symbol}`);const q=await withDeadline(getQuote(sub.market,sub.symbol),10000,'live quote');const payload=`event: quote\ndata: ${JSON.stringify(q)}\n\n`;for(const [res,x] of liveClients)if(x.market===sub.market&&x.symbol===sub.symbol)sendSse(res,payload)}catch(error){const payload=`event: status\ndata: ${JSON.stringify({market:sub.market,symbol:sub.symbol,state:'degraded',message:error.message,updatedAt:nowIso()})}\n\n`;for(const [res,x] of liveClients)if(x.market===sub.market&&x.symbol===sub.symbol)sendSse(res,payload)}})}catch(error){console.error('Live quote polling:',error.message)}finally{polling=false}},Math.max(1000,Number(process.env.QUOTE_POLL_MS||7000)));quoteTimer.unref?.();
await loadCatalog();
if(String(process.env.CATALOG_SYNC_ON_START||'true')==='true')syncCatalog().catch(error=>console.error('Catalog sync failed:',error.message));
let shuttingDown=false;
async function shutdown(signal){if(shuttingDown)return;shuttingDown=true;console.log(`收到 ${signal}，正在安全關閉…`);clearInterval(heartbeatTimer);clearInterval(quoteTimer);for(const res of liveClients.keys())try{res.end()}catch{};liveClients.clear();await new Promise(resolve=>server.close(()=>resolve()));process.exit(0)}
process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('unhandledRejection',error=>console.error('Unhandled rejection:',error));
process.on('uncaughtException',error=>console.error('Uncaught exception:',error));

export{marketFrom,cleanSymbol,symbolCandidates,yahooSymbol,tradingViewSymbol,normalizeRow,scoreFund};
