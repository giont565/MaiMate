# frontend/brand/ — 宿主 App 的官方 logo

`host-app.html`（產品化路徑的可點示意）從這裡讀宿主 App 的 logo。

## 現有檔案

| 檔名 | 用在哪 | 來源 |
|---|---|---|
| `max.png` | MAX 版頂欄的 App icon（128px） | 主辦方提供的品牌素材（`入口動畫/maincoin max logo.jpeg` 裁切） |
| `maicoin.png` | MaiCoin 版頂欄的 App icon（128px） | 同上 |

顯示尺寸只有 27px，128px 綽綽有餘。原圖是深色底的圓角方形 icon，裁切難免帶到一點背景角，
用 CSS `border-radius:23%` 蓋掉——比在圖檔上硬去背乾淨。

要換更高解析或 SVG 版本：換掉檔案即可，或改 `host-app.html` 裡 `HOSTS.<key>.logo` 的路徑
（搜尋 `brand/max.png`）。

## 檔案不存在會怎樣

**不會壞。** `<img>` 的 `onerror` 會退回字標（色塊字母），名稱文字本來就在旁邊，畫面照樣完整，
只是不夠像。`smoke:hostapp` 會如實回報目前是哪一種狀態。

## 麥麥自己的形象

不在這個資料夾——在 `frontend/icons/`（PWA 桌面圖示與九宮格入口共用同一顆），
來源是新版品牌形象的機器人（紅白藍圓潤造型），不是舊的像素機器人。

## ⚠️ 使用範圍

這些是他人的註冊商標，這裡的用途是**向 MaiCoin／MAX 本人簡報整合構想**的示意畫面。

`host-app.html` 底部有一條常駐標示寫明「示意 wireframe · 非官方 App 畫面」——
**用了真 logo 之後那條更不能拿掉**：現在畫面已經很像官方產品截圖，那條是唯一的區隔。
`smoke:hostapp` 有一條斷言盯著它在宿主與 WebView 兩種狀態都可見。

主畫面（PWA）的圖示與名稱刻意用**麥麥自己的**，不是 MAX 或 MaiCoin 的——
在別人手機主畫面上放一個他們的 logo 與名稱，那已經不是示意而是冒名。

對外散布（公開網址、社群、非簡報場合）前請先確認授權範圍。
