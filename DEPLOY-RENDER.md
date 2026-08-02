# AlphaLens Pro v11.1 公開網址部署

## 最簡單方式：Render

1. 建立 GitHub 帳號與一個新的 Repository。
2. 把本資料夾內的所有檔案上傳到 Repository。
3. 登入 Render。
4. 選擇 New → Blueprint，連接剛才的 GitHub Repository。
5. Render 會讀取 `render.yaml`。
6. 在 Environment 裡填入你自己的 API 金鑰。
7. 按 Deploy。

部署完成後會得到：

`https://你的服務名稱.onrender.com`

## 必填或建議設定的環境變數

- FINMIND_TOKEN
- FUGLE_API_KEY
- ALLTICK_TOKEN
- FINNHUB_API_KEY
- TWELVE_DATA_API_KEY
- FMP_API_KEY
- OPENAI_API_KEY（可選）

請勿把正式金鑰寫入 GitHub 或 `.env` 後上傳。

## Render 手動設定

如果不用 Blueprint：

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

伺服器已使用平台的 `PORT` 並綁定 `0.0.0.0`。

## 免費方案提醒

免費 Web Service 長時間沒人使用時可能休眠；再次開啟網址時，第一次載入可能需要等待。
