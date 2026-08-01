#!/bin/bash
# 主片 v3（佔比修正版，71.45 秒無旁白）燒旁白。
#
#   bash scripts/narrate_v3.sh <無旁白.mp4> <輸出.mp4>
#   CHECK=1 bash scripts/narrate_v3.sh <無旁白.mp4>     # 只檢查時間表，不出片
#
# 預設 macOS 內建 Meijia（唯一的台灣女聲）。要真人配音就別用這支，拿無旁白母片去錄。
#
# ⚠ 句子是**為 71 秒重寫過的**，不是 v2 那份照搬：v2 的 13 句唸完要 79 秒，
#   直接套會爆出去 8 秒。改法是砍贅字，不是加快語速——RATE 190 中文會糊掉。
#
# v3 畫面事件時間軸（秒，切點見 cut_master.sh）：
#   0 首屏健檢 ‖ 16.2 打字 ‖ 27.1 三方案出現 ‖ 35 捲卡片 ‖ 50.7 ETH 確認卡（不按）
#   56.5 切真單段 ‖ 59.9 已成交＋稽核軌跡 ‖ 65.5 收尾定格 ‖ 71.45 結束
set -e
IN="${1:?用法：bash scripts/narrate_v3.sh <無旁白.mp4> <輸出.mp4>}"
OUT="${2:-主片_v3_旁白版.mp4}"
VOICE="${VOICE:-Meijia}"
RATE="${RATE:-165}"
FILM_END="${FILM_END:-71.4}"
TTS=$(mktemp -d)
trap 'rm -rf "$TTS"' EXIT

# 每行：開始秒數|旁白
CUES=(
"0.5|別的投資工具看市場，MaiMate 同時看你。"
"5.0|一萬筆真實交易算出來的健檢：六成五的買入，追在高點。"
"11.2|一年的賣出機會成本，兩千六百萬。"
"16.0|市場暴跌，你打開它說：幫我全部賣掉。"
"21.5|它沒有直接下單，也沒有說教。先查行情、查餘額，再算方案。"
"28.8|它把你的盲點攤開：你有賣出後悔的傾向。"
"34.5|接著給三個算好數字的選項：先賣四分之一、照原意圖全賣、或先不動。"
"42.8|金額、手續費、賣後集中度都由程式算，AI 不編數字。"
"49.8|最後一步永遠由你決定——麥麥不會替你按這顆按鈕。"
"56.8|這顆按鈕，我們自己按過——真實帳戶，五百塊 USDT，成交單號當場回來。"
"63.8|每一步都寫進稽核軌跡。"
"66.4|合規是系統設計。AI 有手，方向盤在你手上。"
)

i=0; INPUTS=(); FILTERS=(); BAD=0
for c in "${CUES[@]}"; do
  t="${c%%|*}"; text="${c#*|}"
  say -v "$VOICE" -r "$RATE" -o "$TTS/$i.aiff" "$text"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TTS/$i.aiff")
  end=$(python3 -c "print(round($t + $dur, 2))")
  nxt="${CUES[$((i+1))]}"; nxt="${nxt%%|*}"; [ -z "$nxt" ] && nxt="$FILM_END"
  flag=""
  if python3 -c "exit(0 if $end > $nxt else 1)"; then flag="  ⚠ 壓到下一句／超出片尾"; BAD=1; fi
  printf "L%-2d %5.1f→%5.1f（下一句 %5.1f）%s\n" $((i+1)) "$t" "$end" "$nxt" "$flag"
  INPUTS+=(-i "$TTS/$i.aiff")
  ms=$(python3 -c "print(int(float('$t')*1000))")
  FILTERS+=("[$((i+1)):a]adelay=${ms}|${ms}[a$i];")
  i=$((i+1))
done

[ "$BAD" = 1 ] && echo "⚠ 有句子壓線——改短那句或挪動起點，別調快 RATE。"
[ -n "$CHECK" ] && exit 0

MIX=""; for ((j=0;j<i;j++)); do MIX="$MIX[a$j]"; done
FILTER="$(IFS=; echo "${FILTERS[*]}")${MIX}amix=inputs=$i:normalize=0[aout]"

ffmpeg -y -loglevel error -i "$IN" "${INPUTS[@]}" -filter_complex "$FILTER" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
echo "✔ $OUT"
