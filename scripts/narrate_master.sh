#!/bin/bash
# 主片 v2（真單版，88.1 秒無旁白）燒旁白。
#
#   bash scripts/narrate_master.sh <無旁白.mp4> <輸出.mp4>
#
# 預設用 macOS 內建 Meijia 合成語音；要換人聲配音就不要用這支，直接拿無旁白母片去剪。
# 下面的秒數是對「主片_v2_真單版_無旁白_88秒.mp4」量過的，換片就要重對——
# 重對方式：ffprobe 每句 aiff 的長度，確認不會壓到下一個畫面事件。
#
# v2 畫面事件時間軸（秒）：
#   0.0  首屏健檢 ‖ 12.7 打字 ‖ 15.2 送出 ‖ 30.6 三方案出現 ‖ 38.5 捲卡片
#   56.2 ETH 確認卡（不按） ‖ 62.6 淡出／切真單段 ‖ 70.6 送出中 ‖ 74.6 已成交＋軌跡
#   80.1 收尾定格 ‖ 88.1 結束
set -e
IN="${1:?用法：bash scripts/narrate_master.sh <無旁白.mp4> <輸出.mp4>}"
OUT="${2:-主片_v2_旁白版.mp4}"
VOICE="${VOICE:-Meijia}"
RATE="${RATE:-190}"
TTS=$(mktemp -d)
trap 'rm -rf "$TTS"' EXIT

# 每行：開始秒數|旁白
CUES=(
"0.5|別的投資工具看市場，MaiMate 同時看你。"
"4.3|這是從一萬筆真實交易算出來的行為健檢——六成五的買入，追在高點。"
"10.7|一年的賣出機會成本，兩千六百萬。"
"14.0|市場暴跌，你慌了，打開 MaiMate 說：ETH 跌太多了，幫我全部賣掉。"
"20.6|它沒有直接下單，也沒有說教。先查行情、查餘額，再算方案。"
"30.9|然後把你的盲點攤開：你有賣出後悔的傾向，去年賣完之後又漲上去，少賺兩千六百萬。"
"39.6|接著給你三個都算好數字的選項：先賣四分之一留倉觀察、照原意圖全賣、或先不動設個提醒。"
"48.7|金額、手續費、賣後集中度全部由程式算，AI 不編數字。"
"56.4|最後一步永遠由你決定。麥麥不會替你按下這顆按鈕。"
"63.4|這顆按鈕，我們自己按過。同一個介面，真實帳戶、真實下單。"
"69.3|五百塊的 USDT 市價買入，六十秒內確認，成交單號當場回來。"
"75.4|每次查詢、草稿、確認、成交，全部寫進稽核軌跡。"
"80.9|合規不是免責聲明，是系統設計。MaiMate——AI 有手，方向盤在你手上。"
)

i=0; INPUTS=(); FILTERS=(); MIX=""
for c in "${CUES[@]}"; do
  t="${c%%|*}"; text="${c#*|}"
  say -v "$VOICE" -r "$RATE" -o "$TTS/$i.aiff" "$text"
  ms=$(python3 -c "print(int(float('$t')*1000))")
  INPUTS+=(-i "$TTS/$i.aiff")
  FILTERS+=("[$((i+1)):a]adelay=${ms}|${ms}[a$i];")
  MIX="$MIX[a$i]"
  i=$((i+1))
done
FILTER="$(IFS=; echo "${FILTERS[*]}")${MIX}amix=inputs=$i:normalize=0[aout]"

ffmpeg -y -v error -i "$IN" "${INPUTS[@]}" -filter_complex "$FILTER" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
echo "✔ $OUT"
