#!/bin/bash
# 主片旁白合成（備援用；正式版建議由人配音——合成語音在情緒轉折那幾句撐不住）。
#
#   bash scripts/narrate_demo.sh <無聲.mp4> <輸出.mp4>
#
# 時間點必須對「影片實際節奏」，不是提詞卡的理想秒數——record_demo.js 會把每個鏡頭的
# 實際秒數印出來，重錄後照那份數字改下面的 CUES。實測方案卡是 30 秒才出現，不是分鏡稿的 34 秒。
set -e
IN="${1:?用法：bash scripts/narrate_demo.sh <無聲.mp4> <輸出.mp4>}"
OUT="${2:-旁白版.mp4}"
VOICE="${VOICE:-Meijia}"   # 台灣中文；其他選擇看 say -v '?' | grep zh_TW
RATE="${RATE:-190}"
TTS=$(mktemp -d)
trap 'rm -rf "$TTS"' EXIT

# 每行：開始秒數|旁白
# 下面這組對的是 08-01 16:15 那次錄影的節奏（方案卡 25.8s 出現、確認卡 50.4s）。
# 每次重錄都要照 record_demo.js 印出的 mark 重排——API 回應時間每次差幾秒，照舊值配會整段錯開。
CUES=(
"0.5|別的投資工具看市場，MaiMate 同時看你。"
"4.5|這是從一萬筆真實交易算出來的行為健檢——六成五的買入，追在高點。"
"10.0|一年的賣出機會成本，兩千六百萬。"
"14.8|市場暴跌，你慌了，打開 MaiMate 說——"
"19.0|它沒有直接下單，也沒有說教。它先去查你的行情、餘額，再算方案。"
"26.3|它把你自己的紀錄攤開：你有賣出後悔的傾向，最痛的一筆是一月八日賣掉的 DOGE，少賺三十一萬。"
"34.3|然後給你三個都算好數字的選項：先賣四分之一、照原意圖全賣、或先不動設個提醒。"
"40.0|金額、手續費、賣後佔比全部由程式算，AI 不編數字。"
"45.5|你選了折衷方案。最後一步，永遠由你決定。"
"50.7|確認卡上寫得清清楚楚：金額、滑價提醒、六十秒有效。"
"54.5|麥麥不會替你按下這顆按鈕。"
)

i=0; INPUTS=(); FILTERS=()
for c in "${CUES[@]}"; do
  t="${c%%|*}"; text="${c#*|}"
  say -v "$VOICE" -r "$RATE" -o "$TTS/$i.aiff" "$text"
  ms=$(python3 -c "print(int(float('$t')*1000))")
  INPUTS+=(-i "$TTS/$i.aiff")
  FILTERS+=("[$((i+1)):a]adelay=${ms}|${ms}[a$i];")
  i=$((i+1))
done

MIX=""; for ((j=0;j<i;j++)); do MIX="$MIX[a$j]"; done
FILTER="$(IFS=; echo "${FILTERS[*]}")${MIX}amix=inputs=$i:normalize=0[aout]"

ffmpeg -y -i "$IN" "${INPUTS[@]}" -filter_complex "$FILTER" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT" 2>&1 | tail -2
echo "✔ $OUT"
