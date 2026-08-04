# AlphaLens Enterprise v15.1 架構

- `server.js`：API 編排、行情、公司資料、基本面、財務趨勢、新聞、AI、SSE。
- `lib/mini-express.js`：零依賴 HTTP 路由與靜態檔案服務。
- `lib/jwt.js`：HS256 JWT 簽章與嚴格驗證。
- `lib/env.js`：`.env` 載入。
- `app.js`：單頁應用狀態、取消請求、漸進載入、圖表、AI 證據、通知與投資組合。
- `styles.css`：桌面／平板／手機響應式設計。
- `sw.js`：PWA shell 快取與通知點擊處理。
- `tests/`：單元、靜態整合、HTTP、SSE、併發壓力、桌面與手機 Chromium 測試。

## 穩定性原則

1. 首屏採快取優先與漸進載入；完整公司資料不阻塞價格與 K 線。
2. 每個外部呼叫都有 timeout；快照內各模組也有獨立 deadline。
3. 相同請求合併，排行榜共用行情批次，避免 request storm。
4. 快速切換時取消舊請求，所有非同步結果以 generation 驗證。
5. SSE 使用心跳、原生重連、watchdog、緩衝上限與安全關閉。
6. 後台重連使用指數退避，瀏覽器離線時暫停無效重試。
7. AI 外部模型不得覆寫平台產生的核心數據證據。
8. 缺值不轉成 0；展示／估計／延遲資料均明確標示。
