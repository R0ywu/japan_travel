# 花卷東北賞楓五日｜互動行程地圖

2026/10/06（二）– 10/10（六）「花卷東北賞楓五日」旅行團行程的互動網頁：地圖、行程表、景點介紹、路程估算、周邊推薦店家、天氣預報，手機可離線瀏覽。

純靜態網站，不需要任何 API key，可直接部署到 GitHub Pages。

## 功能

- **行程表 × 地圖聯動**：「全部行程」顯示五天所有圖層；「單日行程」只顯示所選日期的景點、路線與推薦店家。
- **景點介紹**：點行程表或地圖標記，右側／底部面板顯示簡介、實用提醒（門票、營業時間、賞楓時期）、官網與 Google Maps 連結。
- **路程估算**：遊覽車段由 [OSRM](https://project-osrm.org/) 免費服務計算真實道路距離與時間，並畫出路線；服務不可用時自動改用直線估算（會標示）。
- **周邊推薦店家**：每個景點附近 3–5 家評價較高的餐飲、咖啡、伴手禮、溫泉（Tabelog 評分），用不同圖示與預計景點區分；點擊可在地圖定位並開啟 Google Maps。
- **天氣預報**：[Open-Meteo](https://open-meteo.com/) 免費 API，顯示各景點當天預報（僅提供未來 16 天，行前一週再看最準）。
- **航班・飯店・聯絡**：集合時間、航班、飯店電話、領隊電話一鍵撥號。
- **PWA 離線**：Service Worker 快取網頁與行程資料，看過的地圖區域也會快取；手機可「加入主畫面」。

## 專案結構

```
.
├── index.html            # 頁面骨架
├── css/style.css         # 樣式（含手機版）
├── js/app.js             # 地圖、行程表、路線、天氣、面板邏輯
├── data/itinerary.json   # 行程資料（改行程只要改這裡）
├── sw.js                 # Service Worker（離線快取）
├── manifest.webmanifest  # PWA 設定
├── icons/                # 圖示
└── .nojekyll             # 讓 GitHub Pages 原樣部署
```

## 本機預覽

Service Worker 與 `fetch()` 需要 http 環境，不能直接用 `file://` 開啟：

```bash
python3 -m http.server 8000
# 開 http://localhost:8000
```

## 部署到 GitHub Pages

1. 把整個資料夾 push 到 GitHub repo。
2. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `/ (root)`。
3. 幾分鐘後網址會是 `https://<帳號>.github.io/<repo>/`。所有路徑都是相對路徑，放在子目錄也沒問題。

## 修改行程資料

`data/itinerary.json` 結構：

- `meta`：行程名稱、航班、集合、領隊、注意事項。
- `days[]`：每天的日期、標題、餐食、住宿（`hotel` 對應 `places` 的 id）、`stops[]`（依序的地點，`travel` 為 `bus` / `flight` / `null`）。
- `places{}`：以 id 為 key 的地點資料：座標、介紹、提醒、官網、`kind`（`spot` / `hotel` / `airport`）、`inferred`（旅行社未明確指名、屬推測的地點）、`nearby[]` 周邊店家。

## 資料來源與注意事項

- 行程內容整理自旅行社行程頁（見網頁右上「原始行程」）。
- 座標來自 OpenStreetMap / 國土地理院 / 官網，評分為 Tabelog（Google 評分未能取得），店家營業時間可能變動，**出發前請再確認**。
- 「觀光果園採果」「手燒仙貝 DIY」「AEON MALL」旅行社未指名確切店家，網頁中標示為「推測」，實際以領隊安排為準。
- OSRM demo server 為社群免費服務，無 SLA；路線結果會存在瀏覽器 localStorage 減少重複請求。
- 地圖圖磚 © OpenStreetMap 貢獻者（[ODbL](https://www.openstreetmap.org/copyright)）。

## 授權

程式碼 MIT；行程與店家文字資料僅供個人旅遊參考。
# japan_travel
