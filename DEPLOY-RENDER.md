# AlphaLens Enterprise v15.1：Render 部署

1. 把本資料夾上傳到新的 GitHub Repository。
2. 在 Render 選擇 **New → Blueprint**。
3. 連接 Repository，Render 會讀取 `render.yaml`。
4. 在 Environment 填入需要的 API 金鑰與 `SEC_USER_AGENT`。
5. Deploy 完成後開啟 Render 提供的網址。

## 建議環境變數

- `SEC_USER_AGENT`：產品名稱與聯絡信箱，例如 `AlphaLens admin@example.com`。
- `FUGLE_API_KEY`、`FINMIND_TOKEN`：台股資料。
- `ALLTICK_TOKEN`：A 股行情。
- `FINNHUB_API_KEY`、`TWELVE_DATA_API_KEY`、`FMP_API_KEY`：全球行情、基本面與公司資料。
- `OPENAI_API_KEY` 或 `GEMINI_API_KEY`：AI 研究與中文翻譯；未設定時使用本機規則引擎。

請勿把正式金鑰寫入 GitHub。Render 免費方案可能休眠，首次喚醒會較慢。
