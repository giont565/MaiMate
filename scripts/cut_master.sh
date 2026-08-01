#!/bin/bash
# 主片剪接：鏡 1–5 ＋ 鏡 6–7 ＋ 鏡 8 串成完整片（無旁白）。
#
#   bash scripts/cut_master.sh <素材目錄> <輸出.mp4>
#
# 三段素材規格一致（780×1688 H.264），所以先各自切段再 concat，不重新縮放。
#
# ⚠ 鏡 6 刻意切成兩段、跳過 44.35–48.0s：成交在 44.45s 發生，確認卡一被移除、
#   畫面回流，方案卡的「執行後佔比 8.6%」就跳到畫面頂端——那是 08-01 16:10
#   佔比修正**之前**錄的錯數字（真值 0.106%）。B 段收在按鈕變「送出中…」，
#   C 段接已成交，跳過那三秒就乾淨了，不必為了這個再花一筆真單重錄。
#   （切 44.9 會露出 0.5 秒，實測過。）
# ⚠ 鏡 1–5 要留到 56.5s：確認卡 50.6s 才出現，切太早那張卡只閃 1 秒，
#   「最後一步由你決定」的停頓就沒了。
set -e
SRC="${1:?用法：bash scripts/cut_master.sh <素材目錄> <輸出.mp4>}"
OUT="${2:-主片_無旁白.mp4}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cut() {  # cut <輸入> <起> <長度> <輸出>
  ffmpeg -y -loglevel error -ss "$2" -i "$1" -t "$3" \
    -r 25 -c:v libx264 -pix_fmt yuv420p -crf 18 -an "$4"
}

cut "$SRC/鏡1-5_修正後_20260801.mp4"  0    56.5 "$TMP/a.mp4"  # 鏡1–5：首屏→確認卡不按
cut "$SRC/鏡6_真實下單_20260801.mp4"  41.0  3.35 "$TMP/b.mp4" # 鏡6：確認卡→人按下（收在「送出中…」）
cut "$SRC/鏡6_真實下單_20260801.mp4"  48.0  5.6 "$TMP/c.mp4"  # 鏡7：已成交＋稽核軌跡
cut "$SRC/鏡8_收尾_20260801.mp4"       2.5  6.0 "$TMP/d.mp4"  # 鏡8：首屏定格

for f in a b c d; do echo "file '$TMP/$f.mp4'" >> "$TMP/list.txt"; done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
echo "✔ $OUT（${DUR%.*} 秒）"
