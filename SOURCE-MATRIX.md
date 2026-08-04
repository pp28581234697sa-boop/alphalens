# AlphaLens v15.1 資料來源矩陣

| 資料 | 台股 | A 股 | 美股 | 備援策略 |
|---|---|---|---|---|
| 股票名稱 | TWSE / TPEx 官方目錄 | 東方財富、騰訊、搜尋建議 | 股票目錄、行情來源 | 中文名稱快取，英文不可覆蓋中文 |
| 即時行情 | Fugle、TWSE MIS、Twelve Data、FMP、Yahoo、FinMind | AllTick、東方財富、Twelve Data、FMP、Yahoo | Finnhub、Twelve Data、FMP、Yahoo、Stooq | 小批次競速、健康排序、快取、明確標示展示資料 |
| 公司資料 | TWSE / TPEx OpenAPI、FMP、Yahoo、Wikipedia | 東方財富、FMP、Yahoo、Wikipedia | SEC EDGAR、FMP、Finnhub、Yahoo、Wikipedia | 欄位級合併、名稱／代號核對、完整度與信心度 |
| 基本面 | FinMind、FMP、Yahoo 與市場公開資料 | 東方財富、FMP、公開市場資料 | SEC／FMP／Yahoo 與公開財報資料 | 缺值不當 0 分，欄位保留來源 |
| 財務趨勢 | FinMind、FMP | 東方財富、FMP | SEC Company Facts XBRL、FMP | 8 季／5 年、來源覆蓋率、失敗時明確標示趨勢估計 |
| 新聞 | Google News 聚合、MOPS／交易所揭露 | Google News 聚合、交易所公告 | Finnhub（有金鑰時）、SEC filings | 去重、來源標示、官方公告標記 |
| AI 分析 | OpenAI、Gemini、本機規則引擎 | OpenAI、Gemini、本機規則引擎 | OpenAI、Gemini、本機規則引擎 | 供應商失敗退回規則引擎；核心證據由真實資料固定生成 |
| 智慧提醒 | 行情、財務趨勢、官方公告、AI 評級 | 行情、財務趨勢、官方公告、AI 評級 | 行情、SEC filings、財務趨勢、AI 評級 | 頁內紀錄、去重、Service Worker 通知 |

公開來源可能延遲、限流或變更格式；平台會呈現實際來源、新鮮度與備援狀態。
