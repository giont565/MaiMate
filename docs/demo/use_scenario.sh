#!/usr/bin/env bash
# PITCH_DECK.html 第 5–8 頁的 Demo 劇本切換。
#
#   ./docs/demo/use_scenario.sh eth     # 「ETH 跌太多了，幫我全部賣掉。」（簡報第 5 頁現行標題）
#   ./docs/demo/use_scenario.sh usdt    # 「幫我買 500 NTD 的 USDT」（docs/DEMO_SCRIPT.md 現行主線）
#   ./docs/demo/use_scenario.sh         # 只顯示目前用的是哪一套
#
# 為什麼要這支：簡報吃的是固定檔名 demo/02_tools.mp4 … 05_execute.mp4（HTML 寫死在
# img.media[data-video]），而我們有兩套劇本。直接改 HTML 會讓兩邊分岔，所以改成
# 「換檔案不換 HTML」。第 4 頁的 01_profile.mp4 是健檢首屏，兩套共用，這支不動它。
#
# ⚠ 播放邏輯是「載得到才換成影片，載不到就留著 pitch_shots/*.png」——不報錯。
#   所以切換後務必看一眼第 5–8 頁真的在動，不要相信「沒跳錯誤就是好了」。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOTS=(02_tools 03_context 04_scenarios 05_execute)

current() {
  for s in eth usdt; do
    local same=1
    for f in "${SHOTS[@]}"; do
      [ -f "$DIR/$f.mp4" ] && [ -f "$DIR/scenarios/$s/$f.mp4" ] || { same=0; break; }
      cmp -s "$DIR/$f.mp4" "$DIR/scenarios/$s/$f.mp4" || { same=0; break; }
    done
    [ $same -eq 1 ] && { echo "$s"; return; }
  done
  echo "unknown"
}

if [ $# -eq 0 ]; then
  echo "目前使用：$(current)"
  echo "可選：eth／usdt"
  exit 0
fi

want="$1"
case "$want" in
  eth|usdt) ;;
  *) echo "✘ 只接受 eth 或 usdt，收到：$want" >&2; exit 2 ;;
esac

src="$DIR/scenarios/$want"
[ -d "$src" ] || { echo "✘ 找不到 $src" >&2; exit 1; }
for f in "${SHOTS[@]}"; do
  [ -f "$src/$f.mp4" ] || { echo "✘ 缺 $src/$f.mp4，中止（不做半套切換）" >&2; exit 1; }
done

for f in "${SHOTS[@]}"; do cp "$src/$f.mp4" "$DIR/$f.mp4"; done
echo "✔ 已切換到 $want"
for f in 01_profile "${SHOTS[@]}"; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DIR/$f.mp4" 2>/dev/null || echo "?")
  printf "   %-16s %ss\n" "$f.mp4" "$d"
done
echo "→ 開 docs/PITCH_DECK.html，確認第 5–8 頁真的在播（靜態圖＝沒載到）。"
