# 悅管家租賃管理系統

前端網頁 + Vercel Serverless API + Upstash Redis 雲端資料庫。
所有裝置、所有人打開同一個網址，看到的都是同一份即時資料。

## 架構說明

- `index.html` — 前端網頁（跟你原本用的那份幾乎一樣，只是改成會呼叫 API 存取資料，不再只存在瀏覽器記憶體）
- `api/data.js` — 後端 API（Vercel Serverless Function），負責讀寫 Upstash Redis
- 資料存放的 Redis key 是 `yueguanjia:rental-data`，跟你原本「予鹿香茅排班表」用的 key 不一樣，**兩個系統可以共用同一個 Upstash 免費資料庫，不會互相干擾**，不需要另外申請新的資料庫。

## 部署步驟（大約 10 分鐘）

### 1. 建立 GitHub Repository
1. 到 [github.com](https://github.com) 建一個新的 repository（例如叫 `yueguanjia-rental`），設為 Private 或 Public 皆可
2. 把這個資料夾（`yueguanjia-rental`）裡的所有檔案上傳上去
   - 最簡單的方式：GitHub 網頁上有「上傳檔案」的功能，直接把整個資料夾拖上去即可
   - 或用 Git 指令：
     ```bash
     git init
     git add .
     git commit -m "init"
     git remote add origin <你的 repo 網址>
     git push -u origin main
     ```

### 2. 到 Vercel 匯入專案
1. 登入 [vercel.com](https://vercel.com)（跟 Upstash 帳號通常可以用同一組 GitHub 登入）
2. 點「Add New... → Project」
3. 選擇剛剛建立的 GitHub repository，點「Import」
4. Framework Preset 選「Other」（因為這不是 Next.js，是純靜態網頁 + API）
5. **先不要按 Deploy**，往下捲到「Environment Variables」

### 3. 設定環境變數（最重要的一步）
在 Environment Variables 區塊，新增兩筆：

| Key | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | 到 Upstash 後台 → yulu-kv → Details 頁面，複製 Endpoint 那組網址，記得補上 `https://` 開頭 |
| `UPSTASH_REDIS_REST_TOKEN` | 到 Upstash 後台 → yulu-kv → Details 頁面 → Connect 區塊 → REST 分頁，複製 `UPSTASH_REDIS_REST_TOKEN` 那組值（點眼睛圖示先顯示出來，或直接用複製圖示） |

填完後按「Deploy」。

### 4. 完成！
等 1-2 分鐘部署完成，Vercel 會給你一個網址（例如 `yueguanjia-rental.vercel.app`）。
打開它，畫面左下角會顯示「● 已同步雲端」，代表已經成功接上 Upstash。

之後不管是你、還是你的同事/夥伴打開這個網址，新增、修改、刪除任何資料，大家看到的都會是同一份、即時更新的內容 —— 跟你的「予鹿香茅排班表」系統運作方式完全一樣。

## 之後要更新網頁內容/程式碼怎麼辦？

之後如果我（Claude）再幫你調整功能，我會給你更新後的 `index.html`（或其他檔案），你只要：
1. 到 GitHub 上把舊檔案內容換成新的（或用 git push）
2. Vercel 會自動偵測到更新並重新部署，不需要手動按什麼

## 常見問題

**Q: 畫面顯示「⚠ 無法連線雲端」？**
A: 通常是 Vercel 的環境變數沒設定對，回到 Vercel 專案的 Settings → Environment Variables 檢查兩組值有沒有貼對（特別注意 URL 要有 `https://`，TOKEN 不要複製到多餘的空白或引號）。改完要重新 Deploy 一次才會生效。

**Q: 我可以同時保留原本下載的 .html 檔案嗎？**
A: 可以，但那份是舊的「單機展示版」，資料不會同步，建議之後都用這個 Vercel 網址當作正式版本。
