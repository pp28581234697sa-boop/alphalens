import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const js=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('all referenced IDs exist',()=>{const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));const refs=new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(x=>x[1]));assert.deepEqual([...refs].filter(x=>!ids.has(x)),[])});
test('critical handlers exist',()=>{for(const id of ['refreshFundamentals','refreshAiJudgement','translateCompanyProfile','refreshQuote','refreshCompanyProfile','searchBtn'])assert.match(js,new RegExp(`\\$\\('#${id}'\\)\\.onclick`))});
test('cache bust and backend status exist',()=>{assert.match(html,/app\.js\?v=15\.1\.0/);assert.match(html,/id="backendStatus"/)});
test('fundamental and AI panels exist',()=>{for(const id of ['fundDonut','subScores','metrics','aiJudgement'])assert.match(html,new RegExp(`id="${id}"`))});

test('stock selection handler is defined and safe',()=>{assert.match(js,/async function select\(row\)/);assert.match(js,/function normalizeSelection\(row=/);assert.doesNotMatch(js,/updateWatchBtn\?\.\(\)/)});
test('all selection entry points use the defined handler',()=>{for(const pattern of [/=>select\(JSON\.parse/,/if\(rows\[0\]\)select\(rows\[0\]\)/,/=>select\(MARKET_DEFAULTS/])assert.match(js,pattern)});
test('Taiwan names prefer official Chinese catalog',()=>{const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(server,/ensureTwCatalog/);assert.match(server,/twStockNameDetail/);assert.match(server,/applyCanonicalName/);assert.match(server,/canonicalNameRow/)});
test('native chart receives live SSE candle updates',()=>{assert.match(js,/function updateLiveCandle\(q\)/);assert.match(js,/SSE 即時更新/);assert.match(js,/renderQuote\(q\)\{state\.quote=q;updateLiveCandle\(q\)/)});

test('portfolio module exists',()=>{ for(const id of ['portfolioCard','portfolioSelect','saveHolding','analyzePortfolio','holdingList']) assert.match(html,new RegExp(`id=[\"']${id}[\"']`)); assert.match(js,/function initPortfolio\(/); assert.match(js,/function analyzePortfolio\(/); });

test('page-based navigation exists',()=>{assert.match(html,/id=\"pageNavigation\"/);for(const page of ['dashboard','analysis','portfolio','ranking','news'])assert.match(html,new RegExp(`data-page=\"${page}\"`));assert.match(js,/function initPageNavigation/);assert.match(js,/function showAppPage/);});
test('data quality UI is fully removed',()=>{assert.doesNotMatch(html,/資料品質中心|dataQualityCard|openDataQuality/);});

test('pages are statically separated',()=>{for(const page of ['dashboard','analysis','portfolio','ranking','news'])assert.match(html,new RegExp(`class=\"app-page[^\"]*\" data-page=\"${page}\"`));assert.doesNotMatch(js,/createElement\('section'\)/);});

test('portfolio v13.1 intelligence controls and handlers exist',()=>{for(const id of ['refreshPortfolioPrices','openSelectedHolding','portfolioSearch','portfolioSort','exportPortfolio','importPortfolio','portfolioImportFile','portfolioAllocation','portfolioSignalBoard','holdingNote','cancelHoldingEdit'])assert.match(html,new RegExp(`id=\"${id}\"`));assert.doesNotMatch(html,/holdingTarget|holdingStop|目標價|停損價/);for(const fn of ['persistHolding','refreshPortfolioPrices','exportPortfolio','importPortfolioFile','openHoldingForm','renderAllocation','renderEconomicSignals','aiSignal'])assert.match(js,new RegExp(`function ${fn}|async function ${fn}`));assert.match(js,/ai-action/);assert.match(js,/risk-light/);});
test('portfolio uses delegated actions and persistent storage safely',()=>{assert.match(js,/holdingList'\)\.addEventListener\('click'/);assert.match(js,/safeStorageSet/);assert.match(js,/data-action="edit"/);assert.match(js,/data-action="delete"/);assert.match(js,/data-action="open"/);});


test('enterprise v13 price engine and batch refresh exist',()=>{
 const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/quoteTwseMis/);
 assert.match(server,/quoteEastmoney/);
 assert.match(server,/quoteStooq/);
 assert.match(server,/hedgedQuote/);
 assert.match(server,/app\.post\('\/api\/quotes'/);
 assert.match(js,/refreshPortfolioPrices\(\{silent=false\}/);
 assert.match(js,/function schedulePortfolioRefresh/);assert.match(js,/state\.isPortfolioRefreshing/);
});

test('v13.2 dashboard modules and actions exist',()=>{for(const id of ['refreshDashboard','dashboardKpis','dashboardFlowList','dashboardAiPicks','dashboardPortfolio','dashboardNews','dashboardMarketView'])assert.match(html,new RegExp(`id=\"${id}\"`));for(const fn of ['initDashboard','loadDashboard','renderDashboardLists','renderDashboardPortfolio','renderDashboardNews'])assert.match(js,new RegExp(`function ${fn}|async function ${fn}`));assert.match(html,/主力投資資訊/);assert.match(html,/成交量／漲勢代理/);});


test('v13.3 unified Chinese name engine covers all modules',()=>{
 const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/cnNameEastmoney/);assert.match(server,/cnNameTencent/);assert.match(server,/cnNameSuggest/);
 assert.match(server,/app\.post\('\/api\/names'/);
 assert.match(server,/const row=await canonicalNameRow\(m,s\)/);
 assert.match(server,/canonicalNameRow\(m,symbol\)/);
 assert.match(js,/canonicalizePortfolioNames/);
 assert.match(js,/\/api\/names/);
});

test('A-share English names cannot overwrite Chinese portfolio names',()=>{
 assert.match(js,/h\.market==='TW'\|\|h\.market==='CN'/);
 assert.match(js,/canonicalizePortfolioNames/);
});


test('v15.1 financial trends, evidence mode and smart alerts exist',()=>{
 const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 for(const id of ['financialTrendsCard','financialTrendChart','trendMetricTabs','trendKpis','trendInsights','aiEvidence','smartAlerts','enableNotifications'])assert.match(html,new RegExp(`id="${id}"`));
 for(const fn of ['loadFinancialTrends','renderFinancialTrends','drawFinancialTrend','renderAiEvidence','evaluateSmartAlerts','initAlerts','schedulePortfolioRefresh'])assert.match(js,new RegExp(`function ${fn}|async function ${fn}`));
 assert.match(server,/getFinancialTrends/);assert.match(server,/trendsSec/);assert.match(server,/trendsFinMind/);assert.match(server,/trendsEastmoney/);assert.match(server,/app\.get\('\/api\/financial-trends'/);
 assert.match(server,/evidence/);assert.match(server,/upgradeConditions/);assert.match(server,/downgradeConditions/);
});

test('v15.1 stability controls prevent request storms and reconnect loops',()=>{
 const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(js,/requestPool/);assert.match(js,/loadGeneration/);assert.match(js,/EventSource itself reconnects/);assert.match(js,/state\.isPortfolioRefreshing/);assert.match(js,/requestAnimationFrame/);assert.match(js,/state\.stockAbort/);assert.match(js,/state\.chartAbort/);assert.match(js,/isDashboardLoading/);assert.match(js,/isNewsRefreshing/);
 assert.match(server,/function coalesce/);assert.match(server,/getRankingBase/);assert.match(server,/Providers are attempted in small waves/);assert.match(server,/event: ping/);assert.match(server,/mapLimit\(groups,3/);
});
