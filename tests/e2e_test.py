#!/usr/bin/env python3
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'tests'/'artifacts'; ART.mkdir(exist_ok=True)
ORIGIN='https://alphalens.test'

CATALOG={
 ('US','AAPL'):{'market':'US','symbol':'AAPL','name':'Apple','exchange':'NASDAQ','industry':'Consumer Electronics','currency':'USD'},
 ('TW','2330'):{'market':'TW','symbol':'2330','name':'台積電','exchange':'TWSE','industry':'半導體','currency':'TWD'},
 ('CN','600519'):{'market':'CN','symbol':'600519','name':'貴州茅台','exchange':'SSE','industry':'白酒','currency':'CNY'}
}
def row(m,s): return CATALOG.get((m,s),{'market':m,'symbol':s,'name':s,'exchange':'NASDAQ' if m=='US' else 'TWSE' if m=='TW' else 'SZSE','industry':'測試產業','currency':'USD' if m=='US' else 'TWD' if m=='TW' else 'CNY'})
def snapshot(m,s):
    r=row(m,s); now='2026-08-03T07:30:00.000Z'
    return {'market':m,'symbol':s,'quote':{**r,'price':100,'open':99,'high':102,'low':98,'previousClose':99,'change':1,'changePercent':1.01,'volume':1000000,'updatedAt':now,'source':'測試即時行情','isRealtime':True,'isDemo':False,'freshness':'即時','qualityScore':96},'fundamentals':{'market':m,'symbol':s,'name':r['name'],'industry':r['industry'],'eps':8.6,'pe':21.4,'pb':3.2,'roe':18.7,'roa':9.6,'margin':42.5,'operatingMargin':22.1,'netMargin':16.8,'debt':38.2,'currentRatio':1.8,'quickRatio':1.35,'growth':14.2,'epsGrowth':17.5,'freeCashFlow':8600000000,'operatingCashFlow':12400000000,'dividendYield':2.1,'marketCap':100000000000,'total':82,'score':82,'rating':'A','coverage':100,'subScores':{'profitability':84,'growth':80,'health':78,'valuation':70,'cashflow':85,'dividend':65},'strengths':['獲利穩健'],'risks':['估值波動'],'fieldSources':{},'source':'測試基本面','updatedAt':now},'profile':{**r,'description':f"{r['name']} 是 {r['industry']} 產業的重要上市公司，核心業務具全球競爭力。",'country':'台灣' if m=='TW' else '中國' if m=='CN' else '美國','website':'https://example.com','employees':12000,'ceo':'執行長','chairman':'董事長','founded':'2000','headquarters':'主要營運總部','products':['核心產品','企業方案'],'customers':['企業客戶','消費者'],'supplyChain':['關鍵供應商'],'globalFootprint':['亞洲','北美','歐洲'],'competitors':['同業 A','同業 B'],'filings':[{'form':'10-K','date':'2026-07-20','accession':'0000000000-26-000001','document':'report.htm'}] if m=='US' else [],'sources':[{'name':'官方公司資料','url':'https://example.com','tier':'官方','checkedAt':now,'ok':True},{'name':'全球市場資料','url':'https://example.com/profile','tier':'市場資料','checkedAt':now,'ok':True}],'source':'官方公司資料 / 全球市場資料','sourceUrl':'https://example.com','verified':True,'completeness':93,'profileConfidence':91,'dataNature':'多來源交叉整合','rejectedSources':[]},'news':[{'headline':f"{r['name']} 發布最新營運重點",'summary':'營運與核心產品需求維持穩健。','url':'https://example.com/news','source':'測試新聞','datetime':now,'official':True}], 'quality':{'coverage':100,'sourceCount':4,'sources':['測試即時行情','測試基本面','官方公司資料','測試新聞'],'live':True,'partial':False,'errors':[],'updatedAt':now},'latencyMs':18}

def ai_payload():
    return {'signal':'買入','signalScore':78,'stance':'偏正向','summary':'基本面、成長與風險的綜合研究結果偏正向。','confidence':82,'catalysts':['營收成長','產品需求'],'risks':['估值波動','景氣循環'],'valuation':'估值中性','growth':'成長穩健','financialHealth':'財務健康','actionPlan':['追蹤下季營收','確認現金流'],'dataQuality':'資料完整','source':'本機測試 AI','oneMinuteSummary':['公司具產業競爭力','營運成長穩健','仍需留意估值與景氣'],'businessModel':'透過核心產品、服務與全球客戶創造收入。','moat':{'brand':80,'technology':88,'scale':82,'profitability':79},'longTermView':{'label':'適合持續研究','score':80,'reason':'競爭力與財務條件良好。'},'riskRadar':[{'name':'估值','level':'中','reason':'價格波動可能較大'},{'name':'財務','level':'低','reason':'現金流維持正向'}],'peerNotes':['同業 A','同業 B'],'evidence':[{'label':'基本面評分','value':'82 分','source':'測試基本面','date':'2026-08-03T07:30:00.000Z'}],'missingData':[],'upgradeConditions':['營收維持成長'],'downgradeConditions':['毛利率明顯惡化'],'methodology':'測試多來源交叉分析','asOf':'2026-08-03T07:30:00.000Z'}

def ranking(m):
    symbols=['2330','2317','2454'] if m=='TW' else ['600519','300750','002594'] if m=='CN' else ['AAPL','NVDA','MSFT']
    return {'market':m,'type':'gainers','rows':[{**row(m,s),'price':100+i*3,'change':1+i,'changePercent':1.2+i,'volume':1000000*(i+1),'turnover':100000000*(i+1),'hotScore':80-i,'source':'測試行情','updatedAt':'2026-08-03T07:30:00.000Z','isDemo':False,'isRealtime':True} for i,s in enumerate(symbols)],'source':'測試行情','updatedAt':'2026-08-03T07:30:00.000Z'}

def fulfill_json(route,obj,status=200): route.fulfill(status=status,content_type='application/json; charset=utf-8',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(obj,ensure_ascii=False))

def router(route):
    req=route.request; u=urlparse(req.url); path=u.path; q=parse_qs(u.query)
    if u.netloc!='alphalens.test': return route.abort()
    if path in ['/','/index.html']: return route.fulfill(content_type='text/html; charset=utf-8',body=(ROOT/'index.html').read_text())
    if path=='/styles.css': return route.fulfill(content_type='text/css; charset=utf-8',body=(ROOT/'styles.css').read_text())
    if path=='/app.js': return route.fulfill(content_type='text/javascript; charset=utf-8',body=(ROOT/'app.js').read_text())
    if path=='/core.js': return route.fulfill(content_type='text/javascript; charset=utf-8',body=(ROOT/'core.js').read_text())
    if path=='/manifest.webmanifest': return route.fulfill(content_type='application/manifest+json',body=(ROOT/'manifest.webmanifest').read_text())
    if path=='/sw.js': return route.fulfill(content_type='text/javascript',body=(ROOT/'sw.js').read_text())
    if path=='/api/version': return fulfill_json(route,{'version':'15.1.0'})
    if path=='/api/health': return fulfill_json(route,{'ok':True,'catalogCount':5000,'configured':{},'providerHealth':{},'cacheEntries':10,'time':'2026-08-03T07:30:00.000Z'})
    if path=='/api/system/status': return fulfill_json(route,{'version':'15.1.0','providers':[]})
    if path=='/api/snapshot': return fulfill_json(route,snapshot(q.get('market',['US'])[0],q.get('symbol',['AAPL'])[0]))
    if path=='/api/quote':
        d=snapshot(q.get('market',['US'])[0],q.get('symbol',['AAPL'])[0])['quote']; return fulfill_json(route,d)
    if path=='/api/history':
        rows=[{'time':f'2026-07-{i+1:02d}','open':98+i*.1,'high':101+i*.1,'low':97+i*.1,'close':99+i*.1,'volume':100000+i*1000} for i in range(30)]; return fulfill_json(route,{'rows':rows,'source':'測試 K 線'})
    if path=='/api/search':
        m=q.get('market',['US'])[0]; term=q.get('q',[''])[0]; rows=[v for (mm,_),v in CATALOG.items() if mm==m and (term.lower() in v['symbol'].lower() or term.lower() in v['name'].lower())]; return fulfill_json(route,rows)
    if path=='/api/ranking': return fulfill_json(route,ranking(q.get('market',['US'])[0]))
    if path=='/api/ai/analyze': return fulfill_json(route,ai_payload())
    if path=='/api/financial-trends':
        rows=[{'period':f'2024 Q{i+1}' if i<4 else f'2025 Q{i-3}','date':f'{2024 if i<4 else 2025}-{(i%4)*3+3:02d}-31','revenue':100+i*8,'grossMargin':40+i*.5,'eps':2+i*.2,'freeCashFlow':20+i,'roe':15+i*.3,'debt':40-i*.4,'cash':30+i} for i in range(8)]
        return fulfill_json(route,{'market':q.get('market',['US'])[0],'symbol':q.get('symbol',['AAPL'])[0],'quarterly':rows,'annual':[],'insights':['營收持續成長','毛利率改善'],'coverage':100,'source':'測試財務趨勢','sources':['測試財務趨勢'],'errors':[],'derived':False,'updatedAt':'2026-08-03T07:30:00.000Z'})
    if path=='/api/news/summary': return fulfill_json(route,{'sentiment':'正向','summary':'新聞重點偏正向。','sources':['測試新聞']})
    if path=='/api/names':
        data=json.loads(req.post_data or '{}'); rows=[]
        for x in data.get('items',[]): rows.append({'ok':True,**row(x.get('market','US'),x.get('symbol','')),'source':'名稱引擎'})
        return fulfill_json(route,{'rows':rows,'updatedAt':'2026-08-03T07:30:00.000Z'})
    if path=='/api/quotes': return fulfill_json(route,{'rows':[],'updatedAt':'2026-08-03T07:30:00.000Z'})
    if path=='/api/live': return route.fulfill(content_type='text/event-stream; charset=utf-8',headers={'Access-Control-Allow-Origin':'*'},body='retry: 3000\nevent: ready\ndata: {"ok":true}\n\n')
    return fulfill_json(route,{'error':'not found'},404)

def run_view(browser, viewport, mobile=False):
    ctx=browser.new_context(viewport=viewport,device_scale_factor=1,is_mobile=mobile,locale='zh-TW',service_workers='block')
    ctx.route('**/*',router)
    page=ctx.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    html=(ROOT/'index.html').read_text()
    html=html.replace('<head>','<head><base href="https://alphalens.test/">',1)
    html=html.replace('<link href="styles.css?v=15.1.0" rel="stylesheet"/>',f'<style>{(ROOT/"styles.css").read_text()}</style>')
    html=html.replace('<link rel="manifest" href="manifest.webmanifest?v=15.1.0"/>','')
    html=html.replace('<script src="app.js?v=15.1.0"></script>','')
    page.set_content(html,wait_until='domcontentloaded',timeout=20000)
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.wait_for_function("document.querySelector('#backendStatus')?.textContent.includes('連線')",timeout=15000)
    page.wait_for_function("document.querySelector('#snapshotState')?.textContent.includes('同步')",timeout=15000)
    page.locator('#pageNavigation [data-page="analysis"]').click(); page.wait_for_selector('.app-page[data-page="analysis"].active')
    # Rapid switching reproduces the former stale-request freeze. The final selection must win.
    page.evaluate("select({market:'US',symbol:'AAPL',name:'Apple',exchange:'NASDAQ'});select({market:'CN',symbol:'600519',name:'貴州茅台',exchange:'SSE'});select({market:'TW',symbol:'2330',name:'台積電',exchange:'TWSE'})")
    page.wait_for_function("document.querySelector('#stockName')?.textContent.includes('台積')",timeout=10000)
    page.locator('.markets [data-market="TW"]').click(); page.wait_for_timeout(200)
    page.locator('#searchInput').fill('2330'); page.locator('#searchBtn').click(); page.wait_for_selector('#results:not(.hidden) button'); page.locator('#results button').first.click()
    page.wait_for_function("document.querySelector('#stockName')?.textContent.includes('台積')",timeout=10000)
    page.wait_for_function("document.querySelector('#trendSource')?.textContent.includes('測試財務趨勢')",timeout=10000)
    for tab in ['snapshot','products','competitors','events','sources','overview']:
        page.locator(f'#companyTabs [data-tab="{tab}"]').click(); page.wait_for_selector(f'.company-tab-panel[data-panel="{tab}"].active')
    page.wait_for_timeout(350)
    page.screenshot(path=str(ART/('analysis-mobile.png' if mobile else 'analysis-desktop.png')),full_page=True)
    page.locator('#pageNavigation [data-page="dashboard"]').click(); page.wait_for_selector('#smartAlerts'); page.locator('#alertAiChange').uncheck(); page.locator('#alertAiChange').check()
    page.locator('#pageNavigation [data-page="portfolio"]').click(); page.locator('#togglePortfolioForm').click(); page.wait_for_selector('#portfolioForm:not(.hidden)'); page.locator('#cancelHoldingEdit').click()
    page.locator('#pageNavigation [data-page="ranking"]').click(); page.wait_for_selector('.app-page[data-page="ranking"].active')
    page.locator('#pageNavigation [data-page="news"]').click(); page.wait_for_selector('.app-page[data-page="news"].active')
    dims=page.evaluate("({w:document.documentElement.scrollWidth,v:window.innerWidth,bottom:getComputedStyle(document.querySelector('#pageNavigation')).bottom})")
    assert dims['w']<=dims['v']+3, f'horizontal overflow: {dims}'
    if mobile:
        assert dims['bottom']=='0px',dims
        box=page.locator('#pageNavigation').bounding_box(); assert box and box['y']>viewport['height']-110
    page.wait_for_timeout(350)
    page.screenshot(path=str(ART/('mobile.png' if mobile else 'desktop.png')),full_page=True)
    assert not errors,'page errors: '+json.dumps(errors,ensure_ascii=False)
    ctx.close()

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        run_view(browser,{'width':1440,'height':1000},False)
        run_view(browser,{'width':390,'height':844},True)
        browser.close()
    print('E2E desktop/mobile passed')
if __name__=='__main__': main()
