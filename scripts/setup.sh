#!/usr/bin/env bash
# 組員環境檢查與初始化：clone 完 repo 後跑這支，缺什麼會直接告訴你。
set -u

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✘\033[0m %s\n" "$1"; MISSING=1; }
warn() { printf "  \033[33m！\033[0m %s\n" "$1"; }
MISSING=0

echo "== 1/4 基本工具 =="
command -v git >/dev/null && ok "git $(git --version | cut -d' ' -f3)" || bad "git 未安裝 → https://git-scm.com"
command -v python3 >/dev/null && ok "python3 $(python3 -V | cut -d' ' -f2)" || bad "python3 未安裝 → https://python.org"
command -v node >/dev/null && ok "node $(node -v)" || bad "node 未安裝 → https://nodejs.org（跑簡報產生器才需要）"
command -v aws >/dev/null && ok "aws cli $(aws --version 2>&1 | cut -d' ' -f1 | cut -d/ -f2)" || warn "aws cli 未安裝（部署時才需要）→ 搜尋 AWS CLI installer"
command -v sam >/dev/null && ok "sam cli" || warn "sam cli 未安裝（部署時才需要）→ 搜尋 AWS SAM CLI"

echo "== 2/4 MAX 金鑰（環境變數）=="
[ -n "${MAX_API_KEY:-}" ] && ok "MAX_API_KEY 已設定" || warn "MAX_API_KEY 未設定（下單/餘額功能才需要；金鑰自己保管、不進 git）"
[ -n "${MAX_API_SECRET:-}" ] && ok "MAX_API_SECRET 已設定" || warn "MAX_API_SECRET 未設定"

echo "== 3/4 官方資料集 =="
CSV="$(dirname "$0")/../data/MaiCoin_transactions.csv"
if [ -f "$CSV" ]; then
  ok "CSV 就位（$(wc -l < "$CSV" | tr -d ' ') 行）"
else
  warn "data/MaiCoin_transactions.csv 不存在——到 Slack #general 釘選的 Drive 連結下載「可使用數據」放進 data/（CSV 不進 git，屬正常）"
fi

echo "== 4/4 行為分析預計算 =="
if [ -f "$CSV" ]; then
  python3 "$(dirname "$0")/../analysis/precompute.py" >/dev/null 2>&1 \
    && ok "health_report.json 已產出" \
    || bad "precompute.py 執行失敗——把錯誤訊息貼到 Slack #dev"
else
  warn "略過（等 CSV 就位後跑：python3 analysis/precompute.py）"
fi

echo ""
if [ "$MISSING" = 1 ]; then
  echo "→ 紅色 ✘ 項目處理完再跑一次本腳本。"
else
  echo "→ 環境 OK。下一步：用 Kiro 開啟本資料夾，左側 Specs 面板領任務。"
fi
