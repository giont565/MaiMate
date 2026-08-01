#!/usr/bin/env bash
# 部署到指定環境。用法：./scripts/deploy.sh <private|official> [--frontend-only|--backend-only]
#
# 為什麼要有這支：2026-08-01 決賽前發現比賽環境跑的前端在 git 全部歷史裡查無對應版本
# ——有人直接把自己電腦的檔案 sync 上去。沒紀錄、沒跑過 CI、重現不了。
# 這支的規則只有一條：**雲端只從 main 部署**。其餘（API_BASE 該指哪、KB 該用哪個、
# 哪個 bucket 配哪個 distribution）全部由腳本決定，不靠人記。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:-}"
MODE="${2:-all}"

case "$ENV" in
  private)
    PROFILE_ARG=(); REGION="us-east-1"; KB="PDEGDAUUH9"
    API="https://hwgog76s3a.execute-api.us-east-1.amazonaws.com"
    BUCKET="maimate-frontendbucket-tdpftef0y2d6"; DIST="ECJ9UVQF1D5O3"
    SITE="https://d1ttogc25b56n5.cloudfront.net"; LABEL="私人／錄影環境"
    ;;
  official)
    PROFILE_ARG=(--profile hackathon); REGION="us-west-2"; KB="ZGBLEOY7CR"
    API="https://10n5xyf7i4.execute-api.us-west-2.amazonaws.com"
    BUCKET="maimate-frontendbucket-c6ydvtulu9fc"; DIST="E2OC6B03DVGXWI"
    SITE="https://d1z0776b4u2tmf.cloudfront.net"; LABEL="比賽環境（上台用）"
    ;;
  *) echo "用法：./scripts/deploy.sh <private|official> [--frontend-only|--backend-only]"; exit 2 ;;
esac

echo "▶ 目標：$LABEL（$REGION）"

# ── 閘門：只從 main 部署 ────────────────────────────────────────────
git fetch -q origin
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "✘ 目前在分支 '$BRANCH'。雲端只從 main 部署，請先開 PR 合進 main。"; exit 1
fi
if [ -n "$(git rev-list origin/main..HEAD)" ] || [ -n "$(git rev-list HEAD..origin/main)" ]; then
  echo "✘ 本機 main 與 origin/main 不同步。先 git pull（或把你的 commit 開成 PR）。"; exit 1
fi

# 未提交的改動：只放行「前端 API_BASE 覆寫」與自動生成的 sw-assets.js，其餘一律擋
DIRTY=$(git status --porcelain | awk '{print $2}' \
        | grep -vE '^frontend/(index|chat|host-app|onboarding|welcome)\.html$|^frontend/sw-assets\.js$' || true)
if [ -n "$DIRTY" ]; then
  echo "✘ 有未提交的改動，不能部署（部署出去就查不到是什麼版本了）："
  echo "$DIRTY" | sed 's/^/    /'
  echo "  → 先 commit 開 PR，或 git stash。"; exit 1
fi

echo "✔ 版本閘門通過：main @ $(git rev-parse --short HEAD)"

# ── 後端 ──────────────────────────────────────────────────────────
if [ "$MODE" != "--frontend-only" ]; then
  echo "▶ 後端部署（KB=$KB）"
  ( cd infra && sam build && sam deploy --stack-name maimate --region "$REGION" "${PROFILE_ARG[@]}" \
      --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --resolve-s3 \
      --no-confirm-changeset --no-fail-on-empty-changeset \
      --parameter-overrides "KnowledgeBaseId=$KB" GuardrailId=off GuardrailVersion=1 )
  echo "🚨 提醒：CloudFormation 剛把 MAX_API_KEY／MAX_API_SECRET 清掉了。"
  echo "   去 Lambda 主控台用「Add environment variable」補回 ChatFunction 與 OrderFunction 兩支。"
  echo "   不要用 aws lambda update-function-configuration --environment（整組取代，會清掉 KB_ID）。"
fi

# ── 前端 ──────────────────────────────────────────────────────────
if [ "$MODE" != "--backend-only" ]; then
  echo "▶ 前端部署（API_BASE → $API）"
  # 不管本機現在指哪，一律改成這個環境該指的，推完還原。避免「畫面正常但連錯後端」。
  ORIG=$(grep -h -o 'window.API_BASE = "[^"]*"' frontend/index.html)
  perl -pi -e "s|window\.API_BASE = \"[^\"]*\"|window.API_BASE = \"$API\"|" frontend/*.html
  npm run --silent build:sw >/dev/null
  aws s3 sync frontend/ "s3://$BUCKET/" --region "$REGION" "${PROFILE_ARG[@]}" --exclude "mocks/*" --delete
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" "${PROFILE_ARG[@]}" \
    --query 'Invalidation.Id' --output text | sed 's/^/  快取清除 id: /'
  git checkout -- frontend/*.html && npm run --silent build:sw >/dev/null
  echo "  （本機前端已還原成 main 的版本：$ORIG）"
fi

echo
echo "✅ 完成。驗證："
echo "   $SITE"
echo "   curl -s -o /dev/null -w '%{http_code}\\n' $SITE/intro.html   # 動畫要 200，不能是 403"
[ "$ENV" = "official" ] && echo "   python3 scripts/verify_strategy_tool.py --env official"
[ "$ENV" = "private" ]  && echo "   npm run verify:strategy"
exit 0
