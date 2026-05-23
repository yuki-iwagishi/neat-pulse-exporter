# Neat Pulse 設定匯出工具

**[English](../README.md)** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [繁體中文](./README.zh-TW.md) · [简体中文](./README.zh-CN.md)

---

一款小型 Node.js Web 工具，可將 [Neat Pulse API](https://api.pulse.neat.no/docs/) 中的各裝置設定匯出為 CSV 檔案，供您與現有 Excel 會議室裝置庫存進行交叉比對。

> ⚠️ **非官方工具。** 本專案與 Neat 公司無關，並未獲得官方認可。僅使用您提供的 API 金鑰呼叫公開文件中記載的端點。

## 功能

- 以**房間為單位**迭代裝置（`GET /orgs/{org}/rooms` → `GET /orgs/{org}/rooms/{id}`），因此輸出包含位置（Location）及地區（Region）資訊。
- 取得各裝置的現行設定（`GET /endpoints/{id}/config`），以及已指派的設定檔（`GET /profiles/{profileId}`）。
- 每個設定鍵輸出三組欄位：
  - `config.*` — 裝置本身寫入的值
  - `profile.*` — 指派設定檔中宣告的值
  - `effective.*` — 裝置優先、設定檔補足的合併值
- 透過 Server-Sent Events 即時將進度串流至瀏覽器。
- 自動遮蔽鍵名含有 `password`、`token`、`secret`、`apiKey`、`privateKey`、`credential` 的敏感值（`settingsPasswordRequired` 等布林旗標除外）。
- CSV 前置 UTF-8 BOM，使 Excel 預設以 UTF-8 開啟。

## 驗證規模

已在實際正式環境租用戶（**560 個端點、296 個房間、25 個設定檔、11 種裝置型號**）完成零錯誤的完整匯出。預設 `CONCURRENCY=3` 是為了在此規模下避免觸發 Pulse API 速率限制；較小的環境可安全地調高此值。

## 系統需求

- Node.js 18 或更新版本（使用全域 `fetch`）
- Neat Pulse **Plus** 或 **Pro** 訂閱（產生 API 金鑰的必要條件）
- 在 **Pulse → Settings → API** 產生的 API 金鑰
- 您的組織 ID（`orgId`）

## 安裝與啟動

```bash
git clone https://github.com/yuki-iwagishi/neat-pulse-exporter.git
cd neat-pulse-exporter
npm install
cp .env.example .env   # 選用，詳見下方說明
npm start
```

接著在瀏覽器中開啟 <http://127.0.0.1:3000>。

### 透過 `.env` 進行設定（選用）

將 `.env.example` 複製為 `.env` 並填入所需值。所有變數均為選用。

| 變數名稱        | 預設值      | 說明                                                              |
| --------------- | ----------- | ----------------------------------------------------------------- |
| `PORT`          | `3000`      | HTTP 監聽埠號                                                     |
| `HOST`          | `127.0.0.1` | 繫結位址。僅在需要區域網路存取時使用 `0.0.0.0`                    |
| `CONCURRENCY`   | `3`         | 對 Pulse API 的最大同時請求數                                      |
| `PULSE_API_KEY` | _(空)_      | 設定後，UI 的 API 金鑰欄位可留空                                   |
| `PULSE_ORG_ID`  | _(空)_      | 同上（組織 ID）                                                   |

> **請勿提交真實的 `.env` 檔案。** 該檔案已列入 `.gitignore`。

## 使用方式

1. 執行 `npm start` 並在瀏覽器中開啟頁面。
2. 貼上 API 金鑰與組織 ID（若已於 `.env` 設定則可省略）。
3. 點擊 **匯出為 CSV**，進度會即時顯示於面板中。
4. 完成後會自動觸發 CSV 下載。

CSV 每台裝置一行。欄位為所有裝置鍵的聯集並依字母排序，因此不同型號的裝置可共存於同一份檔案中。

## 自訂設定

### 敏感欄位遮蔽

`src/server.js` 中的 `isSecretKey()` 函式負責判斷遮蔽對象。鍵名包含 `password`、`secret`、`token`、`apiKey`、`privateKey`、`credential` 時，值會被替換為 `***MASKED***`。請依您的政策調整此模式。

### 對應 Excel 試算表的欄位

預設情況下，API 回傳的所有鍵均會成為欄位。若需配合 Excel 的固定欄位結構，最簡單的方式是在 Excel 中使用 `VLOOKUP` / Power Query，或修改 `/api/export` 中的 `buildRow()` 函式，僅輸出所需的鍵。

### 涵蓋率摘要

對於已指派設定檔的一般裝置，本工具可透過 `profile.*` 取得 Pulse UI 顯示設定中**約 35 / 45 項**，並透過 `config.*` 額外取得 `pairingSerial`、`wifiEnabled` 等 14 個裝置專屬鍵。上述 24 + 2 個鍵在 Neat 於 Read API 中公開前無法取得。

## 安全性注意事項

- **API 金鑰透過瀏覽器以 POST 請求本文傳送至本地 Node 處理程序**，不會出現在 URL 查詢參數中，且不會記錄或持久化儲存。
- **匯出的 CSV 可能包含網路資訊**（MAC 位址、IP 位址、房間/位置中繼資料），即使遮蔽後仍需妥善保管。
- **預設繫結至 `127.0.0.1`。** 若將 `HOST` 設為非回送位址，伺服器啟動時會顯示警告，UI 也會出現橫幅提示。同一網路中的任何人均可觸發匯出。
- **Web UI 未內建驗證功能。** 若需團隊共用，請將伺服器置於現有 SSO / 反向代理後方，或封裝為 Electron 桌面應用程式。

### 機密偵測的限制

透過鍵名模式（`password`、`secret`、`token`、`apiKey`、`privateKey`、`credential`）判斷遮蔽對象，此方法存在已知的誤判情形：

| 類型 | 可能誤處理的鍵名範例 |
|------|-------------------|
| 過度遮蔽（誤報） | `secretariatMode`、`tokenRefreshInterval` |
| 遮蔽遺漏（漏報） | `pwd`、`clientKey`、`bearer`、`passphrase` |

**對外分享前，請務必親自確認匯出的 CSV 檔案內容。**

## 專案結構

```
neat-pulse-exporter/
├── docs/
│   ├── api_findings.md        # Pulse API 調查記錄
│   ├── README.ja.md           # 日本語
│   ├── README.ko.md           # 한국어
│   ├── README.zh-TW.md        # 此檔案
│   └── README.zh-CN.md        # 简体中文
├── examples/
│   └── sample_output_columns.txt   # CSV 欄位範例清單
├── public/
│   └── index.html        # Web UI（無需建置步驟）
├── src/
│   └── server.js         # Express 伺服器 + Pulse API 用戶端
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md             # English
```

## 疑難排解

| 症狀 | 原因 / 處理方式 |
|------|---------------|
| `Pulse API 401` | API 金鑰無效或已過期。請在 Pulse Settings 重新產生 |
| `Pulse API 403` | 金鑰無 Read 權限，或訂閱方案不包含 API 存取 |
| `/profiles/{id}` 出現 `Pulse API 404` | 裝置未指派設定檔。資料列仍會匯出，但 `profile.*` 欄位為空 |
| `_configError` 欄位有值 | `/config` 取得時發生錯誤（如逾時）。其他欄位仍有效 |
| `endpoints` 陣列為空 | `orgId` 錯誤，或金鑰屬於其他組織 |
| Excel 顯示亂碼 | Excel 2016 以前的版本可能忽略 BOM。請改用「資料 → 從文字/CSV」匯入 |

## 未來改進方向

- **IPv6 位址 RFC 5952 壓縮** — 目前以非壓縮格式輸出，未來將改善可讀性。
- **大型租用戶的串流 CSV** — 目前將所有資料列保留在記憶體後再輸出，數千台規模可能造成記憶體尖峰。
- **工作階段 / 任務分離** — 將 SSE 進度串流與 CSV 下載分離，提升長時間匯出的穩定性。

## 授權

MIT — 請參閱 [LICENSE](../LICENSE)。
